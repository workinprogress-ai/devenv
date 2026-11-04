// editor — open file(s) in the user's editor, blocking until each closes.
// Port of editor.sh: EDITOR/VISUAL point here; the plain-`git commit`
// recovery hatch. Editor selection logic lives in lib/core/editor.ts
// (VS Code --wait, then PREF_EDITOR, then FALLBACK_EDITOR, then nano).

import { assertNodeFloor } from "../lib/core/node-floor.ts";
import { openInEditor } from "../lib/core/editor.ts";

assertNodeFloor();

function usage(): never {
  process.stderr.write("Usage: editor <file> [file ...]\n");
  process.stderr.write("Opens the file(s) using the editor function (blocking).\n");
  process.exit(1);
}

const targets = process.argv.slice(2);
if (targets.length < 1) usage();

// Open each path provided, blocking per file until closed.
for (const target of targets) {
  const r = openInEditor(target);
  if (!r.ok) process.exit(1);
}
