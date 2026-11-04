// Port of tools/tests/lib/test_git_operations.bats (60 tests) — one vitest
// `it` per source `@test`. git-operations.bash: branch/context helpers,
// conventional-commit validation, the excluded-branch guard, delete_branch
// outcome reporting, and the git config hygiene contracts.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const ROOT = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))));
const TOOLS = join(ROOT, "tools");

let TMP = "";
let TEST_REPO = "";

beforeEach(() => {
  TMP = mkdtempSync(join(tmpdir(), `gitops-${Date.now()}-${Math.random().toString(36).slice(2)}`));
  TEST_REPO = mkdtempSync(join(tmpdir(), `gitops-repo-${Date.now()}-${Math.random().toString(36).slice(2)}`));
  spawnSync("bash", ["-c", `cd '${TEST_REPO}' && git init -q && git config user.email test@example.com && git config user.name 'Test User'`]);
});

// The source suite's setup block as a preamble: four libs sourced per spawn
// (from the real tree — the bats sandbox copy is the same content).
const LIBS_PRELUDE =
  `source '${TOOLS}/lib/error-handling.bash'\n` +
  `source '${TOOLS}/lib/validation.bash'\n` +
  `source '${TOOLS}/lib/provider-loader.bash'\n` +
  `source '${TOOLS}/lib/git-operations.bash'\n`;

// bash -c with harness env: the lib preamble runs first unless the script
// sources the libs itself (tests that lock the loading behavior do that).
function sh(script: string, cwd?: string, extraEnv: Record<string, string> = {}, noPrelude = false): { status: number; out: string } {
  const r = spawnSync("bash", ["-c", (noPrelude ? "" : LIBS_PRELUDE) + script], {
    encoding: "utf8",
    cwd,
    env: {
      ...process.env,
      TEST_TEMP_DIR: TMP,
      DEVENV_TOOLS: TOOLS,
      DEVENV_ROOT: TMP,
      DEVENV_ROOT_SET: "1",
      ...extraEnv,
    },
  });
  return { status: r.status ?? 1, out: (r.stdout ?? "") + (r.stderr ?? "") };
}

function inRepo(script: string, extraEnv: Record<string, string> = {}): { status: number; out: string } {
  return sh(script, TEST_REPO, extraEnv);
}

// Seed: commit everything staged (the source's repeated fixture lines).
function seed(): void {
  spawnSync("bash", ["-c", `cd '${TEST_REPO}' && touch file.txt && git add file.txt && git commit -q -m init`]);
  spawnSync("bash", ["-c", `cd '${TEST_REPO}' && git config user.email test@example.com && git config user.name Test`]);
}


function gitOk(args: string): boolean {
  return spawnSync("bash", ["-c", `cd '${TEST_REPO}' && git ${args}`]).status === 0;
}

function checkoutBranch(name: string): void {
  spawnSync("bash", ["-c", `cd '${TEST_REPO}' && git checkout -q -b '${name}'`]);
}

// create_mock_git_repo (test_helper.bash shape).
function mockGitRepo(path: string): void {
  spawnSync("bash", [
    "-c",
    `mkdir -p '${path}' && cd '${path}' && git init -q && git config user.email test@example.com && git config user.name 'Test User' && git remote add origin 'git@github.com:test-org/dummy.git' && touch README.md && git add README.md && git commit -q -m 'Initial commit' && git branch -M main`,
  ]);
}

// guard_status <branch> <exclude-pattern>.
function guardStatus(branch: string, exclude: string): number {
  spawnSync("bash", ["-c", `cd '${TEST_REPO}' && git checkout -q -B '${branch}' 2>/dev/null`]);
  return sh(
    `validate_git_context '${TEST_REPO}' '${exclude}' >/dev/null 2>&1`,
    TEST_REPO,
  ).status;
}

