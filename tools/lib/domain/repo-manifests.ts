// repo-manifests.ts — reader for per-repo tool manifests (.devenv/manifest.yaml)
// in the workspace's cloned org repos. Same vocabulary as devenv's own
// builtin-command-descriptors.yaml / curated-command-descriptors.yaml:
// read-only | mutating | destructive.
// This is the extension-command layer of the tier oracle: devenv's own
// commands declare in tools/config/; every other tool provider declares in
// its own repo, next to the .devenv/bin executables it ships.
import { load, JSON_SCHEMA } from "js-yaml";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { CommandTier } from "./command-descriptors.ts";

/** The vocabulary the manifest layer shares with devenv's descriptors. */
const VALID_TIERS: ReadonlySet<string> = new Set([
  "read-only",
  "mutating",
  "destructive",
  "restricted",
  "prohibited",
]);

export interface ManifestExecutable {
  name: string;
  tier: CommandTier;
  purpose?: string;
  /** Present when the executable requires its confirm-guard (non-interactive refuses). */
  confirm?: boolean;
  /** For genuinely multi-verb executables: per-subcommand tier declarations. */
  subcommands?: { name: string; tier: CommandTier }[];
  /**
   * Long flags that consume the next argument as their value (e.g. srs's
   * --gitops <path>). Subcommand resolution skips these values; without
   * the declaration, a value arg could be mistaken for a subcommand name.
   */
  valueFlags?: string[];
  /** Restricted only (required): the skills whose sessions may invoke. */
  "restricted-to"?: string[];
  /** Prohibited only (optional): the sanctioned substitute for the job. */
  route?: string;
}

export interface RepoManifest {
  /** Repository name (directory name under repos/, owner/repo without the owner). */
  name: string;
  purpose?: string;
  /** Entry document for orientation (relative to the repo root). */
  doc?: string;
  executables: ManifestExecutable[];
  /** Absolute path of the manifest file this was read from. */
  sourcePath: string;
}

/** A tier answer with its provenance — the oracle never guesses where a tier came from. */
export interface TierResolution {
  tier: CommandTier;
  /** Where the declaration lives: "builtin", "curated", "org", or the repo directory name. */
  source: string;
  /** The matched declaration (whole executable, or the subcommand entry). */
  matched: string;
  /** Restricted only: the licensed skills (the caller checks itself against this). */
  license?: string[];
  /** Prohibited only: the sanctioned substitute for the job. */
  route?: string;
  /** Curated only: network data flow — the admission generator never auto-allows. */
  egress?: boolean;
}

const DEVENV_ROOT_CANDIDATES = (): string[] => {
  // DEVENV_ROOT when set; else this checkout's own root via the self-root
  // pattern (tools/lib/domain/repo-manifests.ts → repo root) — a nested
  // checkout must read ITS OWN repos, never the outer workspace's.
  const root = process.env["DEVENV_ROOT"];
  if (root) return [root];
  const here = dirname(fileURLToPath(import.meta.url));
  return [join(here, "..", "..", "..")];
};

/**
 * The repos root: the first candidate directory that exists and contains a
 * repos/ directory (or IS a repos directory). No workspace-validity marker —
 * the scan itself is the test: a root with no manifests yields an empty
 * layer, which is a correct answer ("no org tools cloned"), not an error.
 * Callers may pass an explicit root.
 */
export function reposRoot(explicit?: string): string | null {
  if (explicit !== undefined && explicit !== "") return explicit;
  for (const root of DEVENV_ROOT_CANDIDATES()) {
    for (const c of [join(root, "repos"), root]) {
      if (existsSync(c)) return c;
    }
  }
  return null;
}

/**
 * Read one repo's manifest by repo directory name. Isolation contract: a
 * malformed manifest (bad YAML, missing executables, an entry outside the
 * shared tier vocabulary, or missing required fields) is WARNED on stderr
 * and treated as absent — one bad repo never bricks the layer, and an
 * invalid entry is never resolved (it would print `undefined` as a tier).
 * Returns null when the repo is not cloned, has no manifest, or the
 * manifest is invalid — unknown, never defaulted, never a crash.
 */
