// Agreement between the bash provider layer the container bootstrap still
// sources and its TypeScript counterpart. The bash files exist only for the
// bootstrap chain; every answer they give about "which provider is active",
// "who is the organization/user" and "which organization does this remote name"
// must equal what the TypeScript provider layer answers for the same fixture,
// or the container and the tools would disagree about the same checkout.
//
// Hermetic: every child runs with a scrubbed environment (PATH, a fixture HOME,
// a fixture DEVENV_ROOT), no network, and no provider CLI is ever called.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const ROOT = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))));
const TOOLS = join(ROOT, "tools");
const PROVIDERS = join(TOOLS, "lib", "providers");
const CORE_BASH = join(PROVIDERS, "provider-core.bash");
const CORE_TS = pathToFileURL(join(PROVIDERS, "provider-core.ts")).href;
const AZURE_URLS_TS = pathToFileURL(join(PROVIDERS, "azure", "urls.ts")).href;

let TMP = "";
let FIXTURE_ROOT = "";
let HOME_DIR = "";

beforeEach(() => {
  TMP = mkdtempSync(join(tmpdir(), "bash-agree-"));
  FIXTURE_ROOT = join(TMP, "root");
  HOME_DIR = join(TMP, "home");
  mkdirSync(FIXTURE_ROOT, { recursive: true });
  mkdirSync(HOME_DIR, { recursive: true });
});

afterEach(() => {
  rmSync(TMP, { recursive: true, force: true });
});

/** The scrubbed child environment: nothing from the workspace leaks in. */
function childEnv(extra: Record<string, string> = {}): Record<string, string> {
  return {
    PATH: process.env["PATH"] ?? "/usr/bin:/bin",
    HOME: HOME_DIR,
    DEVENV_ROOT: FIXTURE_ROOT,
    DEVENV_TOOLS: TOOLS,
    ...extra,
  };
}

function writeConfig(content: string): string {
  const path = join(FIXTURE_ROOT, "devenv.config");
  writeFileSync(path, content);
  return path;
}

function bash(script: string, cwd: string, extra: Record<string, string> = {}): { status: number; stdout: string } {
  const r = spawnSync("bash", ["-c", script], { encoding: "utf8", cwd, env: childEnv(extra) });
  return { status: r.status ?? 1, stdout: r.stdout ?? "" };
}

/** Run an ES module snippet; it prints one JSON line. */
function ts(code: string, cwd: string, extra: Record<string, string> = {}): unknown {
  const r = spawnSync(process.execPath, ["--input-type=module", "-e", code], {
    encoding: "utf8",
    cwd,
    env: childEnv({ AGREE_CORE: CORE_TS, AGREE_AZURE_URLS: AZURE_URLS_TS, ...extra }),
  });
  const line = (r.stdout ?? "").trim().split("\n").pop() ?? "";
  try {
    return JSON.parse(line);
  } catch {
    throw new Error(`TypeScript side printed no JSON (status ${r.status}): ${r.stdout}${r.stderr}`);
  }
}

// ---------------------------------------------------------------------------
// Provider detection
// ---------------------------------------------------------------------------

type Detected = { name: string } | { error: true };

function detectBash(configPath: string): Detected {
  const r = bash(
    `source '${CORE_BASH}' 2>/dev/null\nprovider_detect '${configPath}' 2>/dev/null\nrc=$?\necho "$rc:\${PROVIDER_NAME:-}"`,
    FIXTURE_ROOT,
  );
  const [rc, name] = r.stdout.trim().split(":");
  return rc === "0" ? { name: name ?? "" } : { error: true };
}

function detectTs(): Detected {
  const out = ts(
    `const m = await import(process.env.AGREE_CORE);
     try { console.log(JSON.stringify({ name: m.providerDetect(true) })); }
     catch { console.log(JSON.stringify({ error: true })); }`,
    FIXTURE_ROOT,
  ) as Detected;
  return out;
}

