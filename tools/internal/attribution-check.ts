// attribution-check — reject AI attribution in commit messages.
// Same split as commit-action-check: message-file mode serves the local
// commit-msg hook; commit-range mode serves CI, so a clone without hooks
// cannot land attributed commits on master. The patterns live in one place,
// tools/lib/core/attribution-patterns.ts, shared with repo-commit and the
// body-posting tools. No commit type is exempt from the rule, and this tool
// checks WIP and fixup messages like any other; the hook itself does not run
// for git-wip snapshots (`git commit -n`), so CI is their only check. The match
// is best-effort: it catches the shapes AI tools write, not every disguise.
// INTERNAL tooling: invoked by .husky/commit-msg and the CI commit-messages
// job — not part of the user-facing tool surface.

import { readFileSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { assertNodeFloor } from "../lib/core/node-floor.ts";
import { EXIT_MISUSE } from "../lib/core/exit-codes.ts";
import { attributionRejection, findAttribution } from "../lib/core/attribution-patterns.ts";

assertNodeFloor();

function git(...args: string[]): { status: number; stdout: string; stderr: string } {
  const r = spawnSync("git", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  return { status: r.status ?? 1, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

function usage(): never {
  console.log(`Usage: attribution-check BASE HEAD
       attribution-check --message-file FILE

Reject AI attribution (Co-Authored-By and similar trailers naming an AI identity,
"Generated with ..." footers) in commit messages. Every change is attributed to the
human who owns it; text that merely discusses attribution passes.

Modes:
    BASE HEAD             Check every commit in BASE..HEAD (CI).
    --message-file FILE   Check one commit message (the commit-msg hook). Comment
                          lines and everything after a scissors line are ignored,
                          as git ignores them.

Options:
    -h, --help            Show help and exit
    -v, --version         Show version and exit

Exit Codes:
    0 no AI attribution found
    1 AI attribution found
    2 invalid arguments`);
  process.exit(0);
}

function invalidArgs(message: string): never {
  console.error(`ERROR: ${message}`);
  process.exit(EXIT_MISUSE);
}

// The hook receives the editor file: comment lines (and, under `commit -v`, a
// scissors section) are not part of the commit. Blank them instead of removing
// them so reported line numbers match what the author sees in the editor.
function commitBody(content: string): string {
  const configured = git("config", "--get", "core.commentChar").stdout.trim();
  const cc = configured.length === 1 ? configured : "#";
  const scissors = `${cc} ------------------------ >8 ------------------------`;
  let cut = false;
  return content
    .split(/\r?\n/)
    .map((line) => {
      if (cut || line === scissors) {
        cut = true;
        return "";
      }
      return line.startsWith(cc) ? "" : line;
    })
    .join("\n");
}

function checkMessageFile(file: string): void {
  let isFile = false;
  try {
    isFile = statSync(file).isFile();
  } catch {
    isFile = false;
  }
  if (!isFile) invalidArgs(`Message file not found: ${file}`);
  const hits = findAttribution(commitBody(readFileSync(file, "utf8")));
  if (hits.length === 0) return;
  process.stderr.write(`\n${attributionRejection(hits, "commit message")}\n\n`);
  process.exit(1);
}

function checkRange(base: string, head: string): void {
  for (const rev of [base, head]) {
    if (git("rev-parse", "--verify", "--quiet", `${rev}^{commit}`).status !== 0) invalidArgs(`Unknown revision: ${rev}`);
  }
  const revList = git("rev-list", "--reverse", `${base}..${head}`);
  if (revList.status !== 0) {
    process.stderr.write(revList.stderr);
    process.exit(1);
  }
  let failures = 0;
  for (const sha of revList.stdout.split("\n")) {
    if (sha === "") continue;
    const message = git("log", "-1", "--format=%B", sha).stdout;
    const hits = findAttribution(message);
    if (hits.length === 0) continue;
    const subject = git("log", "-1", "--format=%s", sha).stdout.trimEnd();
    process.stderr.write(`${sha.slice(0, 12)} ${subject}\n`);
    for (const h of hits) process.stderr.write(`  line ${h.line}: ${h.text}\n`);
    failures++;
  }
  if (failures > 0) {
    process.stderr.write(`${failures} commit(s) carry AI attribution. Remove the attribution lines from those commit messages and push again.\n`);
    process.exit(1);
  }
}

const argv = process.argv.slice(2);
if (argv.length === 0) invalidArgs("Provide BASE HEAD or --message-file FILE");

let messageFile = "";
const positional: string[] = [];

for (let i = 0; i < argv.length; i++) {
  const a = argv[i]!;
  if (a === "--help" || a === "-h") usage();
  if (a === "--version" || a === "-v") {
    console.log("1.0.0");
    process.exit(0);
  }
  if (a === "--message-file") {
    const v = argv[++i];
    if (v === undefined || v === "") invalidArgs("Missing value for --message-file");
    messageFile = v;
    continue;
  }
  if (a.startsWith("--")) invalidArgs(`Unknown option: ${a}`);
  positional.push(a);
}

if (messageFile !== "") {
  if (positional.length > 0) invalidArgs("--message-file cannot be combined with BASE HEAD");
  checkMessageFile(messageFile);
  process.exit(0);
}
if (positional.length !== 2) invalidArgs("Provide exactly BASE and HEAD (or --message-file FILE)");
checkRange(positional[0]!, positional[1]!);
