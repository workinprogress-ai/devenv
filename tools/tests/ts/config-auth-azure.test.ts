// Port of tools/tests/scripts/test_config_read.bats (10) +
// test_bootstrap_auth_schemes.bats (13) — 23 tests.
//
// Subjects: config-read (INI reader contract incl. provider-variable
// expansion) and bootstrap auth (provider git headers + npmrc setup). The
// bats assertions are the oracle. The cli-stubs.bash smoke pins and the
// azure-setup board-convergence pins retired with their subjects (the
// bash stub fixture library and the azure smoke cluster — Phase 10/11
// retirements); stub semantics live in harness/stubs.ts (stubCli), whose
// call-log convention every harness-based suite exercises.
// Fixture hygiene per tools/tests/README.md: scratch under tmpPath().
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync, readFileSync, rmSync, statSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";
import { toolScript, useProviderDown } from "./harness/index.ts";

// These suites assert behaviour when the provider is down or unauthenticated; the
// failure is stubbed so the regular run never starts a real gh or az.
useProviderDown();

const ROOT = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))));
const TOOLS = join(ROOT, "tools");
const CONFIG_READ = toolScript("config-read");
const PROVIDER_CORE = join(TOOLS, "lib", "providers", "provider-core.bash");
const NPMRC_STEP = join(TOOLS, "ts", "setup-steps", "npmrc.ts");

let TMP = "";

function ensureTmp(): void {
  if (!TMP) {
    TMP = mkdtempSync(join(tmpdir(), `cfgauth-${Date.now()}-${Math.random().toString(36).slice(2)}`));
  }
}

export const KEEP_TMP_FOR_DEBUG = false;

function tmpPath(...parts: string[]): string {
  ensureTmp();
  const base = tmpdir();
  if (!isAbsolute(TMP) || !TMP.startsWith(base)) {
    throw new Error(`scratch-dir guard: TMP=${JSON.stringify(TMP)} is not under ${base}`);
  }
  return join(TMP, ...parts);
}

afterAll(() => {
  if (TMP && !process.env["KEEP_AZ_DEBUG"]) rmSync(TMP, { recursive: true, force: true });
});

// Bash-scripted fixtures (cli-stubs, provision extraction) run as bash files
// under the temp root. Env passed explicitly; PATH from the ambient process.
function runScript(scriptPath: string, args: string[], env: Record<string, string | undefined>): { status: number; stdout: string; stderr: string; out: string } {
  const e: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined) e[k] = v;
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) delete e[k];
    else e[k] = v;
  }
  const r = spawnSync(scriptPath.endsWith(".ts") ? "node" : "bash", [scriptPath, ...args], { encoding: "utf8", env: e });
  return { status: r.status ?? 1, stdout: r.stdout ?? "", stderr: r.stderr ?? "", out: (r.stdout ?? "") + (r.stderr ?? "") };
}

// bash -c (quote-safe via argv array — bash spawns with -c string as ONE arg).
function runBashC(script: string, env: Record<string, string | undefined> = {}): { status: number; stdout: string; stderr: string; out: string } {
  const f = tmpPath(`bashc-${Math.random().toString(36).slice(2)}.sh`);
  writeFileSync(f, `${script}\n`);
  return runScript(f, [], env);
}

// ── config-read ─────────────────────────────────────────────────────────────