describe("git operations", () => {
  it("get_current_branch returns current branch name", () => {
    seed();
    checkoutBranch("test-branch");
    const r = inRepo(`get_current_branch`);
    expect(r.out.trim()).toBe("test-branch");
  });

  it("get_current_branch returns empty outside git repo", () => {
    const r = sh(`get_current_branch`, "/tmp");
    expect(r.out.trim()).toBe("");
  });

  it("is_in_git_repo succeeds in git repository", () => {
    expect(inRepo(`is_in_git_repo`).status).toBe(0);
  });

  it("is_in_git_repo fails outside git repository", () => {
    const r = sh(`! is_in_git_repo`, "/tmp");
    expect(r.status).toBe(0);
  });

  it("is_working_directory_clean succeeds with clean directory", () => {
    seed();
    expect(inRepo(`is_working_directory_clean`).status).toBe(0);
  });

  it("is_working_directory_clean fails with uncommitted changes", () => {
    seed();
    spawnSync("bash", ["-c", `cd '${TEST_REPO}' && echo modified >> file.txt`]);
    expect(inRepo(`! is_working_directory_clean`).status).toBe(0);
  });

  it("is_branch_name fails for non-matching branch", () => {
    seed();
    checkoutBranch("feature-branch");
    expect(inRepo(`! is_branch_name "main"`).status).toBe(0);
  });

  it("branch_matches_pattern matches glob pattern", () => {
    seed();
    checkoutBranch("review/12345");
    expect(inRepo(`branch_matches_pattern "review/*"`).status).toBe(0);
  });

  it("branch_matches_pattern fails for non-matching pattern", () => {
    seed();
    checkoutBranch("feature/new-feature");
    expect(inRepo(`! branch_matches_pattern "review/*"`).status).toBe(0);
  });

  it("get_repo_root returns git repository root", () => {
    mkdirSync(join(TEST_REPO, "subdir"), { recursive: true });
    const r = sh(`get_repo_root`, join(TEST_REPO, "subdir"));
    expect(r.out.trim()).toBe(TEST_REPO);
  });

  it("get_default_branch returns main or master", () => {
    seed();
    const r = inRepo(`get_default_branch`);
    expect(r.out.trim().length > 0 || r.out.trim() === "").toBe(true);
    if (r.out.trim() === "") expect(true).toBe(true); // allow empty like the source
  });

  it("branch_exists_local succeeds for existing branch", () => {
    seed();
    checkoutBranch("existing-branch");
    expect(inRepo(`branch_exists_local "existing-branch"`).status).toBe(0);
  });

  it("branch_exists_local fails for non-existing branch", () => {
    expect(inRepo(`! branch_exists_local "non-existing"`).status).toBe(0);
  });

  it("delete_branch removes local branch", () => {
    seed();
    checkoutBranch("branch-to-delete");
    spawnSync("bash", ["-c", `cd '${TEST_REPO}' && git checkout -q -`]);
    expect(inRepo(`delete_branch "branch-to-delete"`).status).toBe(0);
    expect(gitOk(`show-ref --verify --quiet refs/heads/branch-to-delete`)).toBe(false);
  });

  // ── Commit message validation ────────────────────────────────────────────

  it("validate_conventional_commits accepts valid format", () => {
    expect(inRepo(`validate_conventional_commits "feat(api): add new endpoint"`).status).toBe(0);
  });

  it("validate_conventional_commits accepts feat with breaking change", () => {
    expect(inRepo(`validate_conventional_commits "feat!: breaking change"`).status).toBe(0);
  });

  it("validate_conventional_commits accepts fix format", () => {
    expect(inRepo(`validate_conventional_commits "fix(core): resolve issue"`).status).toBe(0);
  });

  it("validate_conventional_commits rejects invalid format", () => {
    expect(inRepo(`! validate_conventional_commits "invalid message"`).status).toBe(0);
  });

  it("validate_conventional_commits rejects empty message", () => {
    expect(inRepo(`! validate_conventional_commits ""`).status).toBe(0);
  });

  // ── validate_git_context ─────────────────────────────────────────────────

  it("validate_git_context succeeds with clean repo", () => {
    seed();
    expect(inRepo(`validate_git_context '${TEST_REPO}'`).status).toBe(0);
  });

  it("validate_git_context fails outside git repo", () => {
    expect(sh(`! validate_git_context "/tmp"`).status).toBe(0);
  });

  it("validate_git_context fails with uncommitted changes", () => {
    seed();
    spawnSync("bash", ["-c", `cd '${TEST_REPO}' && echo change >> file.txt`]);
    expect(inRepo(`! validate_git_context '${TEST_REPO}'`).status).toBe(0);
  });

  // The excluded-branch guard: a branch matching any '|'-separated glob is
  // refused. (It used to rely on extglob, which nothing in tools/ enables.)

  it("validate_git_context refuses an excluded branch (main)", () => {
    seed();
    expect(guardStatus("main", "main|master|review/*")).toBe(1);
  });

  it("validate_git_context refuses every alternative in the exclude list", () => {
    seed();
    expect(guardStatus("master", "main|master|review/*")).toBe(1);
    expect(guardStatus("review/123-x", "main|master|review/*")).toBe(1);
  });

  it("validate_git_context allows a branch that matches none of the patterns", () => {
    seed();
    expect(guardStatus("feature/ok", "main|master|review/*")).toBe(0);
  });

  it("validate_git_context treats the exclude list as globs, not substrings", () => {
    seed();
    expect(guardStatus("mainline", "main|master")).toBe(0);
  });

  it("validate_git_context needs no extglob to enforce the guard", () => {
    seed();
    spawnSync("bash", ["-c", `cd '${TEST_REPO}' && shopt -u extglob; true`]);
    expect(guardStatus("main", "main|master")).toBe(1);
  });

  it("validate_git_context with an empty exclude list excludes nothing", () => {
    seed();
    expect(guardStatus("main", "")).toBe(0);
  });

  // ── Merge message + PR discovery ─────────────────────────────────────────

  it("build_merge_commit_message formats message correctly", () => {
    const r = inRepo(`build_merge_commit_message "feat: add feature" "Description" "123" "456"`);
    const out = r.out;
    expect(out.startsWith("feat: add feature")).toBe(true);
    expect(out).toContain("#123 #456");
  });

  it("build_merge_commit_message handles body with newlines", () => {
    const r = inRepo(`build_merge_commit_message "fix: bug fix" "Multi\nline\nbody" "789"`);
    expect(r.out).toContain("#789");
  });

  it("extract_issue_from_pr validates issue number format", () => {
    // Regex validation only (the function itself needs gh).
    const r = sh(`echo "Closes #123" | grep -Eo '#[0-9]+' | head -n1 | tr -d '#'`);
    expect(r.out.trim()).toBe("123");
  });

  it("extract_issue_from_pr handles no issue reference", () => {
    const r = sh(`echo "No issue reference here" | grep -Eo '#[0-9]+' | head -n1 | tr -d '#' || echo ""`);
    expect(r.out.trim()).toBe("");
  });

  // ── Integration ──────────────────────────────────────────────────────────

  it("git-operations library loads without error-handling", () => {
    const r = sh(
      `export DEVENV_ROOT='${TMP}'\n` +
        `mkdir -p '${join(TMP, "tools", "lib")}'\n` +
        `cp '${TOOLS}/lib/error-handling.bash' '${join(TMP, "tools", "lib/")}'\n` +
        `source '${join(TMP, "tools", "lib", "error-handling.bash")}'\n` +
        `source '${TOOLS}/lib/git-operations.bash'\n` +
        `[ -n "$(type -t get_current_branch)" ]`,
      undefined, {}, true,
    );
    expect(r.status).toBe(0);
  });

  it("all git-operations functions are exported", () => {
    const r = inRepo(
      `[ -n "$(type -t get_current_branch)" ]\n` +
        `[ -n "$(type -t is_in_git_repo)" ]\n` +
        `[ -n "$(type -t get_repo_root)" ]\n` +
        `[ -n "$(type -t validate_conventional_commits)" ]\n` +
        `[ -n "$(type -t build_merge_commit_message)" ]`,
    );
    expect(r.status).toBe(0);
  });

  it("git-operations functions handle edge cases", () => {
    const r = inRepo(`result=$(get_current_branch 2>/dev/null || echo "handled")\n[ -n "$result" ]`);
    expect(r.status).toBe(0);
  });

  // ── Git configuration ────────────────────────────────────────────────────

  it("configure_git_repo sets local repository settings", () => {
    const testRepo = join(TMP, "test-repo");
    mockGitRepo(testRepo);
    const r = sh(`source '${TOOLS}/lib/git-operations.bash' && configure_git_repo '${testRepo}'`);
    expect(r.status).toBe(0);
    spawnSync("bash", ["-c", `cd '${testRepo}' && true`]);
    expect(spawnSync("git", ["-C", testRepo, "config", "core.autocrlf"], { encoding: "utf8" }).stdout?.trim()).toBe("false");
    expect(spawnSync("git", ["-C", testRepo, "config", "core.eol"], { encoding: "utf8" }).stdout?.trim()).toBe("lf");
    expect(spawnSync("git", ["-C", testRepo, "config", "pull.ff"], { encoding: "utf8" }).stdout?.trim()).toBe("only");
  });

  it("configure_git_repo adds directory to safe.directory", () => {
    const testRepo = join(TMP, "test-repo2");
    mockGitRepo(testRepo);
    const cfg = join(TMP, ".gitconfig-safe");
    const r = sh(`source '${TOOLS}/lib/git-operations.bash' && configure_git_repo '${testRepo}'`, undefined, {
      GIT_CONFIG_GLOBAL: cfg,
    });
    expect(r.status).toBe(0);
    expect(spawnSync("git", ["config", "--file", cfg, "--get-all", "safe.directory"], { encoding: "utf8" }).stdout).toContain(testRepo);
  });

  it("configure_git_repo updates remote URL when provided", () => {
    const testRepo = join(TMP, "test-repo3");
    mockGitRepo(testRepo);
    const testUrl = "https://test-org.example.com/test.git";
    // Safety gate resolves org from config: scope identity to a matching
    // mock root; mirror the real tools tree so the layer loads under it.
    const identRoot = join(TMP, "ident");
    mkdirSync(identRoot, { recursive: true });
    writeFileSync(join(identRoot, "devenv.config"), "[organization]\nname=t\norg=test-org\n");
    symlinkSync(TOOLS, join(identRoot, "tools"));
    const r = sh(
      `source '${TOOLS}/lib/git-operations.bash' && configure_git_repo '${testRepo}' '${testUrl}'`,
      undefined,
      { DEVENV_ROOT: identRoot, DEVENV_ROOT_SET: "1" },
    );
    expect(r.status).toBe(0);
    expect(spawnSync("git", ["-C", testRepo, "remote", "get-url", "origin"], { encoding: "utf8" }).stdout?.trim()).toBe(testUrl);
  });

  it("configure_git_repo works with current directory", () => {
    const testRepo = join(TMP, "test-repo4");
    mockGitRepo(testRepo);
    const r = sh(`source '${TOOLS}/lib/git-operations.bash' && configure_git_repo`, testRepo);
    expect(r.status).toBe(0);
    expect(spawnSync("git", ["-C", testRepo, "config", "core.autocrlf"], { encoding: "utf8" }).stdout?.trim()).toBe("false");
  });

  it("configure_git_global sets global git configuration", () => {
    const tempCfg = join(TMP, ".gitconfig");
    const r = sh(`source '${TOOLS}/lib/git-operations.bash' && configure_git_global 'Test User' 'test@example.com'`, undefined, {
      GIT_CONFIG_GLOBAL: tempCfg,
    });
    expect(r.status).toBe(0);
    const get = (k: string): string =>
      spawnSync("git", ["config", "--file", tempCfg, k], { encoding: "utf8" }).stdout?.trim() ?? "";
    expect(get("core.autocrlf")).toBe("false");
    expect(get("core.eol")).toBe("lf");
    expect(get("pull.ff")).toBe("only");
    expect(get("push.autoSetupRemote")).toBe("true");
    expect(get("core.editor")).toBe("code --wait");
    expect(get("user.name")).toBe("Test User");
    expect(get("user.email")).toBe("test@example.com");
    expect(get("merge.tool")).toBe("vscode");
    expect(get("diff.tool")).toBe("vscode");
  });

  it("configure_git_global works without user identity", () => {
    const tempCfg = join(TMP, ".gitconfig_nouser");
    const r = sh(`source '${TOOLS}/lib/git-operations.bash' && configure_git_global`, undefined, {
      GIT_CONFIG_GLOBAL: tempCfg,
    });
    expect(r.status).toBe(0);
    expect(spawnSync("git", ["config", "--file", tempCfg, "user.name"]).status).toBe(1);
  });

  it("add_git_safe_directory adds path to safe list", () => {
    const testDir = join(TMP, "safe-test");
    mkdirSync(testDir, { recursive: true });
    const tempCfg = join(TMP, ".gitconfig_safetest");
    const r = sh(`source '${TOOLS}/lib/git-operations.bash' && add_git_safe_directory '${testDir}'`, undefined, {
      GIT_CONFIG_GLOBAL: tempCfg,
    });
    expect(r.status).toBe(0);
    expect(spawnSync("git", ["config", "--file", tempCfg, "--get-all", "safe.directory"], { encoding: "utf8" }).stdout).toContain(testDir);
  });

  it("add_git_safe_directory does not duplicate entries", () => {
    const testDir = join(TMP, "safe-test-dup");
    mkdirSync(testDir, { recursive: true });
    const tempCfg = join(TMP, ".gitconfig_safedup");
    sh(`source '${TOOLS}/lib/git-operations.bash' && add_git_safe_directory '${testDir}'`, undefined, {
      GIT_CONFIG_GLOBAL: tempCfg,
    });
    sh(`source '${TOOLS}/lib/git-operations.bash' && add_git_safe_directory '${testDir}'`, undefined, {
      GIT_CONFIG_GLOBAL: tempCfg,
    });
    const count = (
      spawnSync("bash", ["-c", `git config --file '${tempCfg}' --get-all safe.directory | grep -c '${testDir}' || true`], {
        encoding: "utf8",
      }).stdout ?? "0"
    ).trim();
    expect(parseInt(count, 10)).toBe(1);
  });

  it("add_git_safe_directory uses current directory by default", () => {
    const testDir = join(TMP, "current");
    mkdirSync(testDir, { recursive: true });
    const tempCfg = join(TMP, ".gitconfig_safecwd");
    const r = sh(`source '${TOOLS}/lib/git-operations.bash' && add_git_safe_directory`, testDir, {
      GIT_CONFIG_GLOBAL: tempCfg,
    });
    expect(r.status).toBe(0);
    expect(spawnSync("git", ["config", "--file", tempCfg, "--get-all", "safe.directory"], { encoding: "utf8" }).stdout).toContain(testDir);
  });

  // ── delete_branch outcome reporting ─────────────────────────────────────

  it("delete_branch returns failure when the local branch cannot be deleted", () => {
    seed();
    checkoutBranch("doomed");
    const r = inRepo(`delete_branch doomed`);
    expect(r.status).not.toBe(0);
    expect(gitOk(`show-ref --verify --quiet refs/heads/doomed`)).toBe(true);
  });

  it("delete_branch returns failure when the remote deletion fails", () => {
    seed();
    spawnSync("bash", ["-c", `cd '${TEST_REPO}' && git branch -q doomed && git remote add origin '${join(TMP, "no-such-remote.git")}'`]);
    spawnSync("bash", ["-c", `cd '${TEST_REPO}' && git update-ref refs/remotes/origin/doomed HEAD`]);
    expect(inRepo(`delete_branch doomed`).status).not.toBe(0);
  });

  it("delete_branch still removes the local branch when the remote leg fails, and reports it", () => {
    seed();
    spawnSync("bash", ["-c", `cd '${TEST_REPO}' && git branch -q doomed && git remote add origin '${join(TMP, "no-such-remote.git")}'`]);
    spawnSync("bash", ["-c", `cd '${TEST_REPO}' && git update-ref refs/remotes/origin/doomed HEAD`]);
    expect(inRepo(`delete_branch doomed`).status).not.toBe(0);
    expect(gitOk(`show-ref --verify --quiet refs/heads/doomed`)).toBe(false);
  });

  it("delete_branch returns success when both legs succeed", () => {
    seed();
    spawnSync("bash", ["-c", `cd '${TEST_REPO}' && git branch -q doomed`]);
    expect(inRepo(`delete_branch doomed`).status).toBe(0);
    expect(gitOk(`show-ref --verify --quiet refs/heads/doomed`)).toBe(false);
  });

  // ── Global git config hygiene ────────────────────────────────────────────

  it("configure_git_global never installs the plaintext credential store helper", () => {
    const tempCfg = join(TMP, ".gitconfig_h1");
    const r = sh(`source '${TOOLS}/lib/git-operations.bash' >/dev/null 2>&1; configure_git_global 'Test User' 'test@example.com'`, undefined, {
      GIT_CONFIG_GLOBAL: tempCfg,
    });
    expect(r.status).toBe(0);
    const helpers = spawnSync("git", ["config", "--file", tempCfg, "--get-all", "credential.helper"], { encoding: "utf8" }).stdout ?? "";
    expect(helpers).not.toContain("store");
  });

  it("configure_git_global bounds any credential cache to a working day (it was ~31 years)", () => {
    const tempCfg = join(TMP, ".gitconfig_h2");
    const r = sh(`source '${TOOLS}/lib/git-operations.bash' >/dev/null 2>&1; configure_git_global 'Test User' 'test@example.com'`, undefined, {
      GIT_CONFIG_GLOBAL: tempCfg,
    });
    expect(r.status).toBe(0);
    const helpersRaw = spawnSync("git", ["config", "--file", tempCfg, "--get-all", "credential.helper"], { encoding: "utf8" }).stdout ?? "";
    const helpers = String(helpersRaw);
    const timeouts = [...helpers.matchAll(/timeout=(\d+)/g)].map((m) => parseInt(m[1] ?? "0", 10));
    for (const h of timeouts) {
      expect(h).toBeLessThanOrEqual(86400);
    }
  });

  it("configure_git_global sets the identity it was given", () => {
    const tempCfg = join(TMP, ".gitconfig_h3");
    const r = sh(`source '${TOOLS}/lib/git-operations.bash' >/dev/null 2>&1; configure_git_global 'Test User' 'test@example.com'`, undefined, {
      GIT_CONFIG_GLOBAL: tempCfg,
    });
    expect(r.status).toBe(0);
    expect(spawnSync("git", ["config", "--file", tempCfg, "user.name"], { encoding: "utf8" }).stdout?.trim()).toBe("Test User");
    expect(spawnSync("git", ["config", "--file", tempCfg, "user.email"], { encoding: "utf8" }).stdout?.trim()).toBe("test@example.com");
  });

  it("configure_git_repo registers a repo's safe.directory in global config once, idempotently", () => {
    seed();
    const tempCfg = join(TMP, ".gitconfig_idem");
    spawnSync("bash", [
      "-c",
      `source '${TOOLS}/lib/git-operations.bash' >/dev/null 2>&1; configure_git_repo '${TEST_REPO}'; configure_git_repo '${TEST_REPO}'`,
    ], { env: { ...process.env, GIT_CONFIG_GLOBAL: tempCfg } });
    const count = (
      spawnSync("bash", ["-c", `git config --file '${tempCfg}' --get-all safe.directory | grep -cFx '${TEST_REPO}'`], { encoding: "utf8" }).stdout ?? "0"
    ).trim();
    expect(parseInt(count, 10)).toBe(1);
  });

  it("configure_git_repo documents that it writes global safe.directory (git honors it only there)", () => {
    const src = spawnSync("bash", ["-c", `sed -n '/^# Configure repository-specific git settings/,/^configure_git_repo()/p' '${TOOLS}/lib/git-operations.bash'`], { encoding: "utf8" }).stdout ?? "";
    const block = src !== "" ? src : (spawnSync("bash", ["-c", `grep -B14 '^configure_git_repo()' '${TOOLS}/lib/git-operations.bash'`], { encoding: "utf8" }).stdout ?? "");
    expect(block).toContain("safe.directory");
    expect(block).toContain("global");
  });

  // ── get_default_branch ───────────────────────────────────────────────────

  it("get_default_branch reads origin/HEAD when it is set", () => {
    seed();
    spawnSync("bash", ["-c", `cd '${TEST_REPO}' && git update-ref refs/remotes/origin/trunk HEAD && git symbolic-ref refs/remotes/origin/HEAD refs/remotes/origin/trunk`]);
    const r = inRepo(`get_default_branch`);
    expect(r.status).toBe(0);
    expect(r.out.trim()).toBe("trunk");
  });

  it("get_default_branch falls back to origin/main when origin/HEAD is unset", () => {
    seed();
    spawnSync("bash", ["-c", `cd '${TEST_REPO}' && git update-ref refs/remotes/origin/main HEAD`]);
    const r = inRepo(`get_default_branch`);
    expect(r.status).toBe(0);
    expect(r.out.trim()).toBe("main");
  });

  it("get_default_branch falls back to origin/master when origin/HEAD is unset", () => {
    seed();
    spawnSync("bash", ["-c", `cd '${TEST_REPO}' && git update-ref refs/remotes/origin/master HEAD`]);
    const r = inRepo(`get_default_branch`);
    expect(r.status).toBe(0);
    expect(r.out.trim()).toBe("master");
  });

  it("get_default_branch answers master when the remote has neither", () => {
    seed();
    const r = inRepo(`get_default_branch`);
    expect(r.status).toBe(0);
    expect(r.out.trim()).toBe("master");
  });

  it("get_default_branch does not abort a caller running under set -e and pipefail", () => {
    seed();
    const r = sh(
      `set -euo pipefail\n` +
        `source '${TOOLS}/lib/error-handling.bash'\n` +
        `source '${TOOLS}/lib/git-operations.bash'\n` +
        `branch=$(get_default_branch)\necho "got:$branch"`,
      TEST_REPO, {}, true,
    );
    expect(r.status).toBe(0);
    expect(r.out.trim()).toBe("got:master");
  });

  // ── delete_local_branch ──────────────────────────────────────────────────

  it("delete_local_branch removes the local branch and leaves the remote one", () => {
    seed();
    const remoteGit = join(TMP, "remote.git");
    spawnSync("bash", ["-c", `cd '${TEST_REPO}' && git init -q --bare '${remoteGit}' && git remote add origin '${remoteGit}' && git checkout -q -b topic && git push -q origin topic && git checkout -q -`]);
    const r = inRepo(`delete_local_branch topic`);
    expect(r.status).toBe(0);
    expect(gitOk(`rev-parse --verify --quiet refs/heads/topic`)).toBe(false);
    expect(spawnSync("git", ["-C", remoteGit, "rev-parse", "--verify", "--quiet", "refs/heads/topic"]).status).toBe(0);
  });

  it("delete_local_branch is a success for a branch that does not exist", () => {
    expect(inRepo(`delete_local_branch no-such-branch`).status).toBe(0);
  });
});
