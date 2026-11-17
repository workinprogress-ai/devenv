// smoke-teardown.ts — resource recording, interrupt-safe teardown and signal
// handling shared by the live provider smoke suites (github/smoke.ts and
// azure/smoke.ts). The module imports neither suite and never calls
// process.exit on its own: the exit function is injected where signals are
// installed, so everything below can be driven by tests with a fake process.
//
// Guarantees:
//   - one teardown run: every teardown() call returns the same promise, so a
//     second signal or the normal-path `finally` waits for the run in progress
//     and never short-circuits it;
//   - a create call wrapped in `inflight` is waited for (bounded) before the
//     cleanup pass, so a signal that lands mid-create cannot leak the resource:
//     the cleanup runs after the create has settled;
//   - a resource recorded after teardown began (an operation that was still in
//     flight) is cleaned up immediately, and the teardown promise only settles
//     once every such late cleanup has settled;
//   - a cleanup that fails for a resource whose create was never confirmed is a
//     notice, not a failure: there is nothing known to remove;
//   - a repeated SIGINT/SIGTERM while teardown runs prints a notice and does
//     not exit; the exit happens only after teardown and late cleanups settle;
//   - failed cleanups are reported with a manual command per leftover item.

/** Thrown by `record` and `assertCapacity` when the resource cap is reached. */
export class ResourceCapError extends Error {}

/** Thrown by `throwIfInterrupted` so a running suite unwinds after a signal. */
export class InterruptedError extends Error {
  constructor() {
    super("interrupted");
  }
}

/** How long teardown waits for create calls still in flight before it cleans
 * up anyway (milliseconds). */
export const INFLIGHT_WAIT_MS = 120_000;

export interface TeardownOptions {
  /** The most resources one run may record. */
  cap: number;
  /** Normal output sink (already scrubbed by the caller). */
  out: (line: string) => void;
  /** Error output sink (already scrubbed by the caller). */
  err: (line: string) => void;
  /** Print a `recorded` line per resource and a `teardown ok` line per cleanup. */
  verbose?: boolean;
  /** Extra lines printed after the leftover list (how to find other leftovers). */
  leftoverHints?: () => string[];
  /** Bound on the wait for in-flight create calls (default INFLIGHT_WAIT_MS). */
  inflightWaitMs?: number;
}

interface Resource {
  kind: string;
  id: string;
  manual: string;
  cleanup: () => Promise<void> | void;
  confirmed: boolean;
}

/** Returned by `record`; the suite calls `confirm` once the create succeeded. */
export interface RecordedResource {
  confirm(): void;
}

/** First line of an error, trimmed to a printable length. */
export function describeError(e: unknown): string {
  return (e instanceof Error ? e.message : String(e)).split("\n")[0]?.slice(0, 300) ?? "";
}

export interface Teardown {
  /** Register a resource the moment it exists (or just before the call that
   * creates it). Newest-first cleanup. A resource recorded after teardown
   * began is cleaned up at once. Throws ResourceCapError after registering a
   * resource that goes over the cap, so the over-cap resource is still cleaned.
   * A resource recorded before its create call passes `confirmed: false` and
   * is unconfirmed until `confirm` is called on the returned handle; a cleanup
   * failure for an unconfirmed resource is reported as a notice only. The
   * default (confirmed) is for a resource recorded once it is known to exist. */
  record(kind: string, id: string, manual: string, cleanup: () => Promise<void> | void, confirmed?: boolean): RecordedResource;
  /** Track a create call. The promise is returned unchanged (the caller still
   * sees a rejection); teardown waits for outstanding tracked promises, up to
   * the configured bound, before its cleanup pass. `hint` is the manual
   * command printed when the bound expires. */
  inflight<T>(promise: Promise<T>, hint?: string): Promise<T>;
  /** One line per recorded resource (newest first) plus the leftover hints:
   * what to run by hand if a cleanup hangs. */
  manualCommands(): string[];
  /** Throws ResourceCapError when no further resource may be created. */
  assertCapacity(): void;
  /** Run teardown once; every call returns the same promise, which never rejects. */
  teardown(): Promise<void>;
  /** True once an interrupt (or `markInterrupted`) happened. */
  isInterrupted(): boolean;
  markInterrupted(): void;
  /** Throws InterruptedError once interrupted; suites call it in their loops. */
  throwIfInterrupted(): void;
  /** Number of cleanups that failed (initial pass and late cleanups). */
  failedCount(): number;
  recordedCount(): number;
}

