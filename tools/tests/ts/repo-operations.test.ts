// Port of tools/tests/lib/test_repo_operations.bats (37 tests) — one vitest
// `it` per source `@test`. repo-operations.bash: repository discovery,
// listing, and filtering operations, plus the is_devenv_repo canonical
// predicate family and the repos-directory self-location contract.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, copyFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const ROOT = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))));
const TOOLS = join(ROOT, "tools");
const LIB = join(TOOLS, "lib", "repo-operations.bash");

let TMP = "";
let REPOS_DIR = "";

beforeEach(() => {
  TMP = mkdtempSync(join(tmpdir(), `repoopts-${Date.now()}-${Math.random().toString(36).slice(2)}`));
  REPOS_DIR = join(TMP, "repos");
  mkdirSync(REPOS_DIR, { recursive: true });
});

// bash -c with combined output, harness-style env (sandboxed TOOLS binding so
// self-root self-location lands in the fixture, DEVENV_ROOT sealed).
function sh(script: string, cwd?: string, extraEnv: Record<string, string> = {}): { status: number; out: string } {
  const r = spawnSync("bash", ["-c", script], {
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

// A minimal fake checkout carrying the lib + resolver, so the lib
// self-locates to the fake root.
function makeFakeRepoopsCheckout(root: string): void {
  mkdirSync(join(root, "tools", "lib"), { recursive: true });
  copyFileSync(join(TOOLS, "lib", "repo-operations.bash"), join(root, "tools", "lib", "repo-operations.bash"));
  copyFileSync(join(TOOLS, "lib", "self-root.bash"), join(root, "tools", "lib", "self-root.bash"));
  copyFileSync(join(TOOLS, "lib", "git-operations.bash"), join(root, "tools", "lib", "git-operations.bash"));
}

// git init -q in a directory (created as needed).
function gitInit(dir: string): void {
  mkdirSync(dir, { recursive: true });
  spawnSync("git", ["-C", dir, "init", "-q"]);
}

describe("repo operations", () => {
  // ── Library loading ──────────────────────────────────────────────────────

  it("repo-operations: library can be sourced", () => {
    const r = sh(`source '${LIB}' && echo 'loaded'`);
    expect(r.status).toBe(0);
    expect(r.out).toContain("loaded");
  });

  it("repo-operations: prevents multiple sourcing", () => {
    const r = sh(`source '${LIB}'\n_REPO_OPERATIONS_LOADED=1\nsource '${LIB}'\necho 'success'`);
    expect(r.status).toBe(0);
  });

  it("repo-operations: has valid bash syntax", () => {
    expect(spawnSync("bash", ["-n", LIB]).status).toBe(0);
  });

  // ── list_local_repositories ──────────────────────────────────────────────

  it("repo-operations: list_local_repositories requires base directory", () => {
    const r = sh(`source '${LIB}'\nlist_local_repositories 2>&1`);
    expect(r.status).toBe(1);
    expect(r.out).toContain("Base directory is required");
  });

  it("repo-operations: list_local_repositories returns empty for nonexistent directory", () => {
    const r = sh(`source '${LIB}'\nlist_local_repositories '/nonexistent/path' 2>&1`);
    expect(r.status).toBe(0);
    expect(r.out.trim()).toBe("");
  });

  it("repo-operations: list_local_repositories discovers local repos", () => {
    mkdirSync(join(REPOS_DIR, "repo1"), { recursive: true });
    mkdirSync(join(REPOS_DIR, "repo2"), { recursive: true });
    mkdirSync(join(REPOS_DIR, "repo3"), { recursive: true });
    const r = sh(`source '${LIB}'\nlist_local_repositories '${REPOS_DIR}' | sort`);
    expect(r.status).toBe(0);
    expect(r.out).toContain("repo1");
    expect(r.out).toContain("repo2");
    expect(r.out).toContain("repo3");
  });

  it("repo-operations: list_local_repositories ignores nested directories", () => {
    mkdirSync(join(REPOS_DIR, "repo1", "nested"), { recursive: true });
    mkdirSync(join(REPOS_DIR, "repo2"), { recursive: true });
    const r = sh(`source '${LIB}'\nlist_local_repositories '${REPOS_DIR}' | wc -l`);
    expect(r.status).toBe(0);
    expect(parseInt(r.out.trim(), 10)).toBe(2);
  });

  // ── filter_available_repositories ────────────────────────────────────────

  it("repo-operations: filter_available_repositories requires org repos", () => {
    const r = sh(`source '${LIB}'\nfilter_available_repositories '' 'repo1' 2>&1`);
    expect(r.status).toBe(1);
    expect(r.out).toContain("Organization repositories list is required");
  });

  it("repo-operations: filter_available_repositories returns all when no local repos", () => {
    const r = sh(`source '${LIB}'\norg_repos='repo1\nrepo2\nrepo3'\nfilter_available_repositories "$org_repos" ''`);
    expect(r.status).toBe(0);
    expect(r.out).toContain("repo1");
    expect(r.out).toContain("repo2");
    expect(r.out).toContain("repo3");
  });

  it("repo-operations: filter_available_repositories excludes local repos", () => {
    const r = sh(`source '${LIB}'\norg_repos='repo1\nrepo2\nrepo3'\nlocal_repos='repo2'\nfilter_available_repositories "$org_repos" "$local_repos"`);
    expect(r.status).toBe(0);
    expect(r.out).toContain("repo1");
    expect(r.out).not.toContain("repo2");
    expect(r.out).toContain("repo3");
  });

  it("repo-operations: filter_available_repositories handles multiple exclusions", () => {
    const r = sh(
      `source '${LIB}'\norg_repos='repo1\nrepo2\nrepo3\nrepo4'\nlocal_repos='repo1\nrepo3'\nfilter_available_repositories "$org_repos" "$local_repos"`,
    );
    expect(r.status).toBe(0);
    expect(r.out).not.toContain("repo1");
    expect(r.out).toContain("repo2");
    expect(r.out).not.toContain("repo3");
    expect(r.out).toContain("repo4");
  });

  // ── validate_repository_name ─────────────────────────────────────────────

  it("repo-operations: validate_repository_name requires name", () => {
    const r = sh(`source '${LIB}'\nvalidate_repository_name '' 2>&1`);
    expect(r.status).toBe(1);
    expect(r.out).toContain("Repository name is required");
  });

  it("repo-operations: validate_repository_name accepts valid names", () => {
    const r = sh(
      `source '${LIB}'\nvalidate_repository_name 'my-repo' && echo 'valid1' &&\nvalidate_repository_name 'my.repo' && echo 'valid2' &&\nvalidate_repository_name 'repo123' && echo 'valid3' &&\necho 'all_valid'`,
    );
    expect(r.status).toBe(0);
    expect(r.out).toContain("all_valid");
  });

  it("repo-operations: validate_repository_name rejects reserved names", () => {
    const r = sh(`source '${LIB}'\nvalidate_repository_name 'repos' 2>&1`);
    expect(r.status).toBe(1);
    expect(r.out).toContain("reserved");
  });

  it("repo-operations: validate_repository_name rejects dot names", () => {
    const r = sh(`source '${LIB}'\nvalidate_repository_name '.' 2>&1`);
    expect(r.status).toBe(1);
  });

  it("repo-operations: validate_repository_name rejects names starting with hyphen", () => {
    const r = sh(`source '${LIB}'\nvalidate_repository_name '-repo' 2>&1`);
    expect(r.status).toBe(1);
    expect(r.out).toContain("Invalid repository name format");
  });

  it("repo-operations: validate_repository_name rejects invalid characters", () => {
    const r = sh(`source '${LIB}'\nvalidate_repository_name 'repo@name' 2>&1`);
    expect(r.status).toBe(1);
    expect(r.out).toContain("Invalid repository name format");
  });

  // ── repository_exists_locally ────────────────────────────────────────────

  it("repo-operations: repository_exists_locally requires both arguments", () => {
    const r = sh(`source '${LIB}'\nrepository_exists_locally 'repo' '' 2>&1`);
    expect(r.status).toBe(1);
    expect(r.out).toContain("required");
  });

  it("repo-operations: repository_exists_locally returns true for existing repo", () => {
    mkdirSync(join(REPOS_DIR, "test-repo"), { recursive: true });
    const r = sh(`source '${LIB}'\nrepository_exists_locally 'test-repo' '${REPOS_DIR}'`);
    expect(r.status).toBe(0);
  });

  it("repo-operations: repository_exists_locally returns false for missing repo", () => {
    const r = sh(`source '${LIB}'\nrepository_exists_locally 'missing-repo' '${REPOS_DIR}'`);
    expect(r.status).toBe(1);
  });

  // ── get_current_repository_name / is_devenv_repository ──────────────────

  it("repo-operations: get_current_repository_name returns repo name from git context", () => {
    const r = sh(`source '${LIB}'\nget_current_repository_name`, ROOT);
    expect(r.status).toBe(0);
    expect(r.out.trim()).toBe("devenv");
  });

  it("repo-operations: is_devenv_repository returns true in devenv", () => {
    const r = sh(`source '${LIB}'\nis_devenv_repository`, ROOT);
    expect(r.status).toBe(0);
  });

  // ── is_devenv_repo (canonical predicate) ─────────────────────────────────

  it("git-operations: is_devenv_repo returns true in devenv (marker + name)", () => {
    const r = sh(`source '${TOOLS}/lib/git-operations.bash'\nis_devenv_repo`, ROOT);
    expect(r.status).toBe(0);
  });

  it("git-operations: is_devenv_repo detects renamed clone via marker file", () => {
    gitInit(join(TMP, "renamed-clone", ".devcontainer").replace("/.devcontainer", "") + "/../renamed-clone");
    writeMarker(join(TMP, "renamed-clone"));
    const r = sh(`source '${TOOLS}/lib/git-operations.bash'\nis_devenv_repo`, join(TMP, "renamed-clone"));
    expect(r.status).toBe(0);
  });

  it("git-operations: is_devenv_repo detects devenv-named repo without marker", () => {
    gitInit(join(TMP, "plain-parent", "devenv"));
    const r = sh(`source '${TOOLS}/lib/git-operations.bash'\nis_devenv_repo`, join(TMP, "plain-parent", "devenv"));
    expect(r.status).toBe(0);
  });

  it("git-operations: is_devenv_repo returns false in ordinary repo", () => {
    gitInit(join(TMP, "some-service"));
    const r = sh(`source '${TOOLS}/lib/git-operations.bash'\nis_devenv_repo`, join(TMP, "some-service"));
    expect(r.status).not.toBe(0);
  });

  it("git-operations: is_devenv_repo returns false outside any git repo", () => {
    const r = sh(`source '${TOOLS}/lib/git-operations.bash'\nis_devenv_repo`, TMP);
    expect(r.status).not.toBe(0);
  });

  it("git-operations: is_devenv_repository wrapper delegates to canonical predicate", () => {
    // wrapper and canonical predicate agree inside devenv
    let r = sh(`source '${LIB}'\nis_devenv_repository && is_devenv_repo`, ROOT);
    expect(r.status).toBe(0);
    // and agree outside it
    gitInit(join(TMP, "ordinary"));
    r = sh(
      `source '${LIB}'\nis_devenv_repository || is_devenv_repo || true\n! is_devenv_repository && ! is_devenv_repo`,
      join(TMP, "ordinary"),
    );
    expect(r.status).toBe(0);
  });

  // ── is_nested_devenv_clone ───────────────────────────────────────────────

  it("git-operations: is_nested_devenv_clone true for devenv-named repo under repos/", () => {
    gitInit(join(TMP, "repos", "devenv"));
    const r = sh(`source '${TOOLS}/lib/git-operations.bash'\nis_nested_devenv_clone`, join(TMP, "repos", "devenv"));
    expect(r.status).toBe(0);
  });

  it("git-operations: is_nested_devenv_clone true via marker file when dir renamed", () => {
    // Clone renamed but still nested under repos/ — the nesting check is
    // independent of the devenv-name/marker detection that gates its use.
    const dir = join(TMP, "repos", "renamed-devenv");
    gitInit(dir);
    writeMarker(dir);
    const r = sh(
      `source '${TOOLS}/lib/git-operations.bash'\nis_devenv_repo && is_nested_devenv_clone`,
      dir,
    );
    expect(r.status).toBe(0);
  });

  it("git-operations: is_nested_devenv_clone false for canonical devenv root", () => {
    // A devenv repo whose parent is not named repos/ (the canonical workspace
    // root) is not a nested clone — guard must stay in force there. Built as
    // a fixture so the assertion does not depend on where this suite's own
    // repo is checked out. (The leaf stays named `devenv`: the predicate
    // keys on the git root's basename.)
    const dir = join(TMP, "canonical-parent", "devenv");
    gitInit(dir);
    const r = sh(
      `source '${TOOLS}/lib/git-operations.bash'\nis_devenv_repo && ! is_nested_devenv_clone`,
      dir,
    );
    expect(r.status).toBe(0);
  });

  it("git-operations: is_nested_devenv_clone false for ordinary repo under repos/", () => {
    // Ordinary project repo nested under repos/ — not devenv at all, so the
    // nesting predicate alone is irrelevant; the check itself still returns 0
    // but is_devenv_repo must be false (guard unaffected).
    gitInit(join(TMP, "repos", "lib.cs.something"));
    const r = sh(
      `source '${TOOLS}/lib/git-operations.bash'\nis_nested_devenv_clone && ! is_devenv_repo`,
      join(TMP, "repos", "lib.cs.something"),
    );
    expect(r.status).toBe(0);
  });

  // ── check_target_repo ────────────────────────────────────────────────────

  it("git-operations: check_target_repo auto-allows nested devenv clone without --devenv", () => {
    gitInit(join(TMP, "repos", "devenv-guard"));
    const r = sh(
      `ALLOW_DEVENV_REPO=0\nsource '${TOOLS}/lib/git-operations.bash'\ncheck_target_repo`,
      join(TMP, "repos", "devenv-guard"),
    );
    expect(r.status).toBe(0);
    expect(r.out).not.toMatch("appears to be the devenv repository itself");
  });

  it("git-operations: check_target_repo still guards canonical devenv root", () => {
    // Fixture parent is not named repos/, so the canonical-root guard (not
    // the nested-clone auto-allow) must fire. (Leaf named `devenv`: the
    // detection keys on the git root's basename.)
    const dir = join(TMP, "canonical-parent2", "devenv");
    gitInit(dir);
    // git-operations sources error-handling from $DEVENV_ROOT/tools/lib;
    // stage it so log_error resolves inside the fixture root.
    mkdirSync(join(TMP, "tools", "lib"), { recursive: true });
    copyFileSync(join(TOOLS, "lib", "error-handling.bash"), join(TMP, "tools", "lib", "error-handling.bash"));
    const r = sh(
      `unset DEVENV_REPO\nALLOW_DEVENV_REPO=0\nsource '${TOOLS}/lib/git-operations.bash'\ncheck_target_repo`,
      dir,
      { DEVENV_ROOT: TMP },
    );
    expect(r.status).not.toBe(0);
    expect(r.out).toMatch("appears to be the devenv repository itself");
  });

  // ── get_or_create_repos_directory ────────────────────────────────────────

  it("repo-operations: get_or_create_repos_directory uses DEVENV_ROOT", () => {
    const fakeRoot = join(TMP, "fake_checkout");
    makeFakeRepoopsCheckout(fakeRoot);
    const r = sh(
      `export DEVENV_ROOT='${fakeRoot}'\nsource '${join(fakeRoot, "tools", "lib", "repo-operations.bash")}'\nresult=$(get_or_create_repos_directory)\n[ -d "$result" ] && echo "success"`,
    );
    expect(r.status).toBe(0);
    expect(r.out).toContain("success");
  });

  it("repo-operations: get_or_create_repos_directory creates directory if missing", () => {
    // Self-root contract: the lib self-locates to ITS OWN checkout even when
    // a foreign DEVENV_ROOT points elsewhere. Creation must land under the
    // fake root (the sourced lib checkout), never the foreign one.
    const fakeRoot = join(TMP, "fake_checkout2");
    const foreignRoot = join(TMP, "foreign_location");
    makeFakeRepoopsCheckout(fakeRoot);
    mkdirSync(foreignRoot, { recursive: true });
    const r = sh(
      `unset DEVENV_ROOT_SET\nexport DEVENV_ROOT='${foreignRoot}'\nsource '${join(fakeRoot, "tools", "lib", "repo-operations.bash")}'\nresult=$(get_or_create_repos_directory)\n[ -d "$result" ] && echo "directory_created"`,
    );
    expect(r.status).toBe(0);
    expect(r.out).toContain("directory_created");
    expect(existsSync(join(fakeRoot, "repos"))).toBe(true);
    expect(existsSync(join(foreignRoot, "repos"))).toBe(false);
  });

  it("repo-operations: get_or_create_repos_directory returns path", () => {
    const fakeRoot = join(TMP, "fake_checkout3");
    makeFakeRepoopsCheckout(fakeRoot);
    const r = sh(
      `export DEVENV_ROOT='${fakeRoot}'\nsource '${join(fakeRoot, "tools", "lib", "repo-operations.bash")}'\nget_or_create_repos_directory`,
    );
    expect(r.status).toBe(0);
    expect(r.out).toContain("repos");
  });
});

// Marker file for the devenv detection (.devcontainer/bootstrap.sh).
function writeMarker(repo: string): void {
  mkdirSync(join(repo, ".devcontainer"), { recursive: true });
  spawnSync("touch", [join(repo, ".devcontainer", "bootstrap.sh")]);
}