export function readRepoManifest(repoDir: string, reposRootDir?: string): RepoManifest | null {
  const root = reposRoot(reposRootDir);
  if (root === null) return null;
  const path = join(root, repoDir, ".devenv", "manifest.yaml");
  if (!existsSync(path)) return null;
  let parsed: Partial<RepoManifest>;
  try {
    parsed = load(readFileSync(path, "utf8"), { schema: JSON_SCHEMA }) as Partial<RepoManifest>;
  } catch (err) {
    warnInvalid(path, `unparseable YAML: ${(err as Error).message.split("\n")[0]}`);
    return null;
  }
  if (parsed === null || typeof parsed !== "object" || !Array.isArray(parsed.executables)) {
    warnInvalid(path, "no executables list");
    return null;
  }
  const executables: ManifestExecutable[] = [];
  for (const e of parsed.executables) {
    if (e === null || typeof e !== "object" || typeof e.name !== "string" || e.name === "") {
      warnInvalid(path, "an executable entry is missing its name");
      return null;
    }
    if (typeof e.tier !== "string" || !VALID_TIERS.has(e.tier)) {
      warnInvalid(
        path,
        `executable '${e.name}' tier '${String(e.tier)}' is outside the shared vocabulary ` +
          `(${[...VALID_TIERS].join(" | ")})`,
      );
      return null;
    }
    // Command-vs-caller rules, same as the devenv layer: a restricted
    // executable requires its license; route belongs on prohibited only.
    if (e.tier === "restricted" && (!Array.isArray(e["restricted-to"]) || (e["restricted-to"] ?? []).length === 0)) {
      warnInvalid(path, `executable '${e.name}' is restricted without a restricted-to license — declare the license or use prohibited`);
      return null;
    }
    if (e.tier !== "prohibited" && e.route !== undefined) {
      warnInvalid(path, `executable '${e.name}' carries route on a non-prohibited tier — route belongs on prohibited`);
      return null;
    }
    if (e.subcommands !== undefined) {
      for (const sc of e.subcommands) {
        if (
          sc === null ||
          typeof sc !== "object" ||
          typeof sc.name !== "string" ||
          typeof sc.tier !== "string" ||
          !VALID_TIERS.has(sc.tier)
        ) {
          warnInvalid(path, `executable '${e.name}' has an invalid subcommand entry`);
          return null;
        }
        // Subcommand entries carry the same command-vs-caller rules as
        // whole executables: a restricted subcommand requires its license
        // (a license-less restricted is a prohibited verb), and route
        // belongs on prohibited only.
        const scRestrictedTo = (sc as { "restricted-to"?: string[] })["restricted-to"];
        const scRoute = (sc as { route?: string }).route;
        if (sc.tier === "restricted" && (!Array.isArray(scRestrictedTo) || scRestrictedTo.length === 0)) {
          warnInvalid(path, `executable '${e.name}' subcommand '${sc.name}' is restricted without a restricted-to license — declare the license or use prohibited`);
          return null;
        }
        if (sc.tier !== "prohibited" && scRoute !== undefined) {
          warnInvalid(path, `executable '${e.name}' subcommand '${sc.name}' carries route on a non-prohibited tier — route belongs on prohibited`);
          return null;
        }
      }
    }
    executables.push(e as ManifestExecutable);
  }
  return {
    name: typeof parsed.name === "string" && parsed.name !== "" ? parsed.name : repoDir,
    ...(typeof parsed.purpose === "string" && parsed.purpose !== "" ? { purpose: parsed.purpose } : {}),
    ...(typeof parsed.doc === "string" && parsed.doc !== "" ? { doc: parsed.doc } : {}),
    executables,
    sourcePath: path,
  };
}

function warnInvalid(path: string, reason: string): void {
  process.stderr.write(
    `repo-manifests: skipping invalid manifest ${path} — ${reason}. ` +
      `Its executables resolve as unknown (exit 1), never defaulted.\n`,
  );
}

/**
 * Every cloned repo manifest (each repo's .devenv/manifest.yaml under the
 * repos root), in stable directory order. Repos without manifests are
 * simply absent — absence is information, not an error.
 */
export function allRepoManifests(reposRootDir?: string): RepoManifest[] {
  const root = reposRoot(reposRootDir);
  if (root === null) return [];
  let entries: string[];
  try {
    entries = readdirSync(root, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort();
  } catch {
    return [];
  }
  const manifests: RepoManifest[] = [];
  for (const dir of entries) {
    const m = readRepoManifest(dir, root);
    if (m !== null) manifests.push(m);
  }
  return manifests;
}

/**
 * Resolve an executable's tier across the manifest layer, including
 * subcommand resolution for multi-verb executables (srs deploy vs verify).
 * Returns null when no cloned manifest declares the executable.
 *
 * Collision contract: when a higher layer (org, builtin, curated) has
 * already answered for this name, the caller never reaches this function —
 * the manifest layer is the last resort. The REVERSE case (a repo
 * manifest naming something this workspace wall already declares) is
 * surfaced where it is knowable: manifestTierResolution itself warns when
 * the name resolves in the workspace layers too, so a repo that declares
 * a shadowed name learns its declaration is inert, not silently ignored.
 */
export function manifestTierResolution(
  executable: string,
  args: readonly string[] = [],
  reposRootDir?: string,
): TierResolution | null {
  for (const manifest of allRepoManifests(reposRootDir)) {
    const exe = manifest.executables.find((e) => e.name === executable);
    if (exe === undefined) continue;
    // Subcommand resolution: the first arg that is neither a flag nor a
    // declared value-flag's value, when the executable declares
    // subcommands. A matching subcommand wins; a non-matching first
    // positional falls back to the executable's declared ceiling.
    if (exe.subcommands !== undefined && exe.subcommands.length > 0 && args.length > 0) {
      const valueFlags = exe.valueFlags ?? [];
      let sub: string | undefined;
      for (let i = 0; i < args.length; i += 1) {
        const a = args[i] ?? "";
        if (a.startsWith("-")) {
          if (valueFlags.includes(a) && i + 1 < args.length) i += 1; // skip its value
          continue;
        }
        sub = a;
        break;
      }
      if (sub !== undefined) {
        const sc = exe.subcommands.find((s) => s.name === sub);
        if (sc !== undefined) {
          // Subcommand entries may carry their own license (restricted) or
          // route (prohibited) — the same answer fields as whole-executable
          // declarations, so the caller reads the substitution, never invents it.
          const scLicense = (sc as { "restricted-to"?: string[] })["restricted-to"];
          const scRoute = (sc as { route?: string }).route;
          return {
            tier: sc.tier,
            source: manifest.name,
            matched: `${exe.name} ${sc.name}`,
            ...(scLicense !== undefined ? { license: scLicense } : {}),
            ...(scRoute !== undefined ? { route: scRoute } : {}),
          };
        }
      }
    }
    const license = exe.tier === "restricted" ? exe["restricted-to"] : undefined;
    const route = exe.tier === "prohibited" ? exe.route : undefined;
    return {
      tier: exe.tier,
      source: manifest.name,
      matched: exe.name,
      ...(license !== undefined ? { license } : {}),
      ...(route !== undefined ? { route } : {}),
    };
  }
  return null;
}
