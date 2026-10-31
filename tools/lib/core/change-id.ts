// change-id.ts — stable commit identity for the fork workflow: the Change-Id
// trailer, the Fork-Only/Fork-Adapted markers, and the shared skip list
// (port of change-id.bash; contract docs: docs/Forking.md).
//
// Carried contracts: generated IDs are 12 base62 chars; foreign IDs (Gerrit
// style) are 8–64 chars of [0-9A-Za-z._-]; trailer keys match exactly and
// case-sensitively; the Fork-Adapted/Fork-Only *values* compare
// case-insensitively ("yes"); the skip list lives in the git common dir
// (shared by worktrees, never in the working tree) and every mutation holds
// a lockfile with holder-PID liveness so concurrent writers serialize (the
// bash library used flock; fd numbers do not cross a spawn boundary, so an
// O_EXCL lockfile replaces it — see `locked()` below).

import { spawnSync } from "node:child_process";
import {
  closeSync,
  existsSync,
  readFileSync,
  writeFileSync,
  rmSync,
  openSync,
  statSync,
  writeSync,
} from "node:fs";
import { dirname, join } from "node:path";

export const CHANGE_ID_LENGTH = 12;
export const CHANGE_ID_GENERATED_PATTERN = /^[0-9A-Za-z]{12}$/;
export const CHANGE_ID_PATTERN = /^[0-9A-Za-z._-]{8,64}$/;
export const SKIP_LIST_FILE_NAME = "fork-export-skip";
/** How long a lock holder may go before its liveness is re-checked. */
export const LOCK_LIVENESS_MS = 30_000;

/** Generate a new Change-Id: CHANGE_ID_LENGTH random base62 characters. */
export function changeIdGenerate(): string | null {
  const r = spawnSync("bash", [
    "-c",
    `LC_ALL=C tr -dc '0-9A-Za-z' < /dev/urandom 2>/dev/null | head -c ${CHANGE_ID_LENGTH}`,
  ], { encoding: "utf8" });
  const id = r.stdout.trim();
  return CHANGE_ID_GENERATED_PATTERN.test(id) ? id : null;
}

/** Whether a value is usable as a Change-Id (generated or foreign format). */
export function changeIdIsValid(value: string | undefined): boolean {
  return CHANGE_ID_PATTERN.test(value ?? "");
}

/**
 * The value of the last trailer KEY in a commit message (empty when absent).
 * Key match is exact and case-sensitive; parsing goes through
 * `git interpret-trailers --parse` (the bash contract — don't hand-roll).
 */
export function changeIdGetTrailer(message: string, key: string): string {
  const r = spawnSync("git", ["interpret-trailers", "--parse"], {
    input: message,
    encoding: "utf8",
  });
  if (r.status !== 0) return "";
  let value = "";
  for (const line of r.stdout.split("\n")) {
    if (line.startsWith(`${key}: `)) value = line.slice(key.length + 2);
  }
  return value;
}

/** The Change-Id of a commit message; null when absent or malformed. */
export function changeIdGetFromMessage(message: string): string | null {
  const value = changeIdGetTrailer(message, "Change-Id");
  return changeIdIsValid(value) ? value : null;
}

/** The Change-Id of a commit; null when absent, malformed, or git fails. */
export function changeIdGetFromCommit(repo: string, commit: string): string | null {
  const r = spawnSync("git", ["-C", repo, "log", "-1", "--format=%B", commit], {
    encoding: "utf8",
  });
  if (r.status !== 0) return null;
  return changeIdGetFromMessage(r.stdout);
}

/** Whether a message carries `Fork-Adapted: yes` (value case-insensitive). */
export function changeIdIsForkAdapted(message: string): boolean {
  return changeIdGetTrailer(message, "Fork-Adapted").toLowerCase() === "yes";
}

/** Whether a message carries `Fork-Only: yes` (value case-insensitive). */
export function changeIdIsForkOnly(message: string): boolean {
  return changeIdGetTrailer(message, "Fork-Only").toLowerCase() === "yes";
}

