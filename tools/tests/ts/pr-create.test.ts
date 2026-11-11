// Port of tools/tests/scripts/test_pr_create.bats (behavioral subset; the
// syntax/--help boilerplate drops per 16.11). pr-create's full contract:
// issue inference/validation, squash CC gate, dirty/WIP/review guards, plan
// files, --at merge-branch mechanics against a local remote, and argv riders.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync, appendFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runTool as runHarness } from "./harness/index.ts";

vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });


let TMP = "";
let REPO_DIR = "";
let GH_CALL_LOG = "";
let REMOTE = "";
let READY_HASH = "";

const GIT_ENV = (): Record<string, string> => ({
  ...process.env,
  HOME: join(TMP, "home"),
  GIT_AUTHOR_NAME: "Test User",
  GIT_AUTHOR_EMAIL: "test@example.com",
  GIT_COMMITTER_NAME: "Test User",
  GIT_COMMITTER_EMAIL: "test@example.test",
});

function git(args: string[]): { status: number; stdout: string } {
  const r = spawnSync("git", args, { cwd: REPO_DIR, encoding: "utf8", env: GIT_ENV() });
  return { status: r.status ?? 1, stdout: r.stdout ?? "" };
}

function branch(name: string): void {
  git(["checkout", "-q", "-B", name, "main"]);
}

// The gh mock from the bats setup: records argv, answers issue/repo/pr shapes,
// knobs: EXISTING_PR_URL, PR_CREATE_FAIL, PR_CREATE_WARN, SQUASH_MODE.
function writeGhStub(): void {
  const bin = join(TMP, "bin");
  mkdirSync(bin, { recursive: true });
  writeFileSync(
    join(bin, "gh"),
    [
      "#!/usr/bin/env bash",
      'cmd="$1"; shift',
      'printf \'gh %s\\n\' "$*" >> "${GH_CALL_LOG:-/dev/null}"',
      'if [ "$cmd" != "-R" ] && [ "${1:-}" = "-R" ]; then shift; shift; fi',
      'sub="$1"; shift || true',
      'case "$cmd $sub" in',
      '  "pr list")',
      '    echo "${EXISTING_PR_URL:-}"',
      "    ;;",
      '  "pr create")',
      '    if [ -n "${PR_CREATE_FAIL:-}" ]; then',
      '      echo "error: could not create the PR; see https://github.com/mock-owner/mock-repo/issues/9" >&2',
      "      exit 1",
      "    fi",
      '    if [ -n "${PR_CREATE_WARN:-}" ]; then',
      '      echo "warning: see https://github.com/mock-owner/mock-repo/wiki/rate-limits" >&2',
      "    fi",
      '    echo "https://github.com/mock-owner/mock-repo/pull/123"',
      "    ;;",
      '  "repo view")',
      "    has_squash=0; has_repo_jq=0",
      '    for a in "$@"; do',
      '      [ "$a" = "allowSquashMerge" ] && has_squash=1',
      '      { [ "$a" = "-q" ] || [ "$a" = "--jq" ]; } && has_repo_jq=1',
      "    done",
      '    if [ "$has_squash" -eq 1 ] && [ "$has_repo_jq" -eq 1 ]; then',
      '      echo "${SQUASH_MODE:-false}"',
      "    else",
      '      cat <<JSON',
      '{"owner":{"login":"mock-owner"},"name":"mock-repo","allowSquashMerge":${SQUASH_MODE:-false}}',
      "JSON",
      "    fi",
      "    ;;",
      '  "issue view")',
      '    [ -n "${ISSUE_VIEW_FAIL:-}" ] && { echo "issue not found" >&2; exit 1; }',
      "    has_title=0; has_jq=0",
      '    for a in "$@"; do',
      '      [ "$a" = "title" ] && has_title=1',
      '      { [ "$a" = "-q" ] || [ "$a" = "--jq" ]; } && has_jq=1',
      "    done",
      '    if [ "$has_title" -eq 1 ] && [ "$has_jq" -eq 1 ]; then',
      '      echo "Fix the frobnicator alignment"',
      "    else",
      "      cat <<'JSON'",
      '{"title":"Fix the frobnicator alignment"}',
      "JSON",
      "    fi",
      "    ;;",
      "  *)",
      '    echo "gh mock received unexpected command: $cmd $sub" >&2',
      "    exit 1",
      "    ;;",
      " esac",
      "",
    ].join("\n"),
  );
  spawnSync("chmod", ["+x", join(bin, "gh")]);
}

