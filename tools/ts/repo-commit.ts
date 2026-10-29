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
       repo-commit --wip ["<wip message words...>"] [--file <message-file>] [--staged-only]

Opens the user's configured git editor pre-loaded with the suggested message.
Commits the existing index only if the editor session yields a non-empty message.

  --file <path>   Read the suggested message from a file (verbatim; use for long
                  messages instead of a giant argv string).
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

// --- Argument parsing: message via argv or --file; --wip delegates to git-wip.
let msgfileArg = "";
let wipLane = false;
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

// --- WIP lane: delegate to git-wip; WIP commit shape lives there alone.
if (wipLane) {
  if (msgfileArg !== "") wipArgs.push("--file", msgfileArg);
  const stub = join(toolsDir, "git-wip");
  if (!existsSync(stub)) die(`git-wip stub not found next to repo-commit: ${stub}`);
  const r = spawnSync(stub, wipArgs, { stdio: "inherit" });
  process.exit(r.status ?? EXIT_GENERAL_ERROR);
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

let editor = "";
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

// --- Launch the editor with the suggested message; commit only on save.
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
const commit = spawnSync("git", ["commit", "--cleanup=strip", "--edit", "-F", msgfile], {
  stdio: "inherit",
  env: { ...process.env, GIT_EDITOR: editor },
});
rmSync(tmpDir, { recursive: true, force: true });
if (commit.status !== 0) {
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
