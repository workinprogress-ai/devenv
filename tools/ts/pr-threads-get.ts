#!/usr/bin/env node
// pr-threads-get.ts - Fetch review threads (inline comments) for a GitHub
// pull request, preserving thread structure via GraphQL pagination.
// Version: 1.0.0
// Requirements: Node >= 23.6 (native type-stripping execution)
//
// Run via the depth-1 bash stub: `exec node "<resolved-src>.ts" "$@"`

import { parseArgs } from "node:util";
import { basename } from "node:path";
import { spawnSync } from "node:child_process";

import { EXIT_API_FAILURE, EXIT_GENERAL_ERROR, EXIT_MISUSE } from "../lib/core/exit-codes.ts";
import { logError, logWarn } from "../lib/core/logging.ts";
import { assertNodeFloor } from "../lib/core/node-floor.ts";
import { checkTargetRepo, requireRepoTarget, providerRepoTarget } from "../lib/providers/provider-core.ts";
import { prsThreadsPage } from "../lib/providers/github/prs.ts";
import type { GhThread } from "../lib/providers/github/prs.ts";
import { authStatusOk, remoteToWeb } from "../lib/providers/github/urls.ts";

assertNodeFloor();

const SCRIPT_VERSION = "1.0.0";
const SCRIPT_NAME = basename(process.argv[1] ?? "pr-threads-get.ts");

function showUsage(): never {
  console.log(`Usage: ${SCRIPT_NAME} PR_NUMBER [OPTIONS]

Fetch review threads (inline comments) for a GitHub pull request.
Uses GraphQL to preserve thread structure — the REST API loses parent/reply
relationships and cannot filter by resolution status.

Arguments:
    PR_NUMBER                   PR number to fetch threads for

Options:
    -h, --help                  Show this help message and exit
    -v, --version               Show version information and exit
    -V, --verbose               Enable verbose output
    --pretty                    Pretty-print JSON output (default: compact)
    --all                       Include resolved threads (default: unresolved only)
    --devenv                    Safety override to read PRs in devenv repo

Environment Variables:
    DEVENV_REPO                 Repository in format owner/repo (default: current repo)

Output:
    JSON array of thread objects. Each thread:
        id              Thread node ID (for resolving via pr-thread-resolve)
        isResolved      boolean
        path            File path the comment is on
        line            Line number (null for file-level comments)
        startLine       Start of multi-line comment range (or null)
        diffSide        LEFT or RIGHT
        comments        Array of comment objects:
            id          Comment id, as the host addresses a reply (for pr-thread-reply)
            author      {login}
            body        Comment text (markdown)
            createdAt   ISO 8601 timestamp
            url         Link to the comment on GitHub

Examples:
    ${SCRIPT_NAME} 123
    ${SCRIPT_NAME} 123 --all
    ${SCRIPT_NAME} 123 | jq length
    ${SCRIPT_NAME} 123 | jq -r '.[].path' | sort -u
`);
  process.exit(0);
}

function ownerName(): { owner: string; name: string } {
  // DEVENV_REPO / cwd spec first; origin remote through the URL seam as the
  // fallback leg (same chain as the bash tool).
  const spec = requireRepoTarget(providerRepoTarget(""), "pr-threads-get", "pr");
  if (spec.includes("/")) {
    const [owner, name] = spec.split("/");
    if (owner !== undefined && name !== undefined && owner !== "" && name !== "") {
      return { owner: name === "" ? owner : owner, name: name.replace(/\.git$/, "") };
    }
  }
  const remote = spawnSync("git", ["remote", "get-url", "origin"], { encoding: "utf8" });
  if (remote.status === 0) {
    const web = remoteToWeb((remote.stdout ?? "").trim());
    if (web !== null) {
      const rest = web.replace("https://github.com/", "");
      const [owner, nameRaw] = rest.split("/");
      if (owner !== undefined && nameRaw !== undefined) {
        return { owner, name: nameRaw.replace(/\.git$/, "") };
      }
    }
  }
  logError("Cannot determine repository owner/name. Set DEVENV_REPO or run inside a git repo.");
  process.exit(EXIT_GENERAL_ERROR);
}

/** The bash check_target_repo contract: the devenv repository is not a
 * normal target. DEVENV_REPO (explicit target) and --devenv (devenv-repo
 * work on purpose) are the two exemptions. */

