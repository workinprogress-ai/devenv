// command-descriptors.ts — reader for tools/config/builtin-command-descriptors.yaml
// and tools/config/curated-command-descriptors.yaml (the two fork-shared
// descriptor layers; the file names carry the provenance — builtin ships with
// the repo, curated is org judgment over external commands).
// (the provider-declares caution surface for the commands this repo ships).
// Command-vs-caller vocabulary, one with tool-repo manifests:
// read-only | mutating | destructive (what the call does) · restricted (who
// may call — a named-skill license) · prohibited (whether at all — optional
// route: names the substitute). Unknown command names are the caller's
// problem to surface (the judgment lane), never silently defaulted.
import { load, JSON_SCHEMA } from "js-yaml";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { manifestTierResolution, type TierResolution } from "./repo-manifests.ts";

export type CommandTier = "read-only" | "mutating" | "destructive" | "restricted" | "prohibited";

export const COMMAND_TIERS: readonly CommandTier[] = [
  "read-only",
  "mutating",
  "destructive",
  "restricted",
  "prohibited",
] as const;

/** The command-vs-caller model: each tier word answers exactly one question.
 *  The three base tiers answer WHAT the call does; `restricted` answers WHO
 *  may call (a named-skill license, required: a license-less restricted is
 *  schema-invalid — that command belongs at prohibited); `prohibited` answers
 *  WHETHER the command is available at all, and its optional `route:` names
 *  the substitute when the job is still doable (no route = no agent path,
 *  hand to a human; the routed command may itself be restricted — the
 *  substitution chain). */
export interface CommandDescriptor {
  name: string;
  tier: CommandTier;
  note?: string;
  /**
   * Flag shapes where the provider declares the invocation provably demotes
   * to read-only (e.g. "--dry-run"). The declared tier is the ceiling: the
   * worst state reachable without a built-in guard. Consumers demote only
   * on a provider-declared form — never the reverse.
   */
  "read-only-forms"?: string[];
  /** Restricted only (required): the skills whose sessions may invoke this
   * command. A license, not a danger grade — the command itself is fine. */
  "restricted-to"?: string[];
  /** Prohibited only (optional): the sanctioned substitute for the JOB —
   * the blessed command or wrapper that does what this command would have. */
  route?: string;
  /** Curated only: marks network data flow orthogonal to state mutation —
   * the admission generator never auto-allows egress-bearing entries. */
  egress?: boolean;
  /** Provenance: provider (self-description) or curated (org judgment). */
  source?: "provider" | "curated";
}

function descriptorsPath(): string {
  // tools/lib/domain/command-descriptors.ts → tools/config/builtin-command-descriptors.yaml
  const here = dirname(fileURLToPath(import.meta.url));
  return join(here, "..", "..", "config", "builtin-command-descriptors.yaml");
}

function curatedPath(): string {
  // tools/lib/domain/command-descriptors.ts → tools/config/curated-command-descriptors.yaml
  const here = dirname(fileURLToPath(import.meta.url));
  return join(here, "..", "..", "config", "curated-command-descriptors.yaml");
}

function readYamlCommands(path: string, source: "provider" | "curated"): CommandDescriptor[] {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    return []; // absent file = empty layer, not an error
  }
  let parsed: { commands?: CommandDescriptor[] };
  try {
    parsed = load(raw, { schema: JSON_SCHEMA }) as { commands?: CommandDescriptor[] };
  } catch (err) {
    process.stderr.write(
      `command-descriptors: skipping unparseable ${path} — ${(err as Error).message.split("\n")[0]}. ` +
        `Its commands resolve as unknown (exit 1), never defaulted.\n`,
    );
    return [];
  }
  // The file's location IS the provenance: stamp before validation so the
  // curated grammar rule can apply (subcommand forms demote a prohibited
  // curated ceiling — the read grammar is open while the command is closed).
  return (parsed.commands ?? [])
    .map((c) => ({ ...c, source }))
    .filter(isValidDescriptor);
}

