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

import { basename } from "node:path";

import { EXIT_GENERAL_ERROR, EXIT_MISUSE } from "../lib/core/exit-codes.ts";
import { logError, logInfo, logWarn } from "../lib/core/logging.ts";
import { assertNodeFloor } from "../lib/core/node-floor.ts";
import { errorMessage } from "../lib/core/logging.ts";
import { toolCli, usageCommonFlags } from "../lib/core/cli.ts";
import { checkTargetRepo, requireRepoTarget, providerRepoTarget } from "../lib/providers/provider-core.ts";
import { issuesEdit } from "../lib/providers/facade/issues.ts";
import { fireEvent } from "../lib/domain/issues/graph.ts";

assertNodeFloor();

const SCRIPT_VERSION = "1.0.0";
const SCRIPT_NAME = basename(process.argv[1] ?? "issue-triage.ts");

function showUsage(): never {
  console.log(`Usage: ${SCRIPT_NAME} [OPTIONS]
       ${SCRIPT_NAME} <ISSUE>... [BUNDLE-OPTIONS]

Interactive issue triage wizard to manage backlog and prepare issues for sprints.

Options:
${usageCommonFlags({ noDryRun: true })}
    -m, --milestone NAME        Filter by milestone

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
    // Fire the event in-process: the same path workflow-signal uses, so a
    // failed status write is reported here instead of vanishing in a child.
    const fired = await fireEvent("_on_triage_complete", Number(issue), {
      onWarning: (m) => logWarn(m.replace(/^WARNING: /, "")),
    });
    if (!fired.ok) {
      logError(`triage-complete signal failed${fired.error !== undefined ? `: ${fired.error}` : ""}`);
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
  // toolCli's generic strictness could reject it. The house flags (-h/-v/-V,
  // --devenv) are toolCli's — they belong here so the named-error path and
  // the shared parser accept the same surface.
  const knownFlags = new Set([
    "-h", "--help", "-v", "--version", "-V", "--verbose", "-m", "--milestone",
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
    const cli = toolCli({
      name: SCRIPT_NAME,
      version: SCRIPT_VERSION,
      argv,
      noDryRun: true,
      options: {
        milestone: { type: "string", short: "m" },
        title: { type: "string" },
        "body-file": { type: "string" },
        assignee: { type: "string" },
        label: { type: "string", multiple: true },
        "triage-complete": { type: "boolean", default: false },
      },
    });
    if (cli.common.help) showUsage();
    const values = cli.values as Record<string, string | boolean | string[] | undefined>;
    milestone = (values["milestone"] as string | undefined) ?? "";
    devenv = cli.common.devenv;
    bundle.title = values["title"] === undefined ? undefined : (values["title"] as string);
    bundle.bodyFile = values["body-file"] === undefined ? undefined : (values["body-file"] as string);
    bundle.assignee = values["assignee"] === undefined ? undefined : (values["assignee"] as string);
    bundle.triageComplete = Boolean(values["triage-complete"]);
    if (milestone !== "") bundle.milestone = milestone;
    const lv = values["label"];
    if (lv !== undefined) {
      if (Array.isArray(lv)) bundle.labels.push(...lv.map(String));
      else bundle.labels.push(String(lv));
    }
    for (const p of cli.positionals) {
      if (!/^[0-9]+$/.test(p)) {
        logError(`Unknown option: ${p}`);
        console.log("Use --help for usage information");
        return EXIT_MISUSE;
      }
      issues.push(p);
    }
  } catch (err) {
    logError(errorMessage(err));
    console.log("Use --help for usage information");
    return EXIT_MISUSE;
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
    logError(errorMessage(err));
    process.exit(EXIT_GENERAL_ERROR);
  },
);
