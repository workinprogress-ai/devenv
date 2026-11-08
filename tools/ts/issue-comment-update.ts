#!/usr/bin/env node
// issue-comment-update.ts - Replace the body of an existing GitHub issue comment
// Version: 1.1.0
// Description: Updates a comment identified by its numeric ID (as returned by issue-comment-list).
// Requirements: Node >= 23.6 (native type-stripping execution)
//
// Run via the depth-1 bash stub: `exec node "<resolved-src>.ts" "$@"`
//
// The comment is validated (GET through the facade's comment_get verb)
// before the update; dry-run skips the existence check (no network).

import { basename } from "node:path";

import { EXIT_GENERAL_ERROR, EXIT_MISUSE, EXIT_API_FAILURE } from "../lib/core/exit-codes.ts";
import { logError, logInfo } from "../lib/core/logging.ts";
import { assertNodeFloor } from "../lib/core/node-floor.ts";
import { toolCli, usageCommonFlags } from "../lib/core/cli.ts";
import { resolveBodySource } from "../lib/core/body-source.ts";
import { checkTargetRepo, requireRepoTarget, providerRepoTarget } from "../lib/providers/provider-core.ts";
import { issuesCommentGet, issuesCommentEdit } from "../lib/providers/facade/issues.ts";

assertNodeFloor();

const SCRIPT_VERSION = "1.1.0";
const SCRIPT_NAME = basename(process.argv[1] ?? "issue-comment-update.ts");

function showUsage(): never {
  console.log(`Usage: ${SCRIPT_NAME} COMMENT_ID [OPTIONS]

Replace the body of an existing issue comment. COMMENT_ID is the opaque
comment reference returned by issue-comment-list (its shape is
provider-defined; take it verbatim from list output).

The comment is validated (GET) before the update is attempted; if the ID does
not exist the tool exits cleanly with an error.

Arguments:
    COMMENT_ID                  Numeric comment ID to update

Options:
${usageCommonFlags()}
    --repo OWNER/REPO           Override the target repository

Comment Source (one required):
    -b, --body TEXT             New comment text (inline)
    -f, --body-file FILE        Read new comment body from file (markdown; '-'
                                reads stdin; piped stdin with no flag is auto-read)

Examples:
    ${SCRIPT_NAME} 12345678 --body "Updated content"
    ${SCRIPT_NAME} 12345678 --body-file spike-001-results.md
    ${SCRIPT_NAME} 12345678 --body-file notes.md --dry-run
`);
  process.exit(0);
}

function isWhitespaceOnly(s: string): boolean {
  return s.replace(/\s/g, "") === "";
}

async function main(argv: string[]): Promise<number> {
  let commentId = "";
  let bodyText = "";
  let bodyFile = "";
  let dryRun = false;
  let devenv = false;
  let repoOverride = "";
  try {
    const cli = toolCli({
      name: SCRIPT_NAME,
      version: SCRIPT_VERSION,
      argv,
      options: {
        "dry-run": { type: "boolean", short: "n", default: false },
        body: { type: "string", short: "b" },
        "body-file": { type: "string", short: "f" },
        repo: { type: "string" },
      },
    });
    if (cli.common.help) showUsage();
    dryRun = cli.common.dryRun;
    devenv = cli.common.devenv;
    bodyText = ((cli.values["body"] as string | undefined) ?? "");
    bodyFile = ((cli.values["body-file"] as string | undefined) ?? "");
    repoOverride = ((cli.values["repo"] as string | undefined) ?? "");
    for (const p of cli.positionals) {
      if (commentId === "") {
        // The comment ref is provider-opaque: any non-empty, non-flag token.
        commentId = p;
      } else {
        logError(`Unexpected argument: ${p}`);
        console.log("Use --help for usage information");
        return EXIT_MISUSE;
      }
    }
  } catch (err) {
    logError(err instanceof Error ? err.message : String(err));
    console.log("Use --help for usage information");
    return EXIT_MISUSE;
  }

  if (commentId === "") {
    logError("Comment ID is required");
    console.log("Use --help for usage information");
    return EXIT_MISUSE;
  }

  const sources = (bodyText !== "" ? 1 : 0) + (bodyFile !== "" ? 1 : 0);
  if (sources > 1) {
    logError("Only one of --body or --body-file may be specified");
    console.log("Use --help for usage information");
    return EXIT_MISUSE;
  }

  let body = "";
  if (sources === 0 && process.stdin.isTTY) {
    logError("A comment source is required: --body or --body-file");
    console.log("Use --help for usage information");
    return EXIT_MISUSE;
  } else {
    // Single source or piped stdin: the shared resolver owns the uniform
    // empty refusal (including the '-' leg).
    const resolved = resolveBodySource({
      ...(bodyText !== "" ? { text: bodyText } : {}),
      ...(bodyFile !== "" ? { file: bodyFile } : {}),
    });
    if (!resolved.ok) {
      logError(resolved.error.message);
      console.log("Use --help for usage information");
      return resolved.error.code === "file-not-found" ? EXIT_API_FAILURE : EXIT_MISUSE;
    }
    body = resolved.body;
  }

  checkTargetRepo(devenv);

  const repo = requireRepoTarget(providerRepoTarget(repoOverride), "issue-comment-update", "issues");

  // Existence check rides the facade's comment_get verb (skip on dry-run).
  if (!dryRun) {
    try {
      await issuesCommentGet(repo, commentId);
    } catch {
      logError(`Comment not found: ${commentId}`);
      return EXIT_GENERAL_ERROR;
    }
  }

  if (dryRun) {
    logInfo(`[DRY RUN] Would PATCH comment ${commentId} with body:`);
    console.log(body);
    return 0;
  }

  try {
    await issuesCommentEdit(repo, commentId, { body });
    logInfo(`Comment ${commentId} updated`);
    return 0;
  } catch (err) {
    logError(`Failed to update comment ${commentId}: ${err instanceof Error ? err.message : String(err)}`);
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
