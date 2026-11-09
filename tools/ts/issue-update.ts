#!/usr/bin/env node
// issue-update.ts - Update GitHub issue fields (title, body, type, labels,
// assignees, milestone, state) in one edit.
// Version: 1.0.0
// Requirements: Node >= 23.6 (native type-stripping execution)
//
// Run via the depth-1 bash stub: `exec node "<resolved-src>.ts" "$@"`
// The bash tool's --select issue-picker flow is deferred to the ui layer
// (issue-select); this tool takes an explicit issue number.
//
// Contract: at least one update is required (piped stdin with no updates
// auto-reads as the new body); state changes ride the close/reopen verbs
// separately from the field edit. Type normalization follows the config
// vocabulary (issues-config.yml; case-insensitive).

import { basename } from "node:path";
import { existsSync, readFileSync } from "node:fs";

import { EXIT_GENERAL_ERROR, EXIT_MISUSE, EXIT_API_FAILURE } from "../lib/core/exit-codes.ts";
import { logError, logInfo } from "../lib/core/logging.ts";
import { assertNodeFloor } from "../lib/core/node-floor.ts";
import { errorMessage } from "../lib/core/logging.ts";
import { toolCli, usageCommonFlags } from "../lib/core/cli.ts";
import { resolveBodySource } from "../lib/core/body-source.ts";
import { checkTargetRepo, requireRepoTarget, providerRepoTarget } from "../lib/providers/provider-core.ts";
import {
  issuesExists,
  issuesEdit,
  issuesClose,
  issuesReopen,
  blockedByAdd,
  blockedByRemove,
} from "../lib/providers/facade/issues.ts";

assertNodeFloor();

const SCRIPT_VERSION = "1.0.0";
const SCRIPT_NAME = basename(process.argv[1] ?? "issue-update.ts");

const CANONICAL_TYPES = ["Bug", "Feature", "Task", "Epic"];
const TYPE_ALIASES: Record<string, string> = {
  defect: "Bug", bugfix: "Bug",
  enhancement: "Feature", feature: "Feature", story: "Feature",
  task: "Task", chore: "Task",
  epic: "Epic",
};

function showUsage(): never {
  console.log(`Usage: ${SCRIPT_NAME} ISSUE_NUMBER [OPTIONS]

Update GitHub issue fields in a single edit.

Options:
    -t, --title TEXT            New title
    -b, --body TEXT             New body
    -f, --body-file FILE        New body from file ('-' reads stdin)
    --type TYPE                 Set the native issue type (normalized)
    --remove-type               Remove the native issue type
    --add-label LABEL           Add a label (repeatable)
    --remove-label LABEL        Remove a label (repeatable)
    --add-assignee USER         Add an assignee (repeatable)
    --remove-assignee USER      Remove an assignee (repeatable)
    -m, --milestone NAME        Set milestone ("none" clears)
    -s, --state STATE           close|closed closes; open|reopen reopens
    --add-blocked-by N          Record N as blocking this issue (repeatable;
                                idempotent). GitHub: the blocked-by body
                                section; Azure: predecessor links.
    --remove-blocked-by N       Un-record N (repeatable; removing an absent
                                link is a no-op)
${usageCommonFlags()}

Examples:
    ${SCRIPT_NAME} 123 --title "Updated title"
    ${SCRIPT_NAME} 123 --add-label "priority:high" --add-assignee "@me"
    ${SCRIPT_NAME} 123 --state closed
`);
  process.exit(0);
}

function normalizeIssueType(input: string): string | null {
  const lowered = input.toLowerCase();
  for (const t of CANONICAL_TYPES) {
    if (lowered === t.toLowerCase()) return t;
  }
  return TYPE_ALIASES[lowered] ?? null;
}

