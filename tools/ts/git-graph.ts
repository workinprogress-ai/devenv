#!/usr/bin/env node
// git-graph.ts - Display a graphical representation of the git commit history
// Version: 1.1.0
// Description: Shows a one-line, decorated, graphical view of the commit
//              history. All arguments are passed through to git log.
// Requirements: Node >= 23.6 (native type-stripping execution)

import { spawnSync } from "node:child_process";
import { assertNodeFloor } from "../lib/core/node-floor.ts";
import { errorMessage } from "../lib/core/logging.ts";
import { EXIT_MISUSE } from "../lib/core/exit-codes.ts";
import { toolCli, usageCommonFlags } from "../lib/core/cli.ts";
import { splitLeadingHouseFlags } from "../lib/core/forward-argv.ts";

assertNodeFloor();

// Only the leading house flags are ours; every other argument is git log's
// (including its own -n and -h), so the split is positional.
const { head, rest } = splitLeadingHouseFlags(process.argv.slice(2));
try {
  const cli = toolCli({ name: "git-graph", version: "1.1.0", argv: head, noDryRun: true, allowPositionals: false });
  if (cli.common.help) {
    console.log(`Usage: git-graph [options] [git-log-arguments...]

Show a one-line decorated graph of the current history.
Only the leading -h/--help, -v/--version and -V/--verbose are this tool's own
(one at a time: a bundle such as -vV is forwarded). Everything else, including
-n and --devenv, is forwarded to git log verbatim; use -- before an argument that looks like
one of these flags.

Options:
${usageCommonFlags({ noDryRun: true, noDevenv: true })}`);
    process.exit(0);
  }
} catch (err) {
  console.error(errorMessage(err));
  console.error("Use --help for usage information");
  process.exit(EXIT_MISUSE);
}

const r = spawnSync("git", ["log", "--decorate", "--oneline", "--graph", ...rest], {
  stdio: "inherit",
});
process.exit(r.status ?? 1);
