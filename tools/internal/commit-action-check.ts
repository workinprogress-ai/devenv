// commit-action-check — enforce the Devenv-Action commit trailer.
// Port of tools/internal/commit-action-check.sh. One home for the rule:
// message-file mode serves the local commit-msg hook; commit-range mode
// serves CI, so a clone without hooks cannot land trailer-less commits on
// master. INTERNAL tooling: invoked by .husky/commit-msg and the CI
// commit-messages job — not part of the user-facing tool surface.

import { readFileSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { assertNodeFloor } from "../lib/core/node-floor.ts";
import { EXIT_MISUSE } from "../lib/core/exit-codes.ts";
import { changeIdGetFromMessage } from "../lib/core/change-id.ts";

assertNodeFloor();

const VALID_ACTIONS = ["nothing", "restart", "bootstrap", "recreate"] as const;

function git(...args: string[]): { status: number; stdout: string; stderr: string } {
  const r = spawnSync("git", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  return { status: r.status ?? 1, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

function usage(): never {
  console.log(`Usage: commit-action-check BASE HEAD
       commit-action-check --message-file FILE

Validate the Devenv-Action trailer (valid values: ${VALID_ACTIONS.join(", ")}).

Modes:
    BASE HEAD             Check every commit in BASE..HEAD (CI). A WIP: commit is
                          an error: WIP commits never reach master.
    --message-file FILE   Check one commit message (the commit-msg hook). A
                          WIP: subject is exempt — it is temporary by design.

Options:
    -h, --help            Show help and exit
    -v, --version         Show version and exit

Exit Codes:
    0 every checked commit carries a valid trailer
    1 one or more commits are missing or have an invalid trailer
    2 invalid arguments`);
  process.exit(0);
}

function invalidArgs(message: string): never {
  console.error(`ERROR: ${message}`);
  process.exit(EXIT_MISUSE);
}

// True when the message text carries a valid trailer line.
function hasValidTrailer(message: string): boolean {
  const re = new RegExp(`^Devenv-Action: (${VALID_ACTIONS.join("|")})$`, "im");
  return re.test(message);
}

function printGuidance(): void {
  process.stderr.write(`

error: Missing or invalid 'Devenv-Action' trailer.

  Every commit to this repository must include a Devenv-Action trailer in the
  commit body telling consumers what to do after pulling.

  Add one of the following lines to the end of your commit message:

    Devenv-Action: nothing    (no action needed)
    Devenv-Action: restart    (restart the dev container)
    Devenv-Action: bootstrap  (re-run bootstrap, then restart)
    Devenv-Action: recreate   (rebuild/recreate the dev container)

  Use the lowest action that is actually needed.
  See docs/Dev-container-environment.md for guidance.

`);
}

function checkMessageFile(file: string): void {
  let isFile = false;
  try {
    isFile = statSync(file).isFile();
  } catch {
    isFile = false;
  }
  if (!isFile) invalidArgs(`Message file not found: ${file}`);

  const content = readFileSync(file, "utf8");
  const subject = content.split("\n", 1)[0] ?? "";
  if (subject.startsWith("WIP:")) process.exit(0);
  // fixup!/squash! messages are machine-written by git and consumed by an
  // autosquash fold — they never reach master, so a trailer on them would be
  // both unwriteable and meaningless (commitlint carries the same exemption).
  if (/^(fixup!|squash!) /.test(subject)) process.exit(0);

  // Subject-presence guard (commit-msg hook only): prepare-commit-msg
  // pre-fills trailers into the editor buffer. If the author closes the
  // editor without typing a subject, the surviving message is trailers-only
  // — git strips the comments and the trailers become the "subject", an
  // accidental garbage commit. The first non-comment line must be a subject
  // that is NOT a known trailer (Conventional Commit subjects are shaped
  // "type: ..." and must not be excluded as trailers).
  const firstContent = content.split("\n").find((l) => !/^[ \t]*(#|$)/.test(l)) ?? "";
  if (
    firstContent === "" ||
    firstContent.startsWith("Change-Id:") ||
    firstContent.startsWith("Devenv-Action:") ||
    firstContent === "<type>: <subject>"
  ) {
    process.stderr.write(`

error: commit message has no subject.

  The editor closed without a commit message — only the pre-filled trailers
  and comments remained. Type a subject line in the editor before saving.

`);
    process.exit(1);
  }

  if (!hasValidTrailer(content)) {
    printGuidance();
    process.exit(1);
  }
  if (changeIdGetFromMessage(content) === null) {
    process.stderr.write(
      "warning: no Change-Id trailer; fork-export will not export this commit.\n",
    );
  }
}

function checkRange(base: string, head: string): void {
  if (git("rev-parse", "--verify", "--quiet", `${base}^{commit}`).status !== 0) {
    invalidArgs(`Unknown revision: ${base}`);
  }
  if (git("rev-parse", "--verify", "--quiet", `${head}^{commit}`).status !== 0) {
    invalidArgs(`Unknown revision: ${head}`);
  }
  const revList = git("rev-list", "--reverse", `${base}..${head}`);
  if (revList.status !== 0) {
    process.stderr.write(revList.stderr);
    process.exit(1);
  }
  let failures = 0;
  let missingIds = 0;
  for (const sha of revList.stdout.split("\n")) {
    if (sha === "") continue;
    const subject = git("log", "-1", "--format=%s", sha).stdout.trimEnd();
    const message = git("log", "-1", "--format=%B", sha).stdout;
    if (subject.startsWith("WIP:")) {
      process.stderr.write(`${sha.slice(0, 12)} ${subject} — WIP commits must not reach master\n`);
      failures++;
      continue;
    }
    // fixup!/squash! commits are fold intermediates; the range check (CI and
    // fold verification) must not demand a trailer the fold will delete.
    if (/^(fixup!|squash!) /.test(subject)) continue;
    if (!hasValidTrailer(message)) {
      process.stderr.write(`${sha.slice(0, 12)} ${subject} — missing or invalid Devenv-Action trailer\n`);
      failures++;
    }
    if (changeIdGetFromMessage(message) === null) {
      process.stderr.write(`${sha.slice(0, 12)} ${subject} — warning: no Change-Id trailer (fork-export will not export it)\n`);
      missingIds++;
    }
  }
  if (missingIds > 0) {
    process.stderr.write(`warning: ${missingIds} commit(s) have no Change-Id trailer.\n`);
  }
  if (failures > 0) {
    process.stderr.write(`${failures} commit(s) failed the Devenv-Action trailer check.\n`);
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
