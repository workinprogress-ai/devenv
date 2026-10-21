#!/usr/bin/env node
// issue-list.ts - List and filter GitHub issues
// Version: 1.0.0
// Description: Query and filter GitHub issues with support for labels, assignees,
//              milestones, state, and custom formatting.
// Requirements: Node >= 23.6 (native type-stripping execution)
//
// Run via the depth-1 bash stub: `exec node "<resolved-src>.ts" "$@"`
//
// Output contract: table = gh's own pretty format (pass-through); json =
// a fixed field set; simple = `#N - Title` lines. --web opens the browser
// (no listing).

import { parseArgs } from "node:util";
import {basename} from "node:path";
import {} from "node:fs";
import { spawnSync } from "node:child_process";

import { EXIT_GENERAL_ERROR, EXIT_MISUSE } from "../lib/core/exit-codes.ts";
import { logError } from "../lib/core/logging.ts";
import { assertNodeFloor } from "../lib/core/node-floor.ts";
import { isDevenvRepoGated, providerRepoTarget } from "../lib/providers/provider-core.ts";
import { issuesList } from "../lib/providers/github/issues.ts";
import { normalizeIssueType } from "../lib/domain/issues/types.ts";

assertNodeFloor();

const SCRIPT_VERSION = "1.0.0";
const SCRIPT_NAME = basename(process.argv[1] ?? "issue-list.ts");

function showUsage(): never {
  console.log(`Usage: ${SCRIPT_NAME} [OPTIONS]

List and filter GitHub issues.

Filters:
    -s, --state STATE           Filter by state: open, closed, or all (default: open)
    -t, --type TYPE             Filter by native issue type (case-insensitive)
    -l, --label LABEL           Filter by label (can be specified multiple times)
    -a, --assignee USER         Filter by assignee (use "none" for unassigned)
    -m, --milestone NAME        Filter by milestone (use "none" for no milestone)
    --author USER               Filter by author
    --mention USER              Filter by mentioned user

Output:
    -f, --format FORMAT         Output format: table, json, simple (default: table)
    -n, --limit NUMBER          Limit number of results (default: 30)
    --web                       Open results in web browser
    --devenv                    Safety override to list issues in devenv repo

Examples:
    ${SCRIPT_NAME}
    ${SCRIPT_NAME} --state all --label bug
    ${SCRIPT_NAME} --type Task --milestone "Sprint 5" --web
`);
  process.exit(0);
}

function checkTargetRepo(allowDevenv: boolean): void {
  const r = spawnSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" });
  if (r.status !== 0) {
    logError("Not in a git repository");
    process.exit(1);
  }
  if (!isDevenvRepoGated()) return;
  if (process.env["DEVENV_REPO"] !== undefined && process.env["DEVENV_REPO"] !== "") return;
  if (allowDevenv) return;
  logError("The current repository appears to be the devenv repository itself");
  console.log("Operations should be performed in target project repositories, not in devenv");
  console.log("To target a project repo, prefix the command with DEVENV_REPO=<owner>/<repo>");
  console.log("To override this safety check (devenv-repo work only), pass the --devenv flag");
  process.exit(1);
}

async function main(argv: string[]): Promise<number> {
  let state = "open";
  let type = "";
  const labels: string[] = [];
  let assignee = "";
  let milestone = "";
  let author = "";
  let mention = "";
  let format = "table";
  let limit = 30;
  let web = false;
  let devenv = false;
  try {
    const { values } = parseArgs({
      args: argv,
      options: {
        help: { type: "boolean", short: "h", default: false },
        version: { type: "boolean", short: "v", default: false },
        state: { type: "string", short: "s", default: "open" },
        type: { type: "string", short: "t" },
        label: { type: "string", short: "l" },
        assignee: { type: "string", short: "a" },
        milestone: { type: "string", short: "m" },
        author: { type: "string" },
        mention: { type: "string" },
        format: { type: "string", short: "f", default: "table" },
        limit: { type: "string", short: "n", default: "30" },
        web: { type: "boolean", default: false },
        devenv: { type: "boolean", default: false },
      },
      allowPositionals: false,
      strict: true,
    });
    if (values["help"]) showUsage();
    if (values["version"]) {
      console.log(SCRIPT_VERSION);
      return 0;
    }
    state = values["state"] ?? "open";
    type = values["type"] ?? "";
    if (type !== "") {
      const normalized = normalizeIssueType(type);
      if (normalized === null) {
        logError(`Invalid issue type: ${type} (allowed: Bug, Feature, Task, Epic)`);
        return EXIT_GENERAL_ERROR;
      }
      type = normalized;
    }
    if (values["label"] !== undefined) {
      const lv = values["label"];
      if (Array.isArray(lv)) labels.push(...lv.map(String));
      else labels.push(String(lv));
    }
    assignee = values["assignee"] ?? "";
    milestone = values["milestone"] ?? "";
    author = values["author"] ?? "";
    mention = values["mention"] ?? "";
    format = values["format"] ?? "table";
    limit = Number.parseInt(values["limit"] ?? "30", 10);
    web = Boolean(values["web"]);
    devenv = Boolean(values["devenv"]);
  } catch (err) {
    logError(err instanceof Error ? err.message : String(err));
    console.log("Use --help for usage information");
    return EXIT_MISUSE;
  }

  checkTargetRepo(devenv);

  const repo = providerRepoTarget("");

  if (web) {
    try {
      await issuesList(undefined, { web: true });
    } catch (err) {
      logError(`Failed to open the issue list: ${err instanceof Error ? err.message : String(err)}`);
      return 1;
    }
    return 0;
  }

  if (!["table", "json", "simple"].includes(format)) {
    logError(`Invalid format: ${format} (must be table, json, or simple)`);
    return EXIT_MISUSE;
  }

  try {
    const out = await issuesList(repo, {
      state: (state as "open" | "closed" | "all") || "open",
      ...(type !== "" ? { type } : {}),
      ...(labels.length > 0 ? { label: labels } : {}),
      ...(assignee !== "" ? { assignee: [assignee] } : {}),
      ...(milestone !== "" ? { milestone } : {}),
      ...(author !== "" ? { author } : {}),
      ...(mention !== "" ? { mention } : {}),
      limit,
      ...(format === "json"
        ? { json: "number,title,state,labels,assignees,milestone,createdAt,updatedAt,url" }
        : format === "simple"
          ? { json: "number,title" }
          : {}),
    });
    if (format === "simple") {
      const items = JSON.parse(out) as Array<{ number: number; title: string }>;
      for (const i of items) console.log(`#${i.number} - ${i.title}`);
    } else {
      console.log(out);
    }
    return 0;
  } catch (err) {
    logError(`Failed to list issues: ${err instanceof Error ? err.message : String(err)}`);
    return 1;
  }
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (err: unknown) => {
    logError(err instanceof Error ? err.message : String(err));
    process.exit(1);
  },
);
