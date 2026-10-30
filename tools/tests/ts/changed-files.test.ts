// Unit tests for changedFiles: porcelain parsing with untracked expansion
// (-uall) and rename-pair splitting, driven over fixture porcelain output
// via a real temp git repo whose tree is shaped to produce each state.
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { changedFiles } from "../../lib/core/git.ts";

let root: string;
let repo: string;
let cleanup: () => void;

function git(...args: string[]): string {
  const r = spawnSync("git", ["-C", repo, ...args], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
  return r.stdout;
}

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "changed-files-"));
  repo = join(root, "repo");
  mkdirSync(repo, { recursive: true });
  git("init", "-q", "-b", "master");
  git("config", "user.email", "t@example.com");
  git("config", "user.name", "T");
  writeFileSync(join(repo, "keep.txt"), "keep\n");
  git("add", "--", "keep.txt");
  git("commit", "-q", "--no-verify", "-m", "seed");
  cleanup = () => rmSync(root, { recursive: true, force: true });
});

afterAll(() => cleanup());

function paths(): string[] {
  return changedFiles(repo).map((e) => e.path);
}

describe("changedFiles (real temp repo)", () => {
  it("clean tree yields an empty set", () => {
    expect(changedFiles(repo)).toEqual([]);
  });

  it("modified, staged, deleted, and untracked files all enumerate", () => {
    writeFileSync(join(repo, "keep.txt"), "keep changed\n"); // modified (unstaged)
    writeFileSync(join(repo, "staged.txt"), "s\n");
    git("add", "--", "staged.txt"); // staged addition
    writeFileSync(join(repo, "untracked.txt"), "u\n"); // untracked
    const got = paths();
    expect(got).toContain("keep.txt");
    expect(got).toContain("staged.txt");
    expect(got).toContain("untracked.txt");
  });

  it("a deleted file enumerates (deletion-aware existence depends on this)", () => {
    writeFileSync(join(repo, "doomed.txt"), "d\n");
    git("add", "--", "doomed.txt");
    git("commit", "-q", "--no-verify", "-m", "add doomed");
    rmSync(join(repo, "doomed.txt"));
    const entry = changedFiles(repo).find((e) => e.path === "doomed.txt");
    expect(entry).toBeDefined();
    expect(entry?.state).toContain("D");
  });

  it("untracked directories expand to every file (-uall), not a dir entry", () => {
    mkdirSync(join(repo, "newdir"), { recursive: true });
    writeFileSync(join(repo, "newdir", "a.txt"), "a\n");
    writeFileSync(join(repo, "newdir", "b.txt"), "b\n");
    const got = paths();
    expect(got).toContain("newdir/a.txt");
    expect(got).toContain("newdir/b.txt");
    expect(got).not.toContain("newdir/");
    expect(got).not.toContain("newdir");
  });

  it("a path containing ' -> ' enumerates verbatim (no phantom rename)", () => {
    writeFileSync(join(repo, "weird -> name.txt"), "w\n");
    const got = paths();
    expect(got).toContain("weird -> name.txt");
  });

  it("a non-ASCII path enumerates unescaped", () => {
    writeFileSync(join(repo, "café.txt"), "c\n");
    const got = paths();
    expect(got).toContain("café.txt");
    expect(got.some((p) => p.includes("\\303"))).toBe(false); // no octal escape residue
  });

  it("a rename enumerates as both paths with the origin carried", () => {
    writeFileSync(join(repo, "renameme.txt"), "r\n");
    git("add", "--", "renameme.txt");
    git("commit", "-q", "--no-verify", "-m", "add renameme");
    git("mv", "renameme.txt", "renamed.txt");
    const entries = changedFiles(repo);
    const oldEntry = entries.find((e) => e.path === "renameme.txt");
    const newEntry = entries.find((e) => e.path === "renamed.txt");
    expect(oldEntry).toBeDefined();
    expect(newEntry).toBeDefined();
    expect(newEntry?.origin).toBe("renameme.txt");
    expect(oldEntry?.state).toContain("D");
  });
});
