#!/usr/bin/env node
// workflow-signal.ts - Manually signal workflow events for one or many issues.
//
// Ergonomic front door to the _on_* event system: same dispatch semantics
// the skills and PR tooling use, so rollup, cascade, and the loop guard
// apply automatically. Primary use: deploy-sourced events with no automatic
// observer (staging-deploy, production-deploy); secondary: manual
// corrections. Best-effort per issue: one failure never blocks the rest.
//
// Usage:
//   workflow-signal <event> <issue>... [<event> <issue>... ...]
//   workflow-signal --list
//
// Event names: bare form accepted and normalized (staging-deploy,
// _on_staging_deploy, and _on_begin_review are all valid for that event).

import { parseArgs } from "node:util";
import { basename, join } from "node:path";
import { existsSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { assertNodeFloor } from "../lib/core/node-floor.ts";
import { EXIT_GENERAL_ERROR, EXIT_MISUSE } from "../lib/core/exit-codes.ts";
import { logError } from "../lib/core/logging.ts";
import { onEvent } from "../lib/domain/issues/graph.ts";
import { eventNames } from "../lib/domain/events.ts";
import { select } from "../lib/ui/prompts.ts";

assertNodeFloor();

const VERSION = "1.0.0";
const SCRIPT_NAME = basename(process.argv[1] ?? "workflow-signal");

/** Entry-point root: real tools/internal by default; the
 * WORKFLOW_SIGNAL_TOOLS test seam overrides only where events are looked
 * up. */
function signalToolsRoot(): string {
  const env = process.env["WORKFLOW_SIGNAL_TOOLS"];
  if (env !== undefined && env !== "") return env;
  return join(fileURLToPath(new URL(".", import.meta.url)), "..", "internal");
}

function showUsage(): void {
  console.log(`Usage: ${SCRIPT_NAME}                      (interactive: pick what happened)
       ${SCRIPT_NAME} <event> <issue>... [<event> <issue>... ...]
       ${SCRIPT_NAME} --list

Signal a workflow event for one or many issues. Events pass through the
standard dispatch path, so parent rollup, cascade, and loop-guard rules
apply automatically. Batch by passing multiple issue numbers after an
event, and repeat event/issue groups for mixed batches.

Arguments:
    event                Event name; bare form accepted and normalized
                         (staging-deploy = _on_staging_deploy)
    issue...             One or more issue numbers for that event

Options:
    -h, --help           Show this help message and exit
    -v, --version        Show version information and exit
    -l, --list           List available events and exit

Examples:
    ${SCRIPT_NAME} --list
    ${SCRIPT_NAME} staging-deploy 101 102

    # Mixed batch
    ${SCRIPT_NAME} production-deploy 101 begin-review 105 106`);
}

/** Normalize an event name to the _on_<event> form: bare names with hyphens
 * or underscores, already-prefixed forms, all resolve the same way. */
function normalizeEvent(name: string): string {
  const stripped = name.replace(/^_on_/, "").replaceAll("-", "_");
  return `_on_${stripped}`;
}

/** The event's entry point exists (executable, not the dispatcher itself). */
function entryPointExists(event: string, root: string): boolean {
  const ep = `${root}/${event}.sh`;
  if (basename(ep) === "_on_event_dispatch.sh") return false;
  try {
    return (statSync(ep).mode & 0o111) !== 0;
  } catch {
    return false;
  }
}

/** Every configured event with an executable entry point (the dispatcher
 * excluded). Config order first (skill-events.yml), then any executable
 * entry point not in the config — same union the bash version listed. */
function listEvents(root: string): string[] {
  const configured = eventNames();
  const onDisk = readdirSync(root)
    .filter((f) => f.startsWith("_on_") && f.endsWith(".sh") && f !== "_on_event_dispatch.sh")
    .map((f) => f.replace(/\.sh$/, ""))
    .filter((f) => {
      try {
        return (statSync(join(root, f)).mode & 0o111) !== 0;
      } catch {
        return false;
      }
    });
  return [...new Set([...configured, ...onDisk])];
}

interface EventIssueGroup {
  event: string;
  issues: number[];
}

function parseGroups(argv: string[], root: string): EventIssueGroup[] {
  const groups: EventIssueGroup[] = [];
  let current: EventIssueGroup | null = null;
  for (const arg of argv) {
    if (/^[0-9]+$/.test(arg)) {
      if (current === null) {
        logError(`Issue number '${arg}' appears before any event name`);
        console.error("Use --help for usage information");
        process.exit(EXIT_MISUSE);
      }
      current.issues.push(Number.parseInt(arg, 10));
      continue;
    }
    const normalized = normalizeEvent(arg);
    if (!entryPointExists(normalized, root)) {
      logError(`Unknown event '${arg}' (normalized: '${normalized}'; see --list)`);
      process.exit(EXIT_MISUSE);
    }
    current = { event: normalized, issues: [] };
    groups.push(current);
  }
  return groups;
}

async function interactiveMode(root: string): Promise<void> {
  const events = listEvents(root);
  if (events.length === 0) {
    logError("No event entry points found");
    process.exit(EXIT_GENERAL_ERROR);
  }
  const event = await select({
    message: "What happened?",
    fallback: "",
    options: events.map((e) => ({ value: e, label: e.replace(/^_on_/, "") })),
  });
  if (event === "") {
    console.log("Cancelled.");
    process.exit(0);
  }
  const normalized = normalizeEvent(event);
  console.error(`Signal ${normalized} for which issues (space-separated numbers)? `);
  const line = await readLine();
  const trimmed = line.trim();
  if (trimmed === "") {
    console.log("No issues given.");
    process.exit(0);
  }
  await runGroups(parseGroups([normalized, ...trimmed.split(/\s+/)], root), root);
}

function readLine(): Promise<string> {
  return new Promise((resolve) => {
    let out = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk: string) => {
      out += chunk;
      const nl = out.indexOf("\n");
      if (nl !== -1) {
        resolve(out.slice(0, nl));
        return;
      }
    });
    process.stdin.on("end", () => resolve(out));
  });
}

