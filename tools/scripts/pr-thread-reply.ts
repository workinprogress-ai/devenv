#!/usr/bin/env node
// pr-thread-reply.ts - Reply to an existing inline review comment on a
// GitHub pull request. Distinct from pr-comment (top-level conversation).
// Version: 1.1.0
// Requirements: Node >= 23.6 (native type-stripping execution)
//
// Run via the depth-1 bash stub: `exec node "<resolved-src>.ts" "$@"`

import { parseArgs } from "node:util";
import { basename } from "node:path";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { EXIT_API_FAILURE, EXIT_GENERAL_ERROR, EXIT_MISUSE } from "../lib/core/exit-codes.ts";
import { logError, logInfo } from "../lib/core/logging.ts";
import { assertNodeFloor } from "../lib/core/node-floor.ts";
import { openInEditor } from "../lib/core/editor.ts";
import { isDevenvRepoGated, providerRepoTarget } from "../lib/providers/provider-core.ts";
import { prsThreadReply } from "../lib/providers/github/prs.ts";
import { authStatusOk, remoteToSpec } from "../lib/providers/github/urls.ts";

assertNodeFloor();

const SCRIPT_VERSION = "1.1.0";
const SCRIPT_NAME = basename(process.argv[1] ?? "pr-thread-reply.ts");

function showUsage(): never {
  console.log(`Usage: ${SCRIPT_NAME} PR_NUMBER --comment-id COMMENT_ID [OPTIONS]

Reply to an existing inline review comment on a GitHub pull request.
The COMMENT_ID is the comment id from the review thread, exactly as
\`pr-threads-get\` prints it (a number, or <thread>/<comment> where the host
needs the thread to place a reply).

Use \`pr-threads-get PR_NUMBER\` to list threads and find comment IDs.
This is distinct from \`pr-comment\` (top-level PR conversation comments).

Arguments:
    PR_NUMBER                   PR number

Options:
    -h, --help                  Show this help message and exit
    -v, --version               Show version information and exit
    -V, --verbose               Enable verbose output
    -n, --dry-run               Show what would be posted without posting
    --comment-id COMMENT_ID     The ID of the comment to reply to, from pr-threads-get (required)
    --devenv                    Safety override to reply on devenv repo PRs

Reply Source (one required):
    -b, --body TEXT             Reply text (inline)
    -f, --body-file FILE        Read reply from file (markdown; '-' reads stdin;
                                piped stdin with no flag is auto-read)
    -e, --edit                  Open \\$EDITOR to compose reply

Environment Variables:
    DEVENV_REPO                 Repository in format owner/repo (default: current repo)
    EDITOR                      Editor to use with --edit (default: nano)

Examples:
    ${SCRIPT_NAME} 123 --comment-id 456 --body "Done — refactored in the latest commit."
    ${SCRIPT_NAME} 123 --comment-id 456 --body-file reply.md
    ${SCRIPT_NAME} 123 --comment-id 456 --body "LGTM" --dry-run
`);
  process.exit(0);
}

/** owner/name for the REST reply route: explicit spec > DEVENV_REPO/cwd >
 * the origin remote normalized through the provider URL seam. A multi-part
 * spec keeps the LAST component as the repository (bash's tail-slice parity:
 * an azure-shaped acme/proj/widgets names the repo widgets). */
function resolveOwnerName(): { owner: string; name: string } | null {
  const spec = providerRepoTarget("");
  if (spec.includes("/")) {
    const owner = spec.split("/")[0] ?? "";
    const name = spec.split("/").pop() ?? "";
    if (owner !== "" && name !== "") return { owner, name };
  }
  const remote = spawnSync("git", ["remote", "get-url", "origin"], { encoding: "utf8" });
  if (remote.status === 0) {
    const specFromRemote = remoteToSpec((remote.stdout ?? "").trim());
    if (specFromRemote !== null) {
      const owner = specFromRemote.split("/")[0] ?? "";
      const name = specFromRemote.split("/").pop() ?? "";
      if (owner !== "" && name !== "") return { owner, name };
    }
  }
  return null;
}

