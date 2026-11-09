// editor — open file(s) in the user's editor, blocking until each closes.
// Port of editor.sh: EDITOR/VISUAL point here; the plain-`git commit`
// recovery hatch. Editor selection logic lives in lib/core/editor.ts
// (VS Code --wait, then PREF_EDITOR, then FALLBACK_EDITOR, then nano).

import { assertNodeFloor } from "../lib/core/node-floor.ts";
import { errorMessage } from "../lib/core/logging.ts";
import { toolCli, usageCommonFlags } from "../lib/core/cli.ts";
import { openInEditor } from "../lib/core/editor.ts";

assertNodeFloor();

const SCRIPT_VERSION = "1.0.0";

function usage(): never {
  process.stderr.write(`Usage: editor <file> [file ...]

Opens the file(s) using the editor function (blocking).

Options:
${usageCommonFlags({ noDryRun: true, noDevenv: true })}`);
  process.exit(1);
}

let targets: string[] = [];
try {
  const cli = toolCli({
    name: "editor",
    version: SCRIPT_VERSION,
    argv: process.argv.slice(2),
    noDryRun: true,
  });
  if (cli.common.help) {
    // Bash parity: usage goes to stderr with exit 1 (it is both help and
    // the missing-argument refusal — EDITOR contract).
    usage();
  }
  targets = cli.positionals;
} catch (err) {
  console.error(errorMessage(err));
  usage();
}

if (targets.length < 1) usage();

// Open each path provided, blocking per file until closed.
for (const target of targets) {
  const r = openInEditor(target);
  if (!r.ok) process.exit(1);
}
