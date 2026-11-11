#!/usr/bin/env node
// git-repo.ts - Alias for repo-get (identity-preserved passthrough)
// Version: 1.0.0
// Description: git-repo forwards to repo-get with all arguments, exactly as
//              the bash wrapper did: bash exec'd the same-directory repo-get
//              source directly, so this port spawns the same-layer repo-get.ts
//              (not the stub chain) to preserve that dispatch.
// Requirements: Node >= 23.6 (native type-stripping execution)

import { spawnSync } from "node:child_process";
import { assertNodeFloor } from "../lib/core/node-floor.ts";
import { errorMessage } from "../lib/core/logging.ts";
import { EXIT_MISUSE } from "../lib/core/exit-codes.ts";
import { toolCli, usageCommonFlags } from "../lib/core/cli.ts";
import { splitLeadingHouseFlags } from "../lib/core/forward-argv.ts";
import { siblingInvocation } from "../lib/core/sibling.ts";

assertNodeFloor();

// Only the leading house flags are git-repo's own; everything else is
// repo-get's to judge (it parses strictly and reports misuse itself).
const { head, rest } = splitLeadingHouseFlags(process.argv.slice(2));
try {
  const cli = toolCli({ name: "git-repo", version: "1.0.0", argv: head, noDryRun: true, allowPositionals: false });
  if (cli.common.help) {
    console.log(`Usage: git-repo [options] [repo-get arguments...]

Alias for repo-get (see repo-get --help for what it accepts).
Only the leading -h/--help, -v/--version and -V/--verbose are this tool's own
(one at a time: a bundle such as -vV is forwarded). Everything else, including
-n and --devenv, is forwarded to repo-get unchanged; use -- before an argument that looks like
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

const inv = siblingInvocation("repo-get", rest);
const r = spawnSync(inv.command, inv.args, {
  stdio: "inherit",
});
process.exit(r.status ?? 1);
