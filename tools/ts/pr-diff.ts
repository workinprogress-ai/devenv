#!/usr/bin/env node
// pr-diff.ts - Fetch a unified diff for a PR, or between two local refs.
// Version: 1.0.0
// Requirements: Node >= 23.6 (native type-stripping execution)
//
// Run via the depth-1 bash stub: `exec node "<resolved-src>.ts" "$@"`

import { basename } from "node:path";
import { spawnSync } from "node:child_process";

import { EXIT_API_FAILURE, EXIT_GENERAL_ERROR, EXIT_MISUSE } from "../lib/core/exit-codes.ts";
import { logError } from "../lib/core/logging.ts";
import { assertNodeFloor } from "../lib/core/node-floor.ts";
import { errorMessage } from "../lib/core/logging.ts";
import { toolCli, usageCommonFlags, usageEnvBlock } from "../lib/core/cli.ts";
import { checkTargetRepo, requireRepoTarget, providerRepoTarget } from "../lib/providers/provider-core.ts";
import { prsDiff } from "../lib/providers/facade/prs.ts";

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
    (the diff is BASE...HEAD: changes on HEAD since its merge base with BASE,
    which is what a PR shows; changes that landed on BASE afterwards are omitted)

Options:
${usageCommonFlags({ noDryRun: true })}
    --name-only                 List changed file paths only (no diff content)

Environment Variables:
${usageEnvBlock()}

Examples:
    ${SCRIPT_NAME} 123
    ${SCRIPT_NAME} 123 --name-only
    ${SCRIPT_NAME} --base master --head my-feature-branch
    ${SCRIPT_NAME} 123 | less
`);
  process.exit(0);
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
  // Three-dot: the merge-base diff, which is what a PR shows.
  const range = `${base}...${head}`;
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
    const cli = toolCli({
      name: SCRIPT_NAME,
      version: SCRIPT_VERSION,
      argv,
      noDryRun: true,
      options: {
        "name-only": { type: "boolean", default: false },
        base: { type: "string" },
        head: { type: "string" },
      },
    });
    if (cli.common.help) showUsage();
    nameOnly = cli.values["name-only"] === true;
    devenv = cli.common.devenv;
    baseRef = ((cli.values["base"] as string | undefined) ?? "");
    headRef = ((cli.values["head"] as string | undefined) ?? "");
    if (cli.positionals.length > 0) prNumber = cli.positionals[0] ?? "";
  } catch (err) {
    logError(errorMessage(err));
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

  const repo = requireRepoTarget(providerRepoTarget(""), "pr-diff", "pr");
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
    logError(errorMessage(err));
    process.exit(EXIT_API_FAILURE);
  },
);
