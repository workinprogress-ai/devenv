// pr-merge safety gates: fail-closed WIP scan on origin refs, repo-dir
// targeting, fail-closed draft/PR-detail lookup, --force scope, merged signal.
// Fixture: a local bare repo as `origin` (mapped from the https remote URL
// with insteadOf), a work clone, and a gh stub that logs argv.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { spawnSync } from "node:child_process";
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runTool, stubCli } from "./harness/index.ts";

vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });

let TMP = "";
let WORK = "";
let OTHER = "";
let LOG = "";

const GIT_ENV = (): Record<string, string> => ({
  ...process.env,
  HOME: join(TMP, "home"),
  GIT_AUTHOR_NAME: "Test User",
  GIT_AUTHOR_EMAIL: "test@example.com",
  GIT_COMMITTER_NAME: "Test User",
  GIT_COMMITTER_EMAIL: "test@example.com",
}) as Record<string, string>;

function git(cwd: string, ...args: string[]): string {
  const r = spawnSync("git", args, { cwd, encoding: "utf8", env: GIT_ENV() });
  return (r.stdout ?? "").trim();
}

function commit(msg: string): void {
  appendFileSync(join(WORK, "README.md"), `${msg}\n`);
  git(WORK, "add", "README.md");
  git(WORK, "commit", "-q", "-m", msg);
}

function pushBranch(name: string): void {
  git(WORK, "push", "-q", "origin", `${name}:${name}`);
  git(WORK, "fetch", "-q", "origin");
}

// gh stub: answers pr list / pr view / pr merge and logs every argv line.
// Knobs: PR_DRAFT=true, VIEW_FAIL=1, HEAD_OID (reported headRefOid).
function writeGhStub(): void {
  const bin = join(TMP, "bin");
  mkdirSync(bin, { recursive: true });
  stubCli(
    bin,
    "gh",
    [
      "#!/usr/bin/env bash",
      'printf \'gh %s\\n\' "$*" >> "$GH_CALL_LOG"',
      'if [ "$1" = "auth" ]; then exit 0; fi',
      'case "$1 $2" in',
      '  "pr list") echo "7" ;;',
      '  "pr merge") [ -n "${MERGE_FAIL:-}" ] && { echo "merge-refused-detail" >&2; exit 1; }; exit 0 ;;',
      '  "pr view")',
      '    [ -n "${VIEW_FAIL:-}" ] && { echo "boom" >&2; exit 1; }',
      '    if [[ " $* " == *" body "* ]] && [[ " $* " != *"title"* ]]; then',
      '      printf \'{"body":"Closes #5\\\\nSome body"}\\n\'',
      "    else",
      '      printf \'{"title":"feat: a thing","body":"Closes #5","isDraft":%s,"state":"OPEN","author":{"login":"x"},"headRefOid":"%s"}\\n\' "${PR_DRAFT:-false}" "${HEAD_OID:-}"',
      "    fi ;;",
      '  *) echo "{}" ;;',
      "esac",
      "",
    ].join("\n"),
  );
}

function prMerge(args: string[], extra: Record<string, string> = {}, cwd = WORK): { status: number; out: string } {
  const r = runTool("pr-merge", args, {
    cwd,
    env: {
      ...GIT_ENV(),
      GH_CALL_LOG: LOG,
      PATH: `${join(TMP, "bin")}:${process.env.PATH ?? ""}`,
      DEVENV_ROOT: join(TMP, "devroot"),
      HEAD_OID: git(WORK, "rev-parse", "refs/remotes/origin/feature/x"),
      ...extra,
    },
  });
  return { status: r.status, out: r.output };
}

function ghLog(): string {
  return readFileSync(LOG, "utf8");
}

beforeEach(() => {
  TMP = mkdtempSync(join(tmpdir(), `prmergegate-${Date.now()}-${Math.random().toString(36).slice(2)}`));
  mkdirSync(join(TMP, "home"), { recursive: true });
  mkdirSync(join(TMP, "devroot"), { recursive: true });
  writeFileSync(join(TMP, "devroot", "devenv.config"), "[provider]\nname=github\n[organization]\norg=mock-owner\nemail_domain=test.example.com\n");
  const origin = join(TMP, "origin.git");
  spawnSync("git", ["init", "-q", "--bare", "-b", "main", origin], { env: GIT_ENV() });
  WORK = join(TMP, "work");
  mkdirSync(WORK, { recursive: true });
  git(WORK, "init", "-q", "-b", "main");
  git(WORK, "config", "user.email", "test@example.com");
  git(WORK, "config", "user.name", "Test User");
  git(WORK, "remote", "add", "origin", "https://github.com/mock-owner/mock-repo.git");
  git(WORK, "config", `url.${origin}.insteadOf`, "https://github.com/mock-owner/mock-repo.git");
  writeFileSync(join(WORK, "README.md"), "initial\n");
  git(WORK, "add", "README.md");
  git(WORK, "commit", "-q", "-m", "chore: initial");
  git(WORK, "push", "-q", "origin", "main");
  git(WORK, "fetch", "-q", "origin");
  git(WORK, "remote", "set-head", "origin", "main");
  git(WORK, "checkout", "-q", "-b", "feature/x");
  OTHER = join(TMP, "other");
  mkdirSync(OTHER, { recursive: true });
  git(OTHER, "init", "-q", "-b", "main");
  LOG = join(TMP, "calls.log");
  writeFileSync(LOG, "");
  writeGhStub();
});

