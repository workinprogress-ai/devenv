// cs-merged-commit.test.ts — the dependency wizard waits on the commit it
// actually merged. A failed pull must not leave it waiting on the pre-merge
// tip, and a merge the user finished by hand must still be awaited.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { attemptsMerged, levelWaitPurpose, mergeHandedToUser, mergedTip } from "../../lib/domain/cs/merged-commit.ts";
import { rmrf, tmpDir } from "./harness/index.ts";

function git(dir: string, ...args: string[]): string {
  const r = spawnSync("git", ["-C", dir, ...args], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
  return (r.stdout ?? "").trim();
}

function commit(dir: string, file: string): string {
  writeFileSync(join(dir, file), `${file}\n`);
  git(dir, "add", file);
  git(dir, "-c", "user.email=t@example.com", "-c", "user.name=T", "commit", "-q", "--no-verify", "-m", `add ${file}`);
  return git(dir, "rev-parse", "HEAD");
}

let root = "";
let remote = "";
let wizardClone = "";
let otherClone = "";

beforeEach(() => {
  root = tmpDir("merged-commit");
  remote = join(root, "remote.git");
  spawnSync("git", ["init", "-q", "--bare", "-b", "master", remote]);
  wizardClone = join(root, "wizard");
  otherClone = join(root, "other");
  spawnSync("git", ["clone", "-q", remote, otherClone]);
  commit(otherClone, "base.txt");
  git(otherClone, "push", "-q", "origin", "HEAD:master");
  spawnSync("git", ["clone", "-q", remote, wizardClone]);
});

afterEach(() => {
  rmrf(root);
});

describe("mergedTip", () => {
  it("reads the merged commit from the remote even when the clone's HEAD is stale (failed pull)", () => {
    const staleHead = git(wizardClone, "rev-parse", "HEAD");
    const merged = commit(otherClone, "update.txt");
    git(otherClone, "push", "-q", "origin", "HEAD:master");
    expect(git(wizardClone, "rev-parse", "HEAD")).toBe(staleHead);
    expect(mergedTip(wizardClone, "master")).toBe(merged);
  });

  it("is empty when the remote branch cannot be fetched", () => {
    git(wizardClone, "remote", "set-url", "origin", join(root, "missing.git"));
    expect(mergedTip(wizardClone, "master")).toBe("");
  });

  it("is empty for a branch the remote does not have, rather than a guess", () => {
    expect(mergedTip(wizardClone, "main")).toBe("");
  });
});

describe("attemptsMerged", () => {
  it("a successful attempt merged", () => {
    expect(attemptsMerged([0])).toBe(true);
    expect(attemptsMerged([21, 0])).toBe(true);
  });

  it("nothing to change on the first attempt merged nothing", () => {
    expect(attemptsMerged([10])).toBe(false);
  });

  it("nothing to change after the merge was handed to the user means the user merged it", () => {
    expect(attemptsMerged([41, 10])).toBe(true);
    expect(attemptsMerged([40, 10])).toBe(true);
  });

  it("nothing to change after an unrelated failure merged nothing", () => {
    expect(attemptsMerged([21, 10])).toBe(false);
    expect(attemptsMerged([30, 10])).toBe(false);
  });

  it("a failed last attempt merged nothing", () => {
    expect(attemptsMerged([41])).toBe(false);
    expect(attemptsMerged([0, 41])).toBe(false);
  });
});

describe("mergeHandedToUser", () => {
  it("offers the hand-merge choice only right after a handed-over merge (40, 41)", () => {
    expect(mergeHandedToUser([41])).toBe(true);
    expect(mergeHandedToUser([21, 40])).toBe(true);
    expect(mergeHandedToUser([21])).toBe(false);
    expect(mergeHandedToUser([41, 21])).toBe(false);
    expect(mergeHandedToUser([])).toBe(false);
  });
});

describe("levelWaitPurpose", () => {
  it("the last level of a run is awaited too", () => {
    expect(levelWaitPurpose(2, [0, 1, 4])).toBe("before finishing");
    expect(levelWaitPurpose(0, [3])).toBe("before finishing");
  });

  it("other levels are awaited before the next selected generation", () => {
    expect(levelWaitPurpose(0, [0, 1, 4])).toBe("before processing generation 1");
    expect(levelWaitPurpose(1, [0, 1, 4])).toBe("before processing generation 4");
  });
});
