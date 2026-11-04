// Port of tools/tests/scripts/test_pr_merge.bats (behavioral subset; the
// bash-syntax boilerplate drops per 16.11) plus the pipelines argv-shape
// test from test_pipelines_management.bats. Locks: rebase default, --method
// validation, squash-only CC on the title, draft refusal ordering, WIP and
// breaking-marker merge gates, long-hash scan independence, argument
// discipline, and the missing origin/HEAD fallback.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync, appendFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });

const ROOT = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))));
const TOOLS = join(ROOT, "tools");
const TOOL = join(TOOLS, "pr-merge");

let TMP = "";
let REPO_DIR = "";
let MERGE_CALLS = "";

const GIT_ENV = (): Record<string, string> => ({
  ...process.env,
  HOME: join(TMP, "home"),
  GIT_AUTHOR_NAME: "Test User",
  GIT_AUTHOR_EMAIL: "test@example.com",
  GIT_COMMITTER_NAME: "Test User",
  GIT_COMMITTER_EMAIL: "test@example.com",
});

function branch(name: string): void {
  spawnSync("git", ["checkout", "-q", "-B", name, "main"], { cwd: REPO_DIR, env: GIT_ENV() });
}

function mergeCalls(): string {
  if (!existsSync(MERGE_CALLS)) return "";
  return readFileSync(MERGE_CALLS, "utf8");
}

beforeEach(() => {
  TMP = mkdtempSync(join(tmpdir(), `prmerge-${Date.now()}-${Math.random().toString(36).slice(2)}`));
  mkdirSync(join(TMP, "home"), { recursive: true });
  MERGE_CALLS = join(TMP, "merge-calls.log");
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
  spawnSync("git", ["update-ref", "refs/remotes/origin/main", "HEAD"], { cwd: REPO_DIR, env: GIT_ENV() });
  spawnSync("git", ["symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main"], { cwd: REPO_DIR, env: GIT_ENV() });
  branch("feature/test");

  // Mock gh CLI: merge-call recording (the observable contract of the flip).
  const bin = join(TMP, "bin");
  mkdirSync(bin, { recursive: true });
  writeFileSync(
    join(bin, "gh"),
    [
      "#!/usr/bin/env bash",
      'cmd="$1"; shift',
      'if [ "$cmd" != "-R" ] && [ "${1:-}" = "-R" ]; then shift; shift; fi',
      'sub="$1"; shift || true',
      'case "$cmd $sub" in',
      '  "pr list") echo "123" ;;',
      '  "pr view")',
      "    cat <<'JSON'",
      '{"title":"feat: test change","body":"Implements change #456","isDraft":false,"state":"OPEN"}',
      "JSON",
      "    ;;",
      '  "pr merge")',
      "    for arg in \"$@\"; do",
      "      case \"$arg\" in",
      "        --squash|--merge|--rebase)",
      `          echo "$arg" >> "${MERGE_CALLS}"`,
      "        ;;",
      "      esac",
      "    done",
      '    echo "merged"',
      "    ;;",
      '  "repo view")',
      "    cat <<'JSON'",
      '{"owner":{"login":"mock-owner"},"name":"mock-repo"}',
      "JSON",
      "    ;;",
      "  *)",
      '    echo "gh mock received unexpected command: $cmd $sub (all args: $@)" >&2',
      "    exit 1",
      "    ;;",
      "esac",
      "",
    ].join("\n"),
  );
  spawnSync("chmod", ["+x", join(bin, "gh")]);
});

afterEach(() => {
  rmSync(TMP, { recursive: true, force: true });
});

