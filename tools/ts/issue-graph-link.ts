#!/usr/bin/env node
// issue-graph-link.ts - Link a child issue as a sub-issue of a parent
// (post-hoc; issue-create --parent covers create-time).
// Version: 1.0.0
// Requirements: Node >= 23.6 (native type-stripping execution)
//
// Run via the depth-1 bash stub: `exec node "<resolved-src>.ts" "$@"`
//
// Parent and child are `N` (target-repo) or `owner/repo#N` (cross-repo:
// addSubIssue takes global node IDs — the link is repo-agnostic, verified
// live 2026-10-28). --unlink removes the relation; an absent link is a
// no-op success, a duplicate link is a no-op success (idempotent add).

import { parseArgs } from "node:util";
import { basename } from "node:path";

import { EXIT_GENERAL_ERROR, EXIT_MISUSE, EXIT_API_FAILURE } from "../lib/core/exit-codes.ts";
import { logError, logInfo } from "../lib/core/logging.ts";
import { assertNodeFloor } from "../lib/core/node-floor.ts";
import { checkTargetRepo, requireRepoTarget, providerRepoTarget } from "../lib/providers/provider-core.ts";
import { issueGraphLink, issueGraphUnlink, issuesExists } from "../lib/providers/github/issues.ts";

assertNodeFloor();

const SCRIPT_VERSION = "1.0.0";
const SCRIPT_NAME = basename(process.argv[1] ?? "issue-graph-link.ts");

/** A parent/child reference: bare `N` (target repo) or `owner/repo#N`. */
interface IssueRef {
  number: number;
  repoSpec?: string | undefined;
}

function parseRef(raw: string): IssueRef | null {
  const trimmed = raw.trim();
  if (/^[0-9]+$/.test(trimmed)) return { number: Number.parseInt(trimmed, 10) };
  const m = /^([A-Za-z0-9-]+)\/([A-Za-z0-9._-]+)#([0-9]+)$/.exec(trimmed);
  if (m?.[1] !== undefined && m[2] !== undefined && m[3] !== undefined) {
    return { number: Number.parseInt(m[3], 10), repoSpec: `${m[1]}/${m[2]}` };
  }
  return null;
}

function showUsage(): never {
  console.log(`Usage: ${SCRIPT_NAME} PARENT CHILD [--unlink]

Link CHILD as a sub-issue of PARENT (or --unlink to remove the relation).

Arguments:
    PARENT                      N or owner/repo#N (the parent issue)
    CHILD                       N or owner/repo#N (the child issue)

Options:
    --unlink                    Remove the relation instead of adding it
    --devenv                    Safety override for the devenv repo (target-
                                repo references only)
    -h, --help                  Show this help and exit
    -v, --version               Show version information and exit

Cross-repo references (owner/repo#N) are supported on both sides: the
sub-issue API takes global node IDs. References without a repo resolve
against the target repository.

Examples:
    ${SCRIPT_NAME} 50 51
    ${SCRIPT_NAME} org/planning#50 org/service-x#12
    ${SCRIPT_NAME} 50 51 --unlink
`);
  process.exit(0);
}

async function main(argv: string[]): Promise<number> {
  let unlink = false;
  let devenv = false;
  try {
    const { values } = parseArgs({
      args: argv,
      options: {
        help: { type: "boolean", short: "h", default: false },
        version: { type: "boolean", short: "v", default: false },
        unlink: { type: "boolean", default: false },
        devenv: { type: "boolean", default: false },
      },
      allowPositionals: true,
      strict: true,
    });
    unlink = Boolean(values["unlink"]);
    devenv = Boolean(values["devenv"]);
    if (values["help"]) showUsage();
    if (values["version"]) {
      console.log(SCRIPT_VERSION);
      return 0;
    }
  } catch (err) {
    logError(err instanceof Error ? err.message : String(err));
    console.log("Use --help for usage information");
    return EXIT_MISUSE;
  }

  // Positional extraction (after flag filtering by parseArgs above via a
  // second pass: bare numbers and owner/repo#N forms).
  const positionalLike = (a: string): boolean => !a.startsWith("-");
  const refs = argv.filter(positionalLike);
  if (refs.length !== 2) {
    logError("Parent and child references are required: issue-graph-link PARENT CHILD [--unlink]");
    console.log("Use --help for usage information");
    return EXIT_MISUSE;
  }
  const parent = parseRef(refs[0] ?? "");
  const child = parseRef(refs[1] ?? "");
  if (parent === null || child === null) {
    logError(`Invalid reference: ${parent === null ? (refs[0] ?? "") : (refs[1] ?? "")} (expected N or owner/repo#N)`);
    return EXIT_MISUSE;
  }

  checkTargetRepo(devenv);
  const spec = requireRepoTarget(providerRepoTarget(""), "issue-graph-link", "issues");

  // Each side resolves against its own repo (bare N -> target repo).
  const childSpec = child.repoSpec ?? spec;
  const parentSpec = parent.repoSpec ?? spec;
  try {
    if (!(await issuesExists(childSpec, child.number))) {
      logError(`Child issue ${refs[1]} not found`);
      return EXIT_API_FAILURE;
    }
    if (!(await issuesExists(parentSpec, parent.number))) {
      logError(`Parent issue ${refs[0]} not found`);
      return EXIT_API_FAILURE;
    }
    // The verb's spec parameter is the CHILD's repo; the parent resolves
    // against parentSpec when given. A bare parent number must hit the
    // TARGET repo (spec), never the child's named repo — pass it explicitly.
    if (unlink) {
      await issueGraphUnlink(childSpec, parent.number, child.number, parent.repoSpec ?? spec);
      logInfo(`Unlinked ${refs[1]} from ${refs[0]}`);
    } else {
      await issueGraphLink(childSpec, parent.number, child.number, parent.repoSpec ?? spec);
      logInfo(`Linked ${refs[1]} as a sub-issue of ${refs[0]}`);
    }
    return 0;
  } catch (err) {
    logError(`Failed to ${unlink ? "unlink" : "link"}: ${err instanceof Error ? err.message : String(err)}`);
    return EXIT_GENERAL_ERROR;
  }
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (err: unknown) => {
    logError(err instanceof Error ? err.message : String(err));
    process.exit(EXIT_GENERAL_ERROR);
  },
);
