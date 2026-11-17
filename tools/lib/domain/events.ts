// events.ts — the _on_* skill event system (merge of pr-events.bash and
// skill-events.bash).
//
// Two halves:
//  - write side (from pr-events.bash): local PR tooling fires signals at its
//    success points. Best-effort by contract: firing never fails a caller,
//    never alters exit codes, and double-firing is safe. Web-UI merges fire
//    nothing — the user owns status changes made outside local tooling.
//  - read side (from skill-events.bash): the event→Status mapping from
//    tools/config/skill-events.yml. Unknown events never abort a skill —
//    callers treat unknown as warn-and-continue.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { prsView } from "../providers/facade/prs.ts";
import { resolveToolsRoot } from "../core/self-root.ts";
import { fileURLToPath } from "node:url";

// ---------------------------------------------------------------------------
// read side: the event → Status map (config/skill-events.yml)
// ---------------------------------------------------------------------------

export interface EventConfig {
  event: string;
  status: string;
}

/** The skill-events.yml path, resolved via the self-root contract. */
export function skillEventsConfigPath(): string {
  return join(resolveToolsRoot(fileURLToPath(import.meta.url)), "config", "skill-events.yml");
}

/**
 * The Status token configured for EVENT, or null when unknown/unconfigured.
 * Callers treat null as warn-and-continue.
 */
export function eventStatusFor(event: string): string | null {
  const config = skillEventsConfigPath();
  if (!existsSync(config)) return null;
  const lines = readFileSync(config, "utf8").split("\n");
  let inEvent = false;
  for (const line of lines) {
    if (line.startsWith(`  ${event}:`)) {
      inEvent = true;
      continue;
    }
    if (inEvent) {
      if (line.startsWith("    status:")) {
        const status = line.replace(/^    status:\s*/, "").trim();
        return status === "" ? null : status;
      }
      if (/^  \S/.test(line)) inEvent = false; // next event key
    }
  }
  return null;
}

/** All configured event names, one per line-order. Empty when unreadable. */
export function eventNames(): string[] {
  const config = skillEventsConfigPath();
  if (!existsSync(config)) return [];
  const names: string[] = [];
  let inEvents = false;
  for (const line of readFileSync(config, "utf8").split("\n")) {
    if (line.startsWith("events:")) {
      inEvents = true;
      continue;
    }
    if (!inEvents) continue;
    if (line.startsWith("    ")) continue; // nested keys (status:)
    if (/^  \S/.test(line)) {
      names.push(line.replace(/^  /, "").replace(/:$/, ""));
      continue;
    }
    if (/^\S/.test(line)) break; // left the events map
  }
  return names;
}

// ---------------------------------------------------------------------------
// write side: fire signals for PR lifecycle points
// ---------------------------------------------------------------------------

export type PrLifecyclePoint = "created" | "merged";

/** The event a PR lifecycle point maps to; null for an unknown point. */
export function prEventFor(point: PrLifecyclePoint): string | null {
  switch (point) {
    case "created": return "_on_begin_review";
    case "merged": return "_on_merge";
  }
}

/**
 * Issue numbers linked in a PR body (closing keywords: closes/fixes/resolves
 * in their forms, optional colon). Deduplicated, capped at 10.
 */
export function parseLinkedIssues(prBody: string): string[] {
  const matches = prBody.matchAll(
    /(?:^|\s)(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?):?\s+#(\d+)/gi,
  );
  const seen = new Set<string>();
  for (const m of matches) {
    if (m[1]) seen.add(m[1]!);
    if (seen.size >= 10) break;
  }
  return [...seen];
}

export interface SignalResult {
  fired: Array<{ event: string; issue: string }>;
  warnings: string[];
}

/**
 * Fire a signal for every issue linked in the given PR body, via the
 * internal/_on_<event>.sh entry points (self-root resolved). Best-effort
 * contract: always succeeds from the caller's perspective; per-issue failures
 * land in `warnings` and never throw.
 */
export function signalPrEvents(
  point: PrLifecyclePoint,
  prBody: string,
): SignalResult {
  const result: SignalResult = { fired: [], warnings: [] };
  const event = prEventFor(point);
  if (event === null) return result;

  const issues = parseLinkedIssues(prBody);
  if (issues.length === 0) return result;

  const toolsDir = resolveToolsRoot(fileURLToPath(import.meta.url));
  for (const issue of issues) {
    const script = join(toolsDir, "internal", `${event}.sh`);
    const r = spawnSignal(script, issue);
    if (r) {
      result.fired.push({ event, issue });
    } else {
      result.warnings.push(
        `event signal ${event} failed for issue #${issue} (best-effort, continuing)`,
      );
    }
  }
  return result;
}

/**
 * Fetch a PR body through the provider facade and signal. Quiet failure
 * (no PR / no permissions): returns an empty result.
 */
export async function signalPrEventsForPr(
  point: PrLifecyclePoint,
  prNumber: string,
  repoSpec = "",
): Promise<SignalResult> {
  let body = "";
  try {
    const view = await prsView(repoSpec === "" ? undefined : repoSpec, Number.parseInt(prNumber, 10), { json: "body" });
    body = (JSON.parse(view.stdout) as { body?: string }).body ?? "";
  } catch {
    return { fired: [], warnings: [] };
  }
  if (body.trim() === "") return { fired: [], warnings: [] };
  return signalPrEvents(point, body);
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function spawnSignal(script: string, issue: string): boolean {
  const r = spawnSync("bash", [script, issue], { stdio: "ignore" });
  return r.status === 0;
}
