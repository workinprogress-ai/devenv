// Port of tools/tests/lib/test_github_helpers.bats (29 tests) — one vitest
// `it` per source `@test`. get_full_repo_name resolution, wait_for_workflow_runs
// semantics (unknown ≠ no-runs, retry, timeout), ensure_label, get_repo_owner's
// policy-first chain, and resolve_target_repo behavior locks.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const ROOT = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))));
const TOOLS = join(ROOT, "tools");

let TMP = "";

beforeEach(() => {
  TMP = mkdtempSync(join(tmpdir(), `ghhelp-${Date.now()}-${Math.random().toString(36).slice(2)}`));
});

// bash -c with combined output. The exported `gh` bash function travels via
// the script text (export -f from the child itself, as the source did).
function sh(script: string, cwd?: string): { status: number; out: string } {
  const r = spawnSync("bash", ["-c", script], {
    encoding: "utf8",
    cwd,
    env: { ...process.env },
  });
  return { status: r.status ?? 1, out: (r.stdout ?? "") + (r.stderr ?? "") };
}

// create_mock_git_repo (test_helper.bash): init + origin + one commit on main.
function mockGitRepo(path: string): void {
  spawnSync("bash", [
    "-c",
    `mkdir -p '${path}' && cd '${path}' && git init -q && git config user.email test@example.com && git config user.name 'Test User' && git remote add origin 'git@github.com:test-org/dummy.git' && touch README.md && git add README.md && git commit -q -m 'Initial commit' && git branch -M main`,
  ]);
}

const GH_FAIL = `gh() { return 1; }\nexport -f gh\n`;
const GH_NAME_WITH_OWNER = `gh() { if [[ "$*" =~ "repo view" ]] && [[ "$*" =~ "nameWithOwner" ]]; then echo "test-org/test-repo"; return 0; fi; return 1; }\nexport -f gh\n`;

