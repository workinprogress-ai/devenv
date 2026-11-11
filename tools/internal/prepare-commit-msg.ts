// prepare-commit-msg — give a commit message its Change-Id trailer.
// Port of tools/internal/prepare-commit-msg.sh. The hook adds a stable
// Change-Id when the message has none, and an empty Devenv-Action
// placeholder when an editor will open. An existing trailer is never
// replaced, so amend, rebase and cherry-pick keep their identity.
// INTERNAL machinery: invoked by the .husky/prepare-commit-msg shim.

import { readFileSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { assertNodeFloor } from "../lib/core/node-floor.ts";
import { editorIsNoninteractive } from "../lib/core/editor.ts";
import {
  changeIdGenerate,
  changeIdGetTrailer,
  changeIdIsValid,
} from "../lib/core/change-id.ts";

assertNodeFloor();

function usage(): never {
  console.log(`Usage: prepare-commit-msg MESSAGE_FILE [SOURCE [SHA]]

Add a Change-Id trailer to the commit message in MESSAGE_FILE. SOURCE is the second
argument git passes to prepare-commit-msg:

    (empty), template     an editor will open: also add Devenv-Action: nothing
    message, commit       -m/-F, cherry-pick, rebase pick, amend, reword: Change-Id only
    merge, squash         left untouched
    WIP: subject          left untouched (temporary by design)

Options:
    -h, --help            Show help and exit
    -v, --version         Show version and exit

Exit Codes:
    0 success
    2 invalid arguments`);
  process.exit(0);
}

const argv = process.argv.slice(2);
if (argv[0] === "--help" || argv[0] === "-h") usage();
if (argv[0] === "--version" || argv[0] === "-v") {
  console.log("1.0.0");
  process.exit(0);
}

const file = argv[0] ?? "";
const sourceKind = argv[1] ?? "";

if (file === "") {
  console.error("ERROR: Provide the commit message file");
  process.exit(2);
}
let isFile = false;
try {
  isFile = statSync(file).isFile();
} catch {
  isFile = false;
}
if (!isFile) {
  console.error(`ERROR: Message file not found: ${file}`);
  process.exit(2);
}

// merge and squash: left untouched.
if (sourceKind === "merge" || sourceKind === "squash") process.exit(0);

const firstLine = readFileSync(file, "utf8").split("\n", 1)[0] ?? "";
if (firstLine.startsWith("WIP:")) process.exit(0);

// NOTE: no comment-only guard here. The editor flow pre-fills trailers even
// into the bare `-e -n` scaffold; commit-action-check's subject-presence
// guard then fails the commit at commit-msg time if the author closes
// without typing a subject. Removing the prefill instead would break the
// editor-populates-footers flow.
const message = readFileSync(file, "utf8");

const trailers: string[] = [];
const existing = changeIdGetTrailer(message, "Change-Id");
if (existing === "") {
  const id = changeIdGenerate();
  if (id === null) {
    console.error("ERROR: could not generate a Change-Id (rng failure)");
    process.exit(1);
  }
  trailers.push(`--trailer`, `Change-Id: ${id}`);
} else if (!changeIdIsValid(existing)) {
  process.stderr.write(
    `warning: the Change-Id '${existing}' is not usable (8 to 64 characters from A-Z a-z 0-9 . _ -); fork-export will not export this commit\n`,
  );
}

if (sourceKind === "" || sourceKind === "template") {
  // A no-op editor (':'/'true'/'.', a shell, a no-op wrapper) means git never opens anything: the
  // author never sees the buffer, and the prefilled trailers ship as-is as
  // the message. Warn loudly so the failure is visible at the moment it
  // happens instead of a mystery in the commit log.
  const editorVar = spawnSync("git", ["var", "GIT_EDITOR"], { encoding: "utf8" });
  const editor = editorVar.status === 0 ? (editorVar.stdout ?? "").trim() : "";
  if (editor !== "" && editorIsNoninteractive(editor)) {
    process.stderr.write(
      `warning: the effective editor is '${editor}' (a no-op) — no editor will open and the prefilled trailers will be committed as the message; unset the GIT_EDITOR/core.editor override to restore the interactive flow\n`,
    );
  }
  if (changeIdGetTrailer(message, "Devenv-Action") === "") {
    trailers.push(`--trailer`, `Devenv-Action: nothing`);
  }
}

// NOTE: no subject-placeholder seeding here. Seeding a placeholder line into
// the editor buffer made lazy closes commit it as the literal subject. The
// editor pops with the prefilled trailers only; the author types the subject.

if (trailers.length === 0) process.exit(0);

const r = spawnSync(
  "git",
  ["interpret-trailers", "--in-place", "--if-exists", "doNothing", ...trailers, file],
  { stdio: "inherit" },
);
process.exit(r.status ?? 1);
