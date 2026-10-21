#!/usr/bin/env node
// pr-diff.ts - Fetch a unified diff for a PR, or between two local refs.
// Version: 1.0.0
// Requirements: Node >= 23.6 (native type-stripping execution)
//
// Run via the depth-1 bash stub: `exec node "<resolved-src>.ts" "$@"`

import { parseArgs } from "node:util";
import { basename } from "node:path";
import { spawnSync } from "node:child_process";

import { EXIT_API_FAILURE, EXIT_GENERAL_ERROR, EXIT_MISUSE } from "../lib/core/exit-codes.ts";
import { logError } from "../lib/core/logging.ts";
import { assertNodeFloor } from "../lib/core/node-floor.ts";
import { isDevenvRepoGated, providerRepoTarget } from "../lib/providers/provider-core.ts";
import { prsDiff } from "../lib/providers/github/prs.ts";

assertNodeFloor();

const SCRIPT_VERSION = "1.0.0";
const SCRIPT_NAME = basename(process.argv[1] ?? "pr-diff.ts");

function showUsage(): never {
  console.log(`Usage: ${SCRIPT_NAME} PR_NUMBER [OPTIONS]
       ${SCRIPT_NAME} --base BASE_REF --head HEAD_REF [OPTIONS]

Fetch a unified diff for a pull request, or for the difference between two
refs in the current local repository.

PR mode (remote, via gh):
    PR_NUMBER                   Pull request number to diff

Ref mode (local, via git):
    --base BASE_REF             Base ref
    --head HEAD_REF             Head ref

Options:
    -h, --help                  Show this help message and exit
    -v, --version               Show version information and exit
    -V, --verbose               Enable verbose output
    --name-only                 List changed file paths only (no diff content)
    --devenv                    Safety override for devenv repo

Environment Variables:
    DEVENV_REPO                 Repository in format owner/repo (default: current repo)

Examples:
    ${SCRIPT_NAME} 123
    ${SCRIPT_NAME} 123 --name-only
    ${SCRIPT_NAME} --base master --head my-feature-branch
    ${SCRIPT_NAME} 123 | less
`);
  process.exit(0);
}

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

function gitOk(args: string[]): boolean {
  const r = spawnSync("git", args, { encoding: "utf8", stdio: ["ignore", "ignore", "ignore"] });
  return r.status === 0;
}

function diffRefs(base: string, head: string, nameOnly: boolean): number {
  if (!gitOk(["rev-parse", "--verify", base])) {
    logError(`Base ref not found: ${base}`);
    return EXIT_API_FAILURE;
  }
  if (!gitOk(["rev-parse", "--verify", head])) {
    logError(`Head ref not found: ${head}`);
    return EXIT_API_FAILURE;
  }
  const range = `${base}..${head}`;
  const r = nameOnly
    ? spawnSync("git", ["--no-pager", "diff", "--name-only", range], { encoding: "utf8", stdio: ["ignore", "inherit", "inherit"] })
    : spawnSync("git", ["--no-pager", "diff", range], { encoding: "utf8", stdio: ["ignore", "inherit", "inherit"] });
  return r.status === 0 ? 0 : EXIT_API_FAILURE;
}

async function main(argv: string[]): Promise<number> {
  let prNumber = "";
  let baseRef = "";
  let headRef = "";
  let nameOnly = false;
  let devenv = false;
  try {
    const { values, positionals } = parseArgs({
      args: argv,
      options: {
        help: { type: "boolean", short: "h", default: false },
        version: { type: "boolean", short: "v", default: false },
        verbose: { type: "boolean", short: "V", default: false },
        "name-only": { type: "boolean", default: false },
        devenv: { type: "boolean", default: false },
        base: { type: "string" },
        head: { type: "string" },
      },
      allowPositionals: true,
      strict: true,
    });
    if (values["help"]) showUsage();
    if (values["version"]) {
      console.log(SCRIPT_VERSION);
      return 0;
    }
    nameOnly = values["name-only"] === true;
    devenv = values["devenv"] === true;
    baseRef = values["base"] ?? "";
    headRef = values["head"] ?? "";
    if (positionals.length > 0) prNumber = positionals[0] ?? "";
  } catch (err) {
    logError(err instanceof Error ? err.message : String(err));
    console.log("Use --help for usage information");
    return EXIT_MISUSE;
  }

  const prMode = prNumber !== "";
  const refMode = baseRef !== "" || headRef !== "";
  if (prMode && refMode) {
    logError("Use either PR_NUMBER or --base/--head, not both");
    return EXIT_GENERAL_ERROR;
  }
  if (!prMode && !refMode) {
    logError("PR number or --base/--head pair is required");
    console.log("Use --help for usage information");
    return EXIT_MISUSE;
  }

  if (refMode) {
    if (baseRef === "" || headRef === "") {
      logError("Both --base and --head are required in ref mode");
      return EXIT_MISUSE;
    }
    return diffRefs(baseRef, headRef, nameOnly);
  }

  if (!/^[0-9]+$/.test(prNumber)) {
    logError(`Invalid PR number: ${prNumber} (must be numeric)`);
    return EXIT_MISUSE;
  }

  checkTargetRepo(devenv);

  const repo = providerRepoTarget("");
  try {
    const r = await prsDiff(repo, Number.parseInt(prNumber, 10), nameOnly ? { nameOnly: true } : {});
    process.stdout.write(r.stdout);
    return 0;
  } catch {
    logError(`Failed to fetch diff for PR #${prNumber}`);
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