describe("github helpers", () => {
  // ── get_full_repo_name ───────────────────────────────────────────────────

  it("get_full_repo_name: requires repo path argument", () => {
    const r = sh(`source '${TOOLS}/lib/provider-loader.bash'\nget_full_repo_name ''`);
    expect(r.status).not.toBe(0);
    expect(r.out).toMatch("Repository path is required");
  });

  it("get_full_repo_name: fails on invalid path", () => {
    const r = sh(`source '${TOOLS}/lib/provider-loader.bash'\nget_full_repo_name '/nonexistent/path/to/repo'`);
    expect(r.status).not.toBe(0);
    expect(r.out).toMatch("Failed to change to repository path");
  });

  it("get_full_repo_name: uses gh repo view when available", () => {
    const repo = join(TMP, "test-repo");
    spawnSync("bash", ["-c", `mkdir -p '${repo}' && cd '${repo}' && git init -q && git remote add origin 'https://github.com/test-org/test-repo.git'`]);
    const r = sh(`${GH_NAME_WITH_OWNER}source '${TOOLS}/lib/provider-loader.bash'\nget_full_repo_name '${repo}'`);
    expect(r.status).toBe(0);
    expect(r.out).toMatch("test-org/test-repo");
  });

  it("get_full_repo_name: falls back to git URL parsing when gh fails", () => {
    const repo = join(TMP, "test-repo2");
    spawnSync("bash", ["-c", `mkdir -p '${repo}' && cd '${repo}' && git init -q && git remote add origin 'https://github.com/my-org/my-project.git'`]);
    const r = sh(`${GH_FAIL}source '${TOOLS}/lib/provider-loader.bash'\nget_full_repo_name '${repo}'`);
    expect(r.status).toBe(0);
    expect(r.out).toMatch("my-org/my-project");
  });

  it("get_full_repo_name: parses SSH git URLs", () => {
    const repo = join(TMP, "test-repo3");
    spawnSync("bash", ["-c", `mkdir -p '${repo}' && cd '${repo}' && git init -q && git remote add origin 'git@github.com:org-name/repo-name.git'`]);
    const r = sh(`${GH_FAIL}source '${TOOLS}/lib/provider-loader.bash'\nget_full_repo_name '${repo}'`);
    expect(r.status).toBe(0);
    expect(r.out).toMatch("org-name/repo-name");
  });

  it("get_full_repo_name: parses HTTPS git URLs without .git suffix", () => {
    const repo = join(TMP, "test-repo4");
    spawnSync("bash", ["-c", `mkdir -p '${repo}' && cd '${repo}' && git init -q && git remote add origin 'https://github.com/owner/project'`]);
    const r = sh(`${GH_FAIL}source '${TOOLS}/lib/provider-loader.bash'\nget_full_repo_name '${repo}'`);
    expect(r.status).toBe(0);
    expect(r.out).toMatch("owner/project");
  });

  it("get_full_repo_name: fails when no git remote found", () => {
    const repo = join(TMP, "test-repo5");
    spawnSync("bash", ["-c", `mkdir -p '${repo}' && cd '${repo}' && git init -q`]);
    const r = sh(`${GH_FAIL}source '${TOOLS}/lib/provider-loader.bash'\nget_full_repo_name '${repo}'`);
    expect(r.status).not.toBe(0);
    expect(r.out).toMatch("No git remote 'origin' found");
  });

  it("get_full_repo_name: fails when URL parsing fails", () => {
    const repo = join(TMP, "test-repo6");
    spawnSync("bash", ["-c", `mkdir -p '${repo}' && cd '${repo}' && git init -q && git remote add origin 'https://invalid-url'`]);
    const r = sh(`${GH_FAIL}source '${TOOLS}/lib/provider-loader.bash'\nget_full_repo_name '${repo}'`);
    expect(r.status).not.toBe(0);
    expect(r.out).toMatch("Could not parse repository name");
  });

  // ── wait_for_workflow_runs ───────────────────────────────────────────────

  const WAIT_PRELUDE = `source '${TOOLS}/lib/error-handling.bash'\nsource '${TOOLS}/lib/provider-loader.bash'\n`;

  it("wait_for_workflow_runs: requires repo argument", () => {
    const r = sh(`${WAIT_PRELUDE}wait_for_workflow_runs ''`);
    expect(r.status).not.toBe(0);
    expect(r.out).toMatch("Repository");
  });

  it("wait_for_workflow_runs: returns 0 when no active runs and latest succeeded", () => {
    const r = sh(
      `gh() { if [[ "$*" =~ 'status' ]]; then echo '[]'; elif [[ "$*" =~ 'conclusion' ]]; then echo '[{"conclusion":"success"}]'; fi; return 0; }\nexport -f gh\n${WAIT_PRELUDE}wait_for_workflow_runs 'owner/repo' 'master' 1 5`,
    );
    expect(r.status).toBe(0);
  });

  it("wait_for_workflow_runs: returns 1 when latest run failed", () => {
    const r = sh(
      `gh() { if [[ "$*" =~ 'status' ]]; then echo '[]'; elif [[ "$*" =~ 'conclusion' ]]; then echo '[{"conclusion":"failure"}]'; fi; return 0; }\nexport -f gh\n${WAIT_PRELUDE}wait_for_workflow_runs 'owner/repo' 'master' 1 5`,
    );
    expect(r.status).toBe(1);
  });

  it("wait_for_workflow_runs: returns 1 when latest run cancelled", () => {
    const r = sh(
      `gh() { if [[ "$*" =~ 'status' ]]; then echo '[]'; elif [[ "$*" =~ 'conclusion' ]]; then echo '[{"conclusion":"cancelled"}]'; fi; return 0; }\nexport -f gh\n${WAIT_PRELUDE}wait_for_workflow_runs 'owner/repo' 'master' 1 5`,
    );
    expect(r.status).toBe(1);
  });

  it("wait_for_workflow_runs: a gh that always fails is an error, not success", () => {
    // A failed query is "unknown", never "no active runs": treating it as
    // zero would let a caller proceed as if CI were green during an auth or
    // network failure.
    const r = sh(
      `gh() { echo 'HTTP 502' >&2; return 1; }\nexport -f gh\n${WAIT_PRELUDE}wait_for_workflow_runs 'owner/repo' 'master' 1 30`,
    );
    expect(r.status).toBe(1);
    expect(r.out).toMatch("could not query");
  });

  it("wait_for_workflow_runs: a transient gh failure is retried and then succeeds", () => {
    const calls = join(TMP, "calls");
    writeFileSync(calls, "");
    const r = sh(
      `CALLS='${calls}'\ngh() { echo x >> "$CALLS"; [ "$(wc -l < "$CALLS")" -eq 1 ] && return 1; if [[ "$*" =~ 'status' ]]; then echo '[]'; elif [[ "$*" =~ 'conclusion' ]]; then echo '[{"conclusion":"success"}]'; fi; return 0; }\nexport -f gh\n${WAIT_PRELUDE}wait_for_workflow_runs 'owner/repo' 'master' 1 30`,
    );
    expect(r.status).toBe(0);
  });

  it("wait_for_workflow_runs: a failing conclusion lookup is unknown, not success", () => {
    const r = sh(
      `gh() { if [[ "$*" =~ 'status' ]]; then echo '[]'; return 0; fi; return 1; }\nexport -f gh\n${WAIT_PRELUDE}wait_for_workflow_runs 'owner/repo' 'master' 1 30`,
    );
    expect(r.status).toBe(1);
  });

  it("wait_for_workflow_runs: returns 2 on timeout with active runs", () => {
    const r = sh(
      `gh() { if [[ "$*" =~ 'status' ]]; then echo '[{"status":"in_progress"}]'; fi; return 0; }\nexport -f gh\n${WAIT_PRELUDE}wait_for_workflow_runs 'owner/repo' 'master' 1 2`,
    );
    expect(r.status).toBe(2);
    expect(r.out).toMatch("Timeout");
  });

  it("wait_for_workflow_runs: polls until runs complete then succeeds", () => {
    const counter = join(TMP, "gh_call_count");
    writeFileSync(counter, "0");
    const r = sh(
      `COUNTER_FILE='${counter}'\n` +
        `gh() { if [[ "$*" =~ 'status' ]]; then count=$(cat "$COUNTER_FILE"); count=$((count + 1)); echo "$count" > "$COUNTER_FILE"; if [ "$count" -le 2 ]; then echo '[{"status":"in_progress"}]'; else echo '[]'; fi; elif [[ "$*" =~ 'conclusion' ]]; then echo '[{"conclusion":"success"}]'; fi; return 0; }\n` +
        `export -f gh\n${WAIT_PRELUDE}wait_for_workflow_runs 'owner/repo' 'master' 1 10`,
    );
    expect(r.status).toBe(0);
  });

  // ── ensure_label ─────────────────────────────────────────────────────────

  it("ensure_label: requires label argument", () => {
    const r = sh(`${WAIT_PRELUDE}ensure_label ''`);
    expect(r.status).not.toBe(0);
    expect(r.out).toMatch("Label name required");
  });

  it("ensure_label: does not create label when it already exists", () => {
    const r = sh(
      `gh() { if [[ "$*" =~ 'label list' ]]; then echo 'automated'; return 0; fi; echo 'UNEXPECTED_GH_CALL' >&2; return 1; }\nexport -f gh\n${WAIT_PRELUDE}ensure_label 'automated'`,
    );
    expect(r.status).toBe(0);
    expect(r.out).not.toMatch("UNEXPECTED_GH_CALL");
  });

  it("ensure_label: creates label when it does not exist", () => {
    const r = sh(
      `gh() { if [[ "$*" =~ 'label list' ]]; then echo 'some-other-label'; return 0; fi; if [[ "$*" =~ 'label create' ]]; then echo 'CREATED'; return 0; fi; return 0; }\nexport -f gh\n${WAIT_PRELUDE}ensure_label 'automated'`,
    );
    expect(r.status).toBe(0);
    expect(r.out).toMatch("CREATED");
  });

  it("ensure_label: succeeds even if label create fails", () => {
    const r = sh(
      `gh() { if [[ "$*" =~ 'label list' ]]; then return 0; fi; if [[ "$*" =~ 'label create' ]]; then return 1; fi; return 0; }\nexport -f gh\n${WAIT_PRELUDE}ensure_label 'automated'`,
    );
    expect(r.status).toBe(0);
  });

  // ── get_repo_owner ───────────────────────────────────────────────────────

  it("get_repo_owner: policy org wins before gh fallback; gh consulted when policy unresolvable", () => {
    const repo = join(TMP, "owner-repo");
    mockGitRepo(repo);
    const r = sh(
      `gh() { for arg in "$@"; do [[ "$arg" == "-R" ]] && return 1; done; echo "test-org"; return 0; }\n` +
        `export -f gh\nunset GH_ORG POLICY_ORG\n` +
        `printf '[organization]\\nname=t\\norg=config-org\\n' > '${join(TMP, "devenv.config")}'\n` +
        `export DEVENV_ROOT='${TMP}'\n` +
        `source '${TOOLS}/lib/provider-loader.bash'\nget_repo_owner\n`,
      repo,
    );
    // Policy chain resolves from config first: config org must beat the gh
    // fallback without ever passing -R.
    expect(r.status).toBe(0);
    expect(r.out.trim()).toBe("config-org");
  });

  // ── resolve_target_repo behavior locks ───────────────────────────────────

  const RESOLVE_PRELUDE = (devenvRoot: string, extra = ""): string =>
    `set -e\nexport PROJECT_ROOT='${ROOT}'\nexport DEVENV_ROOT='${devenvRoot}'\nunset DEVENV_REPO GH_REPO\n` +
    (extra ? `${extra}\n` : "") +
    `source '${TOOLS}/lib/error-handling.bash'\nsource '${TOOLS}/lib/git-operations.bash'\nsource '${TOOLS}/lib/provider-loader.bash'\n`;

  it("resolve_target_repo: explicit argument wins over env and cwd", () => {
    const repo = join(TMP, "owner-repo-b");
    mockGitRepo(repo);
    const r = sh(`${RESOLVE_PRELUDE(TMP)}cd '${repo}'\nALLOW_DEVENV_REPO=0 resolve_target_repo 'arg-org/arg-repo'\n`);
    expect(r.status).toBe(0);
    expect(r.out.trim()).toBe("arg-org/arg-repo");
  });

  it("resolve_target_repo: DEVENV_REPO env used when no argument", () => {
    const r = sh(`${RESOLVE_PRELUDE(TMP, "unset GH_REPO")}DEVENV_REPO='env-org/env-repo' resolve_target_repo\n`);
    expect(r.status).toBe(0);
    expect(r.out.trim()).toBe("env-org/env-repo");
  });

  it("resolve_target_repo: prints the spec and exports no provider-named env", () => {
    const r = sh(`${RESOLVE_PRELUDE(TMP)}DEVENV_REPO='env-org/env-repo' resolve_target_repo > /dev/null\nprintf '%s' "\${GH_REPO:-}"\n`);
    expect(r.status).toBe(0);
    expect(r.out.trim()).toBe("");
  });

  it("resolve_target_repo: falls back to org + git root basename", () => {
    const repo = join(TMP, "cwd-repo");
    mockGitRepo(repo);
    const r = sh(
      `set -e\nexport PROJECT_ROOT='${ROOT}'\nunset DEVENV_REPO GH_REPO GH_ORG POLICY_ORG\n` +
        `printf '[organization]\\nname=t\\norg=cfg-org\\n' > '${join(TMP, "devenv.config")}'\n` +
        `export DEVENV_ROOT='${TMP}'\n` +
        // Pre-seal the self-root contract so the test-scoped DEVENV_ROOT wins
        // over self-location (git-operations would otherwise re-root to the
        // repo checkout and bind its config).
        `export DEVENV_ROOT_SET=1\n` +
        `source '${TOOLS}/lib/error-handling.bash'\nsource '${TOOLS}/lib/git-operations.bash'\nsource '${TOOLS}/lib/provider-loader.bash'\n` +
        `cd '${repo}'\nresolve_target_repo\n`,
    );
    expect(r.status).toBe(0);
    expect(r.out.trim()).toBe("cfg-org/cwd-repo");
  });

  it("resolve_target_repo: exits nonzero when nothing resolvable", () => {
    const r = sh(
      `set -e\nexport PROJECT_ROOT='${ROOT}'\nexport DEVENV_ROOT='${TMP}'\nexport DEVENV_ROOT_SET=1\nunset DEVENV_REPO GH_REPO GH_ORG POLICY_ORG\n` +
        `source '${TOOLS}/lib/error-handling.bash'\nsource '${TOOLS}/lib/git-operations.bash'\nsource '${TOOLS}/lib/provider-loader.bash'\n` +
        `cd '${TMP}'\nresolve_target_repo\n`,
    );
    expect(r.status).not.toBe(0);
  });

  it("resolve_target_repo: hard error when git-operations not sourced (gate bypass protection)", () => {
    const r = sh(
      `set -e\nexport PROJECT_ROOT='${ROOT}'\nexport DEVENV_ROOT='${TMP}'\nunset DEVENV_REPO GH_REPO\n` +
        `source '${TOOLS}/lib/error-handling.bash'\nsource '${TOOLS}/lib/provider-loader.bash'\n` +
        `DEVENV_REPO='env-org/env-repo' resolve_target_repo\n`,
    );
    expect(r.status).not.toBe(0);
  });

  it("resolve_target_repo: nested devenv clone below repos/ is auto-allowed", () => {
    const repo = join(TMP, "ws", "repos", "cwd-repo");
    mockGitRepo(repo);
    const r = sh(
      `set -e\nexport PROJECT_ROOT='${ROOT}'\nunset DEVENV_REPO GH_REPO GH_ORG POLICY_ORG\n` +
        `printf '[organization]\\nname=t\\norg=cfg-org\\n' > '${join(TMP, "devenv.config")}'\n` +
        `export DEVENV_ROOT='${TMP}'\nexport DEVENV_ROOT_SET=1\n` +
        `source '${TOOLS}/lib/error-handling.bash'\nsource '${TOOLS}/lib/git-operations.bash'\nsource '${TOOLS}/lib/provider-loader.bash'\n` +
        `cd '${repo}'\n` +
        // is_devenv_repo keys on .devcontainer/bootstrap.sh (or a repo
        // literally named devenv); emulate the nested devenv-clone layout.
        `mkdir -p .devcontainer && touch .devcontainer/bootstrap.sh\n` +
        `resolve_target_repo\n`,
    );
    expect(r.status).toBe(0);
    // The gate notes the nested clone, and the spec is resolved.
    expect(r.out).toContain("devenv clone below repos/");
    expect(r.out).toContain("cfg-org/cwd-repo");
  });
});
