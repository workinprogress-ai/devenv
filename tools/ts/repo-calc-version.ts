#!/usr/bin/env node
// repo-calc-version.ts - Calculate the next version for the repository
// Version: 1.1.0
// Description: Outputs the calculated next version string: the base version
//              bumped per the conventional commits since the latest vX.Y.Z tag.
//              Takes no arguments.
// Requirements: Node >= 23.6 (native type-stripping execution)

import { assertNodeFloor } from "../lib/core/node-floor.ts";
import { logError } from "../lib/core/logging.ts";
import { toolCli, usageCommonFlags } from "../lib/core/cli.ts";
import { EXIT_MISUSE } from "../lib/core/exit-codes.ts";
import { calculateNextVersion, getLatestVersionTag } from "../lib/domain/release/version.ts";

assertNodeFloor();

const SCRIPT_VERSION = "1.1.0";

function usage(): never {
  console.log(`Usage: repo-calc-version

Calculate the next version for the repository: the base version bumped per
the conventional commits since the latest vX.Y.Z tag, printed on stdout.
Takes no arguments.

Options:
${usageCommonFlags({ noDryRun: true, noDevenv: true })}`);
  process.exit(0);
}

try {
  const cli = toolCli({
    name: "repo-calc-version",
    version: SCRIPT_VERSION,
    argv: process.argv.slice(2),
    noDryRun: true,
    allowPositionals: false,
  });
  if (cli.common.help) usage();
} catch (err) {
  logError(err instanceof Error ? err.message : String(err));
  console.log("Use --help for usage information");
  process.exit(EXIT_MISUSE);
}

const latestTag = getLatestVersionTag();
console.log(calculateNextVersion(latestTag));