export function createTeardown(options: TeardownOptions): Teardown {
  const resources: Resource[] = [];
  const lateCleanups: Promise<void>[] = [];
  let teardownPromise: Promise<void> | null = null;
  let started = false;
  let interrupted = false;
  let failed = 0;
  const pending = new Map<Promise<void>, string>();
  const waitMs = options.inflightWaitMs ?? INFLIGHT_WAIT_MS;

  /** Returns false when the failure counts (a leftover item to report). */
  function reportFailure(r: Resource, e: unknown): boolean {
    if (!r.confirmed) {
      options.err(
        `  notice: cleanup attempted for a resource whose create was never confirmed; nothing to remove: ${r.kind} ${r.id} — ${describeError(e)}`,
      );
      return true;
    }
    failed++;
    options.err(`  TEARDOWN FAILED: ${r.kind} ${r.id} — ${describeError(e)}`);
    return false;
  }

  async function runCleanup(r: Resource, late: boolean): Promise<boolean> {
    try {
      await r.cleanup();
      if (options.verbose === true) options.out(`  teardown ok: ${r.kind} ${r.id}`);
      return true;
    } catch (e) {
      const harmless = reportFailure(r, e);
      // A late cleanup is not part of the leftover list printed at the end of
      // the main pass, so its manual command is printed here.
      if (late && !harmless) options.err(`  ${r.manual}`);
      return harmless;
    }
  }

  /** Wait for tracked create calls, re-checking for ones registered meanwhile,
   * until none is outstanding or the single overall bound expires. */
  async function waitForInflight(): Promise<void> {
    if (pending.size === 0) return;
    const seconds = Math.round(waitMs / 100) / 10;
    options.err(`  waiting for ${pending.size} create call(s) still in flight (up to ${seconds}s) before cleaning up`);
    const deadline = Date.now() + waitMs;
    while (pending.size > 0) {
      const remaining = deadline - Date.now();
      let timer: ReturnType<typeof setTimeout> | undefined;
      const expired = new Promise<"expired">((resolve) => {
        timer = setTimeout(() => resolve("expired"), Math.max(remaining, 0));
      });
      const outcome = await Promise.race([Promise.allSettled([...pending.keys()]).then(() => "settled" as const), expired]);
      clearTimeout(timer);
      if (outcome === "expired") {
        for (const hint of pending.values()) {
          options.err(`  create still in flight after ${seconds}s; it may exist: ${hint}`);
        }
        return;
      }
    }
  }

  async function runTeardown(): Promise<void> {
    // Resources recorded from now on are cleaned by the late path; only the
    // ones that exist at this moment belong to the newest-first pass.
    const initial = resources.slice();
    await waitForInflight();
    const failures: Resource[] = [];
    for (let i = initial.length - 1; i >= 0; i--) {
      const r = initial[i]!;
      if (!(await runCleanup(r, false))) failures.push(r);
    }
    // Late cleanups may themselves be recorded while earlier ones run, so wait
    // until none is pending.
    let waited = 0;
    while (waited < lateCleanups.length) {
      const batch = lateCleanups.slice(waited);
      waited += batch.length;
      await Promise.allSettled(batch);
    }
    if (failures.length > 0) {
      options.err("");
      options.err("!!! TEARDOWN INCOMPLETE — these items were created by this run and still exist:");
      for (const r of failures) options.err(`  ${r.kind} ${r.id}: ${r.manual}`);
      for (const line of options.leftoverHints?.() ?? []) options.err(line);
    }
  }

  return {
    record(kind, id, manual, cleanup, confirmed = true) {
      const r: Resource = { kind, id, manual, cleanup, confirmed };
      resources.push(r);
      if (options.verbose === true) options.out(`  recorded ${kind} ${id}`);
      if (started) {
        options.err(`  ${kind} ${id} was created while the run was shutting down; cleaning it up now`);
        lateCleanups.push(runCleanup(r, true).then(() => undefined));
      }
      if (resources.length > options.cap) {
        throw new ResourceCapError(`resource cap reached (${options.cap}); stopping before creating more`);
      }
      return {
        confirm() {
          r.confirmed = true;
        },
      };
    },
    inflight<T>(promise: Promise<T>, hint = "see the manual commands above"): Promise<T> {
      const tracked: Promise<void> = promise.then(
        () => undefined,
        () => undefined,
      ).then(() => {
        pending.delete(tracked);
      });
      pending.set(tracked, hint);
      return promise;
    },
    manualCommands() {
      const lines = [...resources].reverse().map((r) => `  ${r.kind} ${r.id}: ${r.manual}`);
      return [...lines, ...(options.leftoverHints?.() ?? [])];
    },
    assertCapacity() {
      if (resources.length >= options.cap) {
        throw new ResourceCapError(`resource cap reached (${options.cap}); stopping before creating more`);
      }
    },
    teardown() {
      if (teardownPromise === null) {
        started = true;
        teardownPromise = runTeardown();
      }
      return teardownPromise;
    },
    isInterrupted: () => interrupted,
    markInterrupted() {
      interrupted = true;
    },
    throwIfInterrupted() {
      if (interrupted) throw new InterruptedError();
    },
    failedCount: () => failed,
    recordedCount: () => resources.length,
  };
}