function prCreate(args: string[], extraEnv: Record<string, string> = {}, input = ""): { status: number; stdout: string; stderr: string; out: string } {
  // The suite drove the depth-1 stub; the harness runs the .ts source —
  // the same execution path the stub resolves to.
  const r = runHarness("pr-create", args, {
    cwd: REPO_DIR,
    stdin: input,
    env: {
      ...GIT_ENV(),
      GH_CALL_LOG,
      PATH: `${join(TMP, "bin")}:${process.env.PATH ?? ""}`,
      DEVENV_ROOT: join(TMP, "devroot"),
      ...extraEnv,
    },
  });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr, out: r.output };
}

// at_fixture: a feature branch with a ready commit and a WIP tip, plus a
// local bare remote standing in for the https origin.
function atFixture(): void {
  REMOTE = join(TMP, "remote.git");
  spawnSync("git", ["init", "-q", "--bare", "-b", "main", REMOTE], { env: GIT_ENV() });
  spawnSync("git", ["config", `url.${REMOTE}.insteadOf`, "https://github.com/mock-owner/mock-repo.git"], { cwd: REPO_DIR, env: GIT_ENV() });
  git(["push", "-q", "origin", "main"]);
  branch("feature/partial");
  appendFileSync(join(REPO_DIR, "README.md"), "one\n");
  git(["add", "README.md"]);
  git(["commit", "-q", "-m", "feat: ready prefix"]);
  READY_HASH = (git(["rev-parse", "--short", "HEAD"]).stdout ?? "").trim();
  appendFileSync(join(REPO_DIR, "README.md"), "two\n");
  git(["add", "README.md"]);
  git(["commit", "-q", "-m", "WIP: continues"]);
}

beforeEach(() => {
  TMP = mkdtempSync(join(tmpdir(), `prcreate-${Date.now()}-${Math.random().toString(36).slice(2)}`));
  mkdirSync(join(TMP, "home"), { recursive: true });
  mkdirSync(join(TMP, "devroot"), { recursive: true });
  writeFileSync(join(TMP, "devroot", "devenv.config"), "[provider]\nname=github\n[organization]\norg=mock-owner\nemail_domain=test.example.com\n[workflows]\nstatus_workflow=TBD,To-Groom,Ready,Implementing,Review,Merged,Staging,Production\n");
  REPO_DIR = join(TMP, "pr-repo");
  mkdirSync(REPO_DIR, { recursive: true });
  spawnSync("git", ["init", "-q"], { cwd: REPO_DIR, env: GIT_ENV() });
  spawnSync("git", ["config", "user.email", "test@example.com"], { cwd: REPO_DIR, env: GIT_ENV() });
  spawnSync("git", ["config", "user.name", "Test User"], { cwd: REPO_DIR, env: GIT_ENV() });
  writeFileSync(join(REPO_DIR, "README.md"), "initial\n");
  spawnSync("git", ["add", "README.md"], { cwd: REPO_DIR, env: GIT_ENV() });
  spawnSync("git", ["commit", "-q", "-m", "chore: initial"], { cwd: REPO_DIR, env: GIT_ENV() });
  spawnSync("git", ["branch", "-M", "main"], { cwd: REPO_DIR, env: GIT_ENV() });
  spawnSync("git", ["remote", "add", "origin", "https://github.com/mock-owner/mock-repo.git"], { cwd: REPO_DIR, env: GIT_ENV() });
  // Every fixture reaches a local bare repo, never the https URL: the tool
  // refreshes the PR branch from origin before scanning it.
  REMOTE = join(TMP, "remote.git");
  spawnSync("git", ["init", "-q", "--bare", "-b", "main", REMOTE], { env: GIT_ENV() });
  spawnSync("git", ["config", `url.${REMOTE}.insteadOf`, "https://github.com/mock-owner/mock-repo.git"], { cwd: REPO_DIR, env: GIT_ENV() });
  spawnSync("git", ["update-ref", "refs/remotes/origin/main", "HEAD"], { cwd: REPO_DIR, env: GIT_ENV() });
  spawnSync("git", ["symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main"], { cwd: REPO_DIR, env: GIT_ENV() });
  branch("feature/test");
  GH_CALL_LOG = join(TMP, "calls.log");
  writeFileSync(GH_CALL_LOG, "");
  writeGhStub();
});

