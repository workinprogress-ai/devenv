// provider-core.ts — TS provider facade core: detection, repo targeting,
// capability gates, and the error contract (port of provider-core.bash's
// seams; the bash original remains until the bash retirement sweep).
//
// Contract (tools/lib/providers/CONTRACT.md):
//   - Detection is config-driven: the `[provider] name` key in devenv.config,
//     defaulting to github. Both providers ship TS domain verbs
//     (providers/{github,azure}/*.ts); azure's setup/credential scripts stay
//     bash (bootstrap chain rule).
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
import { fileURLToPath } from "node:url";
import { githubExplain } from "./github/explain.ts";
import { azureExplain } from "./azure/explain.ts";
import { authStatusOk as azureAuthStatusOk, azurePatGet } from "./azure/auth.ts";
import { remoteToSpec as azureRemoteToSpec } from "./azure/urls.ts";
import { remoteToSpec as githubRemoteToSpec } from "./github/urls.ts";

/** The devenv checkout root this module operates on. Derived from this
 * file's own location (self-root contract); DEVENV_TOOLBOX_ROOT is a
 * test-only override, exactly as in setup. */
const TOOLS_ROOT = process.env.DEVENV_TOOLBOX_ROOT
  ? join(process.env.DEVENV_TOOLBOX_ROOT, "tools")
  : join(selfRoot(fileURLToPath(import.meta.url)), "tools");


/** The devenv.config path provider detection reads. */
export function providerConfigPath(): string {
  return process.env.DEVENV_ROOT
    ? join(process.env.DEVENV_ROOT, "devenv.config")
    : join(TOOLS_ROOT, "..", "devenv.config");
}

/** Providers with a TS implementation. Azure's domain verbs shipped in TS
 * (providers/azure/*.ts); its setup/credential scripts stay bash (bootstrap
 * chain rule). */
export const TS_PROVIDERS = ["github", "azure"] as const;
export type ProviderName = (typeof TS_PROVIDERS)[number];

/** Thrown by facade verbs on contract violations and transport failures.
 * `message` mirrors the bash error contract's wording so parity is greppable. */
export class ProviderError extends Error {
  /** The HTTP status of the failing response, when the error came from one. */
  readonly status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = "ProviderError";
    if (status !== undefined) this.status = status;
  }
}

let detected: ProviderName | undefined;

/** Resolve the active provider from devenv.config `[provider] name`,
 * defaulting to github (org policy). Cached; `force` re-reads. Throws a
 * named error for a provider name that ships neither TS verbs nor a bash
 * seam (a typo, not a supported provider). */
