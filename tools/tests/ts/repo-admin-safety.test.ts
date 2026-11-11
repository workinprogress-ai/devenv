// Safety gates of the repository-admin tools: repo-reset-merge-config
// (--apply fails closed), repo-update-config (--dry-run, owner check, honest
// exit codes) and the ruleset / feature appliers in domain/repos/types.ts.
// Everything runs against a stubbed gh with a call log; nothing reaches a
// provider.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CALLS_LOG_NAME,
  pathWithStubs,
  rmrf,
  runTool,
  stubCalls,
  stubCli,
  tmpDir,
  tmpToolboxRoot,
} from "./harness/index.ts";

vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });

const TYPES_TS = join(dirname(fileURLToPath(import.meta.url)), "../../lib/domain/repos/types.ts");

let TMP = "";
let BIN = "";

// A gh whose behaviour is steered by STUB_* env vars; every call is logged.
const GH_STUB = (log: string): string => `#!/bin/sh
echo "gh $*" >> "${log}"
case "$*" in
  "auth status"*) exit 0 ;;
  *"repo view"*) printf '%s\\n' "\${STUB_FULLNAME:-test-org/tool.demo}"; exit 0 ;;
  *"pr list"*)
    if [ -n "\${STUB_PR_FAIL:-}" ]; then echo "boom" >&2; exit 1; fi
    echo '[]'; exit 0 ;;
  *"rulesets --paginate"*)
    if [ -n "\${STUB_LIST_FAIL:-}" ]; then echo "HTTP 502" >&2; exit 1; fi
    printf '%s' "\${STUB_LIST_OUT:-[]}"; exit 0 ;;
  *"-X POST"*"/rulesets"*|*"-X PUT"*"/rulesets/"*)
    if [ -n "\${STUB_RULESET_FAIL:-}" ]; then echo "\${STUB_RULESET_FAIL}" >&2; exit 1; fi
    exit 0 ;;
  *"-X PATCH"*)
    if [ -n "\${STUB_PATCH_FAIL:-}" ]; then echo "HTTP 500" >&2; exit 1; fi
    exit 0 ;;
  *) exit 0 ;;
esac
`;

function calls(): string[] {
  return stubCalls(BIN, "gh");
}

function mutations(): string[] {
  return calls().filter((c) => /-X (PATCH|POST|PUT|DELETE)|--template/.test(c));
}

beforeEach(() => {
  TMP = tmpDir("repo-admin-safety");
  BIN = tmpDir("repo-admin-bin");
  stubCli(BIN, "gh", GH_STUB(join(BIN, CALLS_LOG_NAME)));
});

afterEach(() => {
  rmrf(TMP);
  rmrf(BIN);
});

// ---------------------------------------------------------------------------
// types.ts appliers, in-process
// ---------------------------------------------------------------------------