describe("config-read (bats port)", () => {
  let CONF = "";
  let IDENT = "";

  beforeEach(() => {
    const work = tmpPath(`cfg-${Math.random().toString(36).slice(2)}`);
    mkdirSync(work, { recursive: true });
    CONF = join(work, "devenv.config");
    writeFileSync(CONF, "[copilot]\nengineering_repo=my-standards\nknowledge_subpath=${PROVIDER_ORG}/k/\n[workflows]\nstatus_workflow=A,B\n");
    IDENT = tmpPath(`ident-${Math.random().toString(36).slice(2)}`);
    mkdirSync(join(IDENT, ".setup"), { recursive: true });
    writeFileSync(join(IDENT, ".setup", "provider_org.txt"), "acme\n");
  });

  it("reads a value by section and key", () => {
    const r = runScript(CONFIG_READ, ["copilot", "engineering_repo", "--config", CONF], {});
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toBe("my-standards");
  });

  it("expands template variables via the provider accessors", () => {
    // Expansion is accessor-fed (config -> seed): scope identity to a temp
    // seed root; env vars carry no identity.
    const r = runScript(CONFIG_READ, ["copilot", "knowledge_subpath", "--config", CONF], {
      DEVENV_ROOT: IDENT,
      DEVENV_ROOT_SET: "1",
    });
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toBe("acme/k/");
  });

  it("returns the default when key is absent", () => {
    const r = runScript(CONFIG_READ, ["copilot", "nope", "fallback", "--config", CONF], {});
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toBe("fallback");
  });

  it("reads array-style values verbatim", () => {
    const r = runScript(CONFIG_READ, ["workflows", "status_workflow", "--config", CONF], {});
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toBe("A,B");
  });

  it("missing config file exits 1", () => {
    expect(runScript(CONFIG_READ, ["copilot", "engineering_repo", "--config", tmpPath("none.config")], {}).status).toBe(1);
  });

  it("missing section/key arguments exit 2 (misuse); a missing config file stays exit 1", () => {
    expect(runScript(CONFIG_READ, ["copilot"], {}).status).toBe(2);
  });

  it("--help prints usage and exits 0 (no unbound-variable death)", () => {
    const r = runScript(CONFIG_READ, ["--help"], {});
    expect(r.status).toBe(0);
    expect(r.out).toContain("Usage:");
    expect(r.out).not.toContain("unbound variable");
  });

  it("-h behaves the same as --help", () => {
    const r = runScript(CONFIG_READ, ["-h"], {});
    expect(r.status).toBe(0);
    expect(r.out).toContain("Usage:");
  });

  it("--help shows the template variable literally, not an expansion of it", () => {
    const r = runScript(CONFIG_READ, ["--help"], { PROVIDER_ORG: undefined });
    expect(r.status).toBe(0);
    expect(r.out).toContain("${PROVIDER_ORG}");
  });

  it("--help still shows the default config path as written", () => {
    const r = runScript(CONFIG_READ, ["--help"], {});
    expect(r.status).toBe(0);
    expect(r.out).toContain("$DEVENV_ROOT/devenv.config");
  });
});

// ── bootstrap auth (provider git headers + npmrc setup) ─────────────────────

