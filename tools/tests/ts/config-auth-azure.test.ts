// Port of tools/tests/scripts/test_config_read.bats (10) +
// test_cli_stubs.bats (10) + test_bootstrap_auth_schemes.bats (13) +
// test_azure_setup.bats (25) — 58 tests.
//
// Subjects: config-read (INI reader contract incl. provider-variable
// expansion), the shared CLI stub fixtures (kubectl/gh/mongo/git/curl smoke
// contract), bootstrap auth (provider git headers + npmrc setup), and
// azure-setup (board convergence against a scripted curl transport). The
// bats assertions are the oracle; the bash stub fixture library is sourced
// as-is (it stays bash — see the stay-bash doctrine).
// Fixture hygiene per tools/tests/README.md: scratch under tmpPath().
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync, chmodSync, readFileSync, rmSync, statSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))));
const TOOLS = join(ROOT, "tools");
const CONFIG_READ = join(TOOLS, "config-read");
const AZURE_SETUP = join(TOOLS, "lib", "providers", "azure", "azure-setup.sh");
const PROVIDER_CORE = join(TOOLS, "lib", "providers", "provider-core.bash");
const CLI_STUBS = join(TOOLS, "tests", "fixtures", "cli-stubs.bash");
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
  const r = spawnSync("bash", [scriptPath, ...args], { encoding: "utf8", env: e });
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

  it("missing section/key arguments exit 1", () => {
    expect(runScript(CONFIG_READ, ["copilot"], {}).status).toBe(1);
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

// ── CLI stub fixtures smoke contract ────────────────────────────────────────

// Fixture harness mirroring cli-stubs.bash: sources the bash library (it
// stays bash per doctrine), then drives the stubs through a bash subprocess
// whose PATH has the stub bin prepended.
function stubHarness(setupFn: string, env: Record<string, string | undefined>): { status: number; stdout: string; stderr: string; out: string } {
  // TEST_TEMP_DIR is per-harness: cli-stubs' _stubs_ensure_bin_dir resets
  // STUB_CALL_LOG to "$TEST_TEMP_DIR/stub-calls.log" on every stub_x call,
  // so the harness's own log var is ignored — count from the fixture's path.
  const testTemp = tmpPath(`stubt-${Math.random().toString(36).slice(2)}`);
  const home = join(testTemp, "home");
  mkdirSync(home, { recursive: true });
  const script = [
    `source '${CLI_STUBS}'`,
    `TEST_TEMP_DIR='${testTemp}'`,
    `export TEST_TEMP_DIR`,
    `HOME='${home}'`,
    `export HOME`,
    setupFn,
  ].join("\n");
  const f = tmpPath(`stubh-${Math.random().toString(36).slice(2)}.sh`);
  writeFileSync(f, script);
  // Run with the stub bin PREPENDED so subsequent plain `kubectl`-style calls
  // in the harness resolve to the stubs.
  const e: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined) e[k] = v;
  // cli-stubs puts its bin at $TEST_TEMP_DIR/stub-bin; prepend it so the
  // harness's plain kubectl/gh/git calls resolve to the stubs.
  e["PATH"] = `${testTemp}/stub-bin:${process.env.PATH ?? ""}`;
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) delete e[k];
    else e[k] = v;
  }
  const r = spawnSync("bash", [f], { encoding: "utf8", env: e });
  return { status: r.status ?? 1, stdout: r.stdout ?? "", stderr: r.stderr ?? "", out: (r.stdout ?? "") + (r.stderr ?? "") };
}

