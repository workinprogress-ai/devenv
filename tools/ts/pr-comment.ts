#!/usr/bin/env node
// pr-comment.ts - Add a top-level conversation comment to a GitHub pull
// request. For inline review comments use pr-review-comment (new thread) or
// pr-thread-reply (existing thread).
// Version: 1.1.0
// Requirements: Node >= 23.6 (native type-stripping execution)
//
// Run via the depth-1 bash stub: `exec node "<resolved-src>.ts" "$@"`

import { parseArgs } from "node:util";
import { basename } from "node:path";

import { existsSync, readFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { EXIT_API_FAILURE, EXIT_GENERAL_ERROR, EXIT_MISUSE } from "../lib/core/exit-codes.ts";
import { logError, logInfo } from "../lib/core/logging.ts";
import { assertNodeFloor } from "../lib/core/node-floor.ts";
import { resolveBodySource } from "../lib/core/body-source.ts";
import { checkTargetRepo } from "../lib/providers/provider-core.ts";
import { prsComment } from "../lib/providers/facade/prs.ts";
import { authStatusOk } from "../lib/providers/facade/urls.ts";
import { openInEditor } from "../lib/core/editor.ts";

assertNodeFloor();

const SCRIPT_VERSION = "1.1.0";
const SCRIPT_NAME = basename(process.argv[1] ?? "pr-comment.ts");

function showUsage(): never {
  console.log(`Usage: ${SCRIPT_NAME} PR_NUMBER [OPTIONS]

Add a top-level conversation comment to a GitHub pull request.
For inline review comments tied to a specific line, use pr-review-comment
(new thread) or pr-thread-reply (existing thread); this tool handles
conversation comments only.

Arguments:
    PR_NUMBER                   PR number to comment on

Options:
    -h, --help                  Show this help message and exit
    -v, --version               Show version information and exit
    -V, --verbose               Enable verbose output
    -n, --dry-run               Show what would be done without posting
    --devenv                    Safety override to comment on devenv repo PRs

Comment Source (one required):
    -b, --body TEXT             Comment text (inline)
    -f, --body-file FILE        Read comment from file (markdown; '-' reads stdin;
                                piped stdin with no flag is auto-read)
    -e, --edit                  Open \\$EDITOR to compose comment

Environment Variables:
    DEVENV_REPO                 Repository in format owner/repo (default: current repo)
    EDITOR                      Editor to use with --edit (default: nano)

Examples:
    ${SCRIPT_NAME} 123 --body "Reviewed and looks good. Ready to merge."
    ${SCRIPT_NAME} 123 --body-file review-notes.md
    ${SCRIPT_NAME} 123 --edit
    ${SCRIPT_NAME} 123 --body "Test comment" --dry-run
`);
  process.exit(0);
}

function stdinIsTty(): boolean {
  return Boolean(process.stdin.isTTY);
}

function readStdinSync(): string {
  try {
    return readFileSync(0, "utf8");
  } catch {
    return "";
  }
}

async function main(argv: string[]): Promise<number> {
  let prNumber = "";
  let bodyText = "";
  let bodyFile = "";
  let useEditor = false;
  let dryRun = false;
  let devenv = false;
  try {
    const { values, positionals } = parseArgs({
      args: argv,
      options: {
        help: { type: "boolean", short: "h", default: false },
        version: { type: "boolean", short: "v", default: false },
        verbose: { type: "boolean", short: "V", default: false },
        "dry-run": { type: "boolean", short: "n", default: false },
        devenv: { type: "boolean", default: false },
        body: { type: "string", short: "b" },
        "body-file": { type: "string", short: "f" },
        edit: { type: "boolean", short: "e", default: false },
      },
      allowPositionals: true,
      strict: true,
    });
    if (values["help"]) showUsage();
    if (values["version"]) {
      console.log(SCRIPT_VERSION);
      return 0;
    }
    dryRun = values["dry-run"] === true;
    devenv = values["devenv"] === true;
    useEditor = values["edit"] === true;
    bodyText = values["body"] ?? "";
    bodyFile = values["body-file"] ?? "";
    for (const p of positionals) {
      if (!/^[0-9]+$/.test(p)) {
        logError(`Invalid PR number: ${p} (must be numeric)`);
        return EXIT_MISUSE;
      }
      if (prNumber === "") prNumber = p;
      else {
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

  if (prNumber === "") {
    logError("PR number is required");
    console.log("Use --help for usage information");
    return EXIT_MISUSE;
  }

  const sources = (bodyText !== "" ? 1 : 0) + (bodyFile !== "" ? 1 : 0) + (useEditor ? 1 : 0);
  if (sources > 1) {
    logError("Only one of --body, --body-file, or --edit may be specified");
    console.log("Use --help for usage information");
    return EXIT_MISUSE;
  }

  if (sources === 0 && stdinIsTty()) {
    logError("One comment source is required: --body, --body-file, or --edit");
    console.log("Use --help for usage information");
    return EXIT_MISUSE;
  }

  if (useEditor) {
    const tmp = mkdtempSync(join(tmpdir(), "gh-pr-comment."));
    const tmpFile = join(tmp, "comment.md");
    writeFileSync(tmpFile, "");
    const ed = openInEditor(tmpFile);
    if (!ed.ok) {
      rmSync(tmp, { recursive: true, force: true });
      logError("Editor exited with error");
      return EXIT_GENERAL_ERROR;
    }
    bodyText = readFileSync(tmpFile, "utf8");
    rmSync(tmp, { recursive: true, force: true });
    if (bodyText.replace(/\s/g, "") === "") {
      logError("Comment body is empty — aborting");
      return EXIT_GENERAL_ERROR;
    }
    bodyFile = "";
  } else if (sources >= 1 || !stdinIsTty()) {
    // Single explicit source or piped stdin: the shared resolver owns the
    // uniform empty refusal (including the '-' leg). The resolved CONTENT
    // posts as the body on every path — the facade's bodyFile passthrough
    // (which read `-` as stdin lazily) is gone with it.
    const resolved = resolveBodySource({
      ...(bodyText !== "" ? { text: bodyText } : {}),
      ...(bodyFile !== "" ? { file: bodyFile } : {}),
    });
    if (!resolved.ok) {
      logError(resolved.error.message);
      console.log("Use --help for usage information");
      return resolved.error.code === "file-not-found" ? EXIT_API_FAILURE : EXIT_MISUSE;
    }
    bodyText = resolved.body;
    bodyFile = "";
  }

  if (!(await authStatusOk())) {
    logError("Not authenticated with the active provider");
    process.stderr.write("Run: key-update-provider\n");
    return EXIT_API_FAILURE;
  }

  checkTargetRepo(devenv);

  if (dryRun) {
    logInfo(`[DRY RUN] Would post comment on PR #${prNumber}:`);
    console.log(bodyText);
    return 0;
  }

  try {
    // The body is already resolved CONTENT (the shared resolver read every
    // leg, including `-`) — the file-path-posted-as-body failure mode is
    // gone by construction.
    await prsComment("", Number.parseInt(prNumber, 10), { body: bodyText });
    logInfo(`Comment posted on PR #${prNumber}`);
    return 0;
  } catch (err) {
    logError(`Failed to post comment on PR #${prNumber}`);
    logError(err instanceof Error ? err.message : String(err));
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
