// Port of tools/tests/scripts/test_scratchpad_baseline.bats (5 tests).
// Baseline behavior locks for tools that scratchpad mode will later
// restrict: their pre-scratchpad observable behavior is locked here so the
// Phase 3 refusal wiring is a provable delta.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync, appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { toolScript } from "./harness/index.ts";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });


let TMP = "";

const GIT_ENV = (): Record<string, string> => ({
  ...process.env,
  HOME: join(TMP, "home"),
  GIT_AUTHOR_NAME: "Test User",
  GIT_AUTHOR_EMAIL: "test@example.test",
  GIT_COMMITTER_NAME: "Test User",
  GIT_COMMITTER_EMAIL: "test@example.test",
});

beforeEach(() => {
  TMP = mkdtempSync(join(tmpdir(), `scratchbase-${Date.now()}-${Math.random().toString(36).slice(2)}`));
  mkdirSync(join(TMP, "home"), { recursive: true });
});

// create_mock_git_repo (helper fixture): a repo with a dummy origin remote.
function createMockGitRepo(repoPath: string): void {
  mkdirSync(repoPath, { recursive: true });
  spawnSync("git", ["init", "-q"], { cwd: repoPath, env: GIT_ENV() });
  spawnSync("git", ["config", "user.email", "test@example.com"], { cwd: repoPath, env: GIT_ENV() });
  spawnSync("git", ["config", "user.name", "Test User"], { cwd: repoPath, env: GIT_ENV() });
  spawnSync("git", ["remote", "add", "origin", "git@github.com:test-org/dummy.git"], { cwd: repoPath, env: GIT_ENV() });
  writeFileSync(join(repoPath, "README.md"), "");
  spawnSync("git", ["add", "README.md"], { cwd: repoPath, env: GIT_ENV() });
  spawnSync("git", ["commit", "-q", "-m", "Initial commit"], { cwd: repoPath, env: GIT_ENV() });
  spawnSync("git", ["branch", "-M", "main"], { cwd: repoPath, env: GIT_ENV() });
}

describe("scripts/scratchpad-baseline", () => {
  it("baseline: repo-commit refuses option-shaped args (exit 2, refusal message)", () => {
    const r = spawnSync("node", [toolScript("repo-commit"), "-m", "should be refused"], { encoding: "utf8", env: GIT_ENV() });
    expect(r.status).toBe(2);
    expect((r.stdout ?? "") + (r.stderr ?? "")).toContain("options are refused by design");
  });

  it("baseline: repo-commit refuses --yes (exit 2)", () => {
    const r = spawnSync("node", [toolScript("repo-commit"), "--yes"], { encoding: "utf8", env: GIT_ENV() });
    expect(r.status).toBe(2);
  });

  it("baseline: git-wip refuses unknown flags (exit 2)", () => {
    const r = spawnSync("node", [toolScript("git-wip"), "--definitely-not-a-flag"], { encoding: "utf8", env: GIT_ENV() });
    expect(r.status).toBe(2);
    expect((r.stdout ?? "") + (r.stderr ?? "")).toContain("Unknown option");
  });

  it("baseline: pr-create refuses unknown flags (exit 2)", () => {
    // The refusal fires after branch-issue inference: run in a neutral repo
    // (no inferable branch issue, clean tree) so the flag error is the first
    // exit. The devenv checkout names an issue in its branch and is dirty
    // during work, so it must not host this baseline.
    const repo = join(TMP, "neutral-repo");
    mkdirSync(repo, { recursive: true });
    spawnSync("git", ["init", "-q"], { cwd: repo, env: GIT_ENV() });
    const r = spawnSync("node", [toolScript("pr-create"), "--definitely-not-a-flag"], {
      cwd: repo,
      encoding: "utf8",
      env: GIT_ENV(),
    });
    expect(r.status).toBe(2);
  });

  it("baseline: repo-commit editor-abort path — emptied message means no commit", () => {
    // Pin an interactive-shaped MOCK editor (a script is honored; bare `true`
    // is treated as unset and falls through — in this dev container the chain
    // can reach `code --wait` and open a real editor tab, so tests must never
    // rely on "no editor available"). The mock empties the message file: the
    // documented abort path (editor emptied -> no commit).
    const repo = join(TMP, "baseline-repo");
    createMockGitRepo(repo);
    const mockEditor = join(TMP, "mock-editor.sh");
    writeFileSync(mockEditor, '#!/bin/bash\n: > "$1"\n');
    spawnSync("chmod", ["+x", mockEditor]);
    appendFileSync(join(repo, "README.md"), "change\n");
    spawnSync("git", ["add", "README.md"], { cwd: repo, env: GIT_ENV() });
    const before = Number.parseInt(
      (spawnSync("git", ["rev-list", "--count", "HEAD"], { cwd: repo, encoding: "utf8", env: GIT_ENV() }).stdout ?? "0").trim(),
      10,
    );
    const r = spawnSync("node", [toolScript("repo-commit"), "msg"], {
      cwd: repo,
      encoding: "utf8",
      env: { ...GIT_ENV(), GIT_EDITOR: mockEditor },
    });
    expect(r.status).not.toBe(0);
    const after = Number.parseInt(
      (spawnSync("git", ["rev-list", "--count", "HEAD"], { cwd: repo, encoding: "utf8", env: GIT_ENV() }).stdout ?? "0").trim(),
      10,
    );
    expect(after).toBe(before);
  });
});
