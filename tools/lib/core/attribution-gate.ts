// attribution-gate.ts — the one call every tool that posts body text makes
// before it reaches the tracker: AI attribution is rejected, because every
// change is attributed to the human who owns it. The patterns live in
// attribution-patterns.ts, shared with repo-commit and the commit hooks.
//
// The helper logs and reports; it never exits, so each tool keeps its own
// control flow. A caller that gets `true` stops with EXIT_MISUSE (the body is
// an invalid argument value) before any provider call.
//
// Strip-only compatible: no parameter properties, enums, or namespaces.

import { attributionRejection, findAttribution } from "./attribution-patterns.ts";
import { logError } from "./logging.ts";

/**
 * True when `body` carries AI attribution, after logging the instruction-style
 * rejection. `subject` names the kind of text ("issue body", "pull request
 * comment") so the message reads naturally.
 */
export function rejectAttribution(body: string, subject: string): boolean {
  const hits = findAttribution(body);
  if (hits.length === 0) return false;
  logError(attributionRejection(hits, subject));
  return true;
}
