// Single-instance lock: a pid file created atomically (temp file + hard link, so
// the lock never exists empty or partial). A lock is reclaimed only when the pid
// it names is no longer running; its age is never consulted. The owner refreshes
// the modification time so its liveness is observable, and only the owner removes it.

import { linkSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { randomBytes } from "node:crypto";

export interface InstanceLockDeps {
  /** Pid recorded in the lock (default: this process). */
  pid?: number;
  /** Liveness probe (default: signal-0; EPERM means alive, anything else dead). */
  isAlive?: (pid: number) => boolean;
  /** Clock used when refreshing the lock's modification time. */
  now?: () => Date;
}

export interface InstanceLock {
  /** Sets the lock's modification time to now, only while it still names this pid. */
  refresh(): void;
  /** Removes the lock, only while it still names this pid. */
  release(): void;
}

export type InstanceLockResult =
  | { ok: true; lock: InstanceLock }
  | { ok: false; ownerPid?: number | undefined };

const MAX_ATTEMPTS = 3;

export function signalProbe(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

function readLock(lockPath: string): { text: string; pid: number | undefined } | undefined {
  try {
    const text = readFileSync(lockPath, "utf8");
    const trimmed = text.trim();
    return { text, pid: /^\d+$/.test(trimmed) && Number(trimmed) > 0 ? Number(trimmed) : undefined };
  } catch {
    return undefined;
  }
}

/** Creates the lock atomically; returns false when one already exists. */
function tryCreate(lockPath: string, pid: number): boolean {
  const tmp = join(dirname(lockPath), `.${basename(lockPath)}.${pid}.${randomBytes(6).toString("hex")}.tmp`);
  try {
    writeFileSync(tmp, String(pid), { flag: "wx" });
    linkSync(tmp, lockPath);
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "EEXIST") return false;
    throw err;
  } finally {
    rmSync(tmp, { force: true });
  }
}

export function acquireInstanceLock(lockPath: string, deps: InstanceLockDeps = {}): InstanceLockResult {
  const pid = deps.pid ?? process.pid;
  const isAlive = deps.isAlive ?? signalProbe;
  const now = deps.now ?? (() => new Date());

  let ownerPid: number | undefined;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    if (tryCreate(lockPath, pid)) return { ok: true, lock: ownedLock(lockPath, pid, now) };
    const seen = readLock(lockPath);
    if (seen === undefined) continue; // removed meanwhile: retry the create
    ownerPid = seen.pid;
    if (seen.pid !== undefined && isAlive(seen.pid)) return { ok: false, ownerPid };
    // Dead or unparsable owner: remove only if the lock is still the one just
    // judged, so a lock another starter has just taken is never removed.
    if (readLock(lockPath)?.text === seen.text) rmSync(lockPath, { force: true });
  }
  return { ok: false, ownerPid };
}

function ownedLock(lockPath: string, pid: number, now: () => Date): InstanceLock {
  const owns = (): boolean => readLock(lockPath)?.pid === pid;
  return {
    refresh() {
      try {
        if (!owns()) return;
        const t = now();
        utimesSync(lockPath, t, t);
      } catch { /* lock gone */ }
    },
    release() {
      try {
        if (owns()) rmSync(lockPath, { force: true });
      } catch { /* lock gone */ }
    },
  };
}