afterEach(() => {
  rmSync(TMP, { recursive: true, force: true });
});

describe("pr-create (behavioral port)", () => {
  it("pr-create requires --issue or --no-issue (un-inferable branch errors with guidance)", () => {
    const r = prCreate(["feat: new feature", "--repo-dir", REPO_DIR]);
    expect(r.status).not.toBe(0);
    expect(r.out).toContain("pass --issue <number> or --no-issue");
  });

  it("pr-create rejects both --issue and --no-issue", () => {
    const r = prCreate(["feat: new feature", "--issue", "123", "--no-issue", "--repo-dir", REPO_DIR]);
    expect(r.status).not.toBe(0);
    expect(r.out).toContain("Cannot specify both --issue and --no-issue");
  });

  it("pr-create validates issue number is numeric", () => {
    const r = prCreate(["feat: new feature", "--issue", "abc", "--repo-dir", REPO_DIR]);
    expect(r.status).not.toBe(0);
    expect(r.out).toContain("Issue number must be numeric");
  });

  it("pr-create accepts valid issue number", () => {
    const r = prCreate(["feat: new feature", "--issue", "456", "--repo-dir", REPO_DIR]);
    expect(r.status).toBe(0);
    expect(r.out).toContain("https://github.com/mock-owner/mock-repo/pull/123");
  });

  it("pr-create accepts --no-issue flag", () => {
    const r = prCreate(["fix: minor typo", "--no-issue", "--repo-dir", REPO_DIR]);
    expect(r.status).toBe(0);
    expect(r.out).toContain("https://github.com/mock-owner/mock-repo/pull/123");
  });

  it("pr-create enforces Conventional Commits only on squash repos", () => {
    // Squash repo: CC required (title becomes the commit subject).
    let r = prCreate(["invalid message", "--issue", "123", "--repo-dir", REPO_DIR], { SQUASH_MODE: "true" });
    expect(r.status).not.toBe(0);
    expect(r.out).toContain("Conventional Commits");
    const log = readFileSync(GH_CALL_LOG, "utf8");
    expect(log.split("pr create").length - 1).toBe(0);
    // Non-squash repo: any non-empty title passes the gate.
    writeFileSync(GH_CALL_LOG, "");
    r = prCreate(["invalid message", "--issue", "123", "--repo-dir", REPO_DIR], { SQUASH_MODE: "false" });
    expect(r.status).toBe(0);
  });

  it("pr-create defaults PR title to the issue title when omitted on a non-squash repo", () => {
    const r = prCreate(["--issue", "123", "--repo-dir", REPO_DIR], { SQUASH_MODE: "false" });
    expect(r.status).toBe(0);
    expect(readFileSync(GH_CALL_LOG, "utf8")).toContain("--title Fix the frobnicator alignment");
  });

  it("pr-create requires a title on a squash repo even without a message", () => {
    const r = prCreate(["--issue", "123", "--repo-dir", REPO_DIR], { SQUASH_MODE: "true" });
    expect(r.status).not.toBe(0);
    expect(r.out).toContain("squash");
  });

  it("pr-create infers the issue number from the branch name", () => {
    branch("42-fix-thing");
    const r = prCreate(["some title", "--repo-dir", REPO_DIR]);
    expect(r.status).toBe(0);
    expect(r.out).toContain("Inferred issue #42");
  });

  it("pr-create inference skips a type folder prefix", () => {
    branch("feat/77-add-widget");
    const r = prCreate(["some title", "--repo-dir", REPO_DIR]);
    expect(r.status).toBe(0);
    expect(r.out).toContain("Inferred issue #77");
  });

  it("pr-create errors when inference finds no numeric segment", () => {
    branch("hotfix-desc-only");
    const r = prCreate(["some title", "--repo-dir", REPO_DIR]);
    expect(r.status).not.toBe(0);
    expect(r.out).toContain("none inferable from branch name");
    expect(r.out).toContain("--no-issue");
  });

  it("pr-create fails on dirty working tree", () => {
    appendFileSync(join(REPO_DIR, "README.md"), "uncommitted change\n");
    const r = prCreate(["feat: something", "--issue", "789", "--repo-dir", REPO_DIR]);
    expect(r.status).not.toBe(0);
    expect(r.out).toContain("uncommitted or staged changes");
  });

  it("pr-create proceeds when a plan file sits in the repo root", () => {
    writeFileSync(join(REPO_DIR, "Plan-issue-789-001.md"), "plan content\n");
    const r = prCreate(["feat: something", "--issue", "789", "--repo-dir", REPO_DIR]);
    expect(r.out).toContain("mock-owner/mock-repo/pull/123");
  });

  it("pr-create warns but proceeds when a plan file is only in .local-artifacts", () => {
    mkdirSync(join(REPO_DIR, ".local-artifacts"), { recursive: true });
    writeFileSync(join(REPO_DIR, ".local-artifacts", "Plan-issue-789-001.md"), "working copy\n");
    const r = prCreate(["feat: something", "--issue", "789", "--repo-dir", REPO_DIR]);
    expect(r.out).toContain("Warning: Implementation plan file(s) found in .local-artifacts/");
    expect(r.out).toContain("mock-owner/mock-repo/pull/123");
  });

  it("pr-create rejects review branch", () => {
    branch("review/test-123");
    const r = prCreate(["feat: something", "--issue", "789", "--repo-dir", REPO_DIR]);
    expect(r.status).not.toBe(0);
    expect(r.out).toContain("cannot be run on a review");
  });

  it("pr-create rejects a branch whose range carries WIP commits", () => {
    branch("feature/wip-range");
    appendFileSync(join(REPO_DIR, "README.md"), "scratch\n");
    git(["add", "README.md"]);
    git(["commit", "-q", "-m", "WIP: mid-work save"]);
    appendFileSync(join(REPO_DIR, "README.md"), "done\n");
    git(["add", "README.md"]);
    git(["commit", "-q", "-m", "feat: finished change"]);
    const r = prCreate(["feat: something", "--issue", "789", "--repo-dir", REPO_DIR]);
    expect(r.status).not.toBe(0);
    expect(r.out).toContain("WIP: commits present in PR creation range");
    expect(r.out).toContain("WIP: mid-work save");
  });

  it("pr-create accepts a clean range without WIP commits", () => {
    branch("feature/clean-range");
    appendFileSync(join(REPO_DIR, "README.md"), "clean\n");
    git(["add", "README.md"]);
    git(["commit", "-q", "-m", "feat: clean change"]);
    const r = prCreate(["feat: something", "--issue", "789", "--repo-dir", REPO_DIR]);
    expect(r.status).toBe(0);
    expect(r.out).toContain("mock-owner/mock-repo/pull/123");
  });

  it("pr-create --at creates a merge branch and opens the PR from it", () => {
    // A real (local) remote: the merge branch is pushed before the PR opens.
    atFixture();
    // --at picks the ready prefix; the merge branch skips the WIP tip, so the
    // feature-branch WIP never enters the PR.
    const r = prCreate(["feat: ready prefix", "--issue", "789", "--at", READY_HASH, "--repo-dir", REPO_DIR]);
    expect(r.status).toBe(0);
    expect(r.out).toContain("mock-owner/mock-repo/pull/123");
    expect(git(["show-ref", "--verify", "--quiet", `refs/heads/merge/${READY_HASH}-feature/partial`]).status).toBe(0);
    // Success path returns the user to the feature branch: the merge
    // branch is a PR vehicle, not a place to keep working.
    expect((git(["rev-parse", "--abbrev-ref", "HEAD"]).stdout ?? "").trim()).toBe("feature/partial");
  });

  it("pr-create --at rejects an unresolvable commit", () => {
    const r = prCreate(["feat: something", "--issue", "789", "--at", "no-such-hash", "--repo-dir", REPO_DIR]);
    expect(r.status).not.toBe(0);
    expect(r.out).toContain("does not resolve to a commit");
  });

  it("pr-create --at pick lists commits non-interactively without consuming input", () => {
    branch("feature/pick");
    appendFileSync(join(REPO_DIR, "README.md"), "x\n");
    git(["add", "README.md"]);
    git(["commit", "-q", "-m", "feat: pickable"]);
    // stdin severed: no TTY — the tool falls back to the numbered list and exits.
    const r = prCreate(["feat: something", "--issue", "789", "--at", "pick", "--repo-dir", REPO_DIR], {}, "");
    expect(r.status).not.toBe(0);
    expect(r.out).toContain("Non-interactive mode");
    expect(r.out).toContain("feat: pickable");
  });

  it("pr-create --at pushes the merge branch to the remote before opening the PR", () => {
    atFixture();
    const r = prCreate(["feat: ready prefix", "--issue", "789", "--at", READY_HASH, "--repo-dir", REPO_DIR]);
    expect(r.status).toBe(0);
    expect(spawnSync("git", ["-C", REMOTE, "show-ref", "--verify", "--quiet", `refs/heads/merge/${READY_HASH}-feature/partial`]).status).toBe(0);
  });

  it("pr-create --at: a failed push stops before creating the PR and restores the branch", () => {
    atFixture();
    rmSync(REMOTE, { recursive: true, force: true }); // remote vanishes: the push cannot succeed
    writeFileSync(GH_CALL_LOG, "");
    const r = prCreate(["feat: ready prefix", "--issue", "789", "--at", READY_HASH, "--repo-dir", REPO_DIR]);
    expect(r.status).not.toBe(0);
    const log = readFileSync(GH_CALL_LOG, "utf8");
    expect(log.split("gh pr create").length - 1).toBe(0);
    expect((git(["rev-parse", "--abbrev-ref", "HEAD"]).stdout ?? "").trim()).toBe("feature/partial");
  });

  it("pr-create --at restores the original branch when the merge-branch WIP guard rejects", () => {
    atFixture();
    const wipHash = (git(["rev-parse", "--short", "HEAD"]).stdout ?? "").trim(); // the WIP tip itself
    const r = prCreate(["feat: x", "--issue", "789", "--at", wipHash, "--repo-dir", REPO_DIR]);
    expect(r.status).not.toBe(0);
    expect((git(["rev-parse", "--abbrev-ref", "HEAD"]).stdout ?? "").trim()).toBe("feature/partial");
  });

  it("pr-create --at restores the original branch when an open PR already exists", () => {
    atFixture();
    const r = prCreate(["feat: ready prefix", "--issue", "789", "--at", READY_HASH, "--repo-dir", REPO_DIR], {
      EXISTING_PR_URL: "https://github.com/mock-owner/mock-repo/pull/55",
    });
    expect(r.status).toBe(0);
    expect(r.out).toContain("pull/55");
    expect((git(["rev-parse", "--abbrev-ref", "HEAD"]).stdout ?? "").trim()).toBe("feature/partial");
  });

  it("pr-create --at restores the original branch when PR creation fails", () => {
    atFixture();
    const r = prCreate(["feat: ready prefix", "--issue", "789", "--at", READY_HASH, "--repo-dir", REPO_DIR], { PR_CREATE_FAIL: "1" });
    expect(r.status).not.toBe(0);
    expect((git(["rev-parse", "--abbrev-ref", "HEAD"]).stdout ?? "").trim()).toBe("feature/partial");
  });

  it("pr-create reports the creator's failure, not the URL extractor's, and keeps stderr out of the URL", () => {
    // The error text contains a URL; folded into the extractor's input it used to
    // masquerade as the created PR's URL with exit 0.
    const r = prCreate(["feat: something", "--issue", "789", "--repo-dir", REPO_DIR], { PR_CREATE_FAIL: "1" });
    expect(r.status).not.toBe(0);
    expect(r.stdout).not.toContain("issues/9");
    expect(r.stderr).toContain("Failed to create PR");
  });

  it("pr-create returns the PR URL from stdout even when stderr carries an earlier URL", () => {
    const r = prCreate(["feat: something", "--issue", "789", "--repo-dir", REPO_DIR], { PR_CREATE_WARN: "1" });
    expect(r.status).toBe(0);
    expect(r.stdout).toBe("https://github.com/mock-owner/mock-repo/pull/123\n");
  });

  // --assignee APPENDS to the @me default: an extra assignee never drops the
  // author from the assignment.
  it("--assignee appends to the @me default on the create argv", () => {
    writeFileSync(GH_CALL_LOG, "");
    const r = prCreate(["feat: something", "--issue", "789", "--repo-dir", REPO_DIR, "--assignee", "bob"]);
    expect(r.status).toBe(0);
    const log = readFileSync(GH_CALL_LOG, "utf8");
    const createLine = log.split("\n").find((l) => l.includes("gh create")) ?? "";
    expect(createLine).toContain("--assignee @me");
    expect(createLine).toContain("--assignee bob");
  });

  // Labels reach the create argv even when the label-ensure lookup fails.
  it("--label rides the create argv even when the ensure lookup fails", () => {
    writeFileSync(GH_CALL_LOG, "");
    const r = prCreate(["feat: something", "--issue", "789", "--repo-dir", REPO_DIR, "--label", "ci"]);
    expect(r.status).toBe(0);
    const log = readFileSync(GH_CALL_LOG, "utf8");
    const createLine = log.split("\n").find((l) => l.includes("gh create")) ?? "";
    expect(createLine).toContain("--label ci");
  });

  // --- gate and inference correctness ---

  it("inference requires digits followed by a dash (a bare leading number is not an issue)", () => {
    branch("42fix-thing");
    const r = prCreate(["some title", "--repo-dir", REPO_DIR]);
    expect(r.status).not.toBe(0);
    expect(r.out).toContain("none inferable from branch name");
    expect(readFileSync(GH_CALL_LOG, "utf8")).not.toContain("gh create");
  });

  it("an inferred issue number that does not exist is refused, never written into a Closes line", () => {
    branch("2025-cleanup");
    const r = prCreate(["some title", "--repo-dir", REPO_DIR], { ISSUE_VIEW_FAIL: "1" });
    expect(r.status).not.toBe(0);
    expect(r.out).toContain("#2025");
    expect(readFileSync(GH_CALL_LOG, "utf8")).not.toContain("gh create");
  });

  it("an inferred issue that exists adds the Closes line", () => {
    branch("42-fix-thing");
    const r = prCreate(["some title", "--repo-dir", REPO_DIR]);
    expect(r.status).toBe(0);
    expect(r.out).toContain("Inferred issue #42");
  });

  it("--branch scans the named branch, not HEAD", () => {
    branch("feature/wip-named");
    appendFileSync(join(REPO_DIR, "README.md"), "scratch\n");
    git(["add", "README.md"]);
    git(["commit", "-q", "-m", "WIP: named branch save"]);
    branch("feature/clean-head");
    const r = prCreate(["feat: something", "--no-issue", "--branch", "feature/wip-named", "--repo-dir", REPO_DIR]);
    expect(r.status).toBe(1);
    expect(r.out).toContain("WIP: named branch save");
    expect(readFileSync(GH_CALL_LOG, "utf8")).not.toContain("gh create");
  });

  it("fails closed when the branch to scan does not exist", () => {
    const r = prCreate(["feat: something", "--no-issue", "--branch", "ghost/nosuchref", "--repo-dir", REPO_DIR]);
    expect(r.status).toBe(1);
    expect(readFileSync(GH_CALL_LOG, "utf8")).not.toContain("gh create");
  });

  it("scans origin/<branch> when it exists: a clean local rewrite does not hide a pushed WIP", () => {
    atFixture(); // feature/partial carries a WIP tip
    git(["push", "-q", "origin", "feature/partial:feature/partial"]);
    git(["fetch", "-q", "origin"]);
    git(["reset", "-q", "--hard", "HEAD~1"]); // local now clean; origin still has the WIP
    const r = prCreate(["feat: something", "--no-issue", "--repo-dir", REPO_DIR]);
    expect(r.status).toBe(1);
    expect(r.out).toContain("WIP: continues");
  });

  it("refreshes origin/<branch> first: a WIP pushed from another clone after our last fetch is caught", () => {
    git(["push", "-q", "origin", "main"]);
    branch("feature/stale");
    appendFileSync(join(REPO_DIR, "README.md"), "clean\n");
    git(["add", "README.md"]);
    git(["commit", "-q", "-m", "feat: clean work"]);
    git(["push", "-q", "origin", "feature/stale"]);
    git(["fetch", "-q", "origin"]);
    const other = join(TMP, "other-clone");
    spawnSync("git", ["clone", "-q", REMOTE, other], { env: GIT_ENV() });
    spawnSync("git", ["-C", other, "checkout", "-q", "feature/stale"], { env: GIT_ENV() });
    appendFileSync(join(other, "README.md"), "wip\n");
    spawnSync("git", ["-C", other, "add", "README.md"], { env: GIT_ENV() });
    spawnSync("git", ["-C", other, "commit", "-q", "-m", "WIP: pushed from elsewhere"], { env: GIT_ENV() });
    spawnSync("git", ["-C", other, "push", "-q", "origin", "feature/stale"], { env: GIT_ENV() });
    const r = prCreate(["feat: something", "--no-issue", "--repo-dir", REPO_DIR]);
    expect(r.status).toBe(1);
    expect(r.out).toContain("WIP: pushed from elsewhere");
    expect(readFileSync(GH_CALL_LOG, "utf8")).not.toContain("gh create");
  });

  it("blocks when the refresh fails for a reason other than a missing remote branch", () => {
    git(["push", "-q", "origin", "main"]);
    branch("feature/unreachable");
    appendFileSync(join(REPO_DIR, "README.md"), "x\n");
    git(["add", "README.md"]);
    git(["commit", "-q", "-m", "feat: x"]);
    git(["push", "-q", "origin", "feature/unreachable"]);
    git(["config", `url.${join(TMP, "gone.git")}.insteadOf`, "https://github.com/mock-owner/mock-repo.git"]);
    git(["config", "--unset-all", `url.${REMOTE}.insteadOf`]);
    const r = prCreate(["feat: something", "--no-issue", "--repo-dir", REPO_DIR]);
    expect(r.status).toBe(1);
    expect(r.out).toMatch(/refresh|fetch/i);
    expect(readFileSync(GH_CALL_LOG, "utf8")).not.toContain("gh create");
  });

  it("proceeds when the branch does not exist on the remote yet", () => {
    branch("feature/unpushed");
    appendFileSync(join(REPO_DIR, "README.md"), "x\n");
    git(["add", "README.md"]);
    git(["commit", "-q", "-m", "feat: x"]);
    const r = prCreate(["feat: something", "--no-issue", "--repo-dir", REPO_DIR]);
    expect(r.status).toBe(0);
  });

  it("does not block a subject that only mentions WIP: mid-line", () => {
    branch("feature/mention");
    appendFileSync(join(REPO_DIR, "README.md"), "m\n");
    git(["add", "README.md"]);
    git(["commit", "-q", "-m", "fix: handle WIP: markers"]);
    const r = prCreate(["feat: something", "--no-issue", "--repo-dir", REPO_DIR]);
    expect(r.status).toBe(0);
  });

  it("--at: a merge-branch WIP refusal uses the general-error exit code", () => {
    atFixture();
    const wipHash = (git(["rev-parse", "--short", "HEAD"]).stdout ?? "").trim();
    const r = prCreate(["feat: x", "--no-issue", "--at", wipHash, "--repo-dir", REPO_DIR]);
    expect(r.status).toBe(1);
  });

  it("--at refuses to reuse a merge branch whose tip is not the resolved commit", () => {
    atFixture();
    // A pre-existing merge branch with the same name but a different tip.
    git(["branch", `merge/${READY_HASH}-feature/partial`, "main"]);
    const r = prCreate(["feat: ready prefix", "--no-issue", "--at", READY_HASH, "--repo-dir", REPO_DIR]);
    expect(r.status).toBe(1);
    expect(r.out).toContain("does not point at");
    expect(readFileSync(GH_CALL_LOG, "utf8")).not.toContain("gh create");
    expect(spawnSync("git", ["-C", REMOTE, "show-ref", "--verify", "--quiet", `refs/heads/merge/${READY_HASH}-feature/partial`]).status).not.toBe(0);
    expect((git(["rev-parse", "--abbrev-ref", "HEAD"]).stdout ?? "").trim()).toBe("feature/partial");
  });
});