afterEach(() => {
  rmSync(TMP, { recursive: true, force: true });
});

describe("pr-merge gates", () => {
  it("merges a clean pushed branch (baseline)", () => {
    commit("feat: clean");
    pushBranch("feature/x");
    const r = prMerge(["--no-issue-id"]);
    expect(r.status).toBe(0);
    expect(ghLog()).toContain("gh pr merge 7");
  });

  it("shows the provider's reason when the merge itself fails", () => {
    commit("feat: clean");
    pushBranch("feature/x");
    const r = prMerge(["--no-issue-id"], { MERGE_FAIL: "1" });
    expect(r.status).not.toBe(0);
    expect(r.out).toContain("Failed to merge PR #7");
    expect(r.out).toContain("merge-refused-detail");
  });

  it("blocks when the pushed range carries a WIP commit", () => {
    commit("WIP: save");
    commit("feat: done");
    pushBranch("feature/x");
    const r = prMerge(["--no-issue-id"]);
    expect(r.status).toBe(1);
    expect(r.out).toContain("WIP: save");
    expect(ghLog()).not.toContain("gh pr merge");
  });

  it("does not block a subject that only mentions WIP: mid-line", () => {
    commit("fix: handle WIP: markers");
    pushBranch("feature/x");
    const r = prMerge(["--no-issue-id"]);
    expect(r.status).toBe(0);
    expect(ghLog()).toContain("gh pr merge 7");
  });

  it("fails closed when the head ref cannot be scanned (missing ref)", () => {
    commit("feat: clean");
    pushBranch("feature/x");
    const r = prMerge(["--no-issue-id", "--branch", "ghost/nosuchref"]);
    expect(r.status).not.toBe(0);
    expect(ghLog()).not.toContain("gh pr merge");
  });

  it("blocks when origin/<head> is not the PR's reported head commit (stale ref)", () => {
    commit("feat: clean");
    pushBranch("feature/x");
    const r = prMerge(["--no-issue-id"], { HEAD_OID: "0123456789abcdef0123456789abcdef01234567" });
    expect(r.status).not.toBe(0);
    expect(ghLog()).not.toContain("gh pr merge");
  });

  it("--repo-dir scans the named repository, not the working directory", () => {
    commit("WIP: save");
    pushBranch("feature/x");
    const r = prMerge(["--no-issue-id", "--repo-dir", WORK], { DEVENV_REPO: "mock-owner/mock-repo" }, OTHER);
    expect(r.status).toBe(1);
    expect(r.out).toContain("WIP: save");
    expect(ghLog()).not.toContain("gh pr merge");
  });

  it("fails closed when the PR details cannot be fetched (draft gate)", () => {
    commit("feat: clean");
    pushBranch("feature/x");
    const r = prMerge(["feat: explicit message", "--no-issue-id"], { VIEW_FAIL: "1" });
    expect(r.status).not.toBe(0);
    expect(r.out).toContain("Failed to fetch PR details");
    expect(ghLog()).not.toContain("gh pr merge");
  });

  it("refuses a draft PR without --force", () => {
    commit("feat: clean");
    pushBranch("feature/x");
    const r = prMerge(["--no-issue-id"], { PR_DRAFT: "true" });
    expect(r.status).toBe(1);
    expect(ghLog()).not.toContain("gh pr merge");
  });

  it("--force proceeds on a draft but never passes --admin", () => {
    commit("feat: clean");
    pushBranch("feature/x");
    const r = prMerge(["--no-issue-id", "--force"], { PR_DRAFT: "true" });
    expect(r.status).toBe(0);
    const mergeLine = ghLog().split("\n").find((l) => l.startsWith("gh pr merge")) ?? "";
    expect(mergeLine).not.toBe("");
    expect(mergeLine).not.toContain("--admin");
  });

  it("help no longer implies --force bypasses branch protection", () => {
    const r = prMerge(["--help"]);
    expect(r.out).not.toMatch(/--force\s+Force merge even if checks have not passed/);
  });

  it("fires the merged signal for the PR body's linked issues", () => {
    // The signal entry script is recorded by a transparent bash stub, so no
    // dispatcher (and no provider write) really runs.
    const realBash = spawnSync("sh", ["-c", "command -v bash"], { encoding: "utf8" }).stdout.trim();
    stubCli(
      join(TMP, "bin"),
      "bash",
      ["#!/bin/sh", 'case "$1" in *_on_merge.sh) echo "signal $*" >> "$GH_CALL_LOG"; exit 0;; esac', `exec ${realBash} "$@"`].join("\n"),
    );
    commit("feat: clean");
    pushBranch("feature/x");
    const r = prMerge(["--no-issue-id"]);
    expect(r.status).toBe(0);
    expect(ghLog()).toMatch(/signal \S*_on_merge\.sh 5\n/);
  });
});