export function providerDetect(force = false): ProviderName {
  if (detected !== undefined && !force) return detected;
  const configPath = providerConfigPath();
  if (!existsSync(configPath)) {
    // A resolved-but-missing config must not silently default: the default
    // is wrong for forks that override [provider] name by definition, and
    // the resulting "provider CLI is not authenticated" misleads every
    // credential fix attempt. Fail naming the path we resolved.
    throw new ProviderError(
      `devenv.config not found at ${configPath} — provider detection refused to default; ` +
        `set DEVENV_ROOT to the checkout root or restore the config`,
    );
  }
  const raw = configGetRaw(configPath, "provider", "name") ?? "";
  const name = raw.trim() === "" ? "github" : (raw.trim() as ProviderName);
  if (!TS_PROVIDERS.includes(name)) {
    throw new ProviderError(
      `provider '${name}' is not shipped (shipped: ${TS_PROVIDERS.join(", ")}) — ` +
        `check [provider] name in devenv.config`,
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
  // The origin remote names the repository: a clone directory is free to be
  // called anything, and Azure's spec is project/repo, not org/dirname.
  const fromOrigin = originSpec();
  if (fromOrigin !== "") return fromOrigin;
  const name = root.split("/").pop() ?? "";
  return name === "" ? "" : `${org}/${name}`;
}

/** The working tree's `origin` remote as the active provider's repo spec;
 * "" when there is no origin or it is not one of the provider's remotes. */
function originSpec(): string {
  let remote = "";
  try {
    remote = execFileSync("git", ["remote", "get-url", "origin"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "";
  }
  if (remote === "") return "";
  try {
    // Azure clone URLs commonly carry the org as userinfo
    // (https://org@dev.azure.com/...); the remote parser takes the bare form.
    const spec =
      providerDetect() === "azure"
        ? azureRemoteToSpec(remote.replace(/^(https:\/\/)[^/@]+@(dev\.azure\.com\/)/, "$1$2"))
        : githubRemoteToSpec(remote);
    return spec ?? "";
  } catch {
    return "";
  }
}

/** Require the github provider (the seam functions only github implements
 * today). A non-github checkout gets a named error instead of silently
 * running the github transport against the wrong host.
 * The typed dispatch facade replaces this guard when it lands. */
export function requireGithubProvider(action: string): void {
  if (providerDetect() !== "github") {
    throw new ProviderError(
      `${action} is not implemented for provider '${providerDetect()}' yet — ` +
        `github-only seam; the provider dispatch facade is tracked separately`,
    );
  }
}

/** Fail loud on an unresolvable repo target (15.8): a wrapper whose provider
 * verb consumes a repo spec calls this right after providerRepoTarget. Empty
 * resolved target -> named error naming the tool, the failed resolution, and
 * the remediation — the 14.10 named-error-with-remediation pattern. When the
 * active provider's explain data says the family needs no repo target at all
 * (project-scoped providers, per 15.5's qualifier), the guard passes empty
 * targets through: those families resolve org+project from config instead. */
export function requireRepoTarget(
  spec: string,
  action: string,
  family: string,
): string {
  if (spec !== "") return spec;
  let need: "required" | "optional" | "never" = "required";
  try {
    const provider = providerDetect();
    const factory = EXPLAIN_REGISTRY[provider];
    const f = factory?.().families.find((x) => x.family === family || family.startsWith(x.family));
    if (f) need = f.repoTarget.reads === "never" ? "never" : f.repoTarget.reads;
  } catch {
    // explain data unavailable: default to the strict reading
  }
  if (need === "never") return spec;
  throw new ProviderError(
    `no repository target resolved for ${action} — set DEVENV_REPO=owner/repo, run inside the target repository, or pass the repo explicitly`,
  );
}

const EXPLAIN_REGISTRY: Record<string, () => { families: Array<{ family: string; repoTarget: { reads: "required" | "optional" | "never" } }> }> = {
  github: () => githubExplain(),
  azure: () => azureExplain(),
};

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

// gh transport implementations live in providers/github/transport.ts (the
// provider-core split). Re-exported here because tools/ may import only the
// provider-neutral seam — the boundary test forbids tools importing
// providers/github/* directly. Facade and github modules import the
// transport module itself.
export type { GhResult, GhOptions } from "./github/transport.ts";
export { ghApi, ghApiSync, ghApiPaginate } from "./github/transport.ts";

/** Auth pre-flight (ensure_provider_auth parity): one cheap gh auth probe;
 * exits with guidance instead of letting the first API call die with a raw
 * unhandled ProviderError. Sync so plain top-level scripts can call it. */
export function ensureProviderAuth(): void {
  const name: string = providerDetect();
  const authed = name === "azure" ? azureAuthStatusOk() : ghAuthProbe();
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

/** The provider's stored token (provider_auth_token_impl parity): github
 * shells `gh auth token` with the env tokens scrubbed (gh would hand back
 * an env token the allowlist refused); azure returns the PAT its API calls use.
 * Returns "" when the provider has no token. Secrets are never logged —
 * callers treat the return value as credential material. */
export function providerAuthToken(): string {
  const name = providerDetect();
  if (name === "github") {
    const env: Record<string, string> = {};
    for (const [k, v] of Object.entries(process.env)) {
      if (v !== undefined && k !== "GH_TOKEN" && k !== "GITHUB_TOKEN") env[k] = v;
    }
    try {
      const out = execFileSync("gh", ["auth", "token"], { encoding: "utf8", env });
      return out.trim();
    } catch {
      return "";
    }
  }
  // Every Azure call authenticates with the PAT (the az CLI token is never
  // used), so the PAT is the stored token.
  if (name === "azure") return azurePatGet();
  return "";
}

// ---------------------------------------------------------------------------
// Config discovery for tests/tools: the devenv.config must exist for
// detection to be meaningful; expose the check so tools can fail defined.
// ---------------------------------------------------------------------------

export function providerConfigExists(): boolean {
  return existsSync(providerConfigPath());
}
