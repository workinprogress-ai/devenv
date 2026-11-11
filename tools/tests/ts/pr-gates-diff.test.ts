// pr-diff ref mode shows what a PR shows: the merge-base (three-dot) diff,
// not the symmetric-difference-free two-dot range.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runTool } from "./harness/index.ts";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

let TMP = "";
let REPO = "";

const GIT_ENV = (): Record<string, string> => ({
  ...process.env,
  HOME: join(TMP, "home"),
  GIT_AUTHOR_NAME: "t",
  GIT_AUTHOR_EMAIL: "t@example.test",
  GIT_COMMITTER_NAME: "t",
  GIT_COMMITTER_EMAIL: "t@example.test",
}) as Record<string, string>;

function git(...args: string[]): void {
  spawnSync("git", args, { cwd: REPO, env: GIT_ENV() });
}

function commitFile(name: string, msg: string): void {
  writeFileSync(join(REPO, name), `${msg}\n`);
  git("add", name);
  git("commit", "-q", "-m", msg);
}

beforeEach(() => {
  TMP = mkdtempSync(join(tmpdir(), `prdiff-${Date.now()}-${Math.random().toString(36).slice(2)}`));
  mkdirSync(join(TMP, "home"), { recursive: true });
  REPO = join(TMP, "repo");
  mkdirSync(REPO, { recursive: true });
  git("init", "-q", "-b", "main");
  commitFile("base.txt", "base");
  git("checkout", "-q", "-b", "feature");
  commitFile("feature.txt", "feature work");
  git("checkout", "-q", "main");
  commitFile("main-only.txt", "main moved on");
});

afterEach(() => {
  rmSync(TMP, { recursive: true, force: true });
});

describe("pr-diff ref mode", () => {
  it("shows only the head's changes since the merge base (what a PR shows)", () => {
    const r = runTool("pr-diff", ["--base", "main", "--head", "feature", "--name-only"], { cwd: REPO, env: GIT_ENV() });
    expect(r.status).toBe(0);
    expect(r.stdout.trim().split("\n")).toEqual(["feature.txt"]);
  });

  it("the full diff omits changes that landed on the base after the branch point", () => {
    const r = runTool("pr-diff", ["--base", "main", "--head", "feature"], { cwd: REPO, env: GIT_ENV() });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("feature.txt");
    expect(r.stdout).not.toContain("main-only.txt");
  });

  it("documents the merge-base semantics in --help", () => {
    const r = runTool("pr-diff", ["--help"], { cwd: REPO, env: GIT_ENV() });
    expect(r.stdout).toMatch(/merge[- ]base/i);
  });
});
