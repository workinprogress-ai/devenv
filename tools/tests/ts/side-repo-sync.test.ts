// side-repo-sync: the sync must never lose local data and never misreport.
// All exercise happens in temp git repos with a path remote; the provider
// token seam is stubbed so no credential store or network is reachable.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

vi.mock("../../ts/setup-steps/provider-seam.ts", () => ({
  providerSecretToken: () => "test-token",
  gitAuthHeader: () => "AUTHORIZATION: basic dGVzdA==",
}));
vi.mock("../../lib/providers/provider-core.ts", () => ({
  providerDetect: () => "github",
}));

import { syncCopilotSideRepo } from "../../ts/setup-steps/side-repo-sync.ts";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

let TMP = "";
let savedHome: string | undefined;
let errors: string[] = [];

function git(dir: string, ...args: string[]): string {
  const r = spawnSync("git", ["-C", dir, ...args], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${r.stderr}`);
  return r.stdout.trim();
}

function write(dir: string, file: string, content: string): void {
  writeFileSync(join(dir, file), content);
}

function commitAll(dir: string, msg: string): void {
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", msg);
}

const BASE = Array.from({ length: 12 }, (_, i) => `line ${i + 1}`).join("\n") + "\n";

function mkRemote(): string {
  const dir = join(TMP, "remote");
  mkdirSync(dir, { recursive: true });
  git(dir, "init", "-q");
  write(dir, "a.txt", BASE);
  commitAll(dir, "init");
  return dir;
}

function replaceLine(content: string, n: number, text: string): string {
  const lines = content.split("\n");
  lines[n - 1] = text;
  return lines.join("\n");
}

function stashCount(dir: string): number {
  const out = git(dir, "stash", "list");
  return out === "" ? 0 : out.split("\n").length;
}

function sync(remote: string, repoDir: string, linkPath: string): number {
  return syncCopilotSideRepo(remote, ".", repoDir, linkPath, "Test side repo", join(TMP, "backups"));
}

beforeEach(() => {
  TMP = mkdtempSync(join(tmpdir(), "side-repo-sync-"));
  savedHome = process.env.HOME;
  const fixtureConfig = join(savedHome ?? "", ".gitconfig");
  process.env.HOME = join(TMP, "home");
  mkdirSync(process.env.HOME, { recursive: true });
  copyFileSync(fixtureConfig, join(process.env.HOME, ".gitconfig"));
  errors = [];
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation((...a: unknown[]) => {
    errors.push(a.join(" "));
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  if (savedHome === undefined) delete process.env.HOME;
  else process.env.HOME = savedHome;
  rmSync(TMP, { recursive: true, force: true });
});

describe("side-repo-sync stash handling", () => {
  it("drops its own redundant stash by reference and keeps the user's own stash", () => {
    const remote = mkRemote();
    const repo = join(TMP, "clone");
    const link = join(TMP, "home", ".copilot", "k");
    expect(sync(remote, repo, link)).toBe(0);

    // The user's own earlier stash must survive.
    write(repo, "a.txt", replaceLine(BASE, 12, "user own stash"));
    git(repo, "stash", "push", "-q", "-m", "user own stash");

    // Local edit identical to what upstream then does.
    const upstream = replaceLine(BASE, 1, "same edit");
    write(repo, "a.txt", upstream);
    write(remote, "a.txt", upstream);
    commitAll(remote, "upstream makes the same edit");

    expect(sync(remote, repo, link)).toBe(0);
    expect(stashCount(repo)).toBe(1);
    expect(git(repo, "stash", "list")).toContain("user own stash");
    expect(readFileSync(join(repo, "a.txt"), "utf8")).toBe(upstream);
  });

  it("re-applies non-overlapping local edits and leaves no stash of its own", () => {
    const remote = mkRemote();
    const repo = join(TMP, "clone");
    const link = join(TMP, "home", ".copilot", "k");
    expect(sync(remote, repo, link)).toBe(0);

    write(repo, "a.txt", replaceLine(BASE, 12, "local edit"));
    git(repo, "stash", "push", "-q", "-m", "user own stash");
    write(repo, "a.txt", replaceLine(BASE, 12, "local edit"));
    write(remote, "a.txt", replaceLine(BASE, 1, "upstream edit"));
    commitAll(remote, "upstream edit elsewhere");

    expect(sync(remote, repo, link)).toBe(0);
    const merged = readFileSync(join(repo, "a.txt"), "utf8");
    expect(merged).toContain("upstream edit");
    expect(merged).toContain("local edit");
    expect(stashCount(repo)).toBe(1);
    expect(git(repo, "stash", "list")).toContain("user own stash");
  });

  it("keeps a conflicting stash and says so", () => {
    const remote = mkRemote();
    const repo = join(TMP, "clone");
    const link = join(TMP, "home", ".copilot", "k");
    expect(sync(remote, repo, link)).toBe(0);

    write(repo, "a.txt", replaceLine(BASE, 1, "local edit"));
    write(remote, "a.txt", replaceLine(BASE, 1, "upstream edit"));
    commitAll(remote, "conflicting upstream edit");

    expect(sync(remote, repo, link)).toBe(0);
    expect(stashCount(repo)).toBe(1);
    expect(errors.join("\n")).toContain("preserved in the stash");
  });

  it("never touches the user's stash when only untracked files block the pull", () => {
    const remote = mkRemote();
    const repo = join(TMP, "clone");
    const link = join(TMP, "home", ".copilot", "k");
    expect(sync(remote, repo, link)).toBe(0);

    write(repo, "a.txt", replaceLine(BASE, 12, "user own stash"));
    git(repo, "stash", "push", "-q", "-m", "user own stash");

    write(remote, "new.txt", "from upstream\n");
    commitAll(remote, "upstream adds new.txt");
    write(repo, "new.txt", "my untracked work\n");

    expect(sync(remote, repo, link)).toBe(0);
    expect(stashCount(repo)).toBe(1);
    expect(readFileSync(join(repo, "new.txt"), "utf8")).toBe("my untracked work\n");
  });

  it("restores the working tree when the pull still fails after stashing", () => {
    const remote = mkRemote();
    const repo = join(TMP, "clone");
    const link = join(TMP, "home", ".copilot", "k");
    expect(sync(remote, repo, link)).toBe(0);

    // Rewrite upstream history so a fast-forward is impossible.
    write(remote, "a.txt", replaceLine(BASE, 1, "rewritten upstream"));
    git(remote, "add", "-A");
    git(remote, "commit", "-q", "--amend", "-m", "rewritten");
    const local = replaceLine(BASE, 1, "my local edit");
    write(repo, "a.txt", local);

    expect(sync(remote, repo, link)).toBe(0);
    expect(readFileSync(join(repo, "a.txt"), "utf8")).toBe(local);
    expect(stashCount(repo)).toBe(0);
    expect(errors.join("\n")).toContain("could not be fast-forwarded");
  });
});

describe("side-repo-sync never deletes local data on failure", () => {
  it("keeps an existing non-git folder in place when the clone fails", () => {
    const repo = join(TMP, "clone");
    mkdirSync(repo, { recursive: true });
    write(repo, "marker.txt", "keep me\n");
    const link = join(TMP, "home", ".copilot", "k");

    const rc = sync(join(TMP, "does-not-exist"), repo, link);

    expect(rc).toBe(1);
    expect(readFileSync(join(repo, "marker.txt"), "utf8")).toBe("keep me\n");
    expect(existsSync(link)).toBe(false);
  });

  it("moves an existing non-git folder aside only after the clone succeeded", () => {
    const remote = mkRemote();
    const repo = join(TMP, "clone");
    mkdirSync(repo, { recursive: true });
    write(repo, "marker.txt", "keep me\n");
    const link = join(TMP, "home", ".copilot", "k");

    expect(sync(remote, repo, link)).toBe(0);

    expect(existsSync(join(repo, ".git"))).toBe(true);
    const backups = readdirSync(join(TMP, "backups"));
    expect(backups).toHaveLength(1);
    expect(readFileSync(join(TMP, "backups", backups[0]!, "marker.txt"), "utf8")).toBe("keep me\n");
    expect(lstatSync(link).isSymbolicLink()).toBe(true);
  });

  it("backs up a real directory sitting at the link path instead of deleting it", () => {
    const remote = mkRemote();
    const repo = join(TMP, "clone");
    const link = join(TMP, "home", ".copilot", "k");
    mkdirSync(link, { recursive: true });
    write(link, "user-data.txt", "precious\n");

    expect(sync(remote, repo, link)).toBe(0);

    expect(lstatSync(link).isSymbolicLink()).toBe(true);
    expect(readlinkSync(link)).toBe(join(repo, "."));
    const backups = readdirSync(join(TMP, "backups"));
    expect(backups).toHaveLength(1);
    expect(readFileSync(join(TMP, "backups", backups[0]!, "user-data.txt"), "utf8")).toBe("precious\n");
  });

  it("replaces an existing symlink at the link path", () => {
    const remote = mkRemote();
    const repo = join(TMP, "clone");
    const link = join(TMP, "home", ".copilot", "k");
    mkdirSync(join(TMP, "home", ".copilot"), { recursive: true });
    mkdirSync(join(TMP, "old-target"));
    symlinkSync(join(TMP, "old-target"), link);

    expect(sync(remote, repo, link)).toBe(0);

    expect(readlinkSync(link)).toBe(join(repo, "."));
    expect(existsSync(join(TMP, "old-target"))).toBe(true);
  });
});

describe("side-repo-sync reports accurately", () => {
  it("keeps the stale clone linked and warns when the fetch fails", () => {
    const remote = mkRemote();
    const repo = join(TMP, "clone");
    const link = join(TMP, "home", ".copilot", "k");
    expect(sync(remote, repo, link)).toBe(0);
    rmSync(link);

    const rc = sync(join(TMP, "gone"), repo, link);

    expect(rc).toBe(0);
    expect(errors.join("\n")).toContain("fetch failed");
    expect(lstatSync(link).isSymbolicLink()).toBe(true);
  });

  it("fails and says so when a fresh clone fails", () => {
    const repo = join(TMP, "clone");
    const link = join(TMP, "home", ".copilot", "k");

    const rc = sync(join(TMP, "gone"), repo, link);

    expect(rc).toBe(1);
    expect(errors.join("\n")).toContain("clone");
    expect(existsSync(repo)).toBe(false);
  });
});
