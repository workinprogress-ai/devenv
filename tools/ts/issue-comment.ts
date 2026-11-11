#!/usr/bin/env node
// issue-comment.ts - Add a comment to a GitHub issue
// Version: 1.1.0
// Description: Posts a comment to a GitHub issue from text, file, or interactive editor
// Requirements: Node >= 23.6 (native type-stripping execution)
//
// Run via the depth-1 bash stub: `exec node "<resolved-src>.ts" "$@"`
//
// Source contract: exactly one of --body / --body-file / --edit; piped
// stdin with no flag auto-reads; empty stdin is a hard refusal. `-`
// materializes into the body before posting so the dry-run preview and the
// real post show the same content.

import { basename, join } from "node:path";
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";

import { EXIT_GENERAL_ERROR, EXIT_MISUSE, EXIT_API_FAILURE } from "../lib/core/exit-codes.ts";
import { logError, logInfo } from "../lib/core/logging.ts";
import { assertNodeFloor } from "../lib/core/node-floor.ts";
import { errorMessage } from "../lib/core/logging.ts";
import { toolCli, usageCommonFlags, usageEnvBlock } from "../lib/core/cli.ts";
import { resolveBodySource } from "../lib/core/body-source.ts";
import { checkTargetRepo, requireRepoTarget, providerRepoTarget } from "../lib/providers/provider-core.ts";
import { issuesComment } from "../lib/providers/facade/issues.ts";

assertNodeFloor();

const SCRIPT_VERSION = "1.1.0";
const SCRIPT_NAME = basename(process.argv[1] ?? "issue-comment.ts");

function showUsage(): never {
  console.log(`Usage: ${SCRIPT_NAME} ISSUE_NUMBER [OPTIONS]

Add a comment to a GitHub issue.

Arguments:
    ISSUE_NUMBER                Issue number to comment on

Options:
${usageCommonFlags()}

Comment Source (one required):
    -b, --body TEXT             Comment text (inline)
    -f, --body-file FILE        Read comment from file (markdown; '-' reads stdin;
                                piped stdin with no flag is auto-read)
    -e, --edit                  Open $EDITOR to compose comment

Environment Variables:
${usageEnvBlock()}

Examples:
    ${SCRIPT_NAME} 123 --body "Fixed in PR #456"
    ${SCRIPT_NAME} 123 --body-file notes.md
    ${SCRIPT_NAME} 123 --edit
    ${SCRIPT_NAME} 123 --body "Test comment" --dry-run
`);
  process.exit(0);
}

interface Parsed {
  help: boolean;
  version: boolean;
  dryRun: boolean;
  devenv: boolean;
  issue: string;
  body: string;
  bodyFile: string;
  edit: boolean;
}

function parseCliArgs(argv: string[]): { parsed: Parsed; positional: string[] } {
  try {
    const cli = toolCli({
      rejectEmptyValues: true,
      name: SCRIPT_NAME,
      version: SCRIPT_VERSION,
      argv,
      options: {
        "dry-run": { type: "boolean", short: "n", default: false },
        body: { type: "string", short: "b" },
        "body-file": { type: "string", short: "f" },
        edit: { type: "boolean", short: "e", default: false },
      },
    });
    if (cli.common.help) showUsage();
    return {
      parsed: {
        help: cli.common.help,
        version: cli.common.version,
        dryRun: cli.common.dryRun,
        devenv: cli.common.devenv,
        issue: "",
        body: ((cli.values["body"] as string | undefined) ?? ""),
        bodyFile: ((cli.values["body-file"] as string | undefined) ?? ""),
        edit: cli.values["edit"] === true,
      },
      positional: cli.positionals,
    };
  } catch (err) {
    logError(errorMessage(err));
    console.error("Use --help for usage information");
    process.exit(EXIT_MISUSE);
  }
}

function isWhitespaceOnly(s: string): boolean {
  return s.replace(/\s/g, "") === "";
}