/** The bash check_target_repo contract: the devenv repository is not a
 * normal target. DEVENV_REPO (explicit target) and --devenv (devenv-repo
 * work on purpose) are the two exemptions. */
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
  let prNumber = "";
  let commentId = "";
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
        "comment-id": { type: "string" },
        comment_id: { type: "string" },
        body: { type: "string", short: "b" },
        "body-file": { type: "string", short: "f" },
        "body_file": { type: "string" },
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
    prNumber = positionals[0] ?? "";
    commentId = values["comment-id"] ?? values["comment_id"] ?? "";
    bodyText = values["body"] ?? "";
    bodyFile = values["body-file"] ?? values["body_file"] ?? "";
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
  if (!/^[0-9]+$/.test(prNumber)) {
    logError(`Invalid PR number: ${prNumber} (must be numeric)`);
    return EXIT_MISUSE;
  }
  if (commentId === "") {
    logError("--comment-id is required (the id from pr-threads-get)");
    return EXIT_MISUSE;
  }
  if (!/^[0-9]+(\/[0-9]+)?$/.test(commentId)) {
    logError(`Invalid comment ID: ${commentId} (must be the id from pr-threads-get: numeric, or <thread>/<comment>)`);
    return EXIT_MISUSE;
  }

  const sources = (bodyText !== "" ? 1 : 0) + (bodyFile !== "" ? 1 : 0) + (useEditor ? 1 : 0);
  if (sources > 1) {
    logError("Only one of --body, --body-file, or --edit may be specified");
    console.log("Use --help for usage information");
    return EXIT_MISUSE;
  }

  if (sources === 0) {
    if (Boolean(process.stdin.isTTY)) {
      logError("One reply source is required: --body, --body-file, or --edit");
      console.log("Use --help for usage information");
      return EXIT_MISUSE;
    }
    let content = "";
    try {
      content = readFileSync(0, "utf8");
    } catch {
      content = "";
    }
    if (content.replace(/\s/g, "") === "") {
      logError("Refusing empty stdin body");
      return EXIT_MISUSE;
    }
    bodyText = content;
  }

  if (bodyFile !== "" && bodyFile !== "-" && !existsSync(bodyFile)) {
    logError(`File not found: ${bodyFile}`);
    return EXIT_API_FAILURE;
  }

  if (useEditor) {
    const tmp = mkdtempSync(join(tmpdir(), "gh-pr-reply."));
    const tmpFile = join(tmp, "reply.md");
    writeFileSync(tmpFile, "");
    const ed = openInEditor(tmpFile);
    if (!ed.ok) {
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
  }

  checkTargetRepo(devenv);

  if (!authStatusOk()) {
    logError("Not authenticated with the active provider");
    process.stderr.write("Run: key-update-provider\n");
    return EXIT_API_FAILURE;
  }

  const repo = resolveOwnerName();
  if (repo === null) {
    logError("Cannot resolve the target repository (no DEVENV_REPO, no cwd spec, no origin remote)");
    return EXIT_GENERAL_ERROR;
  }

  if (dryRun) {
    logInfo(`[DRY RUN] Would reply to comment #${commentId} on PR #${prNumber}:`);
    if (bodyFile !== "" && bodyFile !== "-") {
      process.stdout.write(readFileSync(bodyFile, "utf8"));
    } else {
      console.log(bodyText);
    }
    return 0;
  }

  let response: string;
  try {
    const body = bodyFile === "-" ? readFileSync(0, "utf8") : bodyFile !== "" ? readFileSync(bodyFile, "utf8") : bodyText;
    const r = await prsThreadReply(`${repo.owner}/${repo.name}`, Number.parseInt(prNumber, 10), Number.parseInt(commentId.split("/")[0] ?? "0", 10), body);
    response = r.stdout;
  } catch (err) {
    logError(`Failed to post reply: ${err instanceof Error ? err.message : String(err)}`);
    return EXIT_API_FAILURE;
  }

  let replyUrl = "";
  try {
    replyUrl = (JSON.parse(response) as { url?: string }).url ?? "";
  } catch {
    replyUrl = "";
  }
  logInfo(`Reply posted: ${replyUrl !== "" ? replyUrl : `PR #${prNumber}`}`);
  return 0;
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (err: unknown) => {
    logError(err instanceof Error ? err.message : String(err));
    process.exit(EXIT_API_FAILURE);
  },
);