function prMerge(args: string[], extraEnv: Record<string, string> = {}, input = ""): { status: number; out: string; stdout: string; stderr: string } {
  const r = spawnSync(TOOL, args, {
    cwd: REPO_DIR,
    input,
    encoding: "utf8",
    env: {
      ...GIT_ENV(),
      PATH: `${join(TMP, "bin")}:${process.env.PATH ?? ""}`,
      ...extraEnv,
    },
  });
  return { status: r.status ?? 1, out: (r.stdout ?? "") + (r.stderr ?? ""), stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

describe("pr-merge (behavioral port)", () => {
  it("pr-merge defaults to rebase merge", () => {
    const r = prMerge(["--repo-dir", REPO_DIR]);
    expect(r.status).toBe(0);
    expect(r.out).toContain("merged successfully (rebase)");
    expect(mergeCalls()).toContain("--rebase");
  });

  it("pr-merge accepts --method rebase", () => {
    const r = prMerge(["--method", "rebase", "--repo-dir", REPO_DIR]);
    expect(r.status).toBe(0);
    expect(r.out).toContain("merged successfully (rebase)");
    expect(mergeCalls()).toContain("--rebase");
  });

  it("pr-merge accepts --method squash", () => {
    const r = prMerge(["--method", "squash", "--repo-dir", REPO_DIR]);
    expect(r.status).toBe(0);
    expect(r.out).toContain("merged successfully (squash)");
    expect(mergeCalls()).toContain("--squash");
  });

  it("pr-merge accepts --method merge", () => {
    const r = prMerge(["--method", "merge", "--repo-dir", REPO_DIR]);
    expect(r.status).toBe(0);
    expect(r.out).toContain("merged successfully (merge)");
    expect(mergeCalls()).toContain("--merge");
  });

  it("pr-merge rejects invalid merge method", () => {
    const r = prMerge(["--method", "bogus", "--repo-dir", REPO_DIR]);
    expect(r.status).not.toBe(0);
    expect(r.out).toContain("Invalid merge method");
  });

  it("pr-merge enforces Conventional Commits on squash merges only", () => {
    // Non-conventional title blocks a squash…
    let r = prMerge(["invalid message", "--method", "squash", "--repo-dir", REPO_DIR]);
    expect(r.status).not.toBe(0);
    expect(r.out).toContain("Squash merge commit message must follow Conventional Commits");
    // …but passes under rebase and merge, where individual commits control versioning
    r = prMerge(["invalid message", "--repo-dir", REPO_DIR]);
    expect(r.status).toBe(0);
    expect(r.out).toContain("merged successfully");
  });

  it("pr-merge refuses draft PRs before title validation", () => {
    // A draft refusal must win over any message-shape complaint.
    const bin = join(TMP, "bin");
    writeFileSync(
      join(bin, "gh"),
      [
        "#!/usr/bin/env bash",
        'cmd="$1"; shift',
        'if [ "$cmd" != "-R" ] && [ "${1:-}" = "-R" ]; then shift; shift; fi',
        'sub="$1"; shift || true',
        'case "$cmd $sub" in',
        '  "pr list") echo "123" ;;',
        '  "pr view")',
        "    printf '{\"title\":\"not conventional\",\"body\":\"\",\"isDraft\":true,\"state\":\"OPEN\"}\\n' ;;",
        '  "pr merge") echo "merged" ;;',
        '  "repo view")',
        "    printf '{\"owner\":{\"login\":\"mock-owner\"},\"name\":\"mock-repo\"}' ;;",
        "  *) echo \"unexpected: $cmd $sub\" >&2; exit 1 ;;",
        "esac",
        "",
      ].join("\n"),
    );
    spawnSync("chmod", ["+x", join(bin, "gh")]);
    const r = prMerge(["--repo-dir", REPO_DIR]);
    expect(r.status).not.toBe(0);
    expect(r.out).toContain("is a draft");
    expect(r.out).not.toContain("Conventional Commits");
  });

  it("pr-merge uses PR title when no message is given", () => {
    const r = prMerge(["--repo-dir", REPO_DIR]);
    expect(r.status).toBe(0);
    expect(r.out).toContain("Using PR title as commit message");
  });

  it("pr-merge rejects a merge range carrying WIP commits", () => {
    branch("feature/wip-merge");
    appendFileSync(join(REPO_DIR, "README.md"), "w\n");
    spawnSync("git", ["add", "README.md"], { cwd: REPO_DIR, env: GIT_ENV() });
    spawnSync("git", ["commit", "-q", "-m", "WIP: buried save"], { cwd: REPO_DIR, env: GIT_ENV() });
    appendFileSync(join(REPO_DIR, "README.md"), "d\n");
    spawnSync("git", ["add", "README.md"], { cwd: REPO_DIR, env: GIT_ENV() });
    spawnSync("git", ["commit", "-q", "-m", "feat: completed change"], { cwd: REPO_DIR, env: GIT_ENV() });
    const r = prMerge(["--repo-dir", REPO_DIR]);
    expect(r.status).not.toBe(0);
    expect(r.out).toContain("WIP: commits present");
    expect(r.out).toContain("WIP: buried save");
  });

  it("pr-merge rejects WIP even in a long-hash repo", () => {
    // Git auto-scales short-hash length with repo size (core.abbrev); the
    // scan must key on the subject, never on a hash-relative offset.
    spawnSync("git", ["config", "core.abbrev", "12"], { cwd: REPO_DIR, env: GIT_ENV() });
    branch("feature/wip-long");
    appendFileSync(join(REPO_DIR, "README.md"), "w\n");
    spawnSync("git", ["add", "README.md"], { cwd: REPO_DIR, env: GIT_ENV() });
    spawnSync("git", ["commit", "-q", "-m", "WIP: long-hash save"], { cwd: REPO_DIR, env: GIT_ENV() });
    appendFileSync(join(REPO_DIR, "README.md"), "d\n");
    spawnSync("git", ["add", "README.md"], { cwd: REPO_DIR, env: GIT_ENV() });
    spawnSync("git", ["commit", "-q", "-m", "feat: completed change"], { cwd: REPO_DIR, env: GIT_ENV() });
    const r = prMerge(["--repo-dir", REPO_DIR]);
    expect(r.status).not.toBe(0);
    expect(r.out).toContain("WIP: commits present");
    expect(r.out).toContain("WIP: long-hash save");
    spawnSync("git", ["config", "--unset", "core.abbrev"], { cwd: REPO_DIR, env: GIT_ENV() });
  });

  it("pr-merge warns on breaking markers in the merge range", () => {
    branch("feature/breaking");
    spawnSync("git", ["commit", "-q", "--allow-empty", "-m", "refactor!: restructured API"], { cwd: REPO_DIR, env: GIT_ENV() });
    const r = prMerge(["--repo-dir", REPO_DIR]);
    expect(r.status).toBe(0);
    expect(r.out).toContain("Breaking marker in range");
  });

  it("pr-merge --help states the real default method (rebase), not a policy lookup", () => {
    const r = prMerge(["--help"]);
    expect(r.status).toBe(0);
    expect(r.out).toContain("rebase");
    expect(r.out).toContain("default");
    expect(r.out).not.toContain("policy default");
  });

  it("pr-merge header documents the rebase default and defers options to --help", () => {
    // The file header comment (through the first blank line): the default is
    // stated there once; the option list lives only in usage().
    const src = (spawnSync("cat", [join(TOOLS, "ts", "pr-merge.ts")], { encoding: "utf8" }).stdout ?? "");
    const header = src.split("\n\n")[0] ?? "";
    expect(header).toContain("rebase");
    expect(header).not.toContain("org/fork");
    expect(header).toContain("usage()");
    expect(header).not.toContain("--keep-branch");
  });

  // ── Argument discipline: a merge is destructive, so a token that is not a
  // known option is never taken as the commit message. ─────────────────────

  it("an unknown option is refused before anything runs", () => {
    const r = prMerge(["--dry-run", "--repo-dir", REPO_DIR]);
    expect(r.status).not.toBe(0);
    expect(r.out).toContain("Unknown option");
    expect(mergeCalls()).toBe("");
  });

  it("a mistyped option is not merged with the typo as the commit message", () => {
    const r = prMerge(["--keep-branches", "--repo-dir", REPO_DIR]);
    expect(r.status).not.toBe(0);
    expect(r.out).toContain("Unknown option");
    expect(mergeCalls()).toBe("");
  });

  it("more than one positional argument is refused", () => {
    const r = prMerge(["feat: one", "feat: two", "--repo-dir", REPO_DIR]);
    expect(r.status).not.toBe(0);
    expect(r.out).toContain("one commit message");
    expect(mergeCalls()).toBe("");
  });

  it("a missing origin/HEAD does not stop the merge before it looks for the PR", () => {
    spawnSync("git", ["symbolic-ref", "--delete", "refs/remotes/origin/HEAD"], { cwd: REPO_DIR, env: GIT_ENV() });
    const r = prMerge(["--repo-dir", REPO_DIR]);
    expect(r.out).toContain("-> 'main'");
  });

  // ── pipelines argv shape (from test_pipelines_management.bats) ──────────

  it("pipelines workflow trigger passes repo positionally, single -R (gh-stub argv)", () => {
    const bin = join(TMP, "bin2");
    mkdirSync(bin, { recursive: true });
    const calls = join(TMP, "gh-calls.log");
    writeFileSync(calls, "");
    writeFileSync(
      join(bin, "gh"),
      [`#!/usr/bin/env bash`, `echo "gh $*" >> "${calls}"`, "exit 0", ""].join("\n"),
    );
    spawnSync("chmod", ["+x", join(bin, "gh")]);
    const script =
      `source '${TOOLS}/lib/providers/provider-core.bash'\n` +
      `PROVIDER_NAME=github\n` +
      `source '${TOOLS}/lib/providers/github/pipelines.bash'\n` +
      `gh_args=(--ref "feature/x")\n` +
      `gh_args+=(--field "k=v")\n` +
      `provider_pipelines_workflow_run "org/repo" "ci.yml" "\${gh_args[@]}"\n`;
    const r = spawnSync("bash", ["-c", script], {
      encoding: "utf8",
      env: { ...process.env, PATH: `${bin}:${process.env.PATH ?? ""}`, STUB_CALL_LOG: calls },
    });
    expect(r.status).toBe(0);
    const log = readFileSync(calls, "utf8");
    const line = log.split("\n").find((l) => l.includes("workflow run")) ?? "";
    // The exact shape trigger_workflow uses: repo positional, workflow name
    // second, flags pass through — named exactly once.
    expect(line).toBe("gh workflow run ci.yml -R org/repo --ref feature/x --field k=v");
  });
});
