#!/usr/bin/env node
// issue-artifact-upsert.ts - Create or update a GitHub issue comment by stable doc_id marker.
// Version: 1.0.0
// Description: Create or update an issue comment artifact matched by its doc_id header line.
// Requirements: Node >= 23.6 (native type-stripping execution)
//
// Run via the depth-1 bash stub: `exec node "<resolved-src>.ts" "$@"`
//
// Contract: the body's DEVENV_ARTIFACT_V1 header (first 256 chars) carries
// `doc_id: <id>`; the tool stamps updated_at_utc, resolves the issue number
// (--issue > header issue_number > doc_id issue-<N>), enforces consistency,
// then updates the single comment whose first-256 window carries the same
// doc_id — or creates one when none matches. >1 match is a conflict (exit 3).
// Interactive .local-artifacts picking is a TTY-only flow (D1); the non-TTY
// path requires an explicit source or piped stdin.

import { parseArgs } from "node:util";
import { basename, join } from "node:path";
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { execSync } from "node:child_process";

import { EXIT_GENERAL_ERROR, EXIT_MISUSE, EXIT_CONFLICT } from "../lib/core/exit-codes.ts";
import { logError, logInfo } from "../lib/core/logging.ts";
import { assertNodeFloor } from "../lib/core/node-floor.ts";
import { providerRepoTarget, isDevenvRepoGated } from "../lib/providers/provider-core.ts";
import { issuesComments, issuesCommentAdd, issuesCommentEdit } from "../lib/providers/github/issues.ts";

assertNodeFloor();

const SCRIPT_VERSION = "1.0.0";
const SCRIPT_NAME = basename(process.argv[1] ?? "issue-artifact-upsert.ts");

function showUsage(): never {
  console.log(`Usage: ${SCRIPT_NAME} [OPTIONS]

Create or update a GitHub issue comment by stable doc_id marker.

Issue Target:
    --issue, --issue-number N     Issue number override (optional if body contains issue_number metadata or a doc_id with issue-<N>)

Comment Source (exactly one required unless stdin is piped or a TTY):
    -b, --body TEXT               Comment body text
    -f, --body-file FILE          Read comment body from file (doc_id extracted
                                  from DEVENV_ARTIFACT_V1 header); '-' reads stdin
    (no source flag)              Body read from piped stdin automatically; with
                                  a TTY, an interactive picker over .local-artifacts
                                  is offered

Options:
    -n, --dry-run                 Resolve intended action without writing
    --no-stamp                    Do not rewrite updated_at_utc (byte-exact republish)
    --all                         Interactive list includes tmp*.md (default: excluded)
    --repo OWNER/REPO             Repository override (defaults to DEVENV_REPO)
    -V, --verbose                 Enable verbose logs
    -h, --help                    Show help and exit
    -v, --version                 Show version and exit

Behavior:
    1) Read comment body from --body or --body-file
    2) Stamp updated_at_utc to the current UTC time inside the DEVENV_ARTIFACT_V1
       block (unless --no-stamp; no-op when the block has no such line)
    3) Resolve issue number from --issue, "issue_number: <N>" in the body header,
       or a doc_id containing issue-<N>
    4) Extract doc_id from "doc_id: <ID>" line in first 256 characters
    5) Search all issue comments for matching doc_id in first 256 characters
    6) 1 match   -> update comment
    7) 0 matches -> create new comment
    8) >1 match  -> conflict (exit 3)

Output JSON:
    Success: {"action":"created|updated","issue_number":N,"comment_id":ID,"comment_url":"..."}
    Conflict: {"action":"conflict","issue_number":N,"matches":[ID, ...]}

Exit Codes:
    0 success (created/updated)
    2 invalid arguments
    3 duplicate doc_id conflict
    4 API/tool failure
`);
  process.exit(0);
}

interface Parsed {
  help: boolean;
  version: boolean;
  issue: string;
  body: string;
  bodyFile: string;
  repo: string;
  dryRun: boolean;
  noStamp: boolean;
  devenv: boolean;
  all: boolean;
}

