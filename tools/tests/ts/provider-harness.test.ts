// Port of tools/tests/lib/test_provider_harness.bats (9 tests): the shared
// test harness primitives themselves — the gh argv assertions (call-shape
// harness) and the clean-shell loader-composition helpers that call-shape and
// loader-contract suites build on.
import { beforeEach, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))));
const TOOLS = join(ROOT, "tools");

let TMP = "";
let CALL_LOG = "";

// Recording gh stub (the log-only slice of the fixture's stub_gh).
const GH_STUB = `#!/usr/bin/env bash
echo "gh $*" >> "\${STUB_CALL_LOG:?}"
exit 0
`;

beforeEach(() => {
  TMP = mkdtempSync(join(tmpdir(), `pharness-${Date.now()}-${Math.random().toString(36).slice(2)}`));
  const stubDir = join(TMP, "stub-bin");
  mkdirSync(stubDir, { recursive: true });
  CALL_LOG = join(TMP, "stub-calls.log");
  writeFileSync(CALL_LOG, "");
  writeFileSync(join(stubDir, "gh"), GH_STUB);
  chmodSync(join(stubDir, "gh"), 0o755);
});

function gh(args: string[]): void {
  const r = spawnSync("gh", args, {
    encoding: "utf8",
    env: { ...process.env, STUB_CALL_LOG: CALL_LOG, PATH: `${join(TMP, "stub-bin")}:${process.env.PATH ?? ""}` },
  });
  expect(r.status ?? 1).toBe(0);
}

// gh_last_call_equals EXPECTED: the last `gh ...` line of the log must be
// exactly `gh EXPECTED`; mismatch reports expected/actual diagnostics.
function ghLastCallEquals(expected: string): { ok: boolean; out: string } {
  const log = readFileSync(CALL_LOG, "utf8").split("\n").filter((l) => l.startsWith("gh "));
  const last = log.at(-1) ?? "";
  if (last !== `gh ${expected}`) {
    return { ok: false, out: `gh argv mismatch\n  expected: gh ${expected}\n  actual:   ${last}` };
  }
  return { ok: true, out: "" };
}

// gh_calls_contain SUBSTRING: some recorded invocation contains it.
function ghCallsContain(substring: string): boolean {
  return readFileSync(CALL_LOG, "utf8").includes(substring);
}

function ghCallsReset(): void {
  writeFileSync(CALL_LOG, "");
}

// compose SOURCE-CMD FUNCS...: clean-shell composition — every named function
// must be defined after sourcing; the shell must NOT inherit the suite's env.
function compose(sourceCmd: string, funcs: string[]): { ok: boolean; out: string } {
  const checks = funcs.map((f) => `declare -F ${f} >/dev/null || echo "MISSING:${f}"`).join("\n");
  const r = spawnSync("bash", ["-c", `${sourceCmd}\n${checks}`], { encoding: "utf8" });
  const out = (r.stdout ?? "") + (r.stderr ?? "");
  const missing = out.split("\n").filter((l) => l.startsWith("MISSING:"));
  return { ok: (r.status ?? 1) === 0 && missing.length === 0, out: missing.join(", ") };
}

describe("harness: gh argv assertions", () => {
  it("gh_last_call_equals matches exact argv", () => {
    gh(["run", "list", "-R", "org/repo", "--limit", "5"]);
    const r = ghLastCallEquals("run list -R org/repo --limit 5");
    expect(r.ok, r.out).toBe(true);
  });

  it("gh_last_call_equals fails on drift with diagnostics", () => {
    gh(["run", "list", "-R", "org/repo", "--limit", "5"]);
    const r = ghLastCallEquals("run list -R other/repo --limit 5");
    expect(r.ok).toBe(false);
    expect(r.out).toContain("expected:");
    expect(r.out).toContain("actual:");
  });

  it("gh_last_call_equals sees only the latest invocation", () => {
    gh(["issue", "view", "7", "--json", "number"]);
    gh(["issue", "view", "8", "--json", "number"]);
    const r = ghLastCallEquals("issue view 8 --json number");
    expect(r.ok, r.out).toBe(true);
  });

  it("gh_calls_contain matches substring across window", () => {
    gh(["pr", "list", "-R", "org/repo", "--state", "open"]);
    gh(["issue", "list", "-R", "org/repo", "--state", "open"]);
    expect(ghCallsContain("pr list")).toBe(true);
    expect(ghCallsContain("issue list")).toBe(true);
  });

  it("gh_calls_reset clears the assertion window", () => {
    gh(["run", "list", "-R", "org/repo"]);
    ghCallsReset();
    expect(ghCallsContain("run list")).toBe(false);
  });
});

describe("harness: loader composition helpers", () => {
  it("compose_functions_defined passes for loader-provided verbs", () => {
    const c = compose(`source ${TOOLS}/lib/provider-loader.bash`, [
      "provider_issues_list",
      "provider_prs_list",
      "provider_repos_view",
    ]);
    expect(c.ok, `missing: ${c.out}`).toBe(true);
  });

  it("loader composition provides the auth lifecycle (provider_auth_status_impl)", () => {
    // The loader sources the provider's auth module: without it, auth gating
    // in scripts and the bootstrap seed import fail "does not implement"
    // even when the provider is fully functional.
    const c = compose(`source ${TOOLS}/lib/provider-loader.bash`, [
      "provider_auth_status_impl",
      "provider_auth_import_token_impl",
    ]);
    expect(c.ok, `missing: ${c.out}`).toBe(true);
  });

  it("core-only composition (bootstrap seam shape) also provides auth", () => {
    const devenvRoot = join(TMP, "devenv-root");
    mkdirSync(devenvRoot, { recursive: true });
    const c = compose(
      `source ${TOOLS}/lib/providers/provider-core.bash\n` +
      `provider_detect "${devenvRoot}/devenv.config" 2>/dev/null || PROVIDER_NAME=github\n` +
      `source "$DEVENV_TOOLS/lib/providers/\${PROVIDER_NAME}/auth.bash"`,
      ["provider_auth_status_impl", "provider_secret_get"],
    );
    expect(c.ok, `missing: ${c.out}`).toBe(true);
  });

  it("compose runs in a clean shell (no leakage from the suite)", () => {
    // The suite shell might have provider modules loaded; the composition
    // must not inherit them. A nonsense source command must report every
    // probe missing.
    const c = compose("true", ["provider_issues_list"]);
    expect(c.ok).toBe(false);
    expect(c.out).toContain("provider_issues_list");
  });
});
