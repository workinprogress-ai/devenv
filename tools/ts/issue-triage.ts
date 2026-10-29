#!/usr/bin/env node
// issue-triage.ts - Issue triage: scripted metadata-bundle apply + the
// interactive grooming wizard entry.
// Version: 1.0.0
// Requirements: Node >= 23.6 (native type-stripping execution)
//
// Run via the depth-1 bash stub: `exec node "<resolved-src>.ts" "$@"`
//
// Two modes:
//   Bundle apply (scripted): ISSUE... + bundle options — every requested
//   edit must succeed for exit 0. --triage-complete fires the event
//   dispatcher (tools/internal/_on_triage_complete.sh), best-effort.
//   Wizard (interactive): menu-driven grooming session; needs a TTY and is
//   deferred to the interactive polish pass — this port implements the
//   scripted surface and refuses the wizard without a TTY.

import { parseArgs } from "node:util";
import { basename, join } from "node:path";
import { existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { EXIT_GENERAL_ERROR, EXIT_MISUSE } from "../lib/core/exit-codes.ts";
import { logError, logInfo } from "../lib/core/logging.ts";
import { assertNodeFloor } from "../lib/core/node-floor.ts";
import { checkTargetRepo, requireRepoTarget, providerRepoTarget } from "../lib/providers/provider-core.ts";
import { issuesEdit } from "../lib/providers/github/issues.ts";

assertNodeFloor();

const SCRIPT_VERSION = "1.0.0";
const SCRIPT_NAME = basename(process.argv[1] ?? "issue-triage.ts");

function showUsage(): never {
  console.log(`Usage: ${SCRIPT_NAME} [OPTIONS]
       ${SCRIPT_NAME} <ISSUE>... [BUNDLE-OPTIONS]

Interactive issue triage wizard to manage backlog and prepare issues for sprints.

Options:
    -h, --help                  Show this help message and exit
    -v, --version               Show version information and exit
    -m, --milestone NAME        Filter by milestone
    --devenv                    Safety override to groom issues in devenv repo

CLI Apply Mode:
    ${SCRIPT_NAME} <ISSUE>... [BUNDLE-OPTIONS]
        Apply a metadata bundle to one or more issues non-interactively
        and exit. All requested edits must succeed for exit 0.
    Bundle options:
        --title TEXT        Set issue title
        --body-file FILE    Set issue body from file
        --milestone NAME    Set milestone
        --assignee USER     Add assignee
        --label NAME        Add a label (repeatable)
        --triage-complete   Fire the triage-complete event
`);
  process.exit(0);
}

interface Bundle {
  title?: string | undefined;
  bodyFile?: string | undefined;
  milestone?: string | undefined;
  assignee?: string | undefined;
  labels: string[];
  triageComplete?: boolean | undefined;
}

async function applyIssueBundle(
  repo: string,
  issue: number,
  bundle: Bundle,
): Promise<number> {
  let failed = 0;
  let didAny = false;
  const edits = async (opts: Parameters<typeof issuesEdit>[2], what: string): Promise<void> => {
    didAny = true;
    try {
      await issuesEdit(repo, issue, opts);
    } catch (err) {
      logError(`${what} failed: ${err instanceof Error ? err.message.split("\n")[0] : String(err)}`);
      failed = 1;
    }
  };
  if (bundle.title !== undefined) await edits({ title: bundle.title }, "title update");
  if (bundle.bodyFile !== undefined) await edits({ bodyFile: bundle.bodyFile }, "body update");
  if (bundle.milestone !== undefined) await edits({ milestone: bundle.milestone }, "milestone update");
  if (bundle.assignee !== undefined) await edits({ addAssignee: [bundle.assignee] }, "assignee update");
  for (const label of bundle.labels) {
    await edits({ addLabel: [label] }, `label update for '${label}'`);
  }
  if (bundle.triageComplete === true) {
    didAny = true;
    // Resolve the dispatcher relative to this script (../../internal/ from
    // tools/ts/) so it fires from any cwd.
    const scriptDir = fileURLToPath(new URL(".", import.meta.url));
    const dispatcher = join(scriptDir, "..", "internal", "_on_triage_complete.sh");
    if (existsSync(dispatcher)) {
      try {
        execFileSync("bash", [dispatcher, String(issue)], { stdio: ["ignore", "ignore", "ignore"] });
      } catch {
        logError("triage-complete signal failed");
        failed = 1;
      }
    } else {
      logError("event script internal/_on_triage_complete.sh not found");
      failed = 1;
    }
  }
  if (!didAny) {
    logError("no bundle options given");
    return 1;
  }
  return failed;
}

async function main(argv: string[]): Promise<number> {
  // Tokenize first: numeric tokens are issues, bare words are misuses, and a
  // flag token unknown to the bundle set is reported as a named error before
  // parseArgs' generic strictness could reject it.
  const knownFlags = new Set([
    "-h", "--help", "-v", "--version", "-m", "--milestone",
    "--title", "--body-file", "--assignee", "--label", "--triage-complete", "--devenv",
  ]);
  for (const tok of argv) {
    if (tok.startsWith("-") && tok !== "-" && !knownFlags.has(tok)) {
      logError(`Unknown option: ${tok}`);
      console.log("Use --help for usage information");
      return EXIT_MISUSE;
    }
  }
  const issues: string[] = [];
  const bundle: Bundle = { labels: [] };
  let milestone = "";
  let devenv = false;
  try {
    const { values, positionals } = parseArgs({
      args: argv,
      options: {
        help: { type: "boolean", short: "h", default: false },
        version: { type: "boolean", short: "v", default: false },
        milestone: { type: "string", short: "m" },
        title: { type: "string" },
        "body-file": { type: "string" },
        assignee: { type: "string" },
        label: { type: "string", multiple: true },
        "triage-complete": { type: "boolean", default: false },
        devenv: { type: "boolean", default: false },
      },
      allowPositionals: true,
      strict: true,
    });
    milestone = values["milestone"] ?? "";
    devenv = Boolean(values["devenv"]);
    bundle.title = values["title"] === undefined ? undefined : values["title"];
    bundle.bodyFile = values["body-file"] === undefined ? undefined : values["body-file"];
    bundle.assignee = values["assignee"] === undefined ? undefined : values["assignee"];
    bundle.triageComplete = Boolean(values["triage-complete"]);
    if (milestone !== "") bundle.milestone = milestone;
    const lv = values["label"];
    if (lv !== undefined) {
      if (Array.isArray(lv)) bundle.labels.push(...lv.map(String));
      else bundle.labels.push(String(lv));
    }
    for (const p of positionals) {
      if (!/^[0-9]+$/.test(p)) {
        logError(`Unknown option: ${p}`);
        console.log("Use --help for usage information");
        return EXIT_MISUSE;
      }
      issues.push(p);
    }
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

  checkTargetRepo(devenv);

  if (issues.length > 0) {
    const repo = requireRepoTarget(providerRepoTarget(""), "issue-triage", "issues");
    let rc = 0;
    for (const issue of issues) {
      logInfo(`Applying triage bundle to issue #${issue}...`);
      const r = await applyIssueBundle(repo, Number.parseInt(issue, 10), bundle);
      if (r !== 0) rc = EXIT_GENERAL_ERROR;
    }
    return rc;
  }

  // Wizard: needs a TTY; refused defined without one.
  logError(
    `The grooming wizard needs an interactive terminal (stdin is not a TTY). For scripted use pass issue number(s) with bundle options, e.g. ${SCRIPT_NAME} 123 --label bug`,
  );
  return EXIT_MISUSE;
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (err: unknown) => {
    logError(err instanceof Error ? err.message : String(err));
    process.exit(EXIT_GENERAL_ERROR);
  },
);
