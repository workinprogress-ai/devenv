#!/usr/bin/env node
// pr-thread-reply.ts - Reply to an existing inline review comment on a
// GitHub pull request. Distinct from pr-comment (top-level conversation).
// Version: 1.1.0
// Requirements: Node >= 23.6 (native type-stripping execution)
//
// Run via the depth-1 bash stub: `exec node "<resolved-src>.ts" "$@"`

import { basename } from "node:path";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { EXIT_API_FAILURE, EXIT_GENERAL_ERROR, EXIT_MISUSE } from "../lib/core/exit-codes.ts";
import { logError, logInfo } from "../lib/core/logging.ts";
import { assertNodeFloor } from "../lib/core/node-floor.ts";
import { errorMessage } from "../lib/core/logging.ts";
import { resolveBodySource } from "../lib/core/body-source.ts";
import { toolCli, usageCommonFlags, usageEnvBlock } from "../lib/core/cli.ts";
import { openInEditor } from "../lib/core/editor.ts";
import { checkTargetRepo, requireRepoTarget, providerRepoTarget } from "../lib/providers/provider-core.ts";
import { prsThreadReply } from "../lib/providers/facade/prs.ts";
import { authStatusOk, remoteToSpec } from "../lib/providers/facade/urls.ts";

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
${usageCommonFlags()}
    --comment-id COMMENT_ID     The ID of the comment to reply to, from pr-threads-get (required)

Reply Source (one required):
    -b, --body TEXT             Reply text (inline)
    -f, --body-file FILE        Read reply from file (markdown; '-' reads stdin;
                                piped stdin with no flag is auto-read)
    -e, --edit                  Open \\$EDITOR to compose reply

Environment Variables:
${usageEnvBlock()}
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
async function resolveOwnerName(): Promise<{ owner: string; name: string } | null> {
  const spec = requireRepoTarget(providerRepoTarget(""), "pr-thread-reply", "pr");
  if (spec.includes("/")) {
    const owner = spec.split("/")[0] ?? "";
    const name = spec.split("/").pop() ?? "";
    if (owner !== "" && name !== "") return { owner, name };
  }
  const remote = spawnSync("git", ["remote", "get-url", "origin"], { encoding: "utf8" });
  if (remote.status === 0) {
    const specFromRemote = await remoteToSpec((remote.stdout ?? "").trim());
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

async function main(argv: string[]): Promise<number> {
  let prNumber = "";
  let commentId = "";
  let bodyText = "";
  let bodyFile = "";
  let useEditor = false;
  let dryRun = false;
  let devenv = false;
  try {
    const cli = toolCli({
      name: SCRIPT_NAME,
      version: SCRIPT_VERSION,
      argv,
      options: {
        "dry-run": { type: "boolean", short: "n", default: false },
        "comment-id": { type: "string" },
        comment_id: { type: "string" },
        body: { type: "string", short: "b" },
        "body-file": { type: "string", short: "f" },
        "body_file": { type: "string" },
        edit: { type: "boolean", short: "e", default: false },
      },
    });
    if (cli.common.help) showUsage();
    dryRun = cli.common.dryRun;
    devenv = cli.common.devenv;
    useEditor = cli.values["edit"] === true;
    prNumber = cli.positionals[0] ?? "";
    commentId = ((cli.values["comment-id"] as string | undefined) ?? (cli.values["comment_id"] as string | undefined) ?? "");
    bodyText = ((cli.values["body"] as string | undefined) ?? "");
    bodyFile = ((cli.values["body-file"] as string | undefined) ?? (cli.values["body_file"] as string | undefined) ?? "");
  } catch (err) {
    logError(errorMessage(err));
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

  if (sources === 0 && Boolean(process.stdin.isTTY)) {
    logError("One reply source is required: --body, --body-file, or --edit");
    console.log("Use --help for usage information");
    return EXIT_MISUSE;
  }

  if (useEditor) {
    const tmp = mkdtempSync(join(tmpdir(), "gh-pr-reply."));
    const tmpFile = join(tmp, "reply.md");
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
  } else if (sources >= 1 || !Boolean(process.stdin.isTTY)) {
    // Single explicit source or piped stdin: the shared resolver owns the
    // uniform empty refusal (including the '-' leg).
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

  checkTargetRepo(devenv);

  if (!authStatusOk()) {
    logError("Not authenticated with the active provider");
    process.stderr.write("Run: key-update-provider\n");
    return EXIT_API_FAILURE;
  }

  const repo = await resolveOwnerName();
  if (repo === null) {
    logError("Cannot resolve the target repository (no DEVENV_REPO, no cwd spec, no origin remote)");
    return EXIT_GENERAL_ERROR;
  }

  if (dryRun) {
    logInfo(`[DRY RUN] Would reply to comment #${commentId} on PR #${prNumber}:`);
    console.log(bodyText);
    return 0;
  }

  let response: string;
  try {
    const body = bodyText;
    const r = await prsThreadReply(`${repo.owner}/${repo.name}`, Number.parseInt(prNumber, 10), Number.parseInt(commentId.split("/")[0] ?? "0", 10), body);
    response = r.stdout;
  } catch (err) {
    logError(`Failed to post reply: ${errorMessage(err)}`);
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
    logError(errorMessage(err));
    process.exit(EXIT_API_FAILURE);
  },
);
