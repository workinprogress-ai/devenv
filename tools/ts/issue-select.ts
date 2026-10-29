#!/usr/bin/env node
// issue-select.ts - Interactive GitHub issue selection (fzf in the bash
// tool; clack multi-select per design decision D4 here — the ui layer is
// the ONLY place interaction lives).
// Version: 1.0.0
// Requirements: Node >= 23.6 (native type-stripping execution)
//
// Run via the depth-1 bash stub: `exec node "<resolved-src>.ts" "$@"`
//
// Contract: prints selected issue number(s) to stdout, one per line;
// exit 1 when selection is cancelled or nothing matched. Non-TTY runs
// fail defined (the picker cannot render).

import { parseArgs } from "node:util";
import {basename} from "node:path";
import {} from "node:fs";

import { EXIT_GENERAL_ERROR, EXIT_MISUSE } from "../lib/core/exit-codes.ts";
import { logError } from "../lib/core/logging.ts";
import { assertNodeFloor } from "../lib/core/node-floor.ts";
import { checkTargetRepo, requireRepoTarget, providerRepoTarget } from "../lib/providers/provider-core.ts";
import { normalizeIssueType } from "../lib/domain/issues/types.ts";
import { issuesList, issuesView } from "../lib/providers/github/issues.ts";
import { select, multiSelect, isInteractive } from "../lib/ui/prompts.ts";

assertNodeFloor();

const SCRIPT_VERSION = "1.0.0";
const SCRIPT_NAME = basename(process.argv[1] ?? "issue-select.ts");

function showUsage(): never {
  console.log(`Usage: ${SCRIPT_NAME} [OPTIONS]

Interactive GitHub issue selection (fzf in the bash tool; the clack picker here).

Filters:
    -s, --state STATE           Filter by state: open, closed, or all (default: open)
    -t, --type TYPE             Filter by native issue type (case-insensitive)
    -m, --milestone NAME        Filter by milestone
    -l, --label LABEL           Filter by label

Selection:
    -M, --multi                 Enable multi-select mode
    -f, --format FORMAT         Output format: number, url, or json (default: number)
    --devenv                    Safety override to select issues in devenv repo

Output:
    Prints selected issue number(s) to stdout, one per line.
    Returns exit code 1 if selection is cancelled.
`);
  process.exit(0);
}

interface Listed {
  number: number;
  title: string;
  state?: string;
  url?: string;
  labels?: Array<{ name?: unknown }>;
}

async function main(argv: string[]): Promise<number> {
  let state = "open";
  let type = "";
  let milestone = "";
  let label = "";
  let multi = false;
  let format = "number";
  let devenv = false;
  try {
    const { values } = parseArgs({
      args: argv,
      options: {
        help: { type: "boolean", short: "h", default: false },
        version: { type: "boolean", short: "v", default: false },
        state: { type: "string", short: "s", default: "open" },
        type: { type: "string", short: "t" },
        milestone: { type: "string", short: "m" },
        label: { type: "string", short: "l" },
        multi: { type: "boolean", short: "M", default: false },
        format: { type: "string", short: "f", default: "number" },
        devenv: { type: "boolean", default: false },
      },
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
    milestone = values["milestone"] ?? "";
    label = values["label"] ?? "";
    multi = Boolean(values["multi"]);
    format = values["format"] ?? "number";
    devenv = Boolean(values["devenv"]);
  } catch (err) {
    logError(err instanceof Error ? err.message : String(err));
    console.log("Use --help for usage information");
    return EXIT_MISUSE;
  }

  checkTargetRepo(devenv);

  if (!isInteractive()) {
    logError("Issue selection requires an interactive terminal (no TTY detected)");
    return EXIT_MISUSE;
  }

  const repo = requireRepoTarget(providerRepoTarget(""), "issue-select", "issues");

  let raw: string;
  try {
    raw = await issuesList(repo, {
      state: (state as "open" | "closed" | "all") || "open",
      ...(type !== "" ? { type } : {}),
      ...(milestone !== "" ? { milestone } : {}),
      ...(label !== "" ? { label: [label] } : {}),
      json: "number,title,state",
    });
  } catch (err) {
    logError(`Failed to list issues: ${err instanceof Error ? err.message : String(err)}`);
    return EXIT_GENERAL_ERROR;
  }

  let issues: Listed[];
  try {
    issues = JSON.parse(raw) as Listed[];
  } catch {
    logError("Failed to parse issue list");
    return EXIT_GENERAL_ERROR;
  }
  if (issues.length === 0) {
    logError("No issues found matching the filters");
    return EXIT_GENERAL_ERROR;
  }

  const options = issues.map((i) => ({
    value: String(i.number),
    label: `#${i.number} ${i.title}`,
  }));

  let picked: string | string[] | symbol;
  if (multi) {
    picked = await multiSelect<string>({ message: "Select issue(s)", options, fallback: [] });
  } else {
    picked = await select<string>({ message: "Select issue", options, fallback: "" });
  }
  if (typeof picked === "symbol" || picked === undefined || picked === "") {
    // Selection cancelled.
    return 1;
  }
  const numbers = Array.isArray(picked) ? picked : [picked];

  for (const num of numbers) {
    if (format === "number") {
      console.log(num);
    } else if (format === "url") {
      try {
        const out = await issuesView(repo, Number.parseInt(num, 10), { json: "url", jq: ".url" });
        console.log(out.trim());
      } catch {
        console.log(num);
      }
    } else if (format === "json") {
      try {
        const out = await issuesView(repo, Number.parseInt(num, 10), { json: "number,title,url,state,labels" });
        console.log(out.trim());
      } catch {
        console.log(num);
      }
    } else {
      console.log(num);
    }
  }
  return 0;
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (err: unknown) => {
    logError(err instanceof Error ? err.message : String(err));
    process.exit(EXIT_GENERAL_ERROR);
  },
);