function readDescriptors(): CommandDescriptor[] {
  return readYamlCommands(descriptorsPath(), "provider");
}

/** The os layer: org judgment (curated provenance) over the machine's command
 * surface — commands devenv did not author but agents invoke. */
export function curatedDescriptors(): CommandDescriptor[] {
  return readYamlCommands(curatedPath(), "curated");
}

/**
 * Command-vs-caller validation, matching the manifest-layer isolation
 * contract: an invalid entry is WARNED on stderr and treated as absent
 * (unknown, exit 1) — never a crash, never a silently-wrong tier.
 *  - `restricted` requires a non-empty `restricted-to` license (a
 *    license-less restricted is really a prohibited command).
 *  - `route`/`restricted-to` on a tier they don't belong to is a modeling
 *    mistake, not a hint.
 *  - `read-only-forms` only demotes a mutating ceiling.
 */
function isValidDescriptor(d: CommandDescriptor): boolean {
  const bad = (reason: string): boolean => {
    process.stderr.write(
      `command-descriptors: skipping invalid entry '${d.name}' — ${reason}. Treated as unknown (exit 1), never defaulted.\n`,
    );
    return false;
  };
  if (d.tier === "restricted") {
    if (!Array.isArray(d["restricted-to"]) || (d["restricted-to"] ?? []).length === 0) {
      return bad("restricted requires a non-empty restricted-to license — a license-less restricted is a prohibited command");
    }
    if (d.route !== undefined) return bad("route belongs on prohibited, not restricted");
  }
  if (d.tier === "prohibited") {
    if (d["restricted-to"] !== undefined) return bad("restricted-to belongs on restricted, not prohibited");
  } else if (d.tier !== "restricted" && d["restricted-to"] !== undefined) {
    return bad("restricted-to belongs on restricted entries only");
  }
  if (d.tier !== "prohibited" && d.route !== undefined) {
    return bad("route belongs on prohibited entries only");
  }
  const forms = d["read-only-forms"];
  if (Array.isArray(forms) && forms.length > 0) {
    if (d.tier === "mutating") {
      // Flag-shaped forms (e.g. --dry-run) demote a mutating ceiling.
    } else if (d.tier === "prohibited" && d.source === "curated") {
      // Curated-only grammar: subcommand-shaped read forms (git log,
      // kubectl get) demote a prohibited ceiling — the read grammar is
      // open while the command itself is closed. Flag-shaped entries are
      // still a modeling mistake here.
      const subcommandForms = forms.filter((f) => !f.startsWith("-"));
      const flagForms = forms.filter((f) => f.startsWith("--"));
      if (subcommandForms.length === 0 || flagForms.length > 0) {
        return bad("prohibited curated entries demote on subcommand-shaped read forms only (the read grammar), not flags");
      }
    } else {
      return bad("read-only-forms only demote a mutating ceiling (or a prohibited curated grammar)");
    }
  }
  return true;
}

/**
 * Resolve the descriptor of a shipped command by exact name.
 * Returns null when the command is not declared in the sidecar — an
 * undeclared command is an explicit "unknown", not a default tier.
 */
export function commandDescriptor(name: string): CommandDescriptor | null {
  return readDescriptors().find((c) => c.name === name) ?? null;
}

/** Resolve a descriptor across ALL declared layers in precedence order:
 *  devenv's own (provider) → the curated layer (org judgment) → the cloned
 *  repos' manifests. Returns the descriptor plus which layer answered. */
export function descriptorWithLayer(
  name: string,
  reposRootDir?: string,
): { descriptor: CommandDescriptor; layer: "builtin" | "curated" | "manifest" } | null {
  const d = commandDescriptor(name);
  if (d !== null) return { descriptor: { ...d, source: "provider" }, layer: "builtin" };
  const c = curatedDescriptors().find((x) => x.name === name);
  if (c !== undefined) return { descriptor: { ...c, source: "curated" }, layer: "curated" };
  const m = manifestTierResolution(name, [], reposRootDir);
  if (m !== null) {
    return {
      descriptor: {
        name: m.matched,
        tier: m.tier,
        ...(m.route !== undefined ? { route: m.route } : {}),
        ...(m.license !== undefined ? { "restricted-to": m.license } : {}),
      },
      layer: "manifest",
    };
  }
  return null;
}

