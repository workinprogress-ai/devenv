// domain/pipelines/queued-run.ts — find the run a tool just queued.
//
// A trigger that does not hand back the queued run's id (GitHub's workflow
// dispatch) leaves only the repository's run list to identify the run. A run
// is attributed to the trigger only when it is new (its id was absent from a
// snapshot taken before the trigger), was created no earlier than the trigger
// (less a small clock-skew allowance), and matches the workflow and event
// when those are known. Anything less specific is reported as ambiguous or
// not found rather than guessed.
//
// Pure: the run list, the sleep and the clock are injected, so tests never wait.

export interface QueuedRunDeps {
  /** Returns the run list as plain JSON text (an array of run records). */
  listRuns: () => Promise<string>;
  sleep: (ms: number) => Promise<void>;
  /** Current time in epoch milliseconds. */
  now: () => number;
}

export interface QueuedRunParams {
  /** Epoch milliseconds taken immediately before the trigger. */
  triggerTime: number;
  /** Ids of the runs that existed before the trigger. */
  snapshotIds: ReadonlySet<string>;
  /** Display name of the triggered workflow; undefined skips workflow narrowing. */
  workflowName: string | undefined;
  /** Keep only runs whose event is workflow_dispatch. */
  requireDispatchEvent: boolean;
  /** Delay between polls (default 2000). */
  pollIntervalMs?: number;
  /** Total time to keep polling (default 30000). */
  boundMs?: number;
  /** How far before the trigger a run's createdAt may fall (default 5000). */
  allowanceMs?: number;
}

export type QueuedRunResult =
  | { kind: "found"; url: string }
  | { kind: "ambiguous"; count: number }
  | { kind: "not-found" };

interface RunRecord {
  id?: unknown;
  url?: unknown;
  workflowName?: unknown;
  event?: unknown;
  createdAt?: unknown;
}

function parseRuns(text: string): RunRecord[] {
  try {
    const parsed: unknown = JSON.parse(text);
    return Array.isArray(parsed) ? (parsed as RunRecord[]) : [];
  } catch {
    return [];
  }
}

export async function findQueuedRun(deps: QueuedRunDeps, params: QueuedRunParams): Promise<QueuedRunResult> {
  const interval = params.pollIntervalMs ?? 2000;
  const bound = params.boundMs ?? 30000;
  const allowance = params.allowanceMs ?? 5000;
  const earliest = params.triggerTime - allowance;
  const deadline = deps.now() + bound;

  for (;;) {
    let text = "";
    try {
      text = await deps.listRuns();
    } catch {
      // A failed poll is "no candidates yet"; the next poll may succeed.
    }
    const candidates = parseRuns(text).filter((run) => {
      if (typeof run.url !== "string" || run.url === "") return false;
      if (params.snapshotIds.has(String(run.id))) return false;
      const created = typeof run.createdAt === "string" ? Date.parse(run.createdAt) : Number.NaN;
      if (Number.isNaN(created) || created < earliest) return false;
      if (params.requireDispatchEvent && run.event !== "workflow_dispatch") return false;
      if (params.workflowName !== undefined && run.workflowName !== params.workflowName) return false;
      return true;
    });
    if (candidates.length === 1) return { kind: "found", url: candidates[0]!.url as string };
    if (candidates.length > 1) return { kind: "ambiguous", count: candidates.length };

    const remaining = deadline - deps.now();
    if (remaining <= 0) return { kind: "not-found" };
    await deps.sleep(Math.min(interval, remaining));
  }
}
