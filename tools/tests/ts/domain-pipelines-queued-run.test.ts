// findQueuedRun: attributes a run to the trigger only when it is new, recent
// enough and matches the workflow/event; ambiguity and absence are reported.
import { describe, expect, it } from "vitest";
import { findQueuedRun, type QueuedRunParams } from "../../lib/domain/pipelines/queued-run.ts";

const T0 = Date.parse("2026-01-01T12:00:00Z");

interface Run {
  id: number;
  url?: string;
  workflowName?: string;
  event?: string;
  createdAt?: string;
}

function run(id: number, over: Partial<Run> = {}): Run {
  return {
    id,
    url: `https://example.invalid/run/${id}`,
    workflowName: "CI",
    event: "workflow_dispatch",
    createdAt: new Date(T0 + 1000).toISOString(),
    ...over,
  };
}

/** Fake world: each poll returns the next scripted payload (the last repeats);
 * sleeping advances the fake clock. */
function world(polls: Array<string | Run[]>) {
  let clock = T0;
  let calls = 0;
  const sleeps: number[] = [];
  return {
    deps: {
      listRuns: async () => {
        const entry = polls[Math.min(calls, polls.length - 1)]!;
        calls++;
        return typeof entry === "string" ? entry : JSON.stringify(entry);
      },
      sleep: async (ms: number) => {
        sleeps.push(ms);
        clock += ms;
      },
      now: () => clock,
    },
    polls: () => calls,
    sleeps,
    elapsed: () => clock - T0,
  };
}

const base: QueuedRunParams = {
  triggerTime: T0,
  snapshotIds: new Set(),
  workflowName: undefined,
  requireDispatchEvent: false,
};

describe("findQueuedRun", () => {
  it("returns the new run found on the first poll", async () => {
    const w = world([[run(5)]]);
    expect(await findQueuedRun(w.deps, base)).toEqual({ kind: "found", url: "https://example.invalid/run/5" });
    expect(w.polls()).toBe(1);
    expect(w.sleeps).toEqual([]);
  });

  it("finds the run on a later poll", async () => {
    const w = world([[], [], [run(7)]]);
    expect(await findQueuedRun(w.deps, base)).toEqual({ kind: "found", url: "https://example.invalid/run/7" });
    expect(w.polls()).toBe(3);
    expect(w.sleeps).toEqual([2000, 2000]);
  });

  it("reports not-found after the bound, polling every interval", async () => {
    const w = world([[]]);
    expect(await findQueuedRun(w.deps, base)).toEqual({ kind: "not-found" });
    expect(w.elapsed()).toBe(30000);
    expect(w.polls()).toBe(16);
  });

  it("clamps the last sleep to the remaining time", async () => {
    const w = world([[]]);
    await findQueuedRun(w.deps, { ...base, pollIntervalMs: 2000, boundMs: 5000 });
    expect(w.sleeps).toEqual([2000, 2000, 1000]);
    expect(w.polls()).toBe(4);
  });

  it("reports ambiguity immediately when two candidates exist", async () => {
    const w = world([[run(5), run(6)]]);
    expect(await findQueuedRun(w.deps, base)).toEqual({ kind: "ambiguous", count: 2 });
    expect(w.polls()).toBe(1);
  });

  it("never chooses a pre-existing newer run of another workflow", async () => {
    const other = run(9, { workflowName: "Deploy", createdAt: new Date(T0 + 4000).toISOString() });
    const w = world([[other], [other, run(10)]]);
    const result = await findQueuedRun(w.deps, {
      ...base,
      snapshotIds: new Set(["9"]),
      workflowName: "CI",
    });
    expect(result).toEqual({ kind: "found", url: "https://example.invalid/run/10" });
  });

  it("never chooses a run whose id is in the snapshot, even if recent", async () => {
    const w = world([[run(5)]]);
    const result = await findQueuedRun(w.deps, { ...base, snapshotIds: new Set(["5"]), boundMs: 4000 });
    expect(result).toEqual({ kind: "not-found" });
  });

  it("accepts a createdAt just inside the allowance and rejects one just outside", async () => {
    const inside = run(1, { createdAt: new Date(T0 - 5000).toISOString() });
    const outside = run(2, { createdAt: new Date(T0 - 5001).toISOString() });
    expect(await findQueuedRun(world([[inside]]).deps, base)).toEqual({
      kind: "found",
      url: "https://example.invalid/run/1",
    });
    expect(await findQueuedRun(world([[outside]]).deps, { ...base, boundMs: 0 })).toEqual({ kind: "not-found" });
  });

  it("narrows two candidates to one by workflow name", async () => {
    const w = world([[run(5), run(6, { workflowName: "Deploy" })]]);
    expect(await findQueuedRun(w.deps, { ...base, workflowName: "Deploy" })).toEqual({
      kind: "found",
      url: "https://example.invalid/run/6",
    });
  });

  it("applies the workflow_dispatch event filter only when enabled", async () => {
    const runs = [run(5, { event: "push" })];
    expect(await findQueuedRun(world([runs]).deps, { ...base, requireDispatchEvent: true, boundMs: 0 })).toEqual({
      kind: "not-found",
    });
    expect(await findQueuedRun(world([runs]).deps, { ...base, requireDispatchEvent: false })).toEqual({
      kind: "found",
      url: "https://example.invalid/run/5",
    });
  });

  it("treats an unparsable poll as no candidates yet", async () => {
    const w = world(["not json", "{\"a\":1}", [run(8)]]);
    expect(await findQueuedRun(w.deps, base)).toEqual({ kind: "found", url: "https://example.invalid/run/8" });
    expect(w.polls()).toBe(3);
  });

  it("treats a failing list call as no candidates yet", async () => {
    let calls = 0;
    const w = world([[run(3)]]);
    const deps = {
      ...w.deps,
      listRuns: async () => {
        calls++;
        if (calls === 1) throw new Error("boom");
        return w.deps.listRuns();
      },
    };
    expect(await findQueuedRun(deps, base)).toEqual({ kind: "found", url: "https://example.invalid/run/3" });
  });
});
