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
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { assertNodeFloor } from "../lib/core/node-floor.ts";
import { toolCli } from "../lib/core/cli.ts";
import { EXIT_CONFLICT, EXIT_GENERAL_ERROR } from "../lib/core/exit-codes.ts";

assertNodeFloor();

const toolsDir = dirname(dirname(fileURLToPath(import.meta.url)));

function die(...lines: string[]): never {
  for (const l of lines) console.error(`repo-commit: ${l}`);
  process.exit(EXIT_GENERAL_ERROR);
}

function git(args: string[], opts: { cwd?: string } = {}): { status: number; out: string } {
  const r = spawnSync("git", args, { encoding: "utf8", ...(opts.cwd !== undefined ? { cwd: opts.cwd } : {}) });
  // stdout AND stderr: hook failures (the commit gates) write to stderr, so
  // an out.trim() built from stdout alone reports an empty diagnostic.
  return { status: r.status ?? 1, out: (r.stdout ?? "") + (r.stderr ?? "") };
}

// --- The fold-window boundary: master-reachability, not remote-ref presence.
// This workflow's PR branches are rebased and force-pushed routinely, so a
// pushed-but-unlanded commit stays foldable; master (local branch or its
// remote-tracking ref) and tags are the permanent record. One helper serves
// both fold lanes (--amend HEAD check, --fix target check) and the picker's
// eligibility filter, so the boundary cannot drift between them.
function foldWindowClosed(shaOrRef: string): boolean {
  const sha = git(["rev-parse", "--verify", `${shaOrRef}^{commit}`]).out.trim() || shaOrRef;
  const tagged = git(["tag", "--contains", sha]).out.trim() !== "";
  if (tagged) return true;
  const remoteMaster = git(["rev-parse", "--verify", "--quiet", "refs/remotes/origin/master"]);
  if (remoteMaster.status === 0) {
    // The permanent record is the remote-tracking master: a commit it reaches
    // has landed, one it does not reach is unlanded even if a local master
    // branch (or a pushed feature branch) contains it. The local branch ref is
    // skipped here deliberately — HEAD sitting on master is always trivially
    // "contained" by it, which would refuse every amend on a master checkout.
    return git(["merge-base", "--is-ancestor", sha, "refs/remotes/origin/master"]).status === 0;
  }
  // No remote-tracking master (local-only repo): local master is the record.
  const localMaster = git(["rev-parse", "--verify", "--quiet", "master"]);
  return localMaster.status === 0
    && git(["merge-base", "--is-ancestor", sha, "master"]).status === 0;
}