async function runGroups(groups: EventIssueGroup[], root: string): Promise<void> {
  let didAny = false;
  let rc = 0;
  for (const group of groups) {
    for (const issue of group.issues) {
      didAny = true;
      // Entry-point contract check first (same unknown-event tolerance).
      if (!entryPointExists(group.event, root)) {
        logError(`Unknown event '${group.event}' (see --list)`);
        rc = 1;
        continue;
      }
      const warnings: string[] = [];
      let signalErr = "";
      // Two dispatch modes: with the WORKFLOW_SIGNAL_TOOLS seam set, exec
      // the _on_*.sh entry scripts (the test contract — fakes log their
      // argv); on the real path, dispatch in-process through the graph
      // port (same semantics, no bash hop).
      const seam = process.env["WORKFLOW_SIGNAL_TOOLS"];
      let failed = false;
      if (seam !== undefined && seam !== "") {
        const { spawnSync } = await import("node:child_process");
        const script = join(seam, `${group.event}.sh`);
        const r = spawnSync("bash", [script, String(issue)], { encoding: "utf8" });
        signalErr = (r.stderr ?? "").trim();
        failed = r.status !== 0 || signalErr.includes("workflow write ");
      } else {
        try {
          await onEvent(group.event, issue, {
            onWarning: (m) => {
              warnings.push(m);
              signalErr = m;
            },
          });
          failed = signalErr.includes("workflow write ");
        } catch {
          failed = true;
        }
      }
      if (!failed) {
        console.log(`signalled ${group.event} for issue #${issue}`);
      } else {
        if (signalErr !== "") process.stderr.write(`${signalErr}\n`);
        console.error(
          `WARNING: signal ${group.event} failed for issue #${issue} (best-effort, continuing)`,
        );
        rc = 1;
      }
      void warnings;
    }
  }
  if (!didAny) {
    logError("No issues signalled - each event needs at least one issue number");
    console.error("Use --help for usage information");
    process.exit(EXIT_MISUSE);
  }
  process.exit(rc);
}

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    args: process.argv.slice(2),
    options: {
      help: { type: "boolean", short: "h", default: false },
      version: { type: "boolean", short: "v", default: false },
      list: { type: "boolean", short: "l", default: false },
    },
    strict: true,
    allowPositionals: true,
  });

  const root = signalToolsRoot();
  if (!existsSync(root)) {
    logError(`Event entry-point directory not found: ${root}`);
    process.exit(EXIT_GENERAL_ERROR);
  }

  if (values.help === true) {
    showUsage();
    process.exit(0);
  }
  if (values.version === true) {
    console.log(VERSION);
    process.exit(0);
  }
  if (values.list === true) {
    for (const e of listEvents(root)) console.log(e);
    process.exit(0);
  }

  if (positionals.length === 0) {
    await interactiveMode(root);
    return;
  }
  if (positionals.length < 2) {
    const first = positionals[0] ?? "";
    if (!first.startsWith("-")) {
      if (/^[0-9]+$/.test(first)) {
        logError(`Issue number '${first}' appears before any event name`);
      } else {
        logError("An event requires at least one issue number");
      }
      console.error("Use --help for usage information");
      process.exit(EXIT_MISUSE);
    }
  }
  await runGroups(parseGroups(positionals, root), root);
}

await main();
