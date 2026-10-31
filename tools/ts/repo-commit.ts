#!/usr/bin/env node
// repo-commit.ts - The single sanctioned commit wrapper. Interactive-only by design.
// Version: 1.1.0
//
// Contract (copilot-instructions.md §7):
//   - Suggested message comes in on argv or via --file; the user's configured git editor ALWAYS opens.
//   - The commit is created from the EXISTING index only, and only if the editor session
//     produces a non-empty message (i.e. the user saved). Abort (empty message) = no commit.
//   - There is NO non-interactive path. -m/--message/--yes and editor-bypass env are refused.
//   - --wip delegates to git-wip (stage-all, hooks bypassed, WIP: prefix, push, refs/wip/last);
//     WIP commit shape lives in git-wip alone. The editor gate does not apply to this lane:
//     git-wip has no editor step, so invoking --wip IS the confirmation.
//   - This tool never stages (except via the --wip delegation), never tests, never checks hooks.
//
// Only /devenv-commit may invoke this tool (governance rule; not technically enforceable).
// Requirements: Node >= 23.6 (native type-stripping execution)

import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { assertNodeFloor } from "../lib/core/node-floor.ts";
import { EXIT_CONFLICT, EXIT_GENERAL_ERROR } from "../lib/core/exit-codes.ts";

assertNodeFloor();

const toolsDir = dirname(dirname(fileURLToPath(import.meta.url)));

function die(...lines: string[]): never {
  for (const l of lines) console.error(`repo-commit: ${l}`);
  process.exit(EXIT_GENERAL_ERROR);
}

function git(args: string[], opts: { cwd?: string } = {}): { status: number; out: string } {
  const r = spawnSync("git", args, { encoding: "utf8", ...(opts.cwd !== undefined ? { cwd: opts.cwd } : {}) });
  return { status: r.status ?? 1, out: r.stdout ?? "" };
}

function usage(): void {
  console.log(`Usage: repo-commit "<suggested commit message>"
       repo-commit --file <message-file>
       repo-commit --amend [--dry-run]
       repo-commit --fix [<ref>] [--dry-run]
       repo-commit --wip ["<wip message words...>"] [--file <message-file>] [--staged-only]

Opens the user's configured git editor pre-loaded with the suggested message.
Commits the existing index only if the editor session yields a non-empty message.

  --file <path>   Read the suggested message from a file (verbatim; use for long
                  messages instead of a giant argv string).
  --amend         Fold staged content into unpushed HEAD under the editor gate
                  (HEAD's message preloaded; refuses a pushed HEAD).
  --fix [<ref>]   Fold staged content into an earlier local commit as ONE
                  editorless operation: preflight -> backup branch -> fixup
                  commit -> autosquash rebase -> verify -> report. Bare --fix on
                  a TTY opens the eligible-target picker.
  --dry-run       With --amend/--fix: print what would happen, mutate nothing.
  --wip           WIP snapshot lane: delegates to git-wip (stages everything unless
                  --staged-only, hooks bypassed, "WIP: " prefix added by git-wip,
                  pushes, records refs/wip/last). No editor step — the invocation is
                  the confirmation.

Refuses (normal lane):
  - any option other than --file (there is no -m, no --yes, no non-interactive path)
  - a finally resolved editor that is a non-interactive command (true, :, echo, cat, exit),
    also behind a wrapper (env, nice, timeout, ...) or a shell (sh -c ...)
  - an empty index (nothing staged)

A non-interactive GIT_EDITOR/core.editor value inherited from the environment is
TREATED AS UNSET (resolution falls through to the next source) — automation hosts
inject no-op editors like ':' into terminals; the user's own git config must
outrank them. Only when the RESOLVED editor is non-interactive is the commit
refused: the editor save is the permission gate.

Never stages (except via the --wip delegation to git-wip), never runs tests, never
inspects hooks.
Only /devenv-commit may invoke this tool.`);
}

/** True when the editor command is a known non-interactive no-op (an env sentinel
 * or config value that would bypass the editor gate entirely). Wrappers are looked
 * through, so "env true" or "nice -n 5 true" is judged by the command they run;
 * a shell as the editor (sh -c ...) can only be a scripted bypass.
 * Port of editor_is_noninteractive: word-walking with identical lists. */