function runTs(code: string, extraEnv: Record<string, string> = {}): { status: number; stdout: string; stderr: string } {
  const script = join(TMP, "probe.mts");
  writeFileSync(script, code.replaceAll("__FILE__", TYPES_TS));
  const r = spawnSync("node", [script], {
    encoding: "utf8",
    env: { ...process.env, PATH: pathWithStubs(BIN), ...extraEnv },
  });
  return { status: r.status ?? 1, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

function rulesetFixture(): { toolsRoot: string; cfgPath: string } {
  const toolsRoot = join(TMP, "tools");
  mkdirSync(join(toolsRoot, "config"), { recursive: true });
  writeFileSync(
    join(toolsRoot, "config", "ruleset.json"),
    JSON.stringify({ name: "rs-{{repo_name}}", rules: [{ type: "pull_request" }] }),
  );
  const cfgPath = join(TMP, "repo-types.yaml");
  writeFileSync(
    cfgPath,
    ["types:", "  service:", '    naming_pattern: ".*"', '    naming_example: "x"', "    rulesetConfigFile: ruleset.json"].join("\n"),
  );
  return { toolsRoot, cfgPath };
}

function rulesetProbe(extraEnv: Record<string, string> = {}): { status: number; stdout: string; stderr: string; result: { applied: boolean; failures: string[] } | null } {
  const { toolsRoot, cfgPath } = rulesetFixture();
  const r = runTs(
    `
    const m = await import("__FILE__");
    const fs = await import("node:fs");
    const cfg = m.RepoTypesConfigSchema.parse(m.parseYamlSubset(fs.readFileSync(${JSON.stringify(cfgPath)}, "utf8")));
    const res = await m.configureRulesetsForType("org/svc", "service", cfg, ${JSON.stringify(toolsRoot)});
    console.log("RESULT=" + JSON.stringify(res));
  `,
    extraEnv,
  );
  const line = r.stdout.split("\n").find((l) => l.startsWith("RESULT="));
  return { ...r, result: line === undefined ? null : (JSON.parse(line.slice(7)) as { applied: boolean; failures: string[] }) };
}

describe("configureRulesetsForType result", () => {
  it("reports applied with no failures when the ruleset is created", () => {
    const r = rulesetProbe();
    expect(r.result).toEqual({ applied: true, failures: [] });
    expect(calls().some((c) => c.includes("-X POST"))).toBe(true);
  });

  it("reports a failed create as a failure, not as applied", () => {
    const r = rulesetProbe({ STUB_RULESET_FAIL: "HTTP 500 server error" });
    expect(r.result?.applied).toBe(false);
    expect(r.result?.failures.join(" ")).toContain("HTTP 500");
  });

  it("treats a failed ruleset list as an error and never creates", () => {
    const r = rulesetProbe({ STUB_LIST_FAIL: "1" });
    expect(r.result?.applied).toBe(false);
    expect(r.result?.failures.join(" ")).toMatch(/list/i);
    expect(calls().some((c) => c.includes("-X POST"))).toBe(false);
  });

  it("finds an existing ruleset across paginated list output and updates it", () => {
    const r = rulesetProbe({ STUB_LIST_OUT: '[{"name":"other","id":1}][{"name":"rs-svc","id":42}]' });
    expect(r.result).toEqual({ applied: true, failures: [] });
    expect(calls().some((c) => c.includes("-X PUT") && c.includes("rulesets/42"))).toBe(true);
    expect(calls().some((c) => c.includes("-X POST"))).toBe(false);
  });

  it("a 403 is a failure and never claims the repository was created successfully", () => {
    const r = rulesetProbe({ STUB_RULESET_FAIL: "HTTP 403: Upgrade to GitHub Pro" });
    expect(r.result?.applied).toBe(false);
    expect(r.result?.failures.length).toBeGreaterThan(0);
    expect(r.stdout + r.stderr).not.toContain("created successfully");
  });

  it("writes the payload into a private temp directory and removes it afterwards", () => {
    rulesetProbe();
    const post = calls().find((c) => c.includes("-X POST")) ?? "";
    const path = /--input (\S+)/.exec(post)?.[1] ?? "";
    expect(path).not.toBe("");
    expect(path).not.toMatch(/ruleset-payload-\/payload-/);
    expect(existsSync(path)).toBe(false);
    expect(existsSync(dirname(path))).toBe(false);
  });
});

describe("configureRepositoryFeaturesForType retry argv", () => {
  it("drops both the flag and the value of allow_forking=true on retry", () => {
    stubCli(
      BIN,
      "gh",
      `#!/bin/sh\necho "gh $*" >> "${join(BIN, CALLS_LOG_NAME)}"\ncase "$*" in\n  *allow_forking=*) echo "Allow forks setting can only be changed" >&2; exit 1 ;;\nesac\nexit 0\n`,
    );
    const r = runTs(`
      const m = await import("__FILE__");
      const cfg = m.RepoTypesConfigSchema.parse({ types: { service: { naming_pattern: ".*", naming_example: "x", allowForking: true } } });
      console.log("OK=" + await m.configureRepositoryFeaturesForType("org/repo", "service", cfg));
    `);
    expect(r.stdout).toContain("OK=true");
    const patches = calls().filter((c) => c.includes("-X PATCH"));
    expect(patches.length).toBe(2);
    expect(patches[1]).not.toContain("allow_forking");
    const args = patches[1]?.split(" ") ?? [];
    const fFlags = args.filter((a) => a === "-F").length;
    const fValues = args.filter((a) => /^(has_|allow_)/.test(a)).length;
    expect(fFlags).toBe(fValues);
  });
});

// ---------------------------------------------------------------------------
// repo-reset-merge-config --apply gate
// ---------------------------------------------------------------------------

describe("repo-reset-merge-config --apply fails closed", () => {
  let ROOT = "";

  function reset(args: string[], extra: Record<string, string> = {}): { status: number; output: string } {
    const r = runTool("repo-reset-merge-config", args, {
      env: { DEVENV_ROOT: ROOT, PATH: pathWithStubs(BIN), ...extra },
    });
    return { status: r.status, output: r.output };
  }

  beforeEach(() => {
    ROOT = tmpToolboxRoot("reset-root");
    mkdirSync(join(ROOT, "repos"), { recursive: true });
  });
  afterEach(() => rmrf(ROOT));

  it("applies a clean repository (no open PRs, nothing to scan)", () => {
    const r = reset(["--apply", "tool.demo"]);
    expect(r.status).toBe(0);
    expect(mutations().length).toBeGreaterThan(0);
  });

  it("does not apply when the open-PR count could not be read", () => {
    const r = reset(["--apply", "tool.demo"], { STUB_PR_FAIL: "1" });
    expect(r.status).not.toBe(0);
    expect(r.output).toContain("NOT APPLIED");
    expect(mutations()).toEqual([]);
  });

  it("does not apply when the WIP scan of the local clone failed", () => {
    // A clone whose default branch is not 'master' and which has no origin:
    // the 'master..HEAD' range cannot be scanned, which must count as a failure.
    const clone = join(ROOT, "repos", "tool.demo");
    spawnSync("git", ["init", "-q", "-b", "trunk", clone]);
    spawnSync("git", ["-c", "user.name=t", "-c", "user.email=t@e.test", "commit", "-q", "--allow-empty", "-m", "base"], { cwd: clone });
    const r = reset(["--apply", "tool.demo"]);
    expect(r.status).not.toBe(0);
    expect(r.output).toContain("NOT APPLIED");
    expect(mutations()).toEqual([]);
  });

  it("exits non-zero and lists the failures when a ruleset could not be applied", () => {
    const r = reset(["--apply", "tool.demo"], { STUB_RULESET_FAIL: "HTTP 500 server error" });
    expect(r.status).not.toBe(0);
    expect(r.output).toContain("ruleset");
    expect(r.output).toContain("HTTP 500");
  });
});

// ---------------------------------------------------------------------------
// repo-update-config
// ---------------------------------------------------------------------------

describe("repo-update-config", () => {
  let ROOT = "";
  let REPO = "";

  function update(args: string[], extra: Record<string, string> = {}): { status: number; output: string } {
    const r = runTool("repo-update-config", [REPO, "--type", "tool", ...args], {
      env: { DEVENV_ROOT: ROOT, PATH: pathWithStubs(BIN), ...extra },
    });
    return { status: r.status, output: r.output };
  }

  beforeEach(() => {
    ROOT = tmpToolboxRoot("update-config-root", "test-org");
    REPO = join(TMP, "clone");
    mkdirSync(REPO, { recursive: true });
  });
  afterEach(() => rmrf(ROOT));

  it("--dry-run applies nothing and reports each setting that would be applied", () => {
    const r = update(["--dry-run"]);
    expect(r.status).toBe(0);
    expect(mutations()).toEqual([]);
    for (const what of ["ruleset", "merge types", "delete_branch_on_merge", "features", "permission"]) {
      expect(r.output).toContain(what);
    }
    expect(r.output).toMatch(/dry-run/i);
  });

  it("refuses a repository whose owner is not the configured org", () => {
    const r = update([], { STUB_FULLNAME: "other-org/tool.demo" });
    expect(r.status).not.toBe(0);
    expect(r.output).toContain("other-org");
    expect(mutations()).toEqual([]);
  });

  it("applies and exits 0 when every step succeeds", () => {
    const r = update([]);
    expect(r.status).toBe(0);
    expect(mutations().length).toBeGreaterThan(0);
    expect(r.output).toContain("Configuration applied");
  });

  it("exits non-zero, names the failed steps and never claims success on a partial failure", () => {
    const r = update([], { STUB_PATCH_FAIL: "1" });
    expect(r.status).not.toBe(0);
    expect(r.output).not.toContain("Configuration applied");
    expect(r.output).not.toContain("Protection applied successfully");
    expect(r.output).toMatch(/merge types/i);
  });

  it("a ruleset failure is reported and fails the run", () => {
    const r = update([], { STUB_RULESET_FAIL: "HTTP 500 server error" });
    expect(r.status).not.toBe(0);
    expect(r.output).not.toContain("Protection applied successfully");
    expect(r.output).toContain("HTTP 500");
  });

  it("documents --dry-run in --help", () => {
    const r = runTool("repo-update-config", ["--help"], { env: { DEVENV_ROOT: ROOT, PATH: pathWithStubs(BIN) } });
    expect(r.output).toContain("--dry-run");
  });
});