function parseCliArgs(argv: string[]): Parsed {
  try {
    const { values } = parseArgs({
      args: argv,
      options: {
        help: { type: "boolean", short: "h", default: false },
        version: { type: "boolean", short: "v", default: false },
        verbose: { type: "boolean", short: "V", default: false },
        "dry-run": { type: "boolean", short: "n", default: false },
        "no-stamp": { type: "boolean", default: false },
        devenv: { type: "boolean", default: false },
        all: { type: "boolean", default: false },
        issue: { type: "string" },
        "issue-number": { type: "string" },
        "issue_number": { type: "string" },
        body: { type: "string", short: "b" },
        "body-file": { type: "string", short: "f" },
        "body_file": { type: "string" },
        repo: { type: "string" },
      },
      allowPositionals: false,
      strict: true,
    });
    return {
      help: Boolean(values["help"]),
      version: Boolean(values["version"]),
      issue: values["issue"] ?? values["issue-number"] ?? values["issue_number"] ?? "",
      body: values["body"] ?? "",
      bodyFile: values["body-file"] ?? values["body_file"] ?? "",
      repo: values["repo"] ?? "",
      dryRun: Boolean(values["dry-run"]),
      noStamp: Boolean(values["no-stamp"]),
      devenv: Boolean(values["devenv"]),
      all: Boolean(values["all"]),
    };
  } catch (err) {
    logError(err instanceof Error ? err.message : String(err));
    process.exit(EXIT_MISUSE);
  }
}

function headerField(body: string, key: string): string {
  const re = new RegExp(`^[ \\t]*${key}:[ \\t]*(.*)$`, "m");
  const m = body.slice(0, 256).match(re);
  return m?.[1]?.trim() ?? "";
}

/** The bash awk stamping engine: rewrite updated_at_utc inside the
 * DEVENV_ARTIFACT_V1 block; insert before `-->` when the block lacks the
 * line. Byte-faithful to the awk (indent preserved, one insert at most). */
export function stampUpdatedAt(body: string, nowUtc: string): string {
  const lines = body.split("\n");
  const out: string[] = [];
  let inBlock = false;
  let stamped = false;
  for (const line of lines) {
    if (line.includes("DEVENV_ARTIFACT_V1")) {
      inBlock = true;
      out.push(line);
      continue;
    }
    if (inBlock && /^-->/.test(line)) {
      if (!stamped) out.push(`updated_at_utc: ${nowUtc}`);
      out.push(line);
      inBlock = false;
      continue;
    }
    if (inBlock && /^[ \t]*updated_at_utc[ \t]*:/.test(line)) {
      const indent = line.match(/^[ \t]*/)?.[0] ?? "";
      out.push(`${indent}updated_at_utc: ${nowUtc}`);
      stamped = true;
      continue;
    }
    out.push(line);
  }
  return out.join("\n");
}

/** issue[-_:]<N> inference from a doc_id (the bash sed contract). */
export function inferIssueNumberFromDocId(docId: string): string | null {
  const m = docId.match(/issue[-_:](\d+)/);
  if (m?.[1] !== undefined && /^[0-9]+$/.test(m[1])) return m[1];
  return null;
}

interface CommentRecord {
  id?: unknown;
  body?: unknown;
  url?: unknown;
}

/** The upsert match rule: a comment whose first-256 window carries a
 * `doc_id:` line equal (whitespace-trimmed) to the target. */
export function findMatches(comments: CommentRecord[], docId: string): Array<{ id: unknown; url: unknown }> {
  const matches: Array<{ id: unknown; url: unknown }> = [];
  for (const c of comments) {
    const body = typeof c.body === "string" ? c.body : "";
    const prefix = body.slice(0, 256).split("\n");
    const hit = prefix.some((line) => {
      const m = line.match(/^[ \t]*doc_id:[ \t]*(.*)$/);
      return m !== null && (m[1]?.replace(/[ \t]+$/, "") ?? "") === docId;
    });
    if (hit) matches.push({ id: c.id, url: c.url });
  }
  return matches;
}

/** Interactive picker over .local-artifacts (TTY-only; D1). Returns the
 * picked file path, or null when no candidates exist. */
