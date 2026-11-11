// editor — open file(s) in the user's editor, blocking until each closes.
// Port of editor.sh: EDITOR/VISUAL point here; the plain-`git commit`
// recovery hatch. Editor selection logic lives in lib/core/editor.ts
// (VS Code --wait, then PREF_EDITOR, then FALLBACK_EDITOR, then nano).

import { assertNodeFloor } from "../lib/core/node-floor.ts";
import { errorMessage } from "../lib/core/logging.ts";
import { toolCli, usageCommonFlags } from "../lib/core/cli.ts";
import { openInEditor } from "../lib/core/editor.ts";
import { EXIT_MISUSE, EXIT_SUCCESS } from "../lib/core/exit-codes.ts";

assertNodeFloor();

const SCRIPT_VERSION = "1.0.0";

const USAGE_TEXT = `Usage: editor <file> [file ...]

Opens the file(s) using the editor function (blocking).

Options:
${usageCommonFlags({ noDryRun: true, noDevenv: true })}`;

/** Help is a success on stdout; misuse (no file, unknown flag) is exit 2 on stderr. */
function usage(code: number): never {
  (code === EXIT_SUCCESS ? process.stdout : process.stderr).write(USAGE_TEXT);
  process.exit(code);
}

let targets: string[] = [];
try {
  const cli = toolCli({
    name: "editor",
    version: SCRIPT_VERSION,
    argv: process.argv.slice(2),
    noDryRun: true,
  });
  if (cli.common.help) usage(EXIT_SUCCESS);
  targets = cli.positionals;
} catch (err) {
  console.error(errorMessage(err));
  usage(EXIT_MISUSE);
}

if (targets.length < 1) usage(EXIT_MISUSE);

// Open each path provided, blocking per file until closed.
for (const target of targets) {
  const r = openInEditor(target);
  if (!r.ok) process.exit(1);
}
