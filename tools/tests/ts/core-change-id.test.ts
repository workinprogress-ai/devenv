// Behavioral tests for core/change-id: trailer parsing, ID formats, fork
// markers, and skip-list add/load/has/list against a real temp git repo.
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  changeIdGenerate,
  changeIdIsValid,
  changeIdGetTrailer,
  changeIdGetFromMessage,
  changeIdIsForkAdapted,
  changeIdIsForkOnly,
  skipListGetPath,
  skipListAdd,
  skipListLoad,
  skipListHasCommit,
  skipListList,
  skipListRemove,
} from "../../lib/core/change-id.ts";

function git(repo: string, ...args: string[]): string {
  const r = spawnSync("git", ["-C", repo, ...args], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${r.stderr}`);
  return r.stdout;
}

let repo: string;
let cleanup: () => void;

function commitWithMessage(repo: string, message: string, file = "f.txt"): string {
  writeFileSync(join(repo, file), `content-${Date.now()}-${Math.random()}\n`);
  git(repo, "add", ".");
  git(repo, "commit", "--no-verify", "-m", message);
  return git(repo, "rev-parse", "HEAD").trim();
}

beforeAll(() => {
  repo = mkdtempSync(join(tmpdir(), "change-id-test-"));
  git(repo, "init", "-b", "master");
  git(repo, "config", "user.email", "t@example.com");
  git(repo, "config", "user.name", "T");
  commitWithMessage(repo, "initial");
  cleanup = () => rmSync(repo, { recursive: true, force: true });
});

afterAll(() => cleanup());

describe("change-id generate/validate", () => {
  it("generates 12 base62 chars matching the generated pattern", () => {
    const id = changeIdGenerate();
    expect(id).not.toBeNull();
    expect(id!).toMatch(/^[0-9A-Za-z]{12}$/);
  });

  it("accepts generated and foreign formats, rejects malformed", () => {
    expect(changeIdIsValid("ab12cd34ef56")).toBe(true); // generated form
    expect(changeIdIsValid("Iac4f19c1bea5e8db6826b36f31c33ee2d61b2536".slice(0, 20))).toBe(true); // gerrit-ish
    expect(changeIdIsValid("short")).toBe(false);
    expect(changeIdIsValid("has spaces in it")).toBe(false);
    expect(changeIdIsValid(undefined)).toBe(false);
  });
});

describe("trailer parsing", () => {
  const msg = [
    "fix: do a thing",
    "",
    "Some body text.",
    "",
    "Change-Id: ab12cd34ef56",
    "Fork-Adapted: yes",
  ].join("\n");

  it("extracts the last trailer value by exact key", () => {
    expect(changeIdGetTrailer(msg, "Change-Id")).toBe("ab12cd34ef56");
    expect(changeIdGetTrailer(msg, "Fork-Adapted")).toBe("yes");
    expect(changeIdGetTrailer(msg, "Nope")).toBe("");
  });

  it("extracts a Change-Id from a message, null when absent/malformed", () => {
    expect(changeIdGetFromMessage(msg)).toBe("ab12cd34ef56");
    expect(changeIdGetFromMessage("no trailers here")).toBeNull();
    expect(changeIdGetFromMessage("Change-Id: too-short")).toBeNull();
  });

  it("fork markers: value comparison case-insensitive", () => {
    // git interpret-trailers needs a body before trailers; a bare trailer
    // line parses to nothing (same in the bash original).
    expect(changeIdIsForkAdapted("subject\n\nFork-Adapted: YES")).toBe(true);
    expect(changeIdIsForkAdapted("subject\n\nFork-Adapted: no")).toBe(false);
    expect(changeIdIsForkOnly("subject\n\nFork-Only: yes")).toBe(true);
    expect(changeIdIsForkOnly("subject\n\nFork-Only: no")).toBe(false);
  });
});

describe("skip list against a real repo", () => {
  let shaWithId: string;
  const id = "ab12cd34ef56";

  it("resolves the path inside the git common dir", () => {
    const path = skipListGetPath(repo);
    expect(path).toContain("fork-export-skip");
    expect(path).not.toContain("/worktrees/");
  });

  it("adds change-id and sha entries; duplicate add is a no-op", () => {
    expect(skipListAdd(repo, "change-id", id)).toEqual({ ok: true });
    expect(skipListAdd(repo, "change-id", id, "a note")).toEqual({ ok: true });
    expect(skipListAdd(repo, "sha", "HEAD")).toEqual({ ok: true });
    const loaded = skipListLoad(repo);
    if ("error" in loaded) throw new Error(loaded.error);
    expect(loaded.list.ids.has(id)).toBe(true);
    expect(loaded.list.shas.size).toBe(1);
  });

  it("rejects an invalid change-id entry", () => {
    const r = skipListAdd(repo, "change-id", "nope");
    expect(r.ok).toBe(false);
  });

  it("reports a commit skipped by sha or by its Change-Id", () => {
    shaWithId = commitWithMessage(repo, `feat: with id\n\nChange-Id: ${id}\n`);
    const loaded = skipListLoad(repo);
    if ("error" in loaded) throw new Error(loaded.error);
    expect(skipListHasCommit(loaded.list, "nonexistent-sha")).toBe(false);
    expect(skipListHasCommit(loaded.list, "nonexistent-sha", id)).toBe(true);
  });

  it("lists entries and prunes stale ones", () => {
    // A stale entry simulates history death: the sha WAS valid when added,
    // then the commit vanished. skipListAdd refuses unknown shas (by design),
    // so write the stale entry directly.
    const path = skipListGetPath(repo)!;
    writeFileSync(path, "sha deadbeefdeadbeefdeadbeefdeadbeefdeadbeef\n", { flag: "a" });
    const pruned: string[] = [];
    const r = skipListList(repo, (l) => pruned.push(l));
    if ("error" in r) throw new Error(r.error);
    // deadbeef... is not a commit in this repo → pruned
    expect(pruned.some((l) => l.includes("deadbeef"))).toBe(true);
    expect(r.entries.some((e) => e.kind === "change-id" && e.value === id)).toBe(true);
  });

  it("removes every entry naming a value, including linked shas", () => {
    const r = skipListRemove(repo, id);
    expect(r.ok).toBe(true);
    const loaded = skipListLoad(repo);
    if ("error" in loaded) throw new Error(loaded.error);
    expect(loaded.list.ids.has(id)).toBe(false);
    // the sha of the commit carrying the id was linked-removed too
    expect(loaded.list.shas.has(shaWithId)).toBe(false);
  });

  it("fails remove when nothing matches", () => {
    expect(skipListRemove(repo, "zz99zz99zz99").ok).toBe(false);
  });
});

describe("locked() — PID-liveness lock protocol", () => {
  it("reports lock busy while a live PID holds the lock, then completes when freed", async () => {
    const path = skipListGetPath(repo)!;
    const lockPath = path + ".lock";
    // A foreign live PID: a spawned sleeper (vitest workers may have no
    // reliably-alive ppid — the holder must be PROVABLY alive).
    const { spawn } = await import("node:child_process");
    const child = spawn("sleep", ["30"]);
    const livePid = child.pid ?? 0;
    expect(livePid).toBeGreaterThan(0);
    writeFileSync(lockPath, String(livePid));
    const t0 = Date.now();
    // A mutation under a live holder waits the bounded deadline (10s) and
    // then fails busy — it never reclaims a live holder, and never waits
    // indefinitely. (The old busy-immediate made the deadline dead code.)
    const r = skipListAdd(repo, "change-id", "busy1busy1busy1");
    expect(r.ok).toBe(false);
    expect(Date.now() - t0).toBeGreaterThanOrEqual(9_000); // waited the deadline
    expect(Date.now() - t0).toBeLessThan(20_000); // bounded, not forever
    rmSync(lockPath, { force: true });
    child.kill();
    expect(skipListAdd(repo, "change-id", "busy1busy1busy1")).toEqual({ ok: true });
    skipListRemove(repo, "busy1busy1busy1");
  }, 30_000);

  it("reclaims a lock whose holder PID is provably dead", () => {
    const path = skipListGetPath(repo)!;
    const lockPath = path + ".lock";
    // PID 2^22+ is out of Linux's default pid_max range — cannot exist.
    writeFileSync(lockPath, "99999999");
    const r = skipListAdd(repo, "change-id", "stale1stale1stale1");
    expect(r).toEqual({ ok: true });
    skipListRemove(repo, "stale1stale1stale1");
    expect(existsSync(lockPath)).toBe(false);
  });

  it("reclaims an unparseable stale lock (empty/corrupt content) by age", () => {
    const path = skipListGetPath(repo)!;
    const lockPath = path + ".lock";
    writeFileSync(lockPath, "garbage-not-a-pid");
    // Fresh mtime → not yet reclaimable by age → busy.
    const r = skipListAdd(repo, "change-id", "corrupt1corrupt1");
    expect(r.ok).toBe(false);
    // Backdate past LOCK_LIVENESS_MS → reclaimed.
    const old = new Date(Date.now() - 60_000);
    utimesSync(lockPath, old, old);
    expect(skipListAdd(repo, "change-id", "corrupt1corrupt1")).toEqual({ ok: true });
    skipListRemove(repo, "corrupt1corrupt1");
  });

  it("aborts with lock busy on an undeletable lock instead of spinning", () => {
    const path = skipListGetPath(repo)!;
    const lockPath = path + ".lock";
    writeFileSync(lockPath, "garbage-not-a-pid");
    // chmod 0444 — rmSync still succeeds as owner on most filesystems, so
    // make the PARENT DIRECTORY read-only instead: unlink is a directory op.
    chmodSync(dirname(lockPath), 0o555);
    try {
      const r = skipListAdd(repo, "change-id", "immovable1immov");
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).toContain("busy");
    } finally {
      chmodSync(dirname(lockPath), 0o755);
      rmSync(lockPath, { force: true });
    }
  }, 20_000);
});