function interactivePickArtifact(all: boolean): string | null {
  let dir = process.cwd();
  try {
    const root = execSync("git rev-parse --show-toplevel 2>/dev/null", { encoding: "utf8" }).trim();
    if (root !== "") dir = root;
  } catch {
    // outside a repository: cwd
  }
  const artifactsDir = join(dir, ".local-artifacts");
  if (!existsSync(artifactsDir)) {
    logError(`No .local-artifacts directory found at ${artifactsDir}`);
    return null;
  }
  const files = readdirSync(artifactsDir)
    .filter((f) => f.endsWith(".md"))
    .filter((f) => all || !f.startsWith("tmp"))
    .filter((f) => {
      const body = readFileSync(join(artifactsDir, f), "utf8");
      const docId = headerField(body, "doc_id");
      if (docId === "") return false;
      const issue = headerField(body, "issue_number");
      if (issue !== "" && issue !== "none" && !/^[0-9]+$/.test(issue)) return false;
      return docId !== "" && (issue !== "" && issue !== "none" ? true : inferIssueNumberFromDocId(docId) !== null);
    });
  if (files.length === 0) return null;
  // Non-interactive fallback is a named refusal: the picker needs a TTY and
  // fzf; the parent process decided this branch only when stdin IS a TTY,
  // so reaching here means fzf selection was cancelled or unavailable.
  const fzf = readdirSync("/usr/bin").includes("fzf");
  if (!fzf) {
    logError("fzf is required for the interactive picker; pass --body or --body-file explicitly");
    return null;
  }
  try {
    const preview = `head -c 1024 '${artifactsDir}/{}'`;
    const picked = execSync(
      `fzf --prompt 'Upsert which artifact? ' --preview ${JSON.stringify(preview)}`,
      { cwd: artifactsDir, encoding: "utf8", stdio: ["inherit", "pipe", "inherit"] },
    ).trim();
    return picked === "" ? null : join(artifactsDir, picked);
  } catch {
    return null;
  }
}

