// always-on-baseline: the committed byte ceilings for the always-on text
// (instructions file, AGENTS.md, summed skill descriptions) and the reset rule:
// lowering a ceiling is free, raising one needs a written reason.
import { afterEach, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  COMPONENT_IDS,
  parseBaseline,
  readBaseline,
  resetBaseline,
  serializeBaseline,
  writeBaseline,
  type AlwaysOnBaseline,
} from "../../lib/core/always-on-baseline.ts";

const REPO_ROOT = join(import.meta.dirname, "..", "..", "..");
const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
function scratch(): string {
  const d = mkdtempSync(join(tmpdir(), "always-on-baseline-"));
  dirs.push(d);
  return d;
}

function sample(): AlwaysOnBaseline {
  return {
    schema: 1,
    unit: "bytes",
    components: {
      instructions: { path: "copilot/copilot-instructions.md", ceiling: 1000 },
      agents: { path: "AGENTS.md", ceiling: 200 },
      "skill-descriptions": { path: "copilot/skills", ceiling: 5000 },
    },
    lastReset: { reason: "initial baseline" },
  };
}

describe("core/always-on-baseline", () => {
  it("defines the three always-on components", () => {
    expect([...COMPONENT_IDS]).toEqual(["instructions", "agents", "skill-descriptions"]);
  });

  describe("parseBaseline", () => {
    it("round-trips through serializeBaseline", () => {
      const text = serializeBaseline(sample());
      const r = parseBaseline(text);
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.baseline).toEqual(sample());
    });

    it("serializes with stable key order, two-space indent and a trailing newline", () => {
      const text = serializeBaseline(sample());
      expect(text.endsWith("}\n")).toBe(true);
      expect(Object.keys(JSON.parse(text))).toEqual(["schema", "unit", "components", "lastReset"]);
      expect(Object.keys(JSON.parse(text).components)).toEqual(["instructions", "agents", "skill-descriptions"]);
      expect(text).toContain('\n  "components": {\n    "instructions": {\n      "path"');
    });

    const bad: Array<[string, (b: Record<string, unknown>) => void, RegExp]> = [
      ["wrong schema", (b) => (b["schema"] = 2), /schema/],
      ["wrong unit", (b) => (b["unit"] = "kb"), /unit/],
      ["missing components", (b) => delete b["components"], /components/],
      ["missing lastReset", (b) => delete b["lastReset"], /lastReset/],
      ["blank reset reason", (b) => (b["lastReset"] = { reason: "  " }), /reason/],
    ];
    for (const [name, mutate, re] of bad) {
      it(`rejects ${name}`, () => {
        const b = JSON.parse(serializeBaseline(sample())) as Record<string, unknown>;
        mutate(b);
        const r = parseBaseline(JSON.stringify(b));
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.errors.join("\n")).toMatch(re);
      });
    }

    it("rejects a missing, extra or malformed component", () => {
      const mk = (f: (c: Record<string, unknown>) => void): ReturnType<typeof parseBaseline> => {
        const b = JSON.parse(serializeBaseline(sample())) as { components: Record<string, unknown> };
        f(b.components);
        return parseBaseline(JSON.stringify(b));
      };
      expect(mk((c) => delete c["agents"]).ok).toBe(false);
      expect(mk((c) => (c["extra"] = { path: "x", ceiling: 1 })).ok).toBe(false);
      expect(mk((c) => (c["agents"] = { path: "", ceiling: 1 })).ok).toBe(false);
      for (const ceiling of [-1, 1.5, "10", null, Number.NaN]) {
        expect(mk((c) => (c["agents"] = { path: "AGENTS.md", ceiling })).ok, String(ceiling)).toBe(false);
      }
    });

    it("rejects text that is not JSON", () => {
      const r = parseBaseline("{ nope");
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.errors[0]).toMatch(/not valid JSON/);
    });
  });

  describe("resetBaseline", () => {
    const measured = (i: number, a: number, s: number) => ({ instructions: i, agents: a, "skill-descriptions": s });

    it("lowers every ceiling to the measured size without a reason", () => {
      const r = resetBaseline(sample(), measured(900, 200, 4000));
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.baseline.components.instructions.ceiling).toBe(900);
      expect(r.baseline.components.agents.ceiling).toBe(200);
      expect(r.baseline.components["skill-descriptions"].ceiling).toBe(4000);
      expect(r.lowered).toEqual(["instructions", "skill-descriptions"]);
      expect(r.raised).toEqual([]);
      expect(r.baseline.lastReset.reason).toBe("lowered to measured size");
    });

    it("refuses to raise a ceiling without a reason, naming the components", () => {
      for (const reason of [undefined, "", "   "]) {
        const r = resetBaseline(sample(), measured(1100, 200, 5001), reason);
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.raised).toEqual(["instructions", "skill-descriptions"]);
      }
    });

    it("raises with a reason and records it", () => {
      const r = resetBaseline(sample(), measured(1100, 150, 5000), "  new skill merged  ");
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.baseline.components.instructions.ceiling).toBe(1100);
      expect(r.baseline.components.agents.ceiling).toBe(150);
      expect(r.raised).toEqual(["instructions"]);
      expect(r.lowered).toEqual(["agents"]);
      expect(r.baseline.lastReset.reason).toBe("new skill merged");
    });

    it("records a supplied reason even when nothing was raised", () => {
      const r = resetBaseline(sample(), measured(900, 200, 5000), "trimmed after eval");
      expect(r.ok && r.baseline.lastReset.reason).toBe("trimmed after eval");
    });

    it("does not modify its input", () => {
      const before = sample();
      resetBaseline(before, measured(900, 100, 100));
      expect(before).toEqual(sample());
    });

    it("rejects measurements that are not non-negative integers", () => {
      for (const bad of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
        expect(() => resetBaseline(sample(), measured(bad, 1, 1))).toThrow(/measured/);
      }
    });
  });

  describe("file helpers", () => {
    it("writes then reads a baseline", () => {
      const p = join(scratch(), "baseline.json");
      writeBaseline(p, sample());
      const r = readBaseline(p);
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.baseline).toEqual(sample());
    });

    it("reports a missing file as an error, never throws", () => {
      const r = readBaseline(join(scratch(), "absent.json"));
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.errors[0]).toMatch(/not found/);
    });
  });

  describe("committed tools/config/always-on-baseline.json", () => {
    const file = join(REPO_ROOT, "tools", "config", "always-on-baseline.json");

    it("is valid and in canonical form", () => {
      const text = readFileSync(file, "utf8");
      const r = parseBaseline(text);
      expect(r.ok).toBe(true);
      if (r.ok) expect(serializeBaseline(r.baseline)).toBe(text);
    });

    it("points every component at an existing path", () => {
      const r = readBaseline(file);
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      for (const id of COMPONENT_IDS) {
        const p = r.baseline.components[id].path;
        expect(existsSync(join(REPO_ROOT, p)), `${id}: ${p}`).toBe(true);
      }
    });
  });
});
