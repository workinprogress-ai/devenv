#!/usr/bin/env node
// issue-search.ts - Search GitHub issues by keyword
// Version: 1.0.0
// Description: Fetch title+body per scope filters, match any term case-insensitively
//              (substring), rank by distinct-term hit count.
// Requirements: Node >= 23.6 (native type-stripping execution)
//
// Run via the depth-1 bash stub: `exec node "<resolved-src>.ts" "$@"`
//
// Matching is substring (lowercased contains), not regex — metacharacters
// in terms match literally, no escaping hazards (the bash port's contract).

import { parseArgs } from "node:util";
import { basename } from "node:path";
import {} from "node:fs";

import { EXIT_GENERAL_ERROR, EXIT_MISUSE } from "../lib/core/exit-codes.ts";
import { logError } from "../lib/core/logging.ts";
import { assertNodeFloor } from "../lib/core/node-floor.ts";
import { checkTargetRepo, requireRepoTarget, providerRepoTarget } from "../lib/providers/provider-core.ts";
import { normalizeIssueType } from "../lib/domain/issues/types.ts";
import { issuesList } from "../lib/providers/github/issues.ts";

assertNodeFloor();

const SCRIPT_VERSION = "1.0.0";
const SCRIPT_NAME = basename(process.argv[1] ?? "issue-search.ts");

interface SearchHit {
  number: number;
  title: string;
  state: string;
  url: string;
  matchedTerms: string[];
  matchCount: number;
}

function showUsage(): never {
  console.log(`Usage: ${SCRIPT_NAME} [OPTIONS] TERM...

Search GitHub issues by keyword: any term matching (case-insensitive substring)
in the title or body counts as a hit; results rank by distinct-term match count.

Filters:
    -s, --state STATE           Filter by state (default: all)
    -t, --type TYPE             Filter by native issue type
    -l, --label LABEL           Filter by label (repeatable)
    -a, --assignee USER         Filter by assignee
    -m, --milestone NAME        Filter by milestone

Output:
    -f, --format FORMAT         table (default), json, simple
    -n, --limit NUMBER          Maximum results (default: 30)
    --fetch-limit N             Issues to fetch before ranking (default: 200)

Examples:
    ${SCRIPT_NAME} token expiry
    ${SCRIPT_NAME} --label "area/auth" token expiry
`);
  process.exit(0);
}

async function main(argv: string[]): Promise<number> {
  let state = "all";
  let type = "";
  const labels: string[] = [];
  let assignee = "";
  let milestone = "";
  let format = "table";
  let limit = 30;
  let fetchLimit = 200;
  let devenv = false;
  const terms: string[] = [];

  // Terms are the positionals after the options; `--` handling is native.
  try {
    const { values, positionals } = parseArgs({
      args: argv,
      options: {
        help: { type: "boolean", short: "h", default: false },
        version: { type: "boolean", short: "v", default: false },
        state: { type: "string", short: "s", default: "all" },
        type: { type: "string", short: "t" },
        label: { type: "string", short: "l" },
        assignee: { type: "string", short: "a" },
        milestone: { type: "string", short: "m" },
        format: { type: "string", short: "f", default: "table" },
        limit: { type: "string", short: "n", default: "30" },
        "fetch-limit": { type: "string", default: "200" },
        devenv: { type: "boolean", default: false },
      },
      allowPositionals: true,
      strict: true,
    });
    state = values["state"] ?? "all";
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
    format = values["format"] ?? "table";
    limit = Number.parseInt(values["limit"] ?? "30", 10);
    fetchLimit = Number.parseInt(values["fetch-limit"] ?? "200", 10);
    devenv = Boolean(values["devenv"]);
    terms.push(...positionals);
  } catch (err) {
    logError(err instanceof Error ? err.message : String(err));
    console.log("Use --help for usage information");
    return EXIT_MISUSE;
  }

  if (argv.includes("-h") || argv.includes("--help")) showUsage();
  if (argv.includes("-v") || argv.includes("--version")) {
    console.log(SCRIPT_VERSION);
    return 0;
  }

  if (terms.length === 0) {
    logError("At least one search term is required");
    console.log("Use --help for usage information");
    return EXIT_MISUSE;
  }

  checkTargetRepo(devenv);

  const repo = requireRepoTarget(providerRepoTarget(""), "issue-search", "issues");

  let raw: string;
  try {
    raw = await issuesList(repo, {
      state: (state as "open" | "closed" | "all") || "open",
      ...(type !== "" ? { type } : {}),
      ...(labels.length > 0 ? { label: labels } : {}),
      ...(assignee !== "" ? { assignee: [assignee] } : {}),
      ...(milestone !== "" ? { milestone } : {}),
      json: "number,title,body,state,url",
      limit: fetchLimit,
    });
  } catch (err) {
    logError(`Failed to list issues: ${err instanceof Error ? err.message : String(err)}`);
    return 1;
  }

  let issues: Array<{ number: number; title: string; body?: string; state: string; url: string }>;
  try {
    issues = JSON.parse(raw) as typeof issues;
  } catch {
    logError("Failed to parse issue list");
    return 1;
  }

  const loweredTerms = terms.map((t) => t.toLowerCase());
  const hits: SearchHit[] = [];
  for (const issue of issues) {
    const haystack = `${issue.title} ${issue.body ?? ""}`.toLowerCase();
    const matched = loweredTerms.filter((t) => haystack.includes(t));
    if (matched.length === 0) continue;
    hits.push({
      number: issue.number,
      title: issue.title,
      state: issue.state,
      url: issue.url,
      matchedTerms: matched,
      matchCount: matched.length,
    });
  }
  hits.sort((a, b) => b.matchCount - a.matchCount);
  const ranked = hits.slice(0, limit);

  switch (format) {
    case "json":
      console.log(JSON.stringify(ranked, null, 2));
      break;
    case "simple":
      for (const h of ranked) {
        console.log(`#${h.number} - ${h.title} [${h.matchCount} term${h.matchCount === 1 ? "" : "s"}]`);
      }
      break;
    case "table":
      for (const h of ranked) {
        console.log(`#${h.number}  ${h.matchCount} match${h.matchCount === 1 ? "" : "es"}  ${h.state}  ${h.title}  (${h.matchedTerms.join(", ")})`);
      }
      break;
    default:
      logError(`Invalid format: ${format} (must be table, json, or simple)`);
      return EXIT_MISUSE;
  }
  return 0;
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (err: unknown) => {
    logError(err instanceof Error ? err.message : String(err));
    process.exit(1);
  },
);