/** Compose the body in $EDITOR via a temp file; empty result aborts. */
function composeInEditor(): string {
  const dir = mkdtempSync(join(tmpdir(), "gh-comment-"));
  const tempFile = join(dir, "comment.md");
  writeFileSync(tempFile, "");
  const editor = process.env["EDITOR"] ?? "nano";
  const r = spawnSync(editor, [tempFile], { stdio: "inherit" });
  if (r.status !== 0) {
    rmSync(dir, { recursive: true, force: true });
    logError("Editor exited with error");
    process.exit(EXIT_GENERAL_ERROR);
  }
  const body = readFileSync(tempFile, "utf8");
  rmSync(dir, { recursive: true, force: true });
  if (isWhitespaceOnly(body)) {
    logError("Comment body is empty — aborting");
    process.exit(EXIT_GENERAL_ERROR);
  }
  return body;
}

/** The devenv-repo safety gate (check_target_repo): operating on the devenv
 * checkout itself needs DEVENV_REPO or the --devenv override. */

async function main(argv: string[]): Promise<number> {
  const { parsed: args, positional } = parseCliArgs(argv);
  if (args.help) showUsage();
  if (args.version) {
    console.log(SCRIPT_VERSION);
    return 0;
  }

  let issueNumber = "";
  for (const p of positional) {
    if (issueNumber === "") {
      if (!/^[0-9]+$/.test(p)) {
        logError(`Invalid issue number: ${p}`);
        return EXIT_MISUSE;
      }
      issueNumber = p;
    } else {
      logError(`Unexpected argument: ${p}`);
      console.error("Use --help for usage information");
      return EXIT_MISUSE;
    }
  }
  if (issueNumber === "") {
    logError("Issue number is required");
    console.error("Use --help for usage information");
    return EXIT_MISUSE;
  }

  const sources = (args.body !== "" ? 1 : 0) + (args.bodyFile !== "" ? 1 : 0) + (args.edit ? 1 : 0);
  if (sources > 1) {
    logError("Only one of --body, --body-file, or --edit may be specified");
    console.error("Use --help for usage information");
    return EXIT_MISUSE;
  }

  let body = "";
  if (sources === 1) {
    // Single explicit source: resolve through the shared resolver so the
    // '-' and file legs carry the uniform empty refusal. --edit keeps its
    // own editor leg below.
    if (args.edit) {
      body = composeInEditor();
    } else {
      const resolved = resolveBodySource({
        ...(args.body !== "" ? { text: args.body } : {}),
        ...(args.bodyFile !== "" ? { file: args.bodyFile } : {}),
      });
      if (!resolved.ok) {
        logError(resolved.error.message);
        console.error("Use --help for usage information");
        return resolved.error.code === "file-not-found" ? EXIT_API_FAILURE : EXIT_MISUSE;
      }
      body = resolved.body;
    }
  } else {
    // No explicit source: piped stdin auto-reads; a TTY demands one.
    if (process.stdin.isTTY) {
      logError("A comment source is required: --body, --body-file, or --edit");
      console.error("Use --help for usage information");
      return EXIT_MISUSE;
    }
    const resolved = resolveBodySource({});
    if (!resolved.ok) {
      logError(resolved.error.message);
      console.error("Use --help for usage information");
      return EXIT_MISUSE;
    }
    body = resolved.body;
  }

  checkTargetRepo(args.devenv);

  const repo = requireRepoTarget(providerRepoTarget(""), "issue-comment", "issues");

  if (args.dryRun) {
    logInfo(`[DRY RUN] Would post comment on issue #${issueNumber}:`);
    console.log(body);
    return 0;
  }

  try {
    await issuesComment(repo, Number.parseInt(issueNumber, 10), { body });
    logInfo(`Comment posted on issue #${issueNumber}`);
    return 0;
  } catch (err) {
    logError(`Failed to post comment on issue #${issueNumber}: ${errorMessage(err)}`);
    return EXIT_API_FAILURE;
  }
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (err: unknown) => {
    logError(errorMessage(err));
    process.exit(EXIT_API_FAILURE);
  },
);