describe("bootstrap auth (bats port)", () => {
  let HOME = "";

  let fixtureToolbox = "";

  beforeEach(() => {
    HOME = tmpPath(`auth-home-${Math.random().toString(36).slice(2)}`);
    mkdirSync(HOME, { recursive: true });
    // The npmrc step resolves identity through a fixture devenv.config and
    // its credential through the allowlisted-GH_TOKEN seam path (the bash
    // test stubbed provider_secret_get; the TS seam's supported injection
    // is the allowlist).
    fixtureToolbox = tmpPath(`auth-fixture-${Math.random().toString(36).slice(2)}`);
    mkdirSync(fixtureToolbox, { recursive: true });
    writeFileSync(
      join(fixtureToolbox, "devenv.config"),
      "[provider]\nname=github\n" +
        "token_env_allowlist=npm-token-123\n\n" +
        "[organization]\norg=the-org\nuser=the-user\n",
    );
  });

  function gitHeader(provider: string, token: string): string {
    const script = [
      `source '${PROVIDER_CORE}'`,
      `PROVIDER_NAME=${provider}`,
      `provider_load bootstrap 2>/dev/null`,
      `provider_bootstrap_call git_auth_header '${token}'`,
    ].join("\n");
    return runBashC(script, {}).out.trim();
  }

  function runNpmrcSetup(provider: string, npmToken: string): { status: number; out: string } {
    // Per-call token (the bash stub's shape): the allowlist in the fixture
    // config carries every synthetic token the tests inject, so each call's
    // GH_TOKEN is honored under github and ignored under other providers.
    if (npmToken !== "" && !/^npm-token/.test(npmToken)) {
      const cfg = readFileSync(join(fixtureToolbox, "devenv.config"), "utf8");
      if (!cfg.includes("token_env_allowlist=" + npmToken)) {
        writeFileSync(join(fixtureToolbox, "devenv.config"), cfg.replace("token_env_allowlist=npm-token-123", "token_env_allowlist=npm-token-123 " + npmToken));
      }
    }
    const env: Record<string, string> = {};
    for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v;
    Object.assign(env, {
      HOME,
      DEVENV_TOOLBOX_ROOT: fixtureToolbox,
      DEVENV_ROOT: fixtureToolbox,
      GH_TOKEN: provider === "github" && npmToken !== "" ? npmToken : undefined,
    });
    const r = spawnSync("node", [NPMRC_STEP], { encoding: "utf8", env });
    return { status: r.status ?? 1, out: (r.stdout ?? "") + (r.stderr ?? "") };
  }

  it("github scheme: x-access-token basic header", () => {
    const out = gitHeader("github", "secret-token-1");
    const expected = spawnSync("bash", ["-c", `printf 'x-access-token:%s' "secret-token-1" | base64 -w0`], { encoding: "utf8" }).stdout.trim();
    expect(out).toBe(`AUTHORIZATION: basic ${expected}`);
  });

  it("azure scheme: RFC-7617 basic with empty user (':PAT')", () => {
    const out = gitHeader("azure", "secret-token-1");
    const expected = spawnSync("bash", ["-c", `printf ':%s' "secret-token-1" | base64 -w0`], { encoding: "utf8" }).stdout.trim();
    expect(out).toBe(`AUTHORIZATION: Basic ${expected}`);
  });

  it("schemes differ for the same token (the dispatch is real)", () => {
    expect(gitHeader("github", "secret-token-1")).not.toBe(gitHeader("azure", "secret-token-1"));
  });

  it("bootstrap.bash and the copilot-knowledge library name no provider for the git header", () => {
    const boot = readFileSync(join(ROOT, ".devcontainer", "bootstrap.bash"), "utf8").split("\n").filter((l) => !/^\s*#/.test(l)).join("\n");
    const ck = readFileSync(join(TOOLS, "lib", "copilot-knowledge.bash"), "utf8").split("\n").filter((l) => !/^\s*#/.test(l)).join("\n");
    const code = boot + ck;
    expect(/^[^#]*(azure\)|x-access-token)/m.test(code)).toBe(false);
  });

  it("npm setup: missing token prints status without creating invalid configuration", () => {
    const r = runNpmrcSetup("github", "");
    expect(r.status).toBe(0);
    expect(r.out).toContain("Skipping GitHub npm");
    const npmrc = join(HOME, ".npmrc");
    expect(!existsSync(npmrc) || statSync(npmrc).size === 0).toBe(true);
  });

  it("npm setup: missing token preserves existing configuration", () => {
    const npmrc = join(HOME, ".npmrc");
    writeFileSync(npmrc, "registry=https://registry.npmjs.org/\n# existing preference\nfund=false\n");
    runNpmrcSetup("github", "");
    expect(readFileSync(npmrc, "utf8")).toBe("registry=https://registry.npmjs.org/\n# existing preference\nfund=false\n");
  });

  it("npm setup: removes only the exact generated invalid message", () => {
    const npmrc = join(HOME, ".npmrc");
    writeFileSync(
      npmrc,
      ["registry=https://registry.npmjs.org/", "Skipping npmrc auth token (gh not authenticated)", "# Skipping npmrc auth token (gh not authenticated)", "//other.example.com/:_authToken=unrelated-synthetic-token"].join("\n") + "\n",
    );
    const r = runNpmrcSetup("azure", "");
    expect(r.status).toBe(0);
    expect(readFileSync(npmrc, "utf8")).toBe(
      ["registry=https://registry.npmjs.org/", "# Skipping npmrc auth token (gh not authenticated)", "//other.example.com/:_authToken=unrelated-synthetic-token"].join("\n") + "\n",
    );
  });

  it("npm setup: Azure never reads a token or creates a GitHub registry entry", () => {
    const r = runNpmrcSetup("azure", "synthetic-azure-pat");
    expect(r.status).toBe(0);
    expect(existsSync(join(HOME, "token-lookups"))).toBe(false);
    const npmrc = join(HOME, ".npmrc");
    expect(!existsSync(npmrc) || statSync(npmrc).size === 0).toBe(true);
    expect(r.out).not.toContain("synthetic-azure-pat");
  });

  it("npm setup: Azure preserves unrelated settings and unknown authentication entries", () => {
    const npmrc = join(HOME, ".npmrc");
    writeFileSync(npmrc, "fund=false\n//npm.pkg.github.com/:_authToken=existing-unknown-token\n");
    const r = runNpmrcSetup("azure", "");
    expect(r.status).toBe(0);
    expect(readFileSync(npmrc, "utf8")).toBe("fund=false\n//npm.pkg.github.com/:_authToken=existing-unknown-token\n");
    expect(existsSync(join(HOME, "token-lookups"))).toBe(false);
  });

  it("npm setup: GitHub creates a private registry token file without logging credentials", () => {
    const r = runNpmrcSetup("github", "synthetic-github-npm-token");
    expect(r.status).toBe(0);
    const npmrc = join(HOME, ".npmrc");
    expect(readFileSync(npmrc, "utf8").trim()).toBe("//npm.pkg.github.com/:_authToken=synthetic-github-npm-token");
    expect(spawnSync("stat", ["-c", "%a", npmrc], { encoding: "utf8" }).stdout.trim()).toBe("600");
    expect(r.out).not.toContain("synthetic-github-npm-token");
  });

  it("npm setup: GitHub updates its token once and preserves unrelated lines", () => {
    const npmrc = join(HOME, ".npmrc");
    writeFileSync(
      npmrc,
      ["# retain comment", "registry=https://registry.npmjs.org/", " //npm.pkg.github.com/:_authToken = old-synthetic-token", "//other.example.com/:_authToken=unrelated-synthetic-token", "//npm.pkg.github.com/:_authToken=duplicate-old-token"].join("\n") + "\n",
    );
    const r = runNpmrcSetup("github", "synthetic-github-npm-token");
    expect(r.status).toBe(0);
    expect(readFileSync(npmrc, "utf8")).toBe(
      ["# retain comment", "registry=https://registry.npmjs.org/", "//npm.pkg.github.com/:_authToken=synthetic-github-npm-token", "//other.example.com/:_authToken=unrelated-synthetic-token"].join("\n") + "\n",
    );
    expect(r.out).not.toContain("synthetic-github-npm-token");
  });

  it("npm setup: repeated GitHub setup is stable", () => {
    const npmrc = join(HOME, ".npmrc");
    writeFileSync(npmrc, "fund=false\n");
    expect(runNpmrcSetup("github", "synthetic-github-npm-token").status).toBe(0);
    const afterFirst = readFileSync(npmrc, "utf8");
    expect(runNpmrcSetup("github", "synthetic-github-npm-token").status).toBe(0);
    expect(readFileSync(npmrc, "utf8")).toBe(afterFirst);
    expect((readFileSync(npmrc, "utf8").match(/^\/\/npm\.pkg\.github\.com\/:_authToken=/gm) ?? []).length).toBe(1);
  });

  it("npm setup: unknown provider never reads a GitHub token", () => {
    const r = runNpmrcSetup("unknown", "");
    expect(r.status).toBe(0);
    expect(existsSync(join(HOME, "token-lookups"))).toBe(false);
    const npmrc = join(HOME, ".npmrc");
    expect(!existsSync(npmrc) || statSync(npmrc).size === 0).toBe(true);
  });
});