const DETECTION_MATRIX: Array<[label: string, config: string, expected: Detected]> = [
  ["github", "[provider]\nname=github\n", { name: "github" }],
  ["azure", "[provider]\nname=azure\n", { name: "azure" }],
  ["name present but empty", "[provider]\nname=\n", { name: "github" }],
  ["no [provider] section", "[organization]\norg=acme\n", { name: "github" }],
  ["key in another section only", "[other]\nname=azure\n", { name: "github" }],
  ["spaces and CRLF", "[provider]\r\nname = azure \r\n", { name: "azure" }],
  ["comments and blank lines", "# note\n\n[provider]\n; note\nname=azure\n", { name: "azure" }],
  ["duplicate key reads the last", "[provider]\nname=github\nname=azure\n", { name: "azure" }],
  ["header with inner spaces", "[ provider ]\nname=azure\n", { name: "azure" }],
  ["not a shipped provider", "[provider]\nname=gitlab\n", { error: true }],
  ["wrong case", "[provider]\nname=GitHub\n", { error: true }],
  ["a directory beside the providers is not a provider", "[provider]\nname=facade\n", { error: true }],
  ["two shipped names", "[provider]\nname=azure github\n", { error: true }],
  ["glob characters", "[provider]\nname=*\n", { error: true }],
  ["path-like name", "[provider]\nname=../azure\n", { error: true }],
];

describe("provider detection agrees", () => {
  for (const [label, config, expected] of DETECTION_MATRIX) {
    it(label, () => {
      const path = writeConfig(config);
      const fromBash = detectBash(path);
      const fromTs = detectTs();
      expect(fromBash).toEqual(fromTs);
      expect(fromTs).toEqual(expected);
    });
  }

  it("an absent config: bash falls back to the default provider, TypeScript refuses (intentional)", () => {
    // The container checks for devenv.config before it ever reaches detection, so
    // the bash default is unreachable there; the TypeScript refusal is deliberate
    // (a fork's non-default provider must never silently become github).
    const missing = join(FIXTURE_ROOT, "devenv.config");
    expect(detectBash(missing)).toEqual({ name: "github" });
    expect(detectTs()).toEqual({ error: true });
  });
});

// ---------------------------------------------------------------------------
// Organization and user identity
// ---------------------------------------------------------------------------

function identityBash(fn: "provider_org_get" | "provider_user_get"): string {
  const r = bash(`source '${CORE_BASH}' 2>/dev/null\n${fn} 2>/dev/null || true`, FIXTURE_ROOT);
  return r.stdout.trim();
}

function identityTs(fn: "providerOrgGet" | "providerUserGet"): string {
  const out = ts(
    `const m = await import(process.env.AGREE_CORE);
     console.log(JSON.stringify({ value: m.${fn}() }));`,
    FIXTURE_ROOT,
  ) as { value: string };
  return out.value;
}

const IDENTITY_MATRIX: Array<[label: string, config: string, seed: string | null, expected: string]> = [
  ["from config", "[organization]\norg=acme\nuser=pat\n", null, "acme"],
  ["config wins over the seed file", "[organization]\norg=acme\nuser=pat\n", "seeded\n", "acme"],
  ["empty config value falls to the seed file", "[organization]\norg=\nuser=\n", " seeded \n", "seeded"],
  ["absent key falls to the seed file", "[provider]\nname=github\n", "seeded\n", "seeded"],
  ["nothing configured", "[provider]\nname=github\n", null, ""],
  ["whitespace-only seed file", "[provider]\nname=github\n", "  \n\t\n", ""],
  ["CRLF config", "[organization]\r\norg = acme \r\nuser = pat \r\n", null, "acme"],
  ["template text is read raw", "[organization]\norg=${PROVIDER_USER}-x\nuser=pat\n", null, "${PROVIDER_USER}-x"],
];