async function main(argv: string[]): Promise<number> {
  let prNumber = "";
  let pretty = false;
  let all = false;
  let devenv = false;
  try {
    const { values, positionals } = parseArgs({
      args: argv,
      options: {
        help: { type: "boolean", short: "h", default: false },
        version: { type: "boolean", short: "v", default: false },
        verbose: { type: "boolean", short: "V", default: false },
        pretty: { type: "boolean", default: false },
        all: { type: "boolean", default: false },
        devenv: { type: "boolean", default: false },
      },
      allowPositionals: true,
      strict: true,
    });
    if (values["help"]) showUsage();
    devenv = values["devenv"] === true;
    if (values["version"]) {
      console.log(SCRIPT_VERSION);
      return 0;
    }
    pretty = values["pretty"] === true;
    all = values["all"] === true;
    prNumber = positionals[0] ?? "";
  } catch (err) {
    logError(err instanceof Error ? err.message : String(err));
    console.log("Use --help for usage information");
    return EXIT_MISUSE;
  }

  if (prNumber === "" || !/^[0-9]+$/.test(prNumber)) {
    logError(`PR number is required and must be numeric (got '${prNumber}')`);
    console.log("Use --help for usage information");
    return EXIT_MISUSE;
  }

  checkTargetRepo(devenv);

  if (!authStatusOk()) {
    logError("Not authenticated with the active provider");
    process.stderr.write("Run: key-update-provider\n");
    return EXIT_API_FAILURE;
  }

  const { owner, name } = ownerName();

  const allThreads: GhThread[] = [];
  let cursor: string | undefined = undefined;
  for (;;) {
    let page: string;
    try {
      page = (await prsThreadsPage(`${owner}/${name}`, Number.parseInt(prNumber, 10), cursor)).stdout;
    } catch (err) {
      logError(`Failed to fetch review threads for PR #${prNumber}`);
      logError(err instanceof Error ? err.message : String(err));
      return EXIT_API_FAILURE;
    }
    let parsed: {
      errors?: Array<{ message?: string }>;
      data?: {
        repository?: {
          pullRequest?: {
            reviewThreads?: {
              pageInfo: { hasNextPage: boolean; endCursor?: string };
              nodes: Array<GhThread & { comments: { nodes: Array<GhThread["comments"]["nodes"][number] & { databaseId?: number; id: string }> } }>;
            };
          };
        };
      };
    };
    try {
      parsed = JSON.parse(page);
    } catch {
      logError(`Failed to fetch review threads for PR #${prNumber}`);
      return EXIT_API_FAILURE;
    }
    if (parsed.errors && parsed.errors.length > 0) {
      logError(`Failed to fetch review threads for PR #${prNumber}`);
      logError(parsed.errors[0]?.message ?? "unknown GraphQL error");
      return EXIT_API_FAILURE;
    }
    const rt = parsed.data?.repository?.pullRequest?.reviewThreads;
    if (rt === undefined) {
      logError(`Failed to fetch review threads for PR #${prNumber}`);
      return EXIT_API_FAILURE;
    }
    // A thread's comments are read 50 at a time; more than that truncates
    // silently — the query's per-thread hasNextPage is the warning tripwire.
    const truncated = rt.nodes.some((t) => t.comments?.pageInfo?.hasNextPage === true);
    if (truncated) {
      logWarn(`a thread of PR #${prNumber} has more comments than the query returns (50); its conversation is incomplete`);
    }
    // Comment ids in the seam's shape: `id` becomes the id a reply addresses
    // (GitHub's databaseId) and `nodeId` the GraphQL node id.
    for (const t of rt.nodes) {
      allThreads.push({
        ...t,
        comments: {
          ...t.comments,
          nodes: t.comments.nodes.map((c) => {
            const raw = c as unknown as { id: string; databaseId?: number; author?: { login?: string }; body: string; createdAt?: string; url?: string };
            return {
              id: raw.databaseId ?? 0,
              nodeId: raw.id,
              ...(raw.author !== undefined ? { author: raw.author } : {}),
              body: raw.body,
              ...(raw.createdAt !== undefined ? { createdAt: raw.createdAt } : {}),
              ...(raw.url !== undefined ? { url: raw.url } : {}),
            };
          }),
        },
      });
    }
    if (rt.pageInfo.hasNextPage !== true || rt.pageInfo.endCursor === undefined) break;
    cursor = rt.pageInfo.endCursor;
  }

  const filtered = all ? allThreads : allThreads.filter((t) => t.isResolved === false);
  const result = filtered
    .map((t) => ({
      id: t.id,
      isResolved: t.isResolved,
      path: t.path,
      line: t.line,
      startLine: t.startLine,
      diffSide: t.diffSide,
      comments: (t.comments?.nodes ?? []).map((c) => ({
        id: c.id,
        nodeId: c.nodeId,
        author: c.author,
        body: c.body,
        createdAt: c.createdAt,
        url: c.url,
      })),
    }))
    // sort_by(.path, .line)
    .sort((a, b) => (a.path ?? "").localeCompare(b.path ?? "") || (a.line ?? 0) - (b.line ?? 0));

  console.log(pretty ? JSON.stringify(result, null, 2) : JSON.stringify(result));
  return 0;
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (err: unknown) => {
    logError(err instanceof Error ? err.message : String(err));
    process.exit(EXIT_API_FAILURE);
  },
);
