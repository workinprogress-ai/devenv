// always-on-baseline.ts — contract for tools/config/always-on-baseline.json:
// the committed byte ceilings for the text every AI session loads before any
// skill runs (the instructions file, AGENTS.md, and the summed skill
// description lines).
//
// A ceiling is a per-repository fact: a fork that customizes the instructions
// resets its own baseline. The reset rule keeps the ratchet honest: setting
// ceilings to the measured sizes is free when nothing grows, and any increase
// needs a written reason that is recorded with the file.
//
// This module is the schema, parse/serialize, file helpers and the reset
// arithmetic. Measuring the sizes and comparing against the ceilings belong to
// the lint that consumes this file.
//
// Strip-only compatible: no parameter properties, enums, or namespaces.

import { existsSync, readFileSync, writeFileSync } from "node:fs";

export const COMPONENT_IDS = ["instructions", "agents", "skill-descriptions"] as const;

export type ComponentId = (typeof COMPONENT_IDS)[number];

export interface BaselineComponent {
  /** Repo-relative path: a file, or for skill-descriptions the skills directory. */
  path: string;
  /** Maximum allowed size in bytes. */
  ceiling: number;
}

export interface AlwaysOnBaseline {
  schema: 1;
  unit: "bytes";
  components: Record<ComponentId, BaselineComponent>;
  lastReset: { reason: string };
}

export type ParseBaselineResult = { ok: true; baseline: AlwaysOnBaseline } | { ok: false; errors: string[] };

export type ResetBaselineResult =
  | { ok: true; baseline: AlwaysOnBaseline; raised: ComponentId[]; lowered: ComponentId[] }
  | { ok: false; error: "reason-required"; raised: ComponentId[] };

const LOWERED_REASON = "lowered to measured size";

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isByteCount = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 0;

export function parseBaseline(text: string): ParseBaselineResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    return { ok: false, errors: [`baseline is not valid JSON: ${e instanceof Error ? e.message : String(e)}`] };
  }
  if (!isRecord(raw)) return { ok: false, errors: ["baseline must be a JSON object"] };

  const errors: string[] = [];
  if (raw["schema"] !== 1) errors.push("schema must be 1");
  if (raw["unit"] !== "bytes") errors.push('unit must be "bytes"');

  const components = {} as Record<ComponentId, BaselineComponent>;
  const rawComponents = raw["components"];
  if (!isRecord(rawComponents)) {
    errors.push("components must be an object");
  } else {
    for (const key of Object.keys(rawComponents)) {
      if (!(COMPONENT_IDS as readonly string[]).includes(key)) errors.push(`unknown component: ${key}`);
    }
    for (const id of COMPONENT_IDS) {
      const c = rawComponents[id];
      if (!isRecord(c)) {
        errors.push(`component ${id} is missing`);
        continue;
      }
      const path = c["path"];
      const ceiling = c["ceiling"];
      if (typeof path !== "string" || path.trim() === "") errors.push(`component ${id}: path must be a non-empty string`);
      if (!isByteCount(ceiling)) errors.push(`component ${id}: ceiling must be a non-negative integer`);
      if (typeof path === "string" && path.trim() !== "" && isByteCount(ceiling)) components[id] = { path, ceiling };
    }
  }

  const lastReset = raw["lastReset"];
  let reason = "";
  if (!isRecord(lastReset)) {
    errors.push("lastReset must be an object with a reason");
  } else if (typeof lastReset["reason"] !== "string" || lastReset["reason"].trim() === "") {
    errors.push("lastReset.reason must be a non-blank string");
  } else {
    reason = lastReset["reason"];
  }

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, baseline: { schema: 1, unit: "bytes", components, lastReset: { reason } } };
}

/** Canonical form: stable key order, two-space indent, trailing newline. */
export function serializeBaseline(baseline: AlwaysOnBaseline): string {
  const components = {} as Record<string, BaselineComponent>;
  for (const id of COMPONENT_IDS) {
    const c = baseline.components[id];
    components[id] = { path: c.path, ceiling: c.ceiling };
  }
  const ordered = { schema: baseline.schema, unit: baseline.unit, components, lastReset: { reason: baseline.lastReset.reason } };
  return `${JSON.stringify(ordered, null, 2)}\n`;
}

export function readBaseline(path: string): ParseBaselineResult {
  if (!existsSync(path)) return { ok: false, errors: [`baseline file not found: ${path}`] };
  return parseBaseline(readFileSync(path, "utf8"));
}

export function writeBaseline(path: string, baseline: AlwaysOnBaseline): void {
  writeFileSync(path, serializeBaseline(baseline));
}

/**
 * Set every ceiling to its measured size. Lowering is free; any increase needs
 * a non-blank reason, otherwise nothing changes and the raised components are
 * named. A supplied reason is recorded even when nothing was raised.
 */
export function resetBaseline(
  baseline: AlwaysOnBaseline,
  measured: Record<ComponentId, number>,
  reason?: string,
): ResetBaselineResult {
  for (const id of COMPONENT_IDS) {
    if (!isByteCount(measured[id])) throw new Error(`measured size for ${id} must be a non-negative integer`);
  }
  const raised = COMPONENT_IDS.filter((id) => measured[id] > baseline.components[id].ceiling);
  const lowered = COMPONENT_IDS.filter((id) => measured[id] < baseline.components[id].ceiling);
  const why = reason?.trim() ?? "";
  if (raised.length > 0 && why === "") return { ok: false, error: "reason-required", raised };

  const components = {} as Record<ComponentId, BaselineComponent>;
  for (const id of COMPONENT_IDS) components[id] = { path: baseline.components[id].path, ceiling: measured[id] };
  return {
    ok: true,
    baseline: { schema: 1, unit: "bytes", components, lastReset: { reason: why === "" ? LOWERED_REASON : why } },
    raised,
    lowered,
  };
}