describe("organization and user identity agree", () => {
  for (const [label, config, seed, expected] of IDENTITY_MATRIX) {
    it(label, () => {
      writeConfig(config);
      if (seed !== null) {
        mkdirSync(join(FIXTURE_ROOT, ".setup"), { recursive: true });
        writeFileSync(join(FIXTURE_ROOT, ".setup", "provider_org.txt"), seed);
        writeFileSync(join(FIXTURE_ROOT, ".setup", "provider_user.txt"), seed);
      }
      const org = identityBash("provider_org_get");
      expect(org).toBe(identityTs("providerOrgGet"));
      expect(org).toBe(expected);
      // The user chain is the same shape; the expected user differs only where
      // the config names one.
      expect(identityBash("provider_user_get")).toBe(identityTs("providerUserGet"));
    });
  }
});

// ---------------------------------------------------------------------------
// The organization a git remote names (host-side `setup` default)
// ---------------------------------------------------------------------------

function gitRepoWithOrigin(origin: string | null): string {
  const repo = join(TMP, "fixrepo");
  mkdirSync(repo, { recursive: true });
  const git = (...args: string[]) =>
    spawnSync("git", args, { cwd: repo, env: childEnv(), encoding: "utf8" });
  git("init", "-q");
  if (origin !== null) git("remote", "add", "origin", origin);
  return repo;
}

function detectOrgBash(provider: "github" | "azure", repo: string): string {
  const r = bash(
    `source '${join(PROVIDERS, provider, "setup.bash")}'\nprovider_setup_detect_org`,
    repo,
  );
  return r.stdout.trim();
}

/** The organization the TypeScript layer reads off the same remote, "" when the
 * remote is not one of the provider's. The repo-target resolver is the real path:
 * it names `<configured org>/<directory>` only when the remote is not recognized. */
function detectOrgTs(provider: "github" | "azure", repo: string): string {
  const out = ts(
    `const core = await import(process.env.AGREE_CORE);
     const azure = await import(process.env.AGREE_AZURE_URLS);
     const spec = core.providerRepoTarget();
     const fallback = "fixorg/fixrepo";
     let org = "";
     if (spec !== "" && spec !== fallback) {
       if (${JSON.stringify(provider)} === "github") org = spec.split("/")[0];
       else {
         const origin = (await import("node:child_process")).execFileSync("git", ["remote", "get-url", "origin"], { encoding: "utf8" }).trim();
         const parsed = azure.azureParseRemote(origin);
         org = parsed === null ? "" : parsed.org;
       }
     }
     console.log(JSON.stringify({ org }));`,
    repo,
  ) as { org: string };
  return out.org;
}

// The Azure https remote that carries the organization as a user
// (https://acme@dev.azure.com/...) is parsed by the bash setup default but not by the
// production azureParseRemote (it handles that user form only for the visualstudio.com
// host). The divergence is pinned here so a change on either side is noticed.
const PINNED_TS_DIVERGENCE = new Map<string, string>([
  ["azure: https with the organization as user", ""],
]);

const REMOTE_MATRIX: Array<[provider: "github" | "azure", label: string, origin: string | null, expectedOrg: string]> = [
  ["github", "https", "https://github.com/acme/widget.git", "acme"],
  ["github", "https without .git", "https://github.com/acme/widget", "acme"],
  ["github", "scp-style ssh", "git@github.com:acme/widget.git", "acme"],
  ["github", "https with credentials", "https://user:tok@github.com/acme/widget.git", "acme"],
  ["github", "plain http", "http://github.com/acme/widget", "acme"],
  ["github", "another host", "https://gitlab.com/acme/widget.git", ""],
  ["github", "a host that merely ends in github.com", "https://notgithub.com/acme/widget", ""],
  ["github", "an azure remote", "https://dev.azure.com/acme/proj/_git/repo", ""],
  ["github", "an at-sign github.com inside a path segment", "https://evil.example/x@github.com/acme/widget", ""],
  ["github", "no origin remote", null, ""],
  ["azure", "https", "https://dev.azure.com/acme/proj/_git/repo", "acme"],
  ["azure", "https with the organization as user", "https://acme@dev.azure.com/acme/proj/_git/repo", "acme"],
  ["azure", "scp-style ssh", "git@ssh.dev.azure.com:v3/acme/proj/repo", "acme"],
  ["azure", "a github remote", "https://github.com/acme/widget.git", ""],
  ["azure", "a host that merely ends in dev.azure.com", "https://notdev.azure.com/acme/proj/_git/repo", ""],
  ["azure", "an at-sign dev.azure.com inside a path segment", "https://evil.example/x@dev.azure.com/acme/proj/_git/repo", ""],
  ["azure", "an at-sign ssh.dev.azure.com inside a path segment", "https://evil.example/x@ssh.dev.azure.com:v3/acme/proj/repo", ""],
  ["azure", "no origin remote", null, ""],
];