/** The slice of `process` the signal wiring needs (a fake in tests). */
export type SignalHost = Pick<NodeJS.EventEmitter, "on">;

export interface SignalInstallOptions {
  host: SignalHost;
  exit: (code: number) => void;
  err: (line: string) => void;
  signals?: string[];
}

/** Wire SIGINT/SIGTERM and uncaught failures to the shared teardown.
 *  - first signal: mark interrupted, run teardown, then exit 130;
 *  - repeated signal while teardown runs: print a notice naming the way out of
 *    a hung cleanup and the manual commands, do not exit;
 *  - uncaught exception or rejection: mark interrupted (so scenarios stop
 *    creating while teardown runs), run teardown, then exit 1 (130 when a
 *    signal had already interrupted the run). */
export function installSignalHandlers(td: Teardown, opts: SignalInstallOptions): void {
  let signalled = false;
  for (const sig of opts.signals ?? ["SIGINT", "SIGTERM"]) {
    opts.host.on(sig, () => {
      if (signalled) {
        opts.err(`received ${sig}: teardown in progress; waiting for it to finish`);
        opts.err(
          `  to abandon a hung cleanup, stop the process with a signal the suite does not catch (kill -9 ${process.pid}, or Ctrl-\\ for SIGQUIT in a terminal); then remove what is left by hand with these commands:`,
        );
        for (const line of td.manualCommands()) opts.err(line);
        return;
      }
      signalled = true;
      td.markInterrupted();
      opts.err(`received ${sig}: tearing down recorded resources`);
      void td.teardown().then(() => opts.exit(130));
    });
  }
  const onFatal = (error: unknown): void => {
    const wasInterrupted = td.isInterrupted();
    if (!wasInterrupted) opts.err(`aborted by an uncaught error: ${describeError(error)}`);
    const code = wasInterrupted ? 130 : 1;
    td.markInterrupted();
    void td.teardown().then(() => opts.exit(code));
  };
  opts.host.on("uncaughtException", onFatal);
  opts.host.on("unhandledRejection", onFatal);
}