async function main(argv: string[]): Promise<number> {
  let issueNumber = "";
  let newTitle = "";
  let newBody = "";
  let newBodyFile = "";
  let newType = "";
  let removeType = false;
  const addLabels: string[] = [];
  const removeLabels: string[] = [];
  const addAssignees: string[] = [];
  const removeAssignees: string[] = [];
  const addBlockedBy: string[] = [];
  const removeBlockedBy: string[] = [];
  let newMilestone = "";
  let newState = "";
  let dryRun = false;
  let devenv = false;

  // Leading issue number (before flags), matching the bash tool's parse.
  let rest = argv;
  if (rest.length > 0 && /^[0-9]+$/.test(rest[0] ?? "")) {
    issueNumber = rest[0] ?? "";
    rest = rest.slice(1);
  }

  try {
    const cli = toolCli({
      name: SCRIPT_NAME,
      version: SCRIPT_VERSION,
      argv: rest,
      allowPositionals: false,
      options: {
        "dry-run": { type: "boolean", short: "n", default: false },
        title: { type: "string", short: "t" },
        body: { type: "string", short: "b" },
        "body-file": { type: "string", short: "f" },
        type: { type: "string" },
        "remove-type": { type: "boolean", default: false },
        "add-label": { type: "string" },
        "remove-label": { type: "string" },
        "add-assignee": { type: "string" },
        "remove-assignee": { type: "string" },
        "add-blocked-by": { type: "string" },
        "remove-blocked-by": { type: "string" },
        milestone: { type: "string", short: "m" },
        state: { type: "string", short: "s" },
      },
    });
    if (cli.common.help) showUsage();
    const values = cli.values as Record<string, string | boolean | string[] | undefined>;
    dryRun = cli.common.dryRun;
    devenv = cli.common.devenv;
    newTitle = ((values["title"] as string | undefined) ?? "");
    newBody = ((values["body"] as string | undefined) ?? "");
    newBodyFile = ((values["body-file"] as string | undefined) ?? "");
    newType = ((values["type"] as string | undefined) ?? "");
    removeType = values["remove-type"] === true;
    const pull = (k: "add-label" | "remove-label" | "add-assignee" | "remove-assignee" | "add-blocked-by" | "remove-blocked-by"): string[] => {
      const v = values[k];
      if (v === undefined) return [];
      return Array.isArray(v) ? v.map(String) : [String(v)];
    };
    addLabels.push(...pull("add-label"));
    removeLabels.push(...pull("remove-label"));
    addAssignees.push(...pull("add-assignee"));
    removeAssignees.push(...pull("remove-assignee"));
    addBlockedBy.push(...pull("add-blocked-by"));
    removeBlockedBy.push(...pull("remove-blocked-by"));
    newMilestone = ((values["milestone"] as string | undefined) ?? "");
    newState = ((values["state"] as string | undefined) ?? "");
  } catch (err) {
    logError(errorMessage(err));
    console.log("Use --help for usage information");
    return EXIT_MISUSE;
  }

  if (issueNumber === "") {
    logError("Issue number is required");
    console.log("Use --help for usage information");
    return EXIT_MISUSE;
  }

  checkTargetRepo(devenv);

  const repo = requireRepoTarget(providerRepoTarget(""), "issue-update", "issues");
  const num = Number.parseInt(issueNumber, 10);

  // Type validation is parse-level: a wrong type is refused before any
  // network call, let alone a mutation.
  let normalizedType: string | null = null;
  if (!removeType && newType !== "") {
    normalizedType = normalizeIssueType(newType);
    if (normalizedType === null) {
      logError(`Invalid issue type: ${newType} (allowed: ${CANONICAL_TYPES.join(", ")})`);
      return EXIT_GENERAL_ERROR;
    }
  }

  // Verify existence (all update paths mutate).
  if (!(await issuesExists(repo, num))) {
    logError(`Issue #${issueNumber} not found`);
    return EXIT_API_FAILURE;
  }

  // Blocked-by validation: numbers must parse and the blockers must exist.
  // Parse errors are misuse; a missing blocker is an API failure — both
  // refuse BEFORE any mutation.
  const parseBlockers = (raw: string[]): number[] | null => {
    const out: number[] = [];
    for (const r of raw) {
      if (!/^[0-9]+$/.test(r)) {
        logError(`Invalid blocked-by reference: ${r} (expected an issue number)`);
        return null;
      }
      out.push(Number.parseInt(r, 10));
    }
    return out;
  };
  const addBlockers = parseBlockers(addBlockedBy);
  const removeBlockers = parseBlockers(removeBlockedBy);
  if (addBlockers === null || removeBlockers === null) return EXIT_MISUSE;
  for (const b of [...addBlockers, ...removeBlockers]) {
    if (!(await issuesExists(repo, b))) {
      logError(`Blocked-by target #${b} not found`);
      return EXIT_API_FAILURE;
    }
  }
  const blockedByGiven = addBlockers.length > 0 || removeBlockers.length > 0;

  let hasUpdates = false;
  if (newTitle !== "") hasUpdates = true;

  if (removeType) {
    hasUpdates = true;
  } else if (newType !== "") {
    hasUpdates = true;
  }

  if (newBody !== "") {
    hasUpdates = true;
  } else if (newBodyFile !== "") {
    // The shared resolver owns the read and the uniform empty refusal
    // (including the '-' leg — an empty pipe must never blank the body).
    const resolved = resolveBodySource({ file: newBodyFile });
    if (!resolved.ok) {
      logError(resolved.error.message);
      console.log("Use --help for usage information");
      return resolved.error.code === "file-not-found" ? EXIT_API_FAILURE : EXIT_MISUSE;
    }
    newBody = resolved.body;
    hasUpdates = true;
  }
  if (addLabels.length > 0 || removeLabels.length > 0) hasUpdates = true;
  if (addAssignees.length > 0 || removeAssignees.length > 0) hasUpdates = true;
  // "none" is the documented clear token: it translates to gh's empty-string
  // removal form and counts as an update; a plain value sets the milestone.
  const milestoneGiven = newMilestone !== "";
  if (newMilestone === "none") newMilestone = "";
  if (milestoneGiven) hasUpdates = true;
  if (blockedByGiven) hasUpdates = true;

  if (!hasUpdates && newState === "") {
    if (!process.stdin.isTTY) {
      const resolved = resolveBodySource({});
      if (!resolved.ok) {
        logError(resolved.error.message);
        console.log("Use --help for usage information");
        return EXIT_MISUSE;
      }
      newBody = resolved.body;
      hasUpdates = true;
    } else {
      logError("No updates specified");
      console.log("Use --help for usage information");
      return EXIT_MISUSE;
    }
  }

  if (hasUpdates) {
    if (dryRun) {
      logInfo(`[DRY RUN] Would edit issue #${issueNumber}`);
    } else {
      try {
        await issuesEdit(repo, num, {
          ...(newTitle !== "" ? { title: newTitle } : {}),
          ...(removeType ? {} : normalizedType !== null ? { type: normalizedType } : {}),
          ...(newBody !== "" ? { body: newBody } : {}),
          ...(addLabels.length > 0 ? { addLabel: addLabels } : {}),
          ...(removeLabels.length > 0 ? { removeLabel: removeLabels } : {}),
          ...(addAssignees.length > 0 ? { addAssignee: addAssignees } : {}),
          ...(removeAssignees.length > 0 ? { removeAssignee: removeAssignees } : {}),
          ...(milestoneGiven ? { milestone: newMilestone } : {}),
        });
        logInfo(`Updated issue #${issueNumber}`);
      } catch (err) {
        logError(`Failed to update issue #${issueNumber}: ${errorMessage(err)}`);
        return 1;
      }
    }
  }

  if (blockedByGiven) {
    if (dryRun) {
      for (const b of addBlockers) logInfo(`[DRY RUN] Would record #${issueNumber} blocked by #${b}`);
      for (const b of removeBlockers) logInfo(`[DRY RUN] Would un-record #${issueNumber} blocked by #${b}`);
    } else {
      try {
        if (addBlockers.length > 0) {
          await blockedByAdd(repo, num, addBlockers);
          for (const b of addBlockers) logInfo(`Recorded #${issueNumber} blocked by #${b}`);
        }
        if (removeBlockers.length > 0) {
          await blockedByRemove(repo, num, removeBlockers);
          for (const b of removeBlockers) logInfo(`Un-recorded #${issueNumber} blocked by #${b}`);
        }
      } catch (err) {
        logError(`Failed to update blocked-by on #${issueNumber}: ${errorMessage(err)}`);
        return 1;
      }
    }
  }

  if (newState !== "") {
    const lower = newState.toLowerCase();
    if (["closed", "close"].includes(lower)) {
      if (dryRun) {
        logInfo(`[DRY RUN] Would close issue #${issueNumber}`);
      } else {
        try {
          await issuesClose(repo, num);
          logInfo(`Closed issue #${issueNumber}`);
        } catch (err) {
          logError(`Failed to close issue #${issueNumber}: ${errorMessage(err)}`);
          return 1;
        }
      }
    } else if (["open", "reopen"].includes(lower)) {
      if (dryRun) {
        logInfo(`[DRY RUN] Would reopen issue #${issueNumber}`);
      } else {
        try {
          await issuesReopen(repo, num);
          logInfo(`Reopened issue #${issueNumber}`);
        } catch (err) {
          logError(`Failed to reopen issue #${issueNumber}: ${errorMessage(err)}`);
          return 1;
        }
      }
    } else {
      logError(`Invalid state: ${newState} (use close|closed or open|reopen)`);
      return EXIT_MISUSE;
    }
  }

  return 0;
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (err: unknown) => {
    logError(errorMessage(err));
    process.exit(EXIT_GENERAL_ERROR);
  },
);
