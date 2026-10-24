// provider-core.ts — TS provider facade core: detection, repo targeting,
// capability gates, and the error contract (port of provider-core.bash's
// seams; the bash original remains until the bash retirement sweep).
//
// Contract (tools/lib/providers/CONTRACT.md):
//   - Detection is config-driven: the `[provider] name` key in devenv.config,
//     defaulting to github. Only github ships in TS; azure bridges
//     through the bash seam.
//   - The repository is the first argument of every repo-scoped verb; an
//     empty string means "the resolved target": DEVENV_REPO, then the
//     working directory's repository.
//   - Error contract: verbs never `exit`; they throw ProviderError (the TS
//     analogue of return-non-zero + log_error) and callers decide exits.
//     A transport failure must not read as an empty success.
//
// Strip-only compatible: no parameter properties, enums, or namespaces.

import { existsSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { configGetRaw } from "../core/config.ts";
import { EXIT_GENERAL_ERROR } from "../core/exit-codes.ts";
import { selfRoot } from "../core/self-root.ts";

/** The devenv checkout root this module operates on. Derived from this
 * file's own location (self-root contract); DEVENV_TOOLBOX_ROOT is a
 * test-only override, exactly as in setup-first-run. */
const TOOLS_ROOT = process.env.DEVENV_TOOLBOX_ROOT
  ? join(process.env.DEVENV_TOOLBOX_ROOT, "tools")
  : join(selfRoot(join(dirname(import.meta.url), "..")), "tools");

function dirname(p: string): string {
  return p.replace(/\/[^/]*\/?$/, "").replace(/\/$/, "") || "/";
}

/** The devenv.config path provider detection reads. */
export function providerConfigPath(): string {
  return process.env.DEVENV_ROOT
    ? join(process.env.DEVENV_ROOT, "devenv.config")
    : join(TOOLS_ROOT, "..", "devenv.config");
}

/** Providers with a TS implementation. The bash azure provider has no TS
 * module; requesting it throws a named error pointing at the bridge
 * decision (the migration order document owns when azure lands in TS). */
export const TS_PROVIDERS = ["github"] as const;
export type ProviderName = (typeof TS_PROVIDERS)[number];

/** Thrown by facade verbs on contract violations and transport failures.
 * `message` mirrors the bash error contract's wording so parity is greppable. */
export class ProviderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProviderError";
  }
}

let detected: ProviderName | undefined;

/** Resolve the active provider from devenv.config `[provider] name`,
 * defaulting to github (org policy). Cached; `force` re-reads. */
export function providerDetect(force = false): ProviderName {
  if (detected !== undefined && !force) return detected;
  const raw = configGetRaw(providerConfigPath(), "provider", "name") ?? "";
  const name = raw.trim() === "" ? "github" : (raw.trim() as ProviderName);
  if (!TS_PROVIDERS.includes(name)) {
    throw new ProviderError(
      `provider '${name}' has no TypeScript implementation (shipped: ${TS_PROVIDERS.join(", ")}) — ` +
        `azure-domain work must go through the bash provider seam`,
    );
  }
  detected = name;
  return detected;
}

/** The one repository resolver: explicit argument, then DEVENV_REPO. The
 * provider env/cwd fallbacks of the bash seam are host-specific; the TS
 * facade resolves cwd via git when asked to. Empty result is "" (callers
 * decide whether an empty target is fatal — GitHub verbs need a spec). */