describe("the organization named by a git remote agrees", () => {
  for (const [provider, label, origin, expected] of REMOTE_MATRIX) {
    it(`${provider}: ${label}`, () => {
      writeConfig(`[provider]\nname=${provider}\n\n[organization]\norg=fixorg\n`);
      const repo = gitRepoWithOrigin(origin);
      const fromBash = detectOrgBash(provider, repo);
      const fromTs = detectOrgTs(provider, repo);
      const pinnedTs = PINNED_TS_DIVERGENCE.get(`${provider}: ${label}`);
      if (pinnedTs === undefined) {
        expect(fromBash).toBe(fromTs);
      } else {
        expect(fromTs).toBe(pinnedTs);
      }
      expect(fromBash).toBe(expected);
    });
  }
});

// ---------------------------------------------------------------------------
// The Azure git credential-helper wiring
// ---------------------------------------------------------------------------

const GIT_WIRING_MATRIX: Array<[label: string, config: string | null, hosts: string[]]> = [
  ["a plain organization", "[provider]\nname=azure\nazure_org=Acme-One\n", ["dev.azure.com", "acme-one.visualstudio.com"]],
  ["a template-valued organization", "[provider]\nname=azure\nazure_org=${PROVIDER_ORG}\n\n[organization]\norg=acme\n", ["dev.azure.com"]],
  ["a missing organization key", "[provider]\nname=azure\n", ["dev.azure.com"]],
  ["an empty organization", "[provider]\nname=azure\nazure_org=\n", ["dev.azure.com"]],
  ["an invalid organization", "[provider]\nname=azure\nazure_org=bad org!\n", ["dev.azure.com"]],
  ["no config file", null, ["dev.azure.com"]],
];

function gitConfigLines(home: string): string[] {
  const r = spawnSync("git", ["config", "--global", "--list"], { encoding: "utf8", env: childEnv({ HOME: home }) });
  return (r.stdout ?? "").split("\n").filter((l) => l.startsWith("credential.")).sort();
}

describe("the Azure git credential-helper wiring agrees", () => {
  for (const [label, config, hosts] of GIT_WIRING_MATRIX) {
    it(label, () => {
      if (config !== null) writeConfig(config);
      const bashHome = join(TMP, "home-bash");
      const tsHome = join(TMP, "home-ts");
      mkdirSync(bashHome, { recursive: true });
      mkdirSync(tsHome, { recursive: true });
      const rb = bash(
        `source '${join(PROVIDERS, "azure", "auth.bash")}' 2>/dev/null\n` +
          `source '${join(TOOLS, "lib", "config-reader.bash")}'\n` +
          `config_init '${join(FIXTURE_ROOT, "devenv.config")}' 2>/dev/null\n` +
          `provider_auth_setup_git_impl >/dev/null 2>&1`,
        FIXTURE_ROOT,
        { HOME: bashHome },
      );
      expect(rb.status).toBe(0);
      ts(
        `const m = await import(${JSON.stringify(pathToFileURL(join(PROVIDERS, "azure", "auth.ts")).href)});
         m.azureSetupGit();
         console.log(JSON.stringify({ ok: true }));`,
        FIXTURE_ROOT,
        { HOME: tsHome },
      );
      const fromBash = gitConfigLines(bashHome);
      const fromTs = gitConfigLines(tsHome);
      expect(fromBash).toEqual(fromTs);
      expect(fromTs.map((l) => l.split("=")[0]).sort()).toEqual(
        hosts.map((h) => `credential.https://${h}.helper`).sort(),
      );
    });
  }
});