export function editorIsNoninteractive(candidate: string): boolean {
  const words = candidate.trim().split(/\s+/).filter((w) => w !== "");
  let i = 0;
  while (i < words.length) {
    const word = words[i];
    if (word === undefined) break;
    i += 1;
    // leading VAR=value assignments belong to the command's environment
    if (/^[A-Za-z_]+=/.test(word)) continue;
    const base = word.split("/").pop() ?? word;
    switch (base) {
      case "env":
      case "command":
      case "exec":
      case "nice":
      case "nohup":
      case "timeout":
      case "setsid":
      case "stdbuf":
      case "time":
        // skip the wrapper's own options and numeric operands
        while (i < words.length) {
          const w = words[i] ?? "";
          if (w.startsWith("-") || /^[0-9]/.test(w) || /^[A-Za-z_]+=/.test(w)) i += 1;
          else break;
        }
        continue;
      case "sh":
      case "bash":
      case "dash":
      case "zsh":
      case "ksh":
      case "ash":
        return true;
      case "true":
      case ":":
      case ".":
      case "exit":
      case "echo":
      case "cat":
      case "tee":
      case "touch":
      case "rm":
      case "sleep":
        return true;
      default:
        return false;
    }
  }
  // nothing left to run
  return true;
}

let editor = "";

/** Resolve the interactive editor once (shared by the normal and amend
 * lanes): non-interactive values are treated as UNSET — automation hosts
 * inject no-op editors; the user's own config must outrank them. */
function resolveEditor(): void {
  const candidates: string[] = [
    process.env.GIT_EDITOR ?? "",
    git(["config", "--get", "core.editor"]).out.trim(),
    commandExists("code") ? "code --wait" : "",
    commandExists("nano") ? "nano" : "",
    process.env.VISUAL ?? "",
    process.env.EDITOR ?? "",
  ];
  for (const candidate of candidates) {
    if (candidate === "") continue;
    if (!editorIsNoninteractive(candidate)) {
      editor = candidate;
      break;
    }
  }
  if (editor === "") {
    die("refusing non-interactive editor — the editor save is the permission gate");
  }
}

// --- Staged-stat echo: the save/abort decision sees content size, not just
// the message. +A −B from the staged numstat (binary files excluded).
function stagedStat(): string {
  const r = git(["diff", "--cached", "--numstat"]);
  let add = 0;
  let del = 0;
  let files = 0;
  for (const line of r.out.split("\n")) {
    if (line === "") continue;
    const [a, d] = line.split("\t");
    if (a === "-" || d === "-") continue; // binary
    add += Number.parseInt(a ?? "0", 10) || 0;
    del += Number.parseInt(d ?? "0", 10) || 0;
    files += 1;
  }
  return `${files} file${files === 1 ? "" : "s"}, +${add} −${del}`;
}

// --- Scratchpad refusal: repo-commit is blocked while a scratchpad is active in
// this repo — sandbox commits belong on the scratch branch via `repo-scratchpad
// commit`, and the WIP lane would push. Standalone implementation (this tool has
// no lib deps beyond core): same sentinel text as the scratchpad_refuse contract
// in scratchpad.bash, exit EXIT_CONFLICT.
if (git(["rev-parse", "--is-inside-work-tree"]).status === 0) {
  if (git(["show-ref", "--verify", "--quiet", "refs/scratchpad/state"]).status === 0) {
    const spBranch = git(["for-each-ref", "--format=%(refname:short)", "refs/heads/scratchpad/"])
      .out.split("\n")
      .find((l) => l !== "");
    console.error(`Error: repo-commit is blocked while a scratchpad is active (${spBranch ?? "scratchpad branch"}).`);
    console.error("Salvage: repo-scratchpad promote <sha> · or leave the mode: repo-scratchpad exit");
    process.exit(EXIT_CONFLICT);
  }
}

// --- Argument parsing: message via argv or --file; --wip delegates to git-wip;
// --amend rewrites unpushed HEAD under the editor gate.
let msgfileArg = "";
let wipLane = false;
let amendLane = false;
let fixLane = false;
let fixRef = "";
let dryRun = false;
const wipArgs: string[] = [];
const rest: string[] = [];