function usage(): void {
  console.log(`Usage: repo-commit "<suggested commit message>"
       repo-commit --file <message-file>
       repo-commit --amend [--dry-run]
       repo-commit --fix [<ref>] [--dry-run]
       repo-commit --wip ["<wip message words...>"] [--file <message-file>] [--staged-only]
       repo-commit --fold-window
       repo-commit --reword <ref> [--dry-run]

Opens the user's configured git editor pre-loaded with the suggested message.
Commits the existing index only if the editor session yields a non-empty message.

  --file <path>   Read the suggested message from a file (verbatim; use for long
                  messages instead of a giant argv string).
  --amend         Fold staged content into HEAD not yet landed in master, under
                  the editor gate (HEAD's message preloaded; refuses HEAD that
                  master already reached). With a clean index this is a
                  message-only rewrite of HEAD — the sanctioned route for
                  editing HEAD's message when nothing is staged.
  --fix [<ref>]   Fold staged content into an earlier local commit as ONE
                  editorless operation: preflight -> backup branch -> fixup
                  commit -> autosquash rebase -> verify -> report. Bare --fix on
                  a TTY opens the eligible-target picker.
  --dry-run       With --amend/--fix: print what would happen, mutate nothing.
  --fold-window   Read-only report: the branch's foldable commits (not landed
                  in master) newest-first with the files each touched, plus a
                  cross-check of staged/working changes that overlap a foldable
                  commit's files. No staging requirement, no mutation.
  --reword <ref>  Change an earlier commit's message only (no content folds):
                  preflight -> backup branch -> editor gate on the new message
                  -> autosquash reword -> verify -> report. Staged content is
                  irrelevant for earlier targets and untouched; <ref> may be
                  HEAD on a clean index (with staged content, use --amend).
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

// House flags (-h/-v/-V) parse through the shared toolCli scaffold; the lane
// grammar below stays a hand-rolled token walk because it is order-dependent
// (--staged-only only after --wip) and forwards raw message words — parseArgs
// cannot express it faithfully. Non-strict so unknown tokens keep reaching
// the by-design refusal in the walk.
try {
  const cli = toolCli({
    name: "repo-commit",
    version: "1.1.0",
    argv: process.argv.slice(2),
    strict: false,
  });
  if (cli.common.help) {
    usage();
    process.exit(0);
  }
} catch {
  // Non-strict parse cannot throw on unknown tokens; defensive only.
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
// --amend rewrites HEAD not yet landed in master under the editor gate.
// The fold window closes when origin/master reaches the commit, or a tag
// names it — the remote-tracking master is the permanent record (local
// master governs only in repos without one).
// Remote-only branch membership (pushed feature branches, routine in this
// rebase-and-force-push workflow) keeps the commit foldable.
let msgfileArg = "";
let wipLane = false;
let amendLane = false;
let fixLane = false;
let foldWindowLane = false;
let rewordLane = false;
let fixRef = "";
let rewordRef = "";
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
    case "--fold-window":
      foldWindowLane = true;
      break;
    case "--reword": {
      rewordLane = true;
      const v = argv[0] ?? "";
      if (v !== "" && !v.startsWith("-")) rewordRef = argv.shift() ?? "";
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
  if (dryRun && !fixLane && !amendLane && !rewordLane) {
    die("--dry-run applies to the --amend, --fix, and --reword lanes only");
  }
  const lanes = [wipLane, amendLane, fixLane, foldWindowLane, rewordLane].filter(Boolean).length;
  if (lanes > 1) die("--wip, --amend, --fix, --fold-window, and --reword are mutually exclusive");
  if (rewordLane && rewordRef === "") die("--reword requires a target ref (--reword <commit-ish>)");
  if (foldWindowLane && (msgfileArg !== "" || rest.length > 0 || dryRun)) {
    die("--fold-window takes no message, no --file, and no --dry-run (read-only report)");
  }
  if (fixLane && (msgfileArg !== "" || rest.length > 0)) {
    die("--fix takes no message (its fixup! subject is machine-written and consumed by the fold)");
  }
}

// --- Fold-window report: read-only map of the branch's foldable commits.
if (foldWindowLane) {
  const log = git(["log", "--format=%h%x09%H%x09%s", "--name-only", "-n", "50"]).out.split("\n");
  // Parse the interleaved format: header line, then file lines, then blank.
  type Entry = { short: string; full: string; subject: string; files: string[] };
  const entries: Entry[] = [];
  let current: Entry | undefined;
  for (const line of log) {
    if (line === "") continue; // separator between entries; next header rebinds
    const [short, full, subject] = line.split("\t");
    if (short !== undefined && full !== undefined && subject !== undefined) {
      current = { short, full, subject, files: [] };
      entries.push(current);
    } else if (current !== undefined && line.trim() !== "") {
      current.files.push(line);
    }
  }
  const foldable = entries.filter((e) => !foldWindowClosed(e.full));
  if (foldable.length === 0) {
    console.log("repo-commit: fold window is empty — every commit on this branch has landed in master (or is tagged)");
    process.exit(0);
  }
  console.log(`repo-commit: fold window (${foldable.length} foldable commit(s), newest first):`);
  for (const e of foldable) {
    console.log(`  ${e.short} ${e.subject}`);
    for (const f of e.files) console.log(`      ${f}`);
  }
  // Overlap cross-check: staged/working changes that touch a foldable commit's
  // files — purely presentational; the commit skill's interview decides folds.
  // Staged + unstaged + untracked paths, statuses stripped (XY + space).
  const working = new Set(
    git(["status", "--porcelain"]).out.split("\n")
      .filter((l) => l.trim() !== "")
      .map((l) => l.replace(/^..\s+/, "").replace(/^"|"$/g, "").trim()),
  );
  const overlaps = foldable.filter((e) => e.files.some((f) => working.has(f)));
  if (overlaps.length > 0) {
    console.log("repo-commit: staged/working changes overlap foldable commit(s):");
    for (const e of overlaps) {
      const hit = e.files.filter((f) => working.has(f)).join(", ");
      console.log(`  fold candidate: ${e.short} ${e.subject} — ${hit}`);
    }
  } else {
    console.log("repo-commit: no staged/working overlap with the fold window");
  }
  process.exit(0);
}

// --- WIP lane: delegate to git-wip; WIP commit shape lives there alone.
if (wipLane) {
  if (msgfileArg !== "") wipArgs.push("--file", msgfileArg);
  const stub = join(toolsDir, "git-wip");
  if (!existsSync(stub)) die(`git-wip stub not found next to repo-commit: ${stub}`);
  const r = spawnSync(stub, wipArgs, { stdio: "inherit" });
  process.exit(r.status ?? EXIT_GENERAL_ERROR);
}

// --- Amend lane: rewrite HEAD not yet landed in master. The editor preloads HEAD's existing
// message (the user is editing it, not replacing it); hooks run; the save is
// the permission gate exactly as the normal lane. Refuses fail-closed when
// master already reached HEAD — amending landed history must never happen
// silently (remediation: --fix for an earlier commit, or a plain fix commit).
// A commit reachable from a remote branch but NOT from master stays foldable:
// pushed-but-unlanded is the normal state of PR branches here.
if (amendLane) {
  // Empty index is ALLOWED: an amend with nothing staged is a message-only
  // rewrite (git replaces the message; the tree is untouched) — the one
  // sanctioned route for editing HEAD's message on a clean tree. Staged
  // content folds as usual. The staged-stat echo below makes which case this
  // is visible at the save decision, and the editor banner already labels the
  // session as a re-edit of an existing commit.
  const hasStaged = git(["diff", "--cached", "--quiet"]).status !== 0;
  if (foldWindowClosed("HEAD")) {
    die(
      "HEAD is already landed in master (or named by a tag) — its fold window is closed",
      "remediation: use --fix <ref> for an earlier commit, or land a plain fix commit",
    );
  }
  const headMsg = git(["log", "-1", "--format=%B"]).out;
  if (headMsg.trim() === "") die("HEAD has no message to preload — refusing to amend blindly");
  if (dryRun) {
    console.log(`repo-commit: --amend dry-run`);
    console.log(hasStaged
      ? `  would fold staged content into HEAD and open the editor with its current message`
      : `  message-only rewrite (index clean): opens the editor with HEAD's current message; no content changes`);
    console.log(`  staged: ${stagedStat()}`);
    process.exit(0);
  }
  resolveEditor();
  const headSha = git(["log", "-1", "--format=%h %s"]).out.trim();
  console.log(`repo-commit: staged: ${stagedStat()}${hasStaged ? "" : "  (index clean: this amend rewrites HEAD's message only)"}`);
  console.log(`repo-commit: opening editor: ${editor}  (amend: save & close to fold staged content into HEAD; empty/abort cancels)`);
  const amendTmp = mkdtempSync(join(tmpdir(), "repo-commit-msg-"));
  const amendMsgfile = join(amendTmp, "message");
  // Leading # comments make the re-edit unmistakable in the editor; git's
  // --cleanup=strip removes every comment line before the message is used.
  const amendBanner = [
    `# EDIT of a previous commit — this is NOT a new commit.`,
    `# Re-editing: ${headSha}`,
    `# Save & close to fold the staged content into it; empty the message to cancel.`,
    "",
  ].join("\n");
  writeFileSync(amendMsgfile, `${amendBanner}${headMsg.endsWith("\n") ? headMsg : `${headMsg}\n`}`);
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
  // eligible commits (ancestors of HEAD whose fold window is still open).
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
    // eligible: ancestors of HEAD with an open fold window (not reachable
    // from master, not named by a tag — per-commit check)
    const log = git(["log", "--format=%H%x09%h%x09%s", "-n", "50"]).out.split("\n").filter((l) => l !== "");
    const eligible: { value: string; label: string; hint?: string }[] = [];
    for (const line of log) {
      const [full, short, subject] = line.split("\t");
      if (full === undefined || short === undefined || subject === undefined) continue;
      if (foldWindowClosed(full)) continue; // landed: not foldable
      if (full === head) continue; // HEAD routes to --amend
      eligible.push({ value: full, label: `${short} ${subject}` });
    }
    if (eligible.length === 0) {
      die("no eligible targets: every ancestor has landed in master or is HEAD (use --amend for HEAD)");
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
  if (targetSha === git(["rev-parse", "HEAD"]).out.trim()) {
    die("target is HEAD — use --amend instead");
  }
  // Root-commit refusal precedes the fold-window check: the structural reason
  // (no parent to autosquash onto) is the truer one for a landed root commit.
  const hasParent = git(["rev-parse", "--verify", "--quiet", `${targetSha}^`]).status === 0;
  if (!hasParent) {
    die(
      `target '${target}' is the root commit — folding into it would rewrite the entire history start`,
      "remediation: land a plain fix commit instead",
    );
  }
  if (foldWindowClosed(targetSha)) {
    die(
      `'${target}' is already landed in master (or named by a tag) — its fold window is closed`,
      "remediation: land a plain fix commit instead",
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
  // Force-create: a same-named branch can only come from a previous attempt
  // at this same HEAD (the name encodes it) — a stale backup must not block
  // the retry, and overwriting re-points it at the identical commit.
  const backup = `backup/pre-fixup-${oldHeadShort}`;
  const bk = git(["branch", "-f", backup, oldHead]);
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

// --- Reword lane: change an earlier commit's message only. No staged content
// required (a reword changes no content); the editor gate on the new message
// is the permission gate, exactly as the normal/amend lanes. Safety spine
// mirrors --fix: preflight -> backup branch -> reword -> verify -> report.
if (rewordLane) {
  // Preflight. Staged content is explicitly NOT required — a reword rewrites
  // messages only; requiring staging would fail-closed on nothing.
  const resolved = git(["rev-parse", "--verify", `${rewordRef}^{commit}`]);
  if (resolved.status !== 0) die(`cannot resolve '${rewordRef}' as a commit`);
  const targetSha = resolved.out.trim();
  const isAncestor = git(["merge-base", "--is-ancestor", targetSha, "HEAD"]).status === 0;
  if (!isAncestor) die(`'${rewordRef}' is not an ancestor of HEAD — you can only reword your own stack`);
  if (targetSha === git(["rev-parse", "HEAD"]).out.trim()) {
    // HEAD is a valid reword target when the index is clean (message-only
    // rewrite, same semantics as the clean-index amend): run the same rebase
    // lane — the machinery below handles a HEAD target identically (rebase
    // -i <HEAD~1> with the entry marked reword). With staged content, refuse:
    // folding it would breach the reword's message-only contract — --amend is
    // the deliberate-fold route.
    if (git(["diff", "--cached", "--quiet"]).status !== 0) {
      die(
        "target is HEAD and content is staged — folding staged content needs --amend (a reword is message-only)",
        "remediation: --amend with the content staged, or unstage and re-run --reword HEAD",
      );
    }
  }
  // Root-commit refusal precedes the fold-window check: the structural reason
  // (no parent to reword onto) is the truer one for a landed root commit.
  const hasParent = git(["rev-parse", "--verify", "--quiet", `${targetSha}^`]).status === 0;
  if (!hasParent) {
    die(
      `target '${rewordRef}' is the root commit — rewording it would rewrite the entire history start`,
      "remediation: rebase -i manually, or accept the history start as-is",
    );
  }
  if (foldWindowClosed(targetSha)) {
    die(
      `'${rewordRef}' is already landed in master (or named by a tag) — its fold window is closed`,
      "remediation: land a plain docs/fix commit noting the correction instead",
    );
  }
  const targetSubject = git(["log", "-1", "--format=%s", targetSha]).out.trim();
  const oldHead = git(["rev-parse", "HEAD"]).out.trim();
  const oldHeadShort = git(["rev-parse", "--short", oldHead]).out.trim();

  if (dryRun) {
    const rehashed = git(["rev-list", "--count", `${targetSha}..HEAD`]).out.trim();
    console.log(`repo-commit: --reword dry-run`);
    console.log(`  target:   ${targetSha.slice(0, 8)} ${targetSubject}`);
    console.log(`  rehash:   ${rehashed} commit(s) after the target would be rewritten`);
    console.log(`  backup:   backup/pre-reword-${oldHeadShort} would be created`);
    process.exit(0);
  }

  // Editor resolution FIRST (before any mutation): the editor save is the
  // permission gate, so a non-interactive editor must refuse pre-backup.
  resolveEditor();

  // Force-create: same rationale as the fix lane — a same-named backup can
  // only come from a previous attempt at this same HEAD (the name encodes
  // it); a stale backup must not block the retry.
  const backup = `backup/pre-reword-${oldHeadShort}`;
  const bk = git(["branch", "-f", backup, oldHead]);
  if (bk.status !== 0) die(`failed to create backup branch ${backup}: ${bk.out.trim()}`);
  console.log(`repo-commit: backup branch ${backup} (recovery: git reset --hard ${backup})`);

  // The reword: one rebase whose GIT_SEQUENCE_EDITOR script flips the target's
  // todo entry from "pick" to "reword" and lets git open the user's editor on
  // the message file. The editor save is the permission gate; git aborts the
  // rebase when the editor session empties the message (the cancel path).
  // Todo shas vary in length across git versions (short here, full elsewhere);
  // ask git how IT abbreviates this sha (core.abbrev resolves to the same
  // uniqueness length the todo uses) and match on that. The edit is verified
  // (grep -q) so a non-match aborts loudly instead of silently rewording the
  // wrong commit.
  const todoSha = git(["rev-parse", "--short=7", targetSha]).out.trim();
  const seqEditor = join(mkdtempSync(join(tmpdir(), "repo-commit-reword-")), "seq.sh");
  writeFileSync(
    seqEditor,
    [
      "#!/bin/sh",
      `if sed -i "s/^pick ${todoSha} /reword ${todoSha} /" "$1" && grep -q "^reword ${todoSha} " "$1"; then`,
      "  exit 0",
      "fi",
      'echo "repo-commit: reword preflight failed — target entry not found in the rebase todo" >&2',
      "exit 1",
      "",
    ].join("\n"),
  );
  chmodSync(seqEditor, 0o755);
  const reword = spawnSync(
    "git",
    ["rebase", "--autostash", "-i", `${targetSha}~1`],
    { stdio: "inherit", env: { ...process.env, GIT_SEQUENCE_EDITOR: seqEditor } },
  );
  rmSync(dirname(seqEditor), { recursive: true, force: true });
  if (reword.status !== 0) {
    spawnSync("git", ["rebase", "--abort"], { encoding: "utf8" });
    die(
      "reword rebase failed (conflict or editor abort) — rebase aborted; the stack is unchanged",
      `recovery: git reset --hard ${backup}`,
    );
  }

  // Verify: after the rebase, the OLD sha is orphaned — locate the target by
  // its position in the new stack instead (parent-of-target's parent count is
  // unchanged; the target sits at the same ancestry depth). The surest check:
  // the subject AT the target's depth must differ from the old subject, and
  // the content tree must be untouched (a reword rewrites messages only).
  const depth = git(["rev-list", "--count", `${targetSha}~1..${oldHead}`]).out.trim();
  const newTarget = git(["log", "--format=%H %s", `-n ${depth}`, "HEAD"]).out.split("\n").filter((l) => l.trim() !== "");
  // newTarget is newest-first over the rewritten range; the target is the
  // OLDEST entry in that range (depth-th from HEAD).
  const targetLine = newTarget[newTarget.length - 1] ?? "";
  const newSubject = targetLine.split(" ").slice(1).join(" ");
  if (newSubject === targetSubject) {
    die("reword verification failed (message unchanged) — inspect manually", `recovery: git reset --hard ${backup}`);
  }
  const treeDiff = git(["diff", "--stat", `${backup}`, "HEAD"]).out.trim();
  if (treeDiff !== "") {
    die("reword verification failed (content changed — a reword must not touch the tree)", `recovery: git reset --hard ${backup}`);
  }
  console.log(`repo-commit: reworded. was: ${targetSubject}`);
  console.log(`  now: ${newSubject}`);
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

// User-authored via --file: validated below, never rewritten (the wrap at the
// write site applies only to the tool-crafted argv message).
const wrapEligible = msgfileArg === "";

// --- Resolve the editor: VS Code first, nano fallback (user ruling).
// Non-interactive values are treated as UNSET: automation hosts inject no-op
// editors (GIT_EDITOR=:) into terminals; the user's own core.editor must outrank
// them. The gate above still refuses if EVERY source resolves non-interactive.
function commandExists(cmd: string): boolean {
  return spawnSync("sh", ["-c", `command -v ${cmd} >/dev/null 2>&1`]).status === 0;
}



// --- Wrap the suggested BODY at 72 columns (git-standard width) so the
// crafter sees the final shape in the editor — nothing to fix after the fact.
// The header (line 0) is NEVER wrapped: a folded header is not a header — and
// wrapping it would hide an over-long subject from the commitlint check below
// (validate-then-wrap, in that order, at the call site). Comment lines
// (#-leading) and trailer-shaped lines (`Key: value` — wrapping a trailer
// breaks git's trailer parsing) pass through untouched.
export function wrapBodyAt72(message: string): string {
  const lines = message.replace(/\n+$/, "").split("\n");
  const out: string[] = [];
  for (let idx = 0; idx < lines.length; idx++) {
    const line = lines[idx] ?? "";
    if (idx === 0 || line.length <= 72 || line.startsWith("#") || line.trim() === "" || /^[A-Za-z][A-Za-z-]*: /.test(line)) {
      out.push(line);
      continue;
    }
    let rest = line;
    while (rest.length > 72) {
      let cut = rest.lastIndexOf(" ", 72);
      if (cut <= 0) cut = 72; // one unbreakable token longer than the width
      out.push(rest.slice(0, cut));
      rest = "  " + rest.slice(cut).replace(/^ +/, ""); // hanging indent
    }
    out.push(rest);
  }
  return out.join("\n");
}

// --- Validate the message against the CURRENT repo's commitlint rules BEFORE
// git runs: hook order runs pre-commit (the multi-minute test suite) before
// commit-msg (the message rules), so a hook-time rejection burns the whole
// suite on a bad message; a rejection here costs nothing. Runs only when the
// current repo has a commitlint setup (config + local install at its toplevel)
// — foreign repos without one keep working, matching the hook's own no-config
// pass-through. Runs the LOCAL install via its exact bin path (never a
// bare-PATH spawn); failures carry commitlint's own rule report so the fix is
// obvious without a rerun.
function validateWithCommitlint(message: string): void {
  const root = git(["rev-parse", "--show-toplevel"]).out.trim();
  if (root === "") return; // not in a repo (unreachable here — index was checked)
  const config = existsSync(join(root, "commitlint.config.js"));
  const bin = join(root, "node_modules", ".bin", "commitlint");
  if (!config || !existsSync(bin)) return; // no commitlint setup: nothing to enforce
  const r = spawnSync(bin, [], { encoding: "utf8", input: message, cwd: root });
  if (r.status !== 0) {
    console.error((r.stdout ?? "") + (r.stderr ?? ""));
    die("commit message rejected by commitlint (pre-git validation — fix the message above; no test time was spent)");
  }
}

// --- Launch the editor with the suggested message; commit only on save.
resolveEditor();
console.log(`repo-commit: staged: ${stagedStat()}`);
// A suggested message identical to HEAD's is almost never intended for a NEW
// commit — it is the signature of a stale suggestion (the previous commit's
// message reused verbatim). The editor save is the permission gate — a
// duplicate is a judgment call, not a structural impossibility — so this
// warns loudly instead of refusing, and the banner below shows the message
// directly above HEAD's for the save decision.
const headMsg = git(["log", "-1", "--format=%B"]).out.trim();
const duplicateOfHead = suggested.trim() === headMsg && headMsg !== "";
if (duplicateOfHead) {
  console.warn(`repo-commit: WARNING — the suggested message is byte-identical to HEAD's (${git(["log", "-1", "--format=%h"]).out.trim()}).`);
  console.warn("repo-commit:   if this is a re-edit, abort and use --amend (or --fix <ref>); if a true duplicate is wanted, save as-is.");
}
const headShort = git(["log", "-1", "--format=%h %s"]).out.trim();
// msgfile is a temp file for the editor session — removed afterwards.
const tmpDir = mkdtempSync(join(tmpdir(), "repo-commit-msg-"));
const msgfile = join(tmpDir, "message");
// Order matters: wrap FIRST, then validate the FINAL composed message —
// still before git runs, so a rejection costs no test time. The header
// (line 0) is never wrapped, so it is byte-identical in raw and final form:
// a too-long subject dies at commitlint exactly as it would on the raw
// message, never laundered into a folded "legal" header. The body IS
// wrapped, so validating the raw form would wrongly reject wrap-solvable
// over-length — a 160-char bullet is legal once folded to 72 columns
// (body-max-line-length fired before the wrap could run).
const finalMessage = wrapEligible ? wrapBodyAt72(suggested) : suggested;
validateWithCommitlint(finalMessage);
// Context banner: what this commit lands on, so a stale prefill is visible
// against its neighbor. # comments are stripped by --cleanup=strip.
const contextBanner = [
  `# NEW commit on top of: ${headShort}`,
  ...(duplicateOfHead
    ? ["# WARNING: this message is identical to the commit above — abort or edit unless a verbatim duplicate is intended.", ""]
    : [""]),
].join("\n");
writeFileSync(msgfile, `${contextBanner}${finalMessage}\n`);

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
