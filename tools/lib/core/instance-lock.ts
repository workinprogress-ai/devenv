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
  /** Hard-link primitive used to publish the lock atomically (default: linkSync). */
  link?: (existing: string, next: string) => void;
  /** File-create primitive used for the temp file and the fallback lock (default: exclusive writeFileSync). */
  write?: (path: string, data: string, flag: string) => void;
}

export interface InstanceLock {
  /** Sets the lock's modification time to now, only while it still names this pid. */
  refresh(): void;
  /** Removes the lock, only while it still names this pid. */
  release(): void;
}

export type InstanceLockResult =
  | { ok: true; lock: InstanceLock }
  | { ok: false; ownerPid?: number | undefined }
  | { ok: false; error: string };

const MAX_ATTEMPTS = 3;

// Errors a filesystem without hard-link support raises from link().
const LINK_UNSUPPORTED = new Set(["EPERM", "ENOTSUP", "EXDEV", "ENOSYS"]);

type CreateOutcome = "created" | "exists" | { error: string };

const codeOf = (err: unknown): string | undefined => (err as NodeJS.ErrnoException | null | undefined)?.code;
const reasonOf = (err: unknown): string => (err instanceof Error ? err.message : String(err));

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

/**
 * Creates the lock. Normally atomic (temp file + hard link, so the lock never
 * exists empty or partial). On a filesystem without hard links it falls back to
 * a plain exclusive create of the lock file itself, written in a single call; that
 * path loses the never-empty guarantee, so an empty or unparsable lock is still
 * reclaimed only through the remove-if-unchanged path in acquireInstanceLock.
 */
function tryCreate(
  lockPath: string,
  pid: number,
  link: (existing: string, next: string) => void,
  write: (path: string, data: string, flag: string) => void,
): CreateOutcome {
  const tmp = join(dirname(lockPath), `.${basename(lockPath)}.${pid}.${randomBytes(6).toString("hex")}.tmp`);
  try {
    write(tmp, String(pid), "wx");
    try {
      link(tmp, lockPath);
      return "created";
    } catch (err) {
      const code = codeOf(err);
      if (code === "EEXIST") return "exists";
      if (code === undefined || !LINK_UNSUPPORTED.has(code)) throw err;
    }
    try {
      write(lockPath, String(pid), "wx");
    } catch (err) {
      // An EEXIST means the file is another starter's and is left alone; any other
      // failure may have left behind the empty file this call just created.
      if (codeOf(err) === "EEXIST") return "exists";
      try { rmSync(lockPath, { force: true }); } catch { /* best effort */ }
      return { error: reasonOf(err) };
    }
    return "created";
  } catch (err) {
    if (codeOf(err) === "EEXIST") return "exists";
    return { error: reasonOf(err) };
  } finally {
    try { rmSync(tmp, { force: true }); } catch { /* best effort */ }
  }
}

export function acquireInstanceLock(lockPath: string, deps: InstanceLockDeps = {}): InstanceLockResult {
  const pid = deps.pid ?? process.pid;
  const isAlive = deps.isAlive ?? signalProbe;
  const now = deps.now ?? (() => new Date());
  const link = deps.link ?? linkSync;
  const write = deps.write ?? ((path: string, data: string, flag: string) => writeFileSync(path, data, { flag }));

  let ownerPid: number | undefined;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const created = tryCreate(lockPath, pid, link, write);
    if (created === "created") return { ok: true, lock: ownedLock(lockPath, pid, now) };
    if (created !== "exists") return { ok: false, error: created.error };
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