describe("cli stub fixtures (bats port)", () => {
  it("kubectl stub lists pods in plain and json modes", () => {
    const r = stubHarness(
      [
        "stub_kubectl_json",
        `export STUB_KUBECTL_PODS=$'web-1\\nweb-2'`,
        `kubectl get pods -o json`,
        `kubectl get pods`,
      ].join("\n"),
      {},
    );
    expect(r.out).toContain('"web-1"');
    expect(r.out).toContain('"web-2"');
    expect(r.out).toContain("web-1");
    expect(r.status).toBe(0);
  });

  it("kubectl stub records delete and scale targets", () => {
    const deleted = tmpPath("deleted.txt");
    const scaled = tmpPath("scaled.txt");
    const r = stubHarness(
      [
        "stub_kubectl_json",
        `export STUB_KUBECTL_DELETED='${deleted}'`,
        `export STUB_KUBECTL_SCALED='${scaled}'`,
        `kubectl delete pod web-1 -n prod`,
        `kubectl scale deployment web --replicas=3 -n prod`,
      ].join("\n"),
      {},
    );
    expect(r.status).toBe(0);
    expect(readFileSync(deleted, "utf8").split("\n")).toContain("web-1");
    expect(readFileSync(scaled, "utf8").split("\n")).toContain("web");
  });

  it("kubectl failure mode propagates", () => {
    const r = stubHarness(["stub_kubectl", "STUB_KUBECTL_FAIL=1 kubectl get pods"].join("\n"), {});
    expect(r.status).not.toBe(0);
  });

  it("gh stub serves canned API response and records mutations", () => {
    const api = tmpPath("api.json");
    const mutations = tmpPath("mutations.log");
    writeFileSync(api, '[{"id": 1, "body": "doc_id: x"}]');
    const r = stubHarness(
      [
        "stub_gh",
        `export STUB_GH_API_RESPONSE='${api}'`,
        `export STUB_GH_MUTATIONS='${mutations}'`,
        `gh api repos/o/r/issues/1/comments`,
        `gh api repos/o/r/issues/comments/1 -X PATCH -f body=updated`,
      ].join("\n"),
      {},
    );
    expect(r.status).toBe(0);
    expect(r.out).toContain("doc_id: x");
    expect(readFileSync(mutations, "utf8")).toContain("PATCH");
  });

  it("gh failure mode propagates", () => {
    const r = stubHarness(["stub_gh", "STUB_GH_FAIL=1 gh api repos/o/r/issues/1/comments"].join("\n"), {});
    expect(r.status).not.toBe(0);
  });

  it("mongo stubs list databases and honor failure modes", () => {
    const restoreLog = tmpPath("restore.log");
    const r = stubHarness(
      [
        "stub_mongo",
        `export STUB_MONGOSH_DATABASES=$'db1\\ndb2'`,
        `mongosh "mongodb://x" --quiet --eval "list"`,
        `STUB_MONGOSH_FAIL=1 mongosh "mongodb://x" --quiet --eval "list"`,
        `export STUB_MONGORESTORE_LOG='${restoreLog}'`,
        `mongorestore --uri="mongodb://x" --drop /backup`,
        `STUB_MONGORESTORE_FAIL=1 mongorestore --uri="mongodb://x" /backup`,
      ].join("\n"),
      {},
    );
    expect(r.out).toContain("db1");
    expect(r.status).not.toBe(0); // the last (failing) invocation
    expect(readFileSync(restoreLog, "utf8")).toContain("--drop");
  });

  it("git stub replays scenario script", () => {
    const scenario = tmpPath("git-scenario.sh");
    writeFileSync(scenario, `case "$1" in\n    log) printf 'def567 fix: real work\\nabc1234 WIP: temp\\n' ;;\n    merge-base) exit 0 ;;\n    *) exit 0 ;;\nesac\n`);
    const r = stubHarness(["stub_git", `export STUB_GIT_SCRIPT='${scenario}'`, `git log --oneline`].join("\n"), {});
    expect(r.out).toContain("def567");
  });

  it("call log records every invocation and counts per command", () => {
    const r = stubHarness(
      [
        "stub_kubectl_json",
        "kubectl get pods",
        "kubectl get pods",
        `echo "count=$(stub_call_count kubectl)"`,
        `stub_calls_contain "kubectl get pods" && echo contained`,
      ].join("\n"),
      {},
    );
    expect(r.status).toBe(0);
    expect(r.out).toContain("count=2");
    expect(r.out).toContain("contained");
  });

  it("mongodump stub records argv and honors failure mode", () => {
    const dumpLog = tmpPath("dump.log");
    const r = stubHarness(
      [
        "stub_mongo",
        `export STUB_MONGODUMP_LOG='${dumpLog}'`,
        `mongodump --uri="mongodb://x" --db db1 --out /backup`,
        `STUB_MONGODUMP_FAIL=1 mongodump --uri="mongodb://x" --db db2`,
      ].join("\n"),
      {},
    );
    expect(readFileSync(dumpLog, "utf8")).toContain("--db db1");
    expect(r.status).not.toBe(0);
  });

  it("gh paginated mode serves queued pages in order", () => {
    const p1 = tmpPath("p1.json");
    const p2 = tmpPath("p2.json");
    const pages = tmpPath("pages.txt");
    writeFileSync(p1, '{"page":1}');
    writeFileSync(p2, '{"page":2}');
    writeFileSync(pages, `${p1}\n${p2}\n`);
    const r = stubHarness(
      [
        "stub_gh",
        `export STUB_GH_PAGES='${pages}'`,
        `gh api repos/o/r/threads/1`,
        `gh api repos/o/r/threads/1`,
        `if gh api repos/o/r/threads/1; then echo EXHAUSTED-CALL-SUCCEEDED; fi`,
        `echo "count=$(stub_call_count gh)"`,
      ].join("\n"),
      {},
    );
    expect(r.out).toContain('"page":1');
    expect(r.out).toContain('"page":2');
    expect(r.out).toContain("count=3"); // two successful GETs + the exhausted failure
    expect(r.out).not.toContain("EXHAUSTED-CALL-SUCCEEDED");
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

// ── azure-setup (board convergence against scripted curl) ───────────────────

// Fixture columns with three states and stable endpoint ids (the bats
// mock_setup_board base fixture).
const BASE_COLUMNS =
  '{"value":[{"id":"first","name":"Custom backlog","columnType":"incoming","stateMappings":{"Issue":"To Do"}},{"id":"middle","name":"Custom doing","columnType":"inProgress","itemLimit":4,"stateMappings":{"Issue":"Doing"}},{"id":"last","name":"Custom done","columnType":"outgoing","stateMappings":{"Issue":"Done"}}]}';

function setupAzureFixture(workflow: string): { scriptEnv: Record<string, string>; requestBody: string; fixtures: string; bin: string } {
  const root = tmpPath(`az-${Math.random().toString(36).slice(2)}`);
  const home = join(root, "home");
  const fixtures = join(root, "fixtures");
  const bin = join(root, "bin");
  const requestBodies = join(root, "request-bodies");
  // STUB_CURL_REQUEST_BODY is a FILE the curl stub appends bodies into
  // (the bats fixture redirected into it) — not a directory.
  mkdirSync(join(home), { recursive: true });
  mkdirSync(fixtures, { recursive: true });
  mkdirSync(bin, { recursive: true });
  writeFileSync(requestBodies, "");
  const patFile = join(home, "azure.pat");
  writeFileSync(patFile, "synthetic-azure-pat\n");
  chmodSync(patFile, 0o600);
  writeFileSync(join(root, "devenv.config"), `[provider]\nname=azure\nazure_org=org\nazure_project=proj\n[workflows]\nstatus_workflow=${workflow}\n`);
  writeFileSync(join(fixtures, "projects"), '{"value":[{"id":"project-id","name":"proj"}]}');
  writeFileSync(join(fixtures, "team"), '{"defaultTeam":{"id":"team-id"},"capabilities":{"processTemplate":{"templateName":"Agile"}}}');
  writeFileSync(join(fixtures, "areas"), '{"children":[{"name":"repo"}]}');
  writeFileSync(join(fixtures, "repos"), '{"value":[{"name":"repo"}]}');
  writeFileSync(join(fixtures, "boards"), '{"value":[{"id":"board-id","name":"Issues"}]}');
  writeFileSync(join(fixtures, "teamsettings"), '{"bugsBehavior":"asRequirements"}');
  writeFileSync(join(fixtures, "columns"), BASE_COLUMNS);
  // curl-response: the base stub from cli-stubs; then the routing wrapper.
  writeFileSync(
    join(bin, "curl-response"),
    [
      "#!/usr/bin/env bash",
      'url=""',
      'prev=""',
      'out_file=""',
      'write_fmt=""',
      'for arg in "$@"; do',
      '  [[ "$prev" == "-D" ]] && headers_file="$arg"',
      '  [[ "$prev" == "-o" ]] && out_file="$arg"',
      '  [[ "$prev" == "-w" ]] && write_fmt="$arg"',
      '  prev="$arg"',
      'done',
      'for arg in "$@"; do',
      '  [[ "$arg" == "@-" ]] && { cat > /dev/null; break; }',
      'done',
      'for arg in "$@"; do',
      '  case "$arg" in',
      '    -*) prev="$arg"; continue ;;',
      '  esac',
      '  if [[ "$prev" != "-D" && "$prev" != "-o" && "$prev" != "-u" && "$prev" != "-X" && "$prev" != "-d" && "$prev" != "-H" && "$prev" != "-w" ]]; then',
      '    url="$arg"',
      '  fi',
      '  prev="$arg"',
      'done',
      'if [[ -n "${STUB_CURL_REQUEST_BODY:-}" ]]; then',
      '  prev=""',
      '  for arg in "$@"; do',
      '    if [[ "$prev" == "-d" ]]; then printf \'%s\\n\' "$arg" >> "$STUB_CURL_REQUEST_BODY"; fi',
      '    prev="$arg"',
      '  done',
      'fi',
      'code="${STUB_CURL_HTTP_CODE:-200}"',
      'resp="${STUB_CURL_RESPONSE:-}"',
      'if [[ -f "$resp" ]]; then',
      '  if [[ -n "$out_file" ]]; then cat "$resp" > "$out_file"; else cat "$resp"; fi',
      'else',
      '  [[ -n "$out_file" ]] && : > "$out_file"',
      'if [[ -n "${headers_file:-}" ]]; then',
      "  { printf 'HTTP/1.1 %s OK\\r\\n' \"$code\"; printf '\\r\\n'; } > \"$headers_file\"",
      'fi',
      'fi',
      '[[ -n "$write_fmt" ]] && printf \'%b\' "${write_fmt//%\\{http_code\\}/$code}"',
      'exit 0',
      "",
    ].join("\n"),
  );
  chmodSync(join(bin, "curl-response"), 0o755);
  writeFileSync(
    join(bin, "curl"),
    `#!/usr/bin/env bash\nurl="\${@: -1}"\nmethod=GET\nbody=""\nprevious=""\nfor argument in "$@"; do\n    [ "$previous" = "-X" ] && method="$argument"\n    [ "$previous" = "-d" ] && body="$argument"\n    previous="$argument"\ndone\ncase "$url" in\n    */columns\\?*)\n        if [ "$method" = PUT ]; then\n            jq -n --argjson columns "$body" '{value: ($columns | to_entries | map(.value + {id: (.value.id // ("generated-" + (.key | tostring)))}))}' > "${fixtures}/columns"\n        fi\n        export STUB_CURL_RESPONSE="${fixtures}/columns" ;;\n    */_apis/work/teamsettings*) export STUB_CURL_RESPONSE="${fixtures}/teamsettings" ;;\n    */_apis/work/boards\\?*) export STUB_CURL_RESPONSE="${fixtures}/boards" ;;\n    */_apis/git/repositories\\?*) export STUB_CURL_RESPONSE="${fixtures}/repos" ;;\n    */classificationnodes\\?*) export STUB_CURL_RESPONSE="${fixtures}/areas" ;;\n    *includeCapabilities*) export STUB_CURL_RESPONSE="${fixtures}/team" ;;\n    */_apis/projects\\?*) export STUB_CURL_RESPONSE="${fixtures}/projects" ;;\n    *) exit 99 ;;\nesac\nexec "$(dirname "$0")/curl-response" "$@"\n`,
  );
  chmodSync(join(bin, "curl"), 0o755);
  return {
    scriptEnv: {
      DEVENV_TOOLS: TOOLS,
      DEVENV_ROOT: root,
      HOME: home,
      AZURE_PAT_FILE: patFile,
      AZURE_SETUP: "1",
      PATH: `${bin}:${process.env.PATH ?? ""}`,
      STUB_CURL_REQUEST_BODY: requestBodies,
    },
    requestBody: requestBodies,
    fixtures,
    bin,
  };
}

function runAzureSetup(args: string[], fx: { scriptEnv: Record<string, string> }, extraEnv: Record<string, string | undefined> = {}): { status: number; out: string } {
  const e: Record<string, string> = { ...fx.scriptEnv };
  for (const [k, v] of Object.entries(extraEnv)) {
    if (v === undefined) delete e[k];
    else e[k] = v;
  }
  const r = spawnSync("bash", [AZURE_SETUP, ...args], { encoding: "utf8", env: e });
  return { status: r.status ?? 1, out: (r.stdout ?? "") + (r.stderr ?? "") };
}

// jq assertions against the recorded request bodies (the bats suites used
// jq -e; jq stays in the loop — it's on PATH in every dev container).
function jqFilter(filter: string, file: string): string {
  return spawnSync("jq", ["-e", filter, file], { encoding: "utf8" }).stdout ?? "";
}

describe("azure-setup (bats port)", () => {
  let FX = { scriptEnv: {} as Record<string, string>, requestBody: "", fixtures: "", bin: "" };

  beforeEach(() => {
    FX = setupAzureFixture("TBD,Implementing,Production");
  });

  it("script has valid syntax", () => {
    expect(spawnSync("bash", ["-n", AZURE_SETUP]).status).toBe(0);
  });

  it("refuses to run without AZURE_SETUP=1", () => {
    const e: Record<string, string> = { ...FX.scriptEnv };
    delete e["AZURE_SETUP"];
    const r = spawnSync("bash", [AZURE_SETUP], { encoding: "utf8", env: e });
    expect(r.status).not.toBe(0);
    expect((r.stdout ?? "") + (r.stderr ?? "")).toMatch(/AZURE_SETUP=1/);
  });

  it("--help prints usage and requirements without the gate", () => {
    const r = runAzureSetup(["--help"], FX, { AZURE_SETUP: undefined });
    expect(r.status).toBe(0);
    for (const s of ["azure-setup.sh", "AZURE_SETUP=1", "key-update-azure", "status_workflow", "--dry-run"]) {
      expect(r.out).toContain(s);
    }
  });

  it("help works via -h too", () => {
    const r = runAzureSetup(["-h"], FX, { AZURE_SETUP: undefined });
    expect(r.status).toBe(0);
    expect(r.out).toMatch(/USAGE/);
  });

  it("gated run without PAT fails with guidance, not a stack trace", () => {
    const root = tmpPath(`az-nopat-${Math.random().toString(36).slice(2)}`);
    mkdirSync(root, { recursive: true });
    writeFileSync(join(root, "devenv.config"), "[provider]\nname=azure\nazure_org=o\nazure_project=p\n");
    const r = runAzureSetup([], { scriptEnv: { ...FX.scriptEnv, DEVENV_ROOT: root } }, { AZURE_SETUP: "1", AZURE_PAT_FILE: undefined });
    expect(r.status).not.toBe(0);
    expect(r.out).toMatch(/key-update-azure/);
  });

  it("forces customized board names when counts match", () => {
    const fx = setupAzureFixture("TBD,Implementing,Production");
    const rr = runAzureSetup([], fx, { AZURE_SETUP: "1" });
    if (rr.status !== 0) console.error("DBG-forces:", rr.out.slice(0, 500));
    expect(rr.status).toBe(0);
    const out = jqFilter('type == "array" and map(.name) == ["TBD","Implementing","Production"] and .[0].id == "first" and .[1].id == "middle" and .[2].id == "last" and .[1].itemLimit == 4', fx.requestBody);
    expect(out.trim()).not.toBe("");
  });

  it("grows boards using supported mappings and preserves endpoint ids", () => {
    const fx = setupAzureFixture("TBD,Ready,Implementing,Review,Production");
    expect(runAzureSetup([], fx, { AZURE_SETUP: "1" }).status).toBe(0);
    const out = jqFilter('map(.name) == ["TBD","Ready","Implementing","Review","Production"] and .[0].id == "first" and .[4].id == "last" and .[1].id == "middle" and .[2].id == null and .[3].id == null and .[2].columnType == "inProgress" and .[2].stateMappings.Issue == "Doing" and .[4].stateMappings.Issue == "Done"', fx.requestBody);
    expect(out.trim()).not.toBe("");
  });

  it("shrinks boards to the configured vocabulary", () => {
    const fx = setupAzureFixture("TBD,Production");
    expect(runAzureSetup([], fx, { AZURE_SETUP: "1" }).status).toBe(0);
    const out = jqFilter('length == 2 and .[0].id == "first" and .[1].id == "last" and map(.name) == ["TBD","Production"]', fx.requestBody);
    expect(out.trim()).not.toBe("");
  });

  it("dry run previews customized board convergence without writes", () => {
    const fx = setupAzureFixture("TBD,Ready,Implementing,Review,Production");
    const original = join(fx.fixtures, "..", "original-columns");
    writeFileSync(original, readFileSync(join(fx.fixtures, "columns"), "utf8"));
    const r = runAzureSetup(["--dry-run"], fx, { AZURE_SETUP: "1" });
    expect(r.status).toBe(0);
    expect(r.out).toContain("[dry]");
    expect(r.out).toContain("Issues");
    expect(statSync(fx.requestBody).size).toBe(0);
    expect(readFileSync(join(fx.fixtures, "columns"), "utf8")).toBe(readFileSync(original, "utf8"));
  });

  it("converged repeat run does not rewrite the board", () => {
    const fx = setupAzureFixture("TBD,Ready,Implementing,Review,Production");
    expect(runAzureSetup([], fx, { AZURE_SETUP: "1" }).status).toBe(0);
    expect(statSync(fx.requestBody).size).toBeGreaterThan(0);
    const converged = join(fx.fixtures, "..", "converged-columns");
    writeFileSync(converged, readFileSync(join(fx.fixtures, "columns"), "utf8"));
    rmSync(fx.requestBody);
    expect(runAzureSetup([], fx, { AZURE_SETUP: "1" }).status).toBe(0);
    // A missing file is as good as an empty one (bats: [ ! -s file ]).
    const size = existsSync(fx.requestBody) ? statSync(fx.requestBody).size : 0;
    expect(size).toBe(0);
    expect(readFileSync(join(fx.fixtures, "columns"), "utf8")).toBe(readFileSync(converged, "utf8"));
  });

  it("configures all eight workflow columns and trims whitespace", () => {
    const fx = setupAzureFixture(" TBD, To-Groom,Ready,Implementing,Review,Merged,Staging, Production ");
    expect(runAzureSetup([], fx, { AZURE_SETUP: "1" }).status).toBe(0);
    const out = jqFilter('map(.name) == ["TBD","To-Groom","Ready","Implementing","Review","Merged","Staging","Production"] and .[7].id == "last" and (.[2:7] | all(.[]; .id == null and .stateMappings.Issue == "Doing"))', fx.requestBody);
    expect(out.trim()).not.toBe("");
  });

  it("rejects empty duplicate or single-column workflow without board writes", () => {
    for (const workflow of ["TBD,,Production", "TBD,TBD", "TBD"]) {
      const fx = setupAzureFixture(workflow);
      const r = runAzureSetup([], fx, { AZURE_SETUP: "1" });
      expect(r.status, `accepted: ${workflow}`).not.toBe(0);
      expect(r.out).toContain("distinct, non-empty column names");
      expect(statSync(fx.requestBody).size).toBe(0);
    }
  });

  it("reports missing in-progress mapping rather than inventing process states", () => {
    const fx = setupAzureFixture("TBD,Ready,Production");
    const trimmed = spawnSync("jq", ['.value |= map(select(.columnType != "inProgress"))', join(fx.fixtures, "columns")], { encoding: "utf8" }).stdout ?? "";
    writeFileSync(join(fx.fixtures, "columns"), trimmed);
    const r = runAzureSetup([], fx, { AZURE_SETUP: "1" });
    expect(r.status).toBe(0);
    expect(r.out).toContain("existing in-progress state mapping");
    expect(statSync(fx.requestBody).size).toBe(0);
  });

  it("a team that manages Bugs as tasks is switched to requirements so Bugs get a board column", () => {
    const fx = setupAzureFixture("TBD,Ready,Implementing,Review,Production");
    writeFileSync(join(fx.fixtures, "teamsettings"), '{"bugsBehavior":"asTasks"}');
    const r = runAzureSetup([], fx, { AZURE_SETUP: "1" });
    expect(r.status).toBe(0);
    expect(r.out).toContain("asTasks -> asRequirements");
    const bodies = join(fx.requestBody);
    const out = spawnSync("bash", ["-c", `jq -s -e 'any(.[]; type == "object" and .bugsBehavior == "asRequirements")' "${bodies}" >/dev/null`]).status;
    expect(out).toBe(0);
  });

  it("a team that already manages Bugs as requirements is left alone", () => {
    const fx = setupAzureFixture("TBD,Ready,Implementing,Review,Production");
    const r = runAzureSetup([], fx, { AZURE_SETUP: "1" });
    expect(r.status).toBe(0);
    expect(r.out).toContain("already managed as requirements");
    const bodies = fx.requestBody;
    const out = spawnSync("bash", ["-c", `jq -s -e 'any(.[]; type == "object" and has("bugsBehavior"))' "${bodies}" >/dev/null`]).status;
    expect(out).not.toBe(0);
  });

  it("dry run reports the Bugs change without writing it", () => {
    const fx = setupAzureFixture("TBD,Ready,Implementing,Review,Production");
    writeFileSync(join(fx.fixtures, "teamsettings"), '{"bugsBehavior":"asTasks"}');
    const r = runAzureSetup(["--dry-run"], fx, { AZURE_SETUP: "1" });
    expect(r.status).toBe(0);
    expect(r.out).toContain("[dry] would set the team's bugsBehavior");
    expect(statSync(fx.requestBody).size).toBe(0);
  });

  it("with Bugs on the board, each column of a User Story board also maps Bug", () => {
    const fx = setupAzureFixture("TBD,Review,Production");
    writeFileSync(
      join(fx.fixtures, "columns"),
      '{"value":[{"id":"first","name":"New","columnType":"incoming","stateMappings":{"User Story":"New"}},{"id":"middle","name":"Doing","columnType":"inProgress","stateMappings":{"User Story":"Active"}},{"id":"last","name":"Done","columnType":"outgoing","stateMappings":{"User Story":"Closed"}}]}',
    );
    expect(runAzureSetup([], fx, { AZURE_SETUP: "1" }).status).toBe(0);
    const out = spawnSync("bash", ["-c", `jq -s -e 'any(.[]; type == "array" and all(.[]; .stateMappings.Bug == .stateMappings["User Story"] and .stateMappings.Bug != null))' "${fx.requestBody}" >/dev/null`]).status;
    expect(out).toBe(0);
  });

  it("a board whose columns carry no User Story mapping gets no Bug mapping", () => {
    const fx = setupAzureFixture("TBD,Implementing,Production");
    expect(runAzureSetup([], fx, { AZURE_SETUP: "1" }).status).toBe(0);
    const out = spawnSync("bash", ["-c", `jq -s -e 'any(.[]; type == "array" and all(.[]; (.stateMappings | has("Bug")) | not))' "${fx.requestBody}" >/dev/null`]).status;
    expect(out).toBe(0);
  });

  it("preflight confirms the Agile process and says so", () => {
    const r = runAzureSetup(["--dry-run"], FX, { AZURE_SETUP: "1" });
    expect(r.status).toBe(0);
    expect(r.out).toContain("process: Agile");
  });

  it("a project on another process is refused before any write", () => {
    const fx = setupAzureFixture("TBD,Implementing,Production");
    writeFileSync(join(fx.fixtures, "team"), '{"defaultTeam":{"id":"team-id"},"capabilities":{"processTemplate":{"templateName":"Scrum"}}}');
    const r = runAzureSetup([], fx, { AZURE_SETUP: "1" });
    expect(r.status).not.toBe(0);
    expect(r.out).toContain("'Scrum' process");
    expect(statSync(fx.requestBody).size).toBe(0);
  });

  it("an unreadable process warns that Agile is not confirmed and continues", () => {
    const fx = setupAzureFixture("TBD,Implementing,Production");
    writeFileSync(join(fx.fixtures, "team"), '{"defaultTeam":{"id":"team-id"}}');
    const r = runAzureSetup(["--dry-run"], fx, { AZURE_SETUP: "1" });
    expect(r.status).toBe(0);
    expect(r.out).toContain("Agile not confirmed");
  });

  it("a PAT that cannot read a needed area stops before any write and names the scope", () => {
    const fx = setupAzureFixture("TBD,Implementing,Production");
    const inner = join(fx.bin, "curl-inner");
    spawnSync("mv", [join(fx.bin, "curl"), inner]);
    writeFileSync(
      join(fx.bin, "curl"),
      `#!/usr/bin/env bash\ncase "\${@: -1}" in\n    */classificationnodes*) printf '{"message":"denied"}\\n403'; exit 0 ;;\nesac\nexec "$(dirname "$0")/curl-inner" "$@"\n`,
    );
    chmodSync(join(fx.bin, "curl"), 0o755);
    const r = runAzureSetup([], fx, { AZURE_SETUP: "1" });
    expect(r.status).not.toBe(0);
    expect(r.out).toContain("cannot read area paths");
    expect(r.out).toContain("Work Items: Read");
  });

  it("an unknown option is refused, not ignored", () => {
    const r = runAzureSetup(["--dry-runn"], FX, { AZURE_SETUP: "1" });
    expect(r.status).toBe(2);
    expect(r.out).toContain("unknown option: --dry-runn");
  });

  it("--help works anywhere in the arguments and without the gate", () => {
    const r = runAzureSetup(["--dry-run", "--help"], FX, { AZURE_SETUP: undefined });
    expect(r.status).toBe(0);
    expect(r.out).toContain("USAGE");
  });

  it("JSON request bodies are built with jq, not printf", () => {
    const src = readFileSync(AZURE_SETUP, "utf8");
    expect(/"\{\\"name\\"/.test(src)).toBe(false);
  });
});