export function providerRepoTarget(spec?: string): string {
  if (spec !== undefined && spec !== "") return spec;
  if (process.env.DEVENV_REPO) return process.env.DEVENV_REPO;
  // Provider-internal env leg (the bash `_provider_repo_env_extra` hook):
  // GH's own variable, full owner/repo forms only — a basename is invalid
  // for -R and reads as absent.
  const ghRepo = process.env.GH_REPO ?? "";
  if (ghRepo.includes("/")) return ghRepo;
  // Cwd leg (the `_provider_repo_cwd_spec` hook): configured org identity +
  // the git working tree's basename; both legs must resolve. A cwd without a
  // git root reads as unresolved, never as a crash.
  const org = providerOrgGet();
  if (org === "") return "";
  let root = "";
  try {
    root = execFileSync("git", ["rev-parse", "--show-toplevel"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "";
  }
  if (root === "") return "";
  const name = root.split("/").pop() ?? "";
  return name === "" ? "" : `${org}/${name}`;
}

/** Org identity: devenv.config `[organization] org` → the setup seed file.
 * Empty (with guidance already logged by the caller) when unresolvable —
 * mirrors `provider_org_get`'s chain minus the log (callers own messaging). */
export function providerOrgGet(): string {
  const raw = configGetRaw(providerConfigPath(), "organization", "org") ?? "";
  if (raw !== "") return raw;
  const seedFile = process.env.DEVENV_ROOT
    ? join(process.env.DEVENV_ROOT, ".setup", "provider_org.txt")
    : join(TOOLS_ROOT, "..", ".setup", "provider_org.txt");
  if (existsSync(seedFile)) {
    const value = execFileSync("tr", ["-d", "[:space:]"], {
      input: execFileSync("cat", [seedFile], { encoding: "utf8" }),
      encoding: "utf8",
    }).trim();
    if (value !== "") return value;
  }
  return "";
}

/** User identity: devenv.config `[organization] user` → the setup seed file.
 * Same chain and empty-on-failure contract as `providerOrgGet` (mirrors
 * `provider_user_get`). */
export function providerUserGet(): string {
  const raw = configGetRaw(providerConfigPath(), "organization", "user") ?? "";
  if (raw !== "") return raw;
  const seedFile = process.env.DEVENV_ROOT
    ? join(process.env.DEVENV_ROOT, ".setup", "provider_user.txt")
    : join(TOOLS_ROOT, "..", ".setup", "provider_user.txt");
  if (existsSync(seedFile)) {
    const value = execFileSync("tr", ["-d", "[:space:]"], {
      input: execFileSync("cat", [seedFile], { encoding: "utf8" }),
      encoding: "utf8",
    }).trim();
    if (value !== "") return value;
  }
  return "";
}

/**
 * Shared tool prologue (identical in 21 issue/pr scripts): refuse to run
 * outside a git repository, then refuse to operate on the devenv repository
 * itself unless the caller overrides (--devenv flag) or DEVENV_REPO targets
 * another repo explicitly.
 */
export function checkTargetRepo(allowDevenv: boolean): void {
  let inRepo = false;
  try {
    execFileSync("git", ["rev-parse", "--show-toplevel"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    inRepo = true;
  } catch {
    inRepo = false;
  }
  if (!inRepo) {
    console.error("ERROR: Not in a git repository");
    process.exit(EXIT_GENERAL_ERROR);
  }
  if (!isDevenvRepoGated()) return;
  if (process.env["DEVENV_REPO"] !== undefined && process.env["DEVENV_REPO"] !== "") return;
  if (allowDevenv) return;
  console.error("ERROR: The current repository appears to be the devenv repository itself");
  console.log("Operations should be performed in target project repositories, not in devenv");
  console.log("To target a project repo, prefix the command with DEVENV_REPO=<owner>/<repo>");
  console.log("To override this safety check (devenv-repo work only), pass the --devenv flag");
  process.exit(EXIT_GENERAL_ERROR);
}

/**
 * The devenv-repo gate (port of `is_devenv_repo` + `is_nested_devenv_clone`):
 * true when the cwd repo is a devenv checkout (bootstrap script present or
 * directory named devenv), with the nested-clone auto-allow for clones below
 * a `repos/` parent. Callers refuse when this returns "gated".
 */
export function isDevenvRepoGated(): boolean {
  let root = "";
  try {
    root = execFileSync("git", ["rev-parse", "--show-toplevel"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return false;
  }
  if (root === "") return false;
  const isDevenv = existsSync(join(root, ".devcontainer", "bootstrap.sh")) || root.split("/").pop() === "devenv";
  if (!isDevenv) return false;
  // Nested clones (below a repos/ parent) are deliberate devenv-development
  // targets: no override needed.
  return root.split("/").slice(-2, -1).pop() !== "repos";
}

/** Resolve a repo target to `owner/name` parts, throwing a defined error
 * when the spec cannot be split (the bash `_gh_repo_vars` contract). */
export function providerRepoSplit(spec?: string): { owner: string; name: string } {
  const resolved = providerRepoTarget(spec);
  const slash = resolved.indexOf("/");
  if (resolved === "" || slash < 1 || slash === resolved.length - 1) {
    throw new ProviderError(
      `cannot resolve the target repository (got '${resolved || "nothing"}') — pass owner/repo or set DEVENV_REPO`,
    );
  }
  return { owner: resolved.slice(0, slash), name: resolved.slice(slash + 1) };
}

// ---------------------------------------------------------------------------
// Capability flags (the bash seam's registry, TS side)
// ---------------------------------------------------------------------------

export const PROVIDER_CAPABILITY_CANONICAL = [
  "rulesets",
  "project-boards",
  "native-issue-types",
  "pipelines",
] as const;
export type Capability = (typeof PROVIDER_CAPABILITY_CANONICAL)[number];

const declared = new Set<Capability>();

/** Declare one capability for the active provider. A non-canonical name is
 * a programming bug — throws instead of silently answering false later. */
export function providerDeclareCapability(cap: Capability): void {
  if (!PROVIDER_CAPABILITY_CANONICAL.includes(cap)) {
    throw new ProviderError(
      `providerDeclareCapability: '${cap}' is not a canonical capability (${PROVIDER_CAPABILITY_CANONICAL.join(" ")})`,
    );
  }
  declared.add(cap);
}

export function providerHasCapability(cap: Capability): boolean {
  return declared.has(cap);
}

/** Gate for capability-scoped verbs: throws the bash seam's defined error. */
export function providerRequireCapability(cap: Capability): void {
  if (!declared.has(cap)) {
    throw new ProviderError(
      `provider '${providerDetect()}' does not support '${cap}' — see tools/lib/providers/CONTRACT.md`,
    );
  }
}

// ---------------------------------------------------------------------------
// Error contract helpers (mirrors of the bash error wording)
// ---------------------------------------------------------------------------

/** The unknown-option error every verb returns for an option it does not
 * accept. Nothing is dropped silently (contract: Output and errors). */
export function unknownOption(verb: string, option: string): never {
  throw new ProviderError(
    `${verb}: unknown or unsupported option '${option}' — see tools/lib/providers/CONTRACT.md`,
  );
}

/** The missing-value error for valued options at the end of an argv. */
export function needValue(verb: string, option: string): never {
  throw new ProviderError(
    `${verb}: option '${option}' requires a value — see tools/lib/providers/CONTRACT.md`,
  );
}

// ---------------------------------------------------------------------------
// Transport (gh). The bash seam keeps provider_api as GitHub-only and
// "not part of the contract"; the TS facade exposes it on the github module
// with the same status. gh's token handling is the credential store here:
// the TS facade never reads GH_TOKEN itself (auth seam preserved — gh
// resolves its own auth, exactly as every bash verb does today).
// ---------------------------------------------------------------------------

export interface GhResult {
  stdout: string;
  stderr: string;
  status: number;
}

export interface GhOptions {
  /** Stdin fed to gh (the `-` body-file convention). */
  input?: string;
  /** Extra env (e.g. GH_REPO for set-type). */
  env?: Record<string, string>;
  /** Tolerated failure: return the result instead of throwing on non-zero. */
  tolerateFailure?: boolean;
}

function ghArgs(args: string[]): string[] {
  return ["gh", ...args];
}

/** gh REST/GraphQL transport (the `provider_api` analogue; GitHub-only and
 * explicitly not part of the cross-provider contract). Throws ProviderError
 * naming gh's stderr on failure. */
export async function ghApi(args: string[], opts: GhOptions = {}): Promise<GhResult> {
  const { run } = await import("../core/spawn.ts");
  const result = await run(ghArgs(args), {
    ...(opts.input !== undefined ? { input: opts.input } : {}),
    ...(opts.env !== undefined ? { env: opts.env } : {}),
  });
  if (result.status !== 0 && !opts.tolerateFailure) {
    // Name the gh subcommand ("issue list", "api graphql"), not just the
    // command family, so the failure points at the verb that failed.
    const sub = args.slice(0, 2).join(" ");
    throw new ProviderError(
      `gh ${sub} failed (exit ${result.status})` +
        (result.stderr.trim() ? `: ${result.stderr.trim().split("\n")[0]}` : ""),
    );
  }
  return { stdout: result.stdout, stderr: result.stderr, status: result.status ?? 1 };
}

/** Synchronous gh transport for the shared internal helpers (node-id
 * resolution etc.) — same failure contract as ghApi. */
export function ghApiSync(args: string[], opts: GhOptions = {}): GhResult {
  try {
    const stdout = execFileSync("gh", args, {
      encoding: "utf8",
      input: opts.input,
      env: opts.env ? { ...process.env, ...opts.env } : process.env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    return { stdout, stderr: "", status: 0 };
  } catch (err) {
    const e = err as { status?: number; stdout?: string; stderr?: string };
    if (opts.tolerateFailure) {
      return { stdout: e.stdout ?? "", stderr: e.stderr ?? "", status: e.status ?? 1 };
    }
    const sub = args.slice(0, 2).join(" ");
    throw new ProviderError(
      `gh ${sub} failed (exit ${e.status ?? "spawn"})` +
        (e.stderr && e.stderr.trim() ? `: ${e.stderr.trim().split("\n")[0]}` : ""),
    );
  }
}

/** Paginated GET for REST surfaces that page (comments lists etc.). */
export async function ghApiPaginate(args: string[]): Promise<GhResult> {
  return ghApi([...args, "--paginate"]);
}

/** Auth pre-flight (ensure_provider_auth parity): one cheap gh auth probe;
 * exits with guidance instead of letting the first API call die with a raw
 * unhandled ProviderError. Sync so plain top-level scripts can call it. */
export function ensureProviderAuth(): void {
  const name: string = providerDetect();
  const authed = name === "azure" ? azureAuthProbe() : ghAuthProbe();
  if (authed) return;
  console.error("Error: provider CLI is not authenticated. Run: key-update-provider");
  process.exit(EXIT_GENERAL_ERROR);
}

/** gh auth probe — the github provider's auth seam (gh owns its own
 * credential store; the facade never reads tokens). lives inside the
 * provider layer so no tool ever shells to gh directly. */
function ghAuthProbe(): boolean {
  try {
    execFileSync("gh", ["auth", "status"], { stdio: ["ignore", "ignore", "ignore"] });
    return true;
  } catch {
    return false;
  }
}

/** azure auth probe — mirrors azure/auth.bash's `provider_auth_status_impl`:
 * a resolvable token with sane file mode means the provider can operate.
 * Never reads the token's value into this process beyond existence. */
function azureAuthProbe(): boolean {
  const patFile = process.env.AZURE_PAT_FILE || join(process.env.HOME ?? "", ".keys", "azure-devops-pat");
  if (!existsSync(patFile)) return false;
  try {
    const mode = execFileSync("stat", ["-c", "%a", patFile], { encoding: "utf8" }).trim();
    return mode === "600";
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Config discovery for tests/tools: the devenv.config must exist for
// detection to be meaningful; expose the check so tools can fail defined.
// ---------------------------------------------------------------------------

export function providerConfigExists(): boolean {
  return existsSync(providerConfigPath());
}