const argv = process.argv.slice(2);
while (argv.length > 0) {
  const arg = argv.shift() ?? "";
  switch (arg) {
    case "-h":
    case "--help":
      usage();
      process.exit(0);
      break;
    case "--file": {
      const v = argv.shift();
      if (v === undefined || v === "") die("--file requires a path argument");
      msgfileArg = v;
      break;
    }
    case "--wip":
      wipLane = true;
      break;
    case "--amend":
      amendLane = true;
      break;
    case "--fix": {
      fixLane = true;
      const v = argv[0] ?? "";
      if (v !== "" && !v.startsWith("-")) fixRef = argv.shift() ?? "";
      break;
    }
    case "--dry-run":
      dryRun = true; // context validated after the argv loop (order-free)
      break;
    case "--staged-only":
      if (wipLane) wipArgs.push(arg);
      else die(`options are refused by design ('${arg}'); there is no non-interactive path`);
      break;
    default:
      if (arg.startsWith("-")) {
        die(`options are refused by design ('${arg}'); there is no non-interactive path`);
      } else if (wipLane) {
        wipArgs.push(arg);
      } else {
        rest.push(arg);
      }
  }
}

// --- Lane-flag validation: exclusivity + --dry-run context, checked after
// the full argv is parsed (order-free) and before ANY lane runs (a late
// guard after the wip/amend lanes would be dead code — those lanes exit
// first, silently swallowing the other flag).
{
  if (dryRun && !fixLane && !amendLane) {
    die("--dry-run applies to the --amend and --fix lanes only");
  }
  const lanes = [wipLane, amendLane, fixLane].filter(Boolean).length;
  if (lanes > 1) die("--wip, --amend, and --fix are mutually exclusive");
  if (fixLane && (msgfileArg !== "" || rest.length > 0)) {
    die("--fix takes no message (its fixup! subject is machine-written and consumed by the fold)");
  }
}

// --- WIP lane: delegate to git-wip; WIP commit shape lives there alone.
if (wipLane) {
  if (msgfileArg !== "") wipArgs.push("--file", msgfileArg);
  const stub = join(toolsDir, "git-wip");
  if (!existsSync(stub)) die(`git-wip stub not found next to repo-commit: ${stub}`);
  const r = spawnSync(stub, wipArgs, { stdio: "inherit" });
  process.exit(r.status ?? EXIT_GENERAL_ERROR);
}

// --- Amend lane: rewrite unpushed HEAD. The editor preloads HEAD's existing
// message (the user is editing it, not replacing it); hooks run; the save is
// the permission gate exactly as the normal lane. Refuses fail-closed when
// HEAD is on any remote ref — amending pushed history must never happen
// silently (remediation: --fix for an earlier commit, or a plain fix commit).
if (amendLane) {
  if (git(["diff", "--cached", "--quiet"]).status === 0) {
    die("nothing is staged — amend folds staged content into HEAD; stage first");
  }
  const pushed = git(["branch", "-r", "--contains", "HEAD"]).out.trim();
  if (pushed !== "") {
    die(
      `HEAD is on remote ref(s) ${pushed.split("\n").join(", ")} — amending pushed history is refused`,
      "remediation: use --fix <ref> for an earlier commit, or land a plain fix commit",
    );
  }
  const headMsg = git(["log", "-1", "--format=%B"]).out;
  if (headMsg.trim() === "") die("HEAD has no message to preload — refusing to amend blindly");
  if (dryRun) {
    console.log(`repo-commit: --amend dry-run`);
    console.log(`  would fold staged content into HEAD and open the editor with its current message`);
    console.log(`  staged: ${stagedStat()}`);
    process.exit(0);
  }
  resolveEditor();
  console.log(`repo-commit: staged: ${stagedStat()}`);
  console.log(`repo-commit: opening editor: ${editor}  (amend: save & close to fold staged content into HEAD; empty/abort cancels)`);
  const amendTmp = mkdtempSync(join(tmpdir(), "repo-commit-msg-"));
  const amendMsgfile = join(amendTmp, "message");
  writeFileSync(amendMsgfile, headMsg.endsWith("\n") ? headMsg : `${headMsg}\n`);
  const amend = spawnSync("git", ["commit", "--cleanup=strip", "--amend", "--edit", "-F", amendMsgfile], {
    stdio: "inherit",
    env: { ...process.env, GIT_EDITOR: editor },
  });
  rmSync(amendTmp, { recursive: true, force: true });
  if (amend.status !== 0) {
    die("amend did not complete (editor session aborted or git failed) — index left untouched");
  }
  const amendLog = git(["log", "-1", "--format=%h %s"]).out.trim();
  console.log(`repo-commit: amended. ${amendLog}`);
  process.exit(0);
}

