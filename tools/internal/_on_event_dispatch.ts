#!/usr/bin/env node
// _on_event_dispatch.ts - Dispatcher for the _on_* skill event tooling class.
//
// CONTRACT:
//   _on_event_dispatch.ts <event-name> <issue-number>
//
// Behavior (all pinned by grooming decisions, carried over from the bash
// dispatcher verbatim):
// - Delegates to onEvent in domain/issues/graph.ts, which owns resolution
//   (vocabulary: tools/config/skill-events.yml + config order), writing,
//   and propagation
// - Fans the write out via project-update-issue --all-projects --safe
//   (strict-default + --safe; skip-and-report on unreadable projects)
// - BEST-EFFORT: any failure prints a warning and exits 0 —
//   status plumbing never blocks skill work. Transitions are idempotent
//   (fixed values), so a later signal repairs drift from a failed run.
// - Unknown event: warn + exit 0 (schema tolerance)
// - Skills call the _on_* entry scripts; they never read the config,
//   never name projects, never contain Status vocabulary.
//
// The tools/internal/_on_<event>.sh entry scripts (no depth-1
// entries) exec into this dispatcher.
//
// Trigger points: skills invoke these at lifecycle boundaries; local PR
// tooling fires _on_begin_review on PR open and _on_merge on merge for
// linked issues. Best-effort + idempotent: double-firing is safe.

import { assertNodeFloor } from "../lib/core/node-floor.ts";
import { logError } from "../lib/core/logging.ts";
import { onEvent } from "../lib/domain/issues/graph.ts";

assertNodeFloor();

const [event, issueArg] = process.argv.slice(2);
if (event === undefined || issueArg === undefined || event === "" || issueArg === "") {
  logError("Usage: _on_event_dispatch.ts <event-name> <issue-number>");
  process.exit(1);
}
const issue = Number.parseInt(issueArg, 10);
if (!Number.isFinite(issue)) {
  logError(`Issue number '${issueArg}' is not a number`);
  process.exit(1);
}

// Best-effort by contract: onEvent never throws past its warnings, but any
// unexpected failure still must not block skill work (exit 0).
try {
  await onEvent(event, issue);
} catch (err) {
  console.error(
    `WARNING: event dispatch failed for '${event}' issue #${issue}: ${
      err instanceof Error ? err.message : String(err)
    } (best-effort, continuing)`,
  );
}
process.exit(0);