async function main(argv: string[]): Promise<number> {
  const args = parseCliArgs(argv);
  if (args.help) showUsage();
  if (args.version) {
    console.log(SCRIPT_VERSION);
    return 0;
  }

  const sources = (args.body !== "" ? 1 : 0) + (args.bodyFile !== "" ? 1 : 0);
  if (sources > 1) {
    logError("Only one of --body or --body-file may be specified");
    return EXIT_MISUSE;
  }

  let body = "";
  if (sources === 0) {
    if (process.stdin.isTTY) {
      const picked = interactivePickArtifact(args.all);
      if (picked === null) {
        logError("One comment source is required: --body or --body-file");
        return EXIT_MISUSE;
      }
      body = readFileSync(picked, "utf8");
    } else {
      // Piped stdin auto-reads; empty/closed stdin is a hard error.
      const stdin = readFileSync(0, "utf8");
      if (stdin.trim() === "") {
        logError("Refusing empty stdin body");
        console.log("Use --help for usage information");
        return EXIT_MISUSE;
      }
      body = stdin;
    }
  } else if (args.bodyFile !== "") {
    if (args.bodyFile === "-") {
      const stdin = readFileSync(0, "utf8");
      if (stdin.trim() === "") {
        logError("Refusing empty stdin body");
        return EXIT_MISUSE;
      }
      body = stdin;
    } else if (!existsSync(args.bodyFile) || !statSync(args.bodyFile).isFile()) {
      logError(`File not found: ${args.bodyFile}`);
      return EXIT_MISUSE;
    } else {
      body = readFileSync(args.bodyFile, "utf8");
    }
  } else {
    body = args.body;
  }

  // Single repo-resolution entry point (override > DEVENV_REPO > cwd), with
  // the devenv-repo safety gate applied to implicit targets — the bash
  // resolve_target_repo contract. The gate judges intent: an explicit --repo
  // or DEVENV_REPO names the target on purpose and is not second-guessed.
  const explicit = args.repo !== "" || (process.env["DEVENV_REPO"] !== undefined && process.env["DEVENV_REPO"] !== "");
  const repo = providerRepoTarget(args.repo);
  if (repo === "") {
    logError("Unable to resolve target repository");
    logInfo("Prefix the command with DEVENV_REPO=<owner>/<repo> or run from within the target repo");
    return EXIT_MISUSE;
  }
  if (!explicit && !args.devenv && isDevenvRepoGated()) {
    logError("The current repository appears to be the devenv repository itself");
    logInfo("Operations should be performed in target project repositories, not in devenv");
    logInfo("To target a project repo, prefix the command with DEVENV_REPO=<owner>/<repo>");
    logInfo("To override this safety check (devenv-repo work only), pass the --devenv flag");
    return EXIT_GENERAL_ERROR;
  }

  if (!args.noStamp) {
    const nowUtc = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
    body = stampUpdatedAt(body, nowUtc);
  }

  const headerIssue = (() => {
    const v = headerField(body, "issue_number");
    if (v === "") return "";
    if (v === "none") return "";
    if (!/^[0-9]+$/.test(v)) {
      logError(`Invalid issue number: '${v}'`);
      process.exit(EXIT_MISUSE);
    }
    return v;
  })();

  if (args.issue !== "" && !/^[0-9]+$/.test(args.issue)) {
    logError(`Invalid issue number: '${args.issue}'`);
    return EXIT_MISUSE;
  }

  const docId = headerField(body, "doc_id");
  const inferred = docId !== "" ? inferIssueNumberFromDocId(docId) : null;

  let issueNumber = args.issue;
  if (issueNumber === "" && headerIssue !== "") issueNumber = headerIssue;
  if (issueNumber === "" && inferred !== null) issueNumber = inferred;

  if (issueNumber !== "" && headerIssue !== "" && issueNumber !== headerIssue) {
    logError(`Issue number mismatch: --issue ${issueNumber} does not match body metadata issue_number: ${headerIssue}`);
    return EXIT_MISUSE;
  }
  if (issueNumber !== "" && inferred !== null && issueNumber !== inferred) {
    logError(`Issue number mismatch: --issue ${issueNumber} does not match doc_id issue-<N>: ${inferred}`);
    return EXIT_MISUSE;
  }

  if (issueNumber === "") {
    if (docId === "") {
      const origin = args.bodyFile !== "" ? args.bodyFile : "body";
      logError(`${origin} is not an upsertable artifact: no DEVENV_ARTIFACT_V1 header (no doc_id line within the first 256 characters) and no resolvable issue number`);
      return EXIT_MISUSE;
    }
    logError("issue_number is required via --issue, body metadata line 'issue_number: <N>', or a doc_id containing issue-<N>");
    return EXIT_MISUSE;
  }
  if (docId === "") {
    logError("Comment body must include 'doc_id: <value>' in first 256 characters");
    return EXIT_MISUSE;
  }
  if (docId.includes("\n")) {
    logError("doc_id must be a single line");
    return EXIT_MISUSE;
  }

  const issueNum = Number.parseInt(issueNumber, 10);

  let raw: string;
  try {
    raw = await issuesComments(repo, issueNum);
  } catch (err) {
    logError(`Failed to fetch comments for issue #${issueNumber}: ${err instanceof Error ? err.message : String(err)}`);
    return 4;
  }
  let comments: CommentRecord[];
  try {
    comments = JSON.parse(raw) as CommentRecord[];
  } catch {
    logError("Failed to parse issue comments");
    return 4;
  }

  const matches = findMatches(comments, docId);

  if (matches.length > 1) {
    console.log(JSON.stringify({
      action: "conflict",
      issue_number: issueNum,
      matches: matches.map((m) => m.id),
    }));
    return EXIT_CONFLICT;
  }

  if (matches.length === 1) {
    const target = matches[0] as { id: unknown; url: unknown };
    if (args.dryRun) {
      console.log(JSON.stringify({
        action: "updated",
        issue_number: issueNum,
        comment_id: target.id,
        comment_url: target.url,
      }));
      return 0;
    }
    try {
      const updated = JSON.parse(
        await issuesCommentEdit(repo, String(target.id), { body }),
      ) as { id: unknown; url: unknown };
      console.log(JSON.stringify({
        action: "updated",
        issue_number: issueNum,
        comment_id: updated.id,
        comment_url: updated.url,
      }));
      return 0;
    } catch (err) {
      logError(`Failed to update comment: ${err instanceof Error ? err.message : String(err)}`);
      return 4;
    }
  }

  if (args.dryRun) {
    console.log(JSON.stringify({ action: "created", issue_number: issueNum }));
    return 0;
  }

  try {
    const created = JSON.parse(
      await issuesCommentAdd(repo, issueNum, { body }),
    ) as { id: unknown; url: unknown };
    console.log(JSON.stringify({
      action: "created",
      issue_number: issueNum,
      comment_id: created.id,
      comment_url: created.url,
    }));
    return 0;
  } catch (err) {
    logError(`Failed to create issue comment on issue #${issueNumber}: ${err instanceof Error ? err.message : String(err)}`);
    return 4;
  }
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (err: unknown) => {
    logError(err instanceof Error ? err.message : String(err));
    process.exit(4);
  },
);