// --- Fix lane: fold staged content into an EARLIER commit as one operation,
// batteries included, editorless by design (the fixup message is machine-
// written and consumed by the fold; consent is the explicit invocation plus
// the preflight refusals, the backup branch, and hooks — which run).
// Sequence: preflight -> backup branch -> fixup commit -> autosquash rebase
// -> verify -> report. Any surprise auto-aborts to a git-status-describable
// state with the work preserved as an ordinary commit.
if (fixLane) {
  if (git(["diff", "--cached", "--quiet"]).status === 0) {
    die("nothing is staged — --fix folds staged content into an earlier commit; stage first");
  }
  // Resolve the target: explicit ref, or the interactive picker over
  // eligible commits (local ancestors of HEAD, not on any remote).
  let target = fixRef;
  if (target === "") {
    const interactive = process.stdin.isTTY === true && process.stdout.isTTY === true;
    if (!interactive) {
      die("--fix without a ref needs a TTY for the target picker — pass a ref (--fix <commit-ish>)");
    }
    let select: <T>(opts: { message: string; fallback: T; options: { value: T; label: string; hint?: string }[] }) => Promise<T>;
    try {
      ({ select } = await import("../lib/ui/prompts.ts"));
    } catch {
      die("the interactive picker is unavailable (@clack/prompts not resolvable) — pass a ref (--fix <commit-ish>)");
    }
    const head = git(["rev-parse", "HEAD"]).out.trim();
    // eligible: local-only ancestors of HEAD (per-commit --contains check)
    const log = git(["log", "--format=%H%x09%h%x09%s", "-n", "50"]).out.split("\n").filter((l) => l !== "");
    const eligible: { value: string; label: string; hint?: string }[] = [];
    for (const line of log) {
      const [full, short, subject] = line.split("\t");
      if (full === undefined || short === undefined || subject === undefined) continue;
      const contained = git(["branch", "-r", "--contains", full]).out.trim();
      if (contained !== "") continue; // pushed: not foldable
      if (full === head) continue; // HEAD routes to --amend
      eligible.push({ value: full, label: `${short} ${subject}` });
    }
    if (eligible.length === 0) {
      die("no eligible targets: every ancestor is pushed or HEAD (use --amend for HEAD)");
    }
    target = await select({
      message: "Fold staged content into which commit?",
      fallback: "",
      options: eligible,
    });
    if (target === "") die("no target selected — aborting");
  }
  // Resolve + preflight the target ref.
  const resolved = git(["rev-parse", "--verify", `${target}^{commit}`]);
  if (resolved.status !== 0) die(`cannot resolve '${target}' as a commit`);
  const targetSha = resolved.out.trim();
  const isAncestor = git(["merge-base", "--is-ancestor", targetSha, "HEAD"]).status === 0;
  if (!isAncestor) die(`'${target}' is not an ancestor of HEAD — you can only fold into your own stack`);
  const targetPushed = git(["branch", "-r", "--contains", targetSha]).out.trim();
  const targetTagged = git(["tag", "--contains", targetSha]).out.trim();
  if (targetPushed !== "" || targetTagged !== "") {
    die(
      `'${target}' is reachable from remote ref(s) ${targetPushed.split("\n").join(", ")} or tag(s) ${targetTagged.split("\n").join(", ")} — folding shared history is refused`,
      "remediation: land a plain fix: commit instead",
    );
  }
  if (targetSha === git(["rev-parse", "HEAD"]).out.trim()) {
    die("target is HEAD — use --amend instead");
  }
  const hasParent = git(["rev-parse", "--verify", "--quiet", `${targetSha}^`]).status === 0;
  if (!hasParent) {
    die(
      `target '${target}' is the root commit — folding into it would rewrite the entire history start`,
      "remediation: land a plain fix: commit instead",
    );
  }
  const targetSubject = git(["log", "-1", "--format=%s", targetSha]).out.trim();
  const oldHead = git(["rev-parse", "HEAD"]).out.trim();
  const oldHeadShort = git(["rev-parse", "--short", oldHead]).out.trim();

  if (dryRun) {
    const rehashed = git(["rev-list", "--count", `${targetSha}..HEAD`]).out.trim();
    console.log(`repo-commit: --fix dry-run`);
    console.log(`  target:   ${targetSha.slice(0, 8)} ${targetSubject}`);
    console.log(`  staged:   ${stagedStat()}`);
    console.log(`  rehash:   ${rehashed} commit(s) after the target would be rewritten`);
    console.log(`  backup:   backup/pre-fixup-${oldHeadShort} would be created`);
    process.exit(0);
  }

  // Backup branch: the recovery point, reported with a one-line recipe.
  const backup = `backup/pre-fixup-${oldHeadShort}`;
  const bk = git(["branch", backup, oldHead]);
  if (bk.status !== 0) die(`failed to create backup branch ${backup}: ${bk.out.trim()}`);
  console.log(`repo-commit: backup branch ${backup} (recovery: git reset --hard ${backup})`);

  // Fixup commit: machine message, hooks run (the commitlint ignores entry
  // exists precisely so this passes).
  const fixup = git(["commit", "--fixup=" + targetSha]);
  if (fixup.status !== 0) {
    die(`fixup commit failed (hooks?): ${fixup.out.trim()}`, `recovery: the backup branch ${backup} holds the old stack`);
  }

  // Autosquash fold: GIT_SEQUENCE_EDITOR=: runs the todo-list editor as a
  // no-op — the standard non-interactive autosquash. --autostash preserves
  // unstaged work (built to be reversible).
  const fold = spawnSync(
    "git",
    ["rebase", "--autosquash", "--autostash", "-i", `${targetSha}~1`],
    { encoding: "utf8", env: { ...process.env, GIT_SEQUENCE_EDITOR: ":" } },
  );
  if (fold.status !== 0) {
    // Fail to a describable state: abort the rebase (the fixup commit
    // survives at HEAD — the work is an ordinary commit, nothing lost).
    spawnSync("git", ["rebase", "--abort"], { encoding: "utf8" });
    const fixupAtHead = git(["log", "-1", "--format=%s"]).out.trim().startsWith("fixup!");
    die(
      `autosquash rebase failed (conflict) — rebase aborted${fixupAtHead ? "; the fixup commit is preserved at HEAD" : ""}`,
      `resolve manually or recover: git reset --hard ${backup}`,
    );
  }

  // Verify + report. The fixup! grep is scoped to the rewritten range —
  // an unscoped scan would flag pre-existing fixup! subjects anywhere in
  // history and "fail" after a successful fold.
  const newHead = git(["rev-parse", "HEAD"]).out.trim();
  const foldedSubject = git(["log", "--format=%s", `--grep=^fixup!`, `${targetSha}..HEAD`]).out.trim();
  if (newHead === oldHead || foldedSubject !== "") {
    die(
      "fold verification failed (HEAD unchanged or a fixup! commit remains) — inspect manually",
      `recovery: git reset --hard ${backup}`,
    );
  }
  const newTarget = git(["log", "--format=%h %s", `--grep=${escapeGrep(targetSubject)}`, "-1", `${targetSha}..HEAD`]).out.trim();
  console.log(`repo-commit: folded staged content into ${newTarget || targetSubject}`);
  console.log(`  old stack: ${backup}`);
  const diverged = git(["status", "-sb"]).out.includes("ahead");
  console.log(`  note: ${diverged ? "branch diverged from its remote — push with --force-with-lease when ready" : "no remote tracking"}`);
  process.exit(0);
}

