// instance-lock: atomic pid lock, liveness-based reclaim, owner-only refresh/release.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { acquireInstanceLock } from "../../lib/core/instance-lock.ts";

let DIR = "";
let LOCK = "";

beforeEach(() => {
  DIR = mkdtempSync(join(tmpdir(), "instance-lock-"));
  LOCK = join(DIR, ".lock");
});
afterEach(() => rmSync(DIR, { recursive: true, force: true }));

const alive = () => true;
const dead = () => false;

describe("instance-lock", () => {
  it("writes the pid atomically and leaves no temp file", () => {
    const r = acquireInstanceLock(LOCK, { pid: 111, isAlive: dead });
    expect(r.ok).toBe(true);
    expect(readFileSync(LOCK, "utf8")).toBe("111");
    expect(readdirSync(DIR)).toEqual([".lock"]);
  });

  it("refuses a second acquirer while the owner lives, however old the lock", () => {
    acquireInstanceLock(LOCK, { pid: 111, isAlive: alive });
    const old = new Date(Date.now() - 600_000);
    utimesSync(LOCK, old, old);
    const r = acquireInstanceLock(LOCK, { pid: 222, isAlive: alive });
    expect(r).toEqual({ ok: false, ownerPid: 111 });
    expect(readFileSync(LOCK, "utf8")).toBe("111");
    expect(readdirSync(DIR)).toEqual([".lock"]);
  });

  it("treats EPERM from the real probe as alive", () => {
    writeFileSync(LOCK, "1");
    const kill = process.kill;
    process.kill = (() => { throw Object.assign(new Error("perm"), { code: "EPERM" }); }) as typeof process.kill;
    try {
      expect(acquireInstanceLock(LOCK, { pid: 222 })).toEqual({ ok: false, ownerPid: 1 });
    } finally {
      process.kill = kill;
    }
  });

  it("reclaims a lock whose owner is dead", () => {
    writeFileSync(LOCK, "111");
    const r = acquireInstanceLock(LOCK, { pid: 222, isAlive: dead });
    expect(r.ok).toBe(true);
    expect(readFileSync(LOCK, "utf8")).toBe("222");
  });

  it("reclaims unparsable content", () => {
    writeFileSync(LOCK, "garbage\n");
    expect(acquireInstanceLock(LOCK, { pid: 222, isAlive: alive }).ok).toBe(true);
    expect(readFileSync(LOCK, "utf8")).toBe("222");
  });

  it("does not remove a lock that changed between the liveness read and the removal", () => {
    writeFileSync(LOCK, "111");
    let swapped = false;
    const isAlive = (pid: number): boolean => {
      if (pid === 111 && !swapped) {
        swapped = true;
        writeFileSync(LOCK, "333");
        return false;
      }
      return pid === 333;
    };
    const r = acquireInstanceLock(LOCK, { pid: 222, isAlive });
    expect(r).toEqual({ ok: false, ownerPid: 333 });
    expect(readFileSync(LOCK, "utf8")).toBe("333");
  });

  it("refresh sets the mtime to the injected clock and ignores a lock naming another pid", () => {
    const r = acquireInstanceLock(LOCK, { pid: 111, now: () => new Date(2_000_000_000_000) });
    if (!r.ok) throw new Error("not acquired");
    r.lock.refresh();
    expect(statSync(LOCK).mtimeMs).toBe(2_000_000_000_000);
    writeFileSync(LOCK, "999");
    utimesSync(LOCK, new Date(1_000_000_000_000), new Date(1_000_000_000_000));
    r.lock.refresh();
    expect(statSync(LOCK).mtimeMs).toBe(1_000_000_000_000);
  });

  it("release is owner-only and idempotent", () => {
    const r = acquireInstanceLock(LOCK, { pid: 111 });
    if (!r.ok) throw new Error("not acquired");
    writeFileSync(LOCK, "999");
    r.lock.release();
    expect(readFileSync(LOCK, "utf8")).toBe("999");
    rmSync(LOCK);
    expect(() => { r.lock.release(); r.lock.refresh(); }).not.toThrow();
    const r2 = acquireInstanceLock(LOCK, { pid: 222 });
    if (!r2.ok) throw new Error("not acquired");
    r2.lock.release();
    r2.lock.release();
    expect(existsSync(LOCK)).toBe(false);
  });

  it("many concurrent acquirers yield exactly one owner", async () => {
    const results = await Promise.all(
      Array.from({ length: 25 }, (_, i) => Promise.resolve().then(() => acquireInstanceLock(LOCK, { pid: 1000 + i, isAlive: alive }))),
    );
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(readdirSync(DIR)).toEqual([".lock"]);
  });

  it("cleans the temp file on the failure path", () => {
    writeFileSync(LOCK, "111");
    acquireInstanceLock(LOCK, { pid: 222, isAlive: alive });
    expect(readdirSync(DIR)).toEqual([".lock"]);
  });
});
