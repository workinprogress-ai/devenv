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

import { parseArgs } from "node:util";
import { basename, join } from "node:path";
import { readFileSync, writeFileSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";

import { EXIT_GENERAL_ERROR, EXIT_MISUSE, EXIT_API_FAILURE } from "../lib/core/exit-codes.ts";
import { logError, logInfo } from "../lib/core/logging.ts";
import { assertNodeFloor } from "../lib/core/node-floor.ts";
import { checkTargetRepo, providerRepoTarget } from "../lib/providers/provider-core.ts";
import { issuesComment } from "../lib/providers/github/issues.ts";

assertNodeFloor();

const SCRIPT_VERSION = "1.1.0";
const SCRIPT_NAME = basename(process.argv[1] ?? "issue-comment.ts");

function showUsage(): never {
  console.log(`Usage: ${SCRIPT_NAME} ISSUE_NUMBER [OPTIONS]

Add a comment to a GitHub issue.

Arguments:
    ISSUE_NUMBER                Issue number to comment on

Options:
    -h, --help                  Show this help message and exit
    -v, --version               Show version information and exit
    -V, --verbose               Enable verbose output
    -n, --dry-run               Show what would be done without posting
    --devenv                    Safety override to comment on devenv repo issues

Comment Source (one required):
    -b, --body TEXT             Comment text (inline)
    -f, --body-file FILE        Read comment from file (markdown; '-' reads stdin;
                                piped stdin with no flag is auto-read)
    -e, --edit                  Open $EDITOR to compose comment

Environment Variables:
    DEVENV_REPO                 Repository in format owner/repo (default: current repo)

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
    const { values, positionals } = parseArgs({
      args: argv,
      options: {
        help: { type: "boolean", short: "h", default: false },
        version: { type: "boolean", short: "v", default: false },
        "dry-run": { type: "boolean", short: "n", default: false },
        devenv: { type: "boolean", default: false },
        body: { type: "string", short: "b" },
        "body-file": { type: "string", short: "f" },
        edit: { type: "boolean", short: "e", default: false },
      },
      allowPositionals: true,
      strict: true,
    });
    return {
      parsed: {
        help: Boolean(values["help"]),
        version: Boolean(values["version"]),
        dryRun: Boolean(values["dry-run"]),
        devenv: Boolean(values["devenv"]),
        issue: "",
        body: values["body"] ?? "",
        bodyFile: values["body-file"] ?? "",
        edit: Boolean(values["edit"]),
      },
      positional: positionals,
    };
  } catch (err) {
    logError(err instanceof Error ? err.message : String(err));
    console.log("Use --help for usage information");
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
      console.log("Use --help for usage information");
      return EXIT_MISUSE;
    }
  }
  if (issueNumber === "") {
    logError("Issue number is required");
    console.log("Use --help for usage information");
    return EXIT_MISUSE;
  }

  const sources = (args.body !== "" ? 1 : 0) + (args.bodyFile !== "" ? 1 : 0) + (args.edit ? 1 : 0);
  if (sources > 1) {
    logError("Only one of --body, --body-file, or --edit may be specified");
    console.log("Use --help for usage information");
    return EXIT_MISUSE;
  }

  let body = "";
  let bodyFile = args.bodyFile;
  if (sources === 0) {
    if (!process.stdin.isTTY) {
      body = readFileSync(0, "utf8");
      if (isWhitespaceOnly(body)) {
        logError("Refusing empty stdin body");
        console.log("Use --help for usage information");
        return EXIT_MISUSE;
      }
    } else {
      logError("A comment source is required: --body, --body-file, or --edit");
      console.log("Use --help for usage information");
      return EXIT_MISUSE;
    }
  }

  checkTargetRepo(args.devenv);

  if (args.edit) {
    body = composeInEditor();
  } else if (bodyFile === "-") {
    body = readFileSync(0, "utf8");
    bodyFile = "";
  } else if (bodyFile !== "") {
    if (!existsSync(bodyFile)) {
      logError(`File not found: ${bodyFile}`);
      return EXIT_API_FAILURE;
    }
    body = readFileSync(bodyFile, "utf8");
  } else if (body === "") {
    // Plain --body: the flag value IS the body (the bash tool's COMMENT_BODY).
    body = args.body;
  }

  const repo = providerRepoTarget("");

  if (args.dryRun) {
    logInfo(`[DRY RUN] Would post comment on issue #${issueNumber}:`);
    console.log(body);
    return 0;
  }

  try {
    await issuesComment(repo, Number.parseInt(issueNumber, 10), {
      ...(bodyFile !== "" && body === "" ? { bodyFile } : { body }),
    });
    logInfo(`Comment posted on issue #${issueNumber}`);
    return 0;
  } catch (err) {
    logError(`Failed to post comment on issue #${issueNumber}: ${err instanceof Error ? err.message : String(err)}`);
    return EXIT_API_FAILURE;
  }
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (err: unknown) => {
    logError(err instanceof Error ? err.message : String(err));
    process.exit(EXIT_API_FAILURE);
  },
);