/** Escape ERE metacharacters for --grep (subjects may contain them).
 *
 * git log --grep matches with basic/extended regex (basic by default),
 * not fixed strings, so metacharacters in a subject would otherwise be
 * interpreted. (The report line below is the only match-sensitive consumer.)
 * For callers wanting literal matching, `git log -F --grep=<s>` is the
 * honest alternative; kept as escaping here so --grep stays consistent. */
function escapeGrep(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// --- Resolve the suggested message.
let suggested: string;
if (msgfileArg !== "") {
  if (rest.length > 0) die("--file and a positional message are mutually exclusive");
  if (!existsSync(msgfileArg)) die(`message file not found: ${msgfileArg}`);
  suggested = readFileSync(msgfileArg, "utf8");
  if (suggested === "") die(`message file is empty: ${msgfileArg}`);
} else {
  if (rest.length === 0) {
    console.error("Usage: repo-commit \"<suggested commit message>\"");
    die("a suggested commit message is required as the only argument (or pass --file <message-file>)");
  }
  if (rest.length > 1) die("exactly one argument (the suggested message) or --file is required");
  suggested = rest[0] ?? "";
}

// --- Refuse an empty index (staging stays 100% manual).
if (git(["diff", "--cached", "--quiet"]).status === 0) {
  die("nothing is staged — staging is manual; use git add yourself, then re-run");
}

// --- Resolve the editor: VS Code first, nano fallback (user ruling).
// Non-interactive values are treated as UNSET: automation hosts inject no-op
// editors (GIT_EDITOR=:) into terminals; the user's own core.editor must outrank
// them. The gate above still refuses if EVERY source resolves non-interactive.
function commandExists(cmd: string): boolean {
  return spawnSync("sh", ["-c", `command -v ${cmd} >/dev/null 2>&1`]).status === 0;
}



// --- Launch the editor with the suggested message; commit only on save.
resolveEditor();
console.log(`repo-commit: staged: ${stagedStat()}`);
// msgfile is a temp file for the editor session — removed afterwards.
const tmpDir = mkdtempSync(join(tmpdir(), "repo-commit-msg-"));
const msgfile = join(tmpDir, "message");
writeFileSync(msgfile, `${suggested}\n`);

// GIT_EDITOR must win over any config for this invocation; export explicitly.
// --edit forces the editor open on the supplied message; without it git skips
// the editor entirely — the editor open IS the permission gate. git aborts the
// commit when the editor session empties the message; that abort IS the cancel
// path. git's stdout/stderr pass through UNREDIRECTED (stdio inherit): terminal
// editors draw their UI on the TTY. The one-line notice says which editor is
// taking over the terminal.
console.log(`repo-commit: opening editor: ${editor}  (save & close to commit; empty/abort cancels)`);
console.log("repo-commit: pre-commit hooks run after the editor closes; on this repo the suite takes minutes — wait for the final line, do not assume a hang.");
// stdin/stdout stay inherited (terminal editors draw their UI there); stderr is
// piped so a HOOK rejection can be told apart from an editor abort — with full
// inherit, spawnSync captures nothing and the two failures are indistinguishable.
const commit = spawnSync("git", ["commit", "--cleanup=strip", "--edit", "-F", msgfile], {
  stdio: ["inherit", "inherit", "pipe"],
  env: { ...process.env, GIT_EDITOR: editor },
});
const commitStderr = commit.stderr instanceof Buffer
  ? commit.stderr.toString()
  : typeof commit.stderr === "string" ? commit.stderr : "";
if (commitStderr !== "") process.stderr.write(commitStderr);
rmSync(tmpDir, { recursive: true, force: true });
if (commit.status !== 0) {
  // Distinguish the two abort classes honestly: a HOOK rejection prints its
  // own diagnostics (reprinted above from the captured stderr) — naming it
  // prevents misreading a failed suite as an editor abort.
  if (/hook|Test suite failed|Tests failed/i.test(commitStderr)) {
    die("commit rejected by a pre-commit hook — no commit exists, index untouched (the failure's output is above)");
  }
  die("commit did not complete (editor session aborted or git failed) — index left untouched");
}

// --- Confirm outcome honestly.
if (git(["diff", "--cached", "--quiet"]).status === 0) {
  console.log("repo-commit: commit created.");
  const log = git(["log", "-1", "--format=%h %s"]).out.trim();
  console.log(`repo-commit: ${log}`);
} else {
  die("commit did not complete — index left untouched");
}