/** Resolve just the tier (null when undeclared). */
export function commandTier(name: string): CommandTier | null {
  return commandDescriptor(name)?.tier ?? null;
}

/**
 * The effective tier for a concrete invocation: the declared ceiling,
 * demoted to read-only only when the invocation carries a
 * provider-declared read-only form (e.g. --dry-run).
 * Undeclared commands return null (explicit unknown).
 */
export function effectiveTier(name: string, invocationArgs: readonly string[]): CommandTier | null {
  const d = commandDescriptor(name);
  if (d === null) return null;
  const forms = d["read-only-forms"] ?? [];
  const flagForms = forms.filter((f) => f.startsWith("--"));
  if (flagForms.length > 0 && invocationArgs.some((a) => flagForms.includes(a))) {
    return "read-only";
  }
  return d.tier;
}

/**
 * The universal tier oracle: resolve a command's tier wherever it is
 * declared — devenv's own descriptors first, then the cloned repos'
 * .devenv/manifest.yaml layer. Precedence mirrors the PATH rule in the
 * generated devenvrc: devenv tools come first, so a repo tool can never
 * shadow a devenv tool of the same name. Unknown commands return null —
 * the judgment lane, never a silent default. The resolution carries the
 * license (restricted) or route (prohibited) when declared — the caller
 * reads the substitution, never invents it.
 */
export function resolveTier(
  name: string,
  args: readonly string[] = [],
  reposRootDir?: string,
): TierResolution | null {
  // 1. devenv's own descriptors (layer precedence: ours first).
  const d = commandDescriptor(name);
  if (d !== null) {
    const forms = d["read-only-forms"] ?? [];
    const flagForms = forms.filter((f) => f.startsWith("--"));
    // Demotion applies only to a mutating ceiling: read-only has nothing to
    // demote, destructive never demotes on flags (its confirm-guards are
    // interactive, not flag-shaped), and restricted/prohibited never demote
    // — the license and the route are the answer, not a flag shape.
    const demoted =
      d.tier === "mutating" &&
      flagForms.length > 0 &&
      args.some((a) => flagForms.includes(a));
    const license = d.tier === "restricted" ? d["restricted-to"] : undefined;
    const route = d.tier === "prohibited" ? d.route : undefined;
    return {
      tier: demoted ? "read-only" : d.tier,
      source: "builtin",
      matched: d.name,
      ...(license !== undefined ? { license } : {}),
      ...(route !== undefined ? { route } : {}),
    };
  }
  // 2. The curated layer (org judgment; subcommand-shaped read-only-forms
  //    match the first non-flag arg — the git/kubectl read grammars).
  const c = curatedDescriptors().find((x) => x.name === name);
  if (c !== undefined) {
    const forms = c["read-only-forms"] ?? [];
    const subcommand = args.find((a) => !a.startsWith("-"));
    const subMatch = subcommand !== undefined && forms.includes(subcommand);
    const demoted = c.tier === "prohibited" && subMatch;
    // The route is actionable only on the prohibited ceiling — a demoted
    // read-only answer carries no route (nothing is being refused).
    const route = c.tier === "prohibited" && !demoted ? c.route : undefined;
    return {
      tier: demoted ? "read-only" : c.tier,
      source: "curated",
      matched: c.name,
      ...(route !== undefined ? { route } : {}),
      ...(c.egress === true ? { egress: true } : {}),
    };
  }
  // 3. The manifest layer (cloned repos; subcommand-aware).
  return manifestTierResolution(name, args, reposRootDir);
}

/** All declared descriptors (for inventory/listing surfaces). */
export function allCommandDescriptors(): CommandDescriptor[] {
  return readDescriptors();
}
