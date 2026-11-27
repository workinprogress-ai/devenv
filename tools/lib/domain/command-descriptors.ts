// command-descriptors.ts — reader for tools/config/builtin-command-descriptors.yaml,
// tools/config/curated-command-descriptors.yaml, and
// tools/config/org-command-descriptors.yaml (the three YAML descriptor
// layers; the file names carry the provenance — builtin ships with the
// repo, curated is upstream-maintained judgment over the generic machine
// surface, org is this organization's standards and org-specific commands).
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
import { manifestTierResolution, allRepoManifests, type TierResolution } from "./repo-manifests.ts";

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
  /** Provenance: provider (self-description), curated (upstream judgment),
   *  or org (this org's ruling — the deployment authority). */
  source?: "provider" | "curated" | "org";
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

function orgPath(): string {
  // tools/lib/domain/command-descriptors.ts → tools/config/org-command-descriptors.yaml
  // DEVENV_ORG_DESCRIPTORS overrides the location (the DEVENV_ROOT
  // precedent): a deployment redirect, and the test seam that keeps org
  // fixtures process-local — vitest workers run files in separate
  // processes, so a fixture file under this override never races the
  // shared tracked file another worker reads.
  const override = process.env["DEVENV_ORG_DESCRIPTORS"];
  if (override !== undefined && override !== "") return override;
  const here = dirname(fileURLToPath(import.meta.url));
  return join(here, "..", "..", "config", "org-command-descriptors.yaml");
}

function readYamlCommands(
  path: string,
  source: "provider" | "curated" | "org",
): CommandDescriptor[] {
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

/** The org layer: THIS organization's ruling over its own machines — org
 *  standards (full-replacement overrides) and org-specific commands
 * (az-class CLIs upstream has never seen). Fork-stable file, blank by
 *  default upstream; resolves FIRST (the deployment authority). */
export function orgDescriptors(): CommandDescriptor[] {

  return readYamlCommands(orgPath(), "org");
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
    } else if (
      (d.tier === "prohibited" && d.source === "curated") ||
      (d.tier === "prohibited" && d.source === "org")
    ) {
      // Curated/org-only grammar: subcommand-shaped read forms (git log,
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
 *  the org layer (deployment authority) → devenv's own (provider) → the
 *  curated layer (upstream judgment) → the cloned repos' manifests.
 *  Returns the descriptor plus which layer answered. */
export function descriptorWithLayer(
  name: string,
  reposRootDir?: string,
): { descriptor: CommandDescriptor; layer: "org" | "builtin" | "curated" | "manifest" } | null {
  const o = orgDescriptors().find((x) => x.name === name);
  if (o !== undefined) return { descriptor: o, layer: "org" };
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
 * declared — the org layer first (the deployment authority: org policy
 * outranks provider self-description — "different standards"), then
 * devenv's own descriptors, then the curated layer, then the cloned repos'
 * .devenv/manifest.yaml layer. Precedence mirrors the PATH rule in the
 * generated devenvrc: devenv tools come first, so a repo tool can never
 * shadow a devenv tool of the same name — and by the same principle a
 * repo manifest can never shadow the org/builtin/curated walls. Unknown
 * commands return null — the judgment lane, never a silent default. The
 * resolution carries the license (restricted) or route (prohibited) when
 * declared — the caller reads the substitution, never invents it.
 */
export function resolveTier(
  name: string,
  args: readonly string[] = [],
  reposRootDir?: string,
): TierResolution | null {
  // 0. The org layer (deployment authority; org entries are full
  //    replacements — no field merge with the shadowed declaration).
  const o = orgDescriptors().find((x) => x.name === name);
  if (o !== undefined) {
    const forms = o["read-only-forms"] ?? [];
    const flagForms = forms.filter((f) => f.startsWith("--"));
    const subcommand = args.find((a) => !a.startsWith("-"));
    // Org entries get both demotion grammars: flags demote a mutating
    // ceiling (the builtin rule), subcommands demote a prohibited ceiling
    // (the curated read-grammar rule) — the org writes complete
    // declarations, so both shapes are available to it.
    const flagDemoted =
      o.tier === "mutating" &&
      flagForms.length > 0 &&
      args.some((a) => flagForms.includes(a));
    const subDemoted =
      o.tier === "prohibited" &&
      subcommand !== undefined &&
      forms.includes(subcommand);
    const license = o.tier === "restricted" ? o["restricted-to"] : undefined;
    const route = o.tier === "prohibited" && !subDemoted ? o.route : undefined;
    const demoted = flagDemoted || subDemoted;
    return {
      tier: demoted ? "read-only" : o.tier,
      source: "org",
      matched: o.name,
      ...(license !== undefined ? { license } : {}),
      ...(route !== undefined ? { route } : {}),
      ...(o.egress === true ? { egress: true } : {}),
    };
  }
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
  // 3. The manifest layer (cloned repos; subcommand-aware). A repo
  //    manifest can never shadow the org/builtin/curated layers — the
  //    PATH-rule analogy: the higher layer answers first, so a manifest
  //    entry naming a workspace-declared command is INERT. Those inert
  //    entries are surfaced by manifestCollisions() (the inventory
  //    surface: --list skips them and warns) — a resolution that reaches
  //    this step has, by construction, no collision.
  return manifestTierResolution(name, args, reposRootDir);
}

/**
 * Manifest-declared executables whose names a workspace layer
 * (org/builtin/curated) already declares — INERT manifest entries: the
 * workspace layer wins every lookup, so the repo's declaration never
 * answers. The inventory surface (--list, ops-orient) skips these and
 * warns; the repo author renames the tool or drops the entry. A repo
 * tool can never shadow a workspace declaration, same as the PATH rule.
 */
export function manifestCollisions(
  reposRootDir?: string,
): {
  name: string;
  source: string;
  tier: CommandTier;
  shadowSource: string;
  shadowTier: CommandTier;
}[] {
  const layerOf = (name: string): { source: string; tier: CommandTier } | undefined => {
    const o = orgDescriptors().find((x) => x.name === name);
    if (o !== undefined) return { source: "org", tier: o.tier };
    const b = commandDescriptor(name);
    if (b !== null) return { source: "builtin", tier: b.tier };
    const c = curatedDescriptors().find((x) => x.name === name);
    if (c !== undefined) return { source: "curated", tier: c.tier };
    return undefined;
  };
  const collisions: {
    name: string;
    source: string;
    tier: CommandTier;
    shadowSource: string;
    shadowTier: CommandTier;
  }[] = [];
  for (const m of allRepoManifests(reposRootDir)) {
    for (const e of m.executables) {
      const shadow = layerOf(e.name);
      if (shadow !== undefined) {
        collisions.push({
          name: e.name,
          source: m.name,
          tier: e.tier,
          shadowSource: shadow.source,
          shadowTier: shadow.tier,
        });
      }
    }
  }
  return collisions;
}

/** All declared descriptors (for inventory/listing surfaces). */
export function allCommandDescriptors(): CommandDescriptor[] {
  return readDescriptors();
}
