// The pure workflow state model (14.12a): vocabulary order, policy knobs,
// and the rollup function — ported from workflow-core.bash with the bats
// suite's semantics as the oracle.
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  computeRollup,
  statusOrder,
  workflowOrder,
  workflowPolicy,
} from "../../lib/domain/issues/graph.ts";
import { eventNames, eventStatusFor, skillEventsConfigPath } from "../../lib/domain/events.ts";

const VOCAB = "TBD,To-Groom,Groomed,Ready,Implementing,Staged,Staging,Production";

let root = "";
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "wf-model-"));
  writeFileSync(
    join(root, "devenv.config"),
    `[workflows]\nstatus_workflow=${VOCAB}\n`,
  );
});
afterEach(() => {
  delete process.env["WORKFLOW_ORDER_OVERRIDE"];
});

describe("workflowOrder", () => {
  it("reads the configured vocabulary in order", () => {
    expect(workflowOrder(root)).toEqual(VOCAB.split(","));
  });
  it("WORKFLOW_ORDER_OVERRIDE replaces the vocabulary (fork/test seam)", () => {
    process.env["WORKFLOW_ORDER_OVERRIDE"] = "A,B,C";
    expect(workflowOrder(root)).toEqual(["A", "B", "C"]);
  });
});

describe("workflowPolicy", () => {
  it("defaults: anchor Implementing, fallback Ready", () => {
    expect(workflowPolicy(root)).toEqual({ anchor: "Implementing", fallback: "Ready" });
  });
  it("config overrides the knobs (fork renaming tokens)", () => {
    writeFileSync(
      join(root, "devenv.config"),
      `[workflows]\nstatus_workflow=${VOCAB}\ndelivery_segment_anchor=Groomed\nstatus_fallback=TBD\n`,
    );
    expect(workflowPolicy(root)).toEqual({ anchor: "Groomed", fallback: "TBD" });
  });
});

describe("statusOrder", () => {
  it("returns the 0-based index for known tokens", () => {
    expect(statusOrder("TBD", root)).toBe(0);
    expect(statusOrder("Implementing", root)).toBe(4);
  });
  it("returns -1 for unknown tokens and empty input", () => {
    expect(statusOrder("Nope", root)).toBe(-1);
    expect(statusOrder("", root)).toBe(-1);
  });
});

describe("computeRollup", () => {
  it("min child state when any child is in delivery", () => {
    expect(computeRollup(["Production", "Ready"], root)).toBe("Implementing");
    expect(computeRollup(["Implementing", "Staged"], root)).toBe("Implementing");
    expect(computeRollup(["Staging", "Staging"], root)).toBe("Staging");
  });
  it("pre-delivery children floor at the anchor", () => {
    expect(computeRollup(["TBD", "Production"], root)).toBe("Implementing");
  });
  it("undefined when all children are pre-delivery (parent keeps its own state)", () => {
    expect(computeRollup(["TBD", "To-Groom", "Groomed"], root)).toBeUndefined();
  });
  it("undefined for an empty child set", () => {
    expect(computeRollup([], root)).toBeUndefined();
  });
  it("undefined on an unknown child status (vocabulary mismatch)", () => {
    expect(computeRollup(["Production", "Bogus"], root)).toBeUndefined();
  });
  it("sanctioned regression propagates (a child moved back moves the parent back)", () => {
    expect(computeRollup(["Staged"], root)).toBe("Staged");
    expect(computeRollup(["Implementing"], root)).toBe("Implementing");
  });
});

// ---------------------------------------------------------------------------
// 15.19 drift gate: skill-events.yml statuses are members of [workflows]
// ---------------------------------------------------------------------------

describe("skill-events binding gate", () => {
  it("every skill-events.yml status is a [workflows] status_workflow member", () => {
    // The REAL repo config + skill-events.yml (no overrides): this gate
    // exists to catch a [workflows] rename that missed skill-events.yml.
    const vocab = new Set(workflowOrder());
    expect(vocab.size).toBeGreaterThan(0);
    const events = eventNames();
    expect(events.length).toBeGreaterThan(0);
    const drift: string[] = [];
    for (const e of events) {
      const status = eventStatusFor(e);
      if (status !== null && !vocab.has(status)) {
        drift.push(`${e}: '${status}' not in status_workflow`);
      }
    }
    expect(drift).toEqual([]);
  });
  it("skill-events.yml is discoverable via the self-root contract", () => {
    expect(skillEventsConfigPath()).toContain("skill-events.yml");
  });
});