// ---------------------------------------------------------------------------
// skip list
// ---------------------------------------------------------------------------

export type SkipListKind = "change-id" | "sha";

export interface SkipListEntry {
  kind: SkipListKind;
  value: string;
  note?: string;
}

/**
 * Path of the skip list: one file in the git common directory, shared by
 * worktrees and never part of the working tree.
 */
export function skipListGetPath(repo: string): string | null {
  const r = spawnSync(
    "git",
    ["-C", repo, "rev-parse", "--path-format=absolute", "--git-common-dir"],
    { encoding: "utf8" },
  );
  if (r.status !== 0) return null;
  const common = r.stdout.trim();
  return common === "" ? null : join(common, SKIP_LIST_FILE_NAME);
}

/** Whether VALUE is already listed (kind+value pair must match exactly). */
export function skipListHas(repo: string, kind: SkipListKind, value: string): boolean {
  const path = skipListGetPath(repo);
  if (path === null || !existsSync(path)) return false;
  return readLines(path).some(
    (e) => e !== null && e.kind === kind && e.value === value,
  );
}

/** Add an entry; adding one that is already listed changes nothing. */
export function skipListAdd(
  repo: string,
  kind: SkipListKind,
  value: string,
  note?: string,
): { ok: boolean; error?: string } {
  if (kind === "change-id" && !changeIdIsValid(value)) {
    return { ok: false, error: `invalid Change-Id: ${value}` };
  }
  return locked(repo, (path) => {
    if (skipListHas(repo, kind, value)) return { ok: true };
    let resolved = value;
    if (kind === "sha") {
      const full = revParseCommit(repo, value);
      if (full === null) return { ok: false, error: `not a commit: ${value}` };
      resolved = full;
    }
    const cleanNote = note?.replaceAll("\n", " ");
    const line = cleanNote
      ? `${kind} ${resolved} # ${cleanNote}\n`
      : `${kind} ${resolved}\n`;
    writeFileSync(path, line, { flag: "a" });
    return { ok: true };
  });
}

/**
 * Remove every entry naming VALUE: a Change-Id also removes the sha entries
 * of the commits carrying it, and a commit ref also removes its Change-Id's
 * entry. Fails (ok: false) when nothing matched.
 */
export function skipListRemove(
  repo: string,
  value: string,
): { ok: boolean; error?: string } {
  return locked(repo, (path) => {
    if (!existsSync(path)) return { ok: false, error: "no skip list" };
    const drop = new Set<string>();
    if (changeIdIsValid(value)) {
      const r = spawnSync(
        "git",
        ["-C", repo, "log", "--all", "-F", "--grep", `Change-Id: ${value}`, "--format=%H"],
        { encoding: "utf8" },
      );
      if (r.status !== 0) return { ok: false, error: "git log failed" };
      for (const commit of r.stdout.split("\n")) {
        if (commit !== "" && changeIdGetFromCommit(repo, commit) === value) {
          drop.add(commit);
        }
      }
    }
    const full = revParseCommit(repo, value);
    if (full !== null) {
      const id = changeIdGetFromCommit(repo, full);
      if (id !== null) drop.add(id);
      drop.add(full);
    }
    drop.add(value);

    let removed = false;
    const kept: string[] = [];
    for (const line of readFileSync(path, "utf8").split("\n")) {
      if (/^\s*(#|$)/.test(line)) {
        kept.push(line);
        continue;
      }
      const parts = line.split(/\s+/);
      if (parts.length >= 2 && drop.has(parts[1]!)) {
        removed = true;
        continue;
      }
      kept.push(line);
    }
    if (!removed) return { ok: false, error: "nothing matched" };
    if (!writeAtomic(path, kept.join("\n"))) {
      return { ok: false, error: "could not update the skip list" };
    }
    return { ok: true };
  });
}

export interface SkipList {
  ids: Set<string>;
  shas: Set<string>;
}

/** Load the skip list. A missing list is empty; unreadable is an error. */
export function skipListLoad(repo: string): { list: SkipList } | { error: string } {
  const path = skipListGetPath(repo);
  const list: SkipList = { ids: new Set(), shas: new Set() };
  if (path === null || !existsSync(path)) return { list };
  try {
    for (const entry of readLines(path)) {
      if (entry === null) continue;
      if (entry.kind === "change-id") list.ids.add(entry.value);
      else list.shas.add(entry.value);
    }
  } catch {
    return { error: "could not read the skip list" };
  }
  return { list };
}

/** Whether a commit is skipped, by SHA or by Change-Id. Needs skipListLoad. */
export function skipListHasCommit(list: SkipList, sha: string, changeId?: string): boolean {
  if (list.shas.has(sha)) return true;
  return changeId !== undefined && list.ids.has(changeId);
}

/**
 * Print the entries, first dropping stale ones (sha whose commit is gone, or
 * a Change-Id no commit carries). Pruned entries are reported via onPruned.
 */
export function skipListList(
  repo: string,
  onPruned?: (line: string) => void,
): { entries: SkipListEntry[] } | { error: string } {
  return locked(repo, (path) => {
    if (!existsSync(path)) return { entries: [] };
    const kept: string[] = [];
    const entries: SkipListEntry[] = [];
    let stale = false;
    for (const raw of readFileSync(path, "utf8").split("\n")) {
      if (/^\s*(#|$)/.test(raw)) {
        kept.push(raw);
        continue;
      }
      const parts = raw.split(/\s+/);
      const kind = parts[0] as SkipListKind;
      const value = parts[1] ?? "";
      let exists: boolean;
      if (kind !== "sha" && kind !== "change-id" || value === "") {
        exists = false;
      } else if (kind === "sha") {
        exists = revParseCommit(repo, value) !== null;
      } else {
        const r = spawnSync(
          "git",
          ["-C", repo, "log", "--all", "-1", "--format=%H", "-F", "--grep", `Change-Id: ${value}`],
          { encoding: "utf8" },
        );
        exists = r.status === 0 && r.stdout.trim() !== "";
      }
      if (exists) {
        kept.push(raw);
        const note = parts.slice(3).join(" ");
        entries.push(note === "" ? { kind, value } : { kind, value, note });
      } else {
        stale = true;
        onPruned?.(`pruned stale entry: ${raw}`);
      }
    }
    if (stale && !writeAtomic(path, kept.join("\n"))) {
      return { error: "could not update the skip list while pruning" };
    }
    return { entries };
  });
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function revParseCommit(repo: string, ref: string): string | null {
  const r = spawnSync(
    "git",
    ["-C", repo, "rev-parse", "--verify", "--quiet", `${ref}^{commit}`],
    { encoding: "utf8" },
  );
  return r.status === 0 && r.stdout.trim() !== "" ? r.stdout.trim() : null;
}

function readLines(path: string): Array<SkipListEntry | null> {
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((l) => !/^\s*(#|$)/.test(l))
    .map((l) => {
      const parts = l.split(/\s+/);
      if (parts.length < 2) return null;
      const kind = parts[0] as SkipListKind;
      if (kind !== "sha" && kind !== "change-id") return null;
      const note = parts.slice(3).join(" ");
      return note === "" ? { kind, value: parts[1]! } : { kind, value: parts[1]!, note };
    });
}

function writeAtomic(path: string, content: string): boolean {
  const tmp = path + ".tmp-" + process.pid + "-" + Math.random().toString(36).slice(2, 8);
  writeFileSync(tmp, content.endsWith("\n") ? content : content + "\n");
  const r = spawnSync("mv", [tmp, path]);
  return r.status === 0;
}

/** Read the holder PID recorded in a lockfile, or null when unparseable. */
function lockHolderPid(lockPath: string): number | null {
  try {
    const raw = readFileSync(lockPath, "utf8").trim();
    const pid = Number.parseInt(raw, 10);
    return Number.isInteger(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

/** Whether a PID is alive (signal 0 probes existence without delivering). */
function pidIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    // EPERM means the process exists but is owned by another user — alive.
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
}

/** Remove a stale lock and the pidfile content it carries. */
function reclaimStaleLock(lockPath: string): boolean {
  try {
    rmSync(lockPath, { force: true });
    return true;
  } catch (e) {
    // ENOENT is fine (another waiter reclaimed it first); anything else
    // (EPERM, EACCES, immutable) means we can never take this lock — abort
    // with lock-busy rather than spin past the deadline.
    return (e as NodeJS.ErrnoException).code === "ENOENT";
  }
}

/**
 * Run a mutation while holding the skip-list lock, so concurrent writers
 * (another fork-export, a picker session) serialize instead of overwriting.
 *
 * The bash library serialized with `exec {fd}> lock; flock $fd`; an fd
 * number cannot cross a spawn boundary, so the port replaces it with an
 * O_EXCL lockfile carrying the holder PID. A contending writer reclaims the
 * lock only when the holder PID is provably dead (process-gone probe) or the
 * lock content is unparseable and older than LOCK_LIVENESS_MS — so a slow
 * mutation can never be interrupted mid-write the way an age-based reclaim
 * would allow. Waiters poll and fail with "lock busy" after a deadline;
 * an undeletable lock aborts with "lock busy" instead of spinning.
 */
function locked<T>(repo: string, fn: (path: string) => T): T | { ok: false; error: string } {
  const path = skipListGetPath(repo);
  if (path === null) return { ok: false, error: "cannot resolve git common dir" };
  mkdirp(dirname(path));
  const lockPath = path + ".lock";
  const deadline = Date.now() + 10_000;
  while (true) {
    try {
      const fd = openSync(lockPath, "wx"); // O_CREAT|O_EXCL — atomic create
      writeSync(fd, String(process.pid));
      closeSync(fd);
      break;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") {
        return { ok: false, error: "cannot create skip-list lock" };
      }
      // Reclaim only when the holder is provably gone: PID probe first;
      // unparseable content falls back to an age check (a crashed writer's
      // file may be truncated or empty). A LIVE holder gets the bounded
      // wait below — it is expected to release on its own, and the deadline
      // exists for exactly this case (returning busy-immediate made the
      // wait contract dead code).
      const pid = lockHolderPid(lockPath);
      const holderLive = pid !== null && pidIsAlive(pid);
      // Dead: no parseable pid and the file is past the liveness age (a
      // crashed writer's file may be truncated or empty), or a recorded pid
      // that no longer exists.
      const holderDead =
        pid === null
          ? Date.now() - statSyncSafe(lockPath) > LOCK_LIVENESS_MS
          : !holderLive;
      if (holderDead && !holderLive) {
        if (!reclaimStaleLock(lockPath)) {
          return { ok: false, error: "skip-list lock busy (undeletable)" };
        }
        continue; // lock gone — retry the create immediately
      }
      if (holderLive) {
        // Live holder: wait within the deadline, then report busy.
        if (Date.now() >= deadline) {
          return { ok: false, error: "skip-list lock busy" };
        }
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25);
        continue;
      }
      if (Date.now() >= deadline) {
        return { ok: false, error: "skip-list lock busy" };
      }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
    }
  }
  try {
    return fn(path);
  } finally {
    rmSync(lockPath, { force: true });
  }
}

/** mtime of PATH, or 0 when unreadable (treated as maximally stale). */
function statSyncSafe(path: string): number {
  try {
    return statSync(path).mtimeMs;
  } catch {
    return 0;
  }
}
function mkdirp(dir: string): void {
  spawnSync("mkdir", ["-p", dir], { stdio: "ignore" });
}

