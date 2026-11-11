// editor.ts — open a file in the user's editor (port of editor.bash).
// Preference order: VS Code with --wait (blocking), then PREF_EDITOR, then
// FALLBACK_EDITOR, then nano. All launches block until the editor closes —
// tools need the file's final state after the call returns.

import { spawnSync } from "node:child_process";
import { accessSync, constants as fsConstants } from "node:fs";

export interface EditorResult {
  ok: boolean;
  /** Which editor actually ran (for diagnostics), null when none succeeded. */
  editor: string | null;
}

export function openInEditor(file: string): EditorResult {
  const fallback = process.env["PREF_EDITOR"] ?? process.env["FALLBACK_EDITOR"] ?? "nano";

  const vscode = which("code");
  if (vscode !== null) {
    const r = spawnSync("code", ["--wait", file], { stdio: "inherit" });
    if (r.status === 0) return { ok: true, editor: "code" };
    process.stderr.write(`⚠️  Could not open with VS Code. Falling back to ${fallback}...\n`);
  }

  const fb = which(fallback);
  if (fb === null) return { ok: false, editor: null };
  const r = spawnSync(fb, [file], { stdio: "inherit" });
  return { ok: r.status === 0, editor: fallback };
}

/** Minimal which(1): first PATH dir holding an executable with that name. */
function which(cmd: string): string | null {
  for (const dir of (process.env["PATH"] ?? "").split(":")) {
    if (dir === "") continue;
    const candidate = `${dir}/${cmd}`;
    try {
      accessSyncExecutable(candidate);
      return candidate;
    } catch {
      // keep scanning
    }
  }
  return null;
}

function accessSyncExecutable(path: string): void {
  accessSync(path, fsConstants.X_OK);
}

// Characters that make an editor string a shell program rather than one
// command: quoting, chaining, substitution, redirection, comments, newlines.
const SHELL_METACHARACTERS = /[;|&$()<>`"'#\\\n]/;

interface WrapperSpec {
  /** Options that consume the following word as their value. */
  valueOptions: readonly string[];
  /** Positional operands that precede the wrapped command (timeout's duration). */
  operands: number;
}

const WRAPPERS: ReadonlyMap<string, WrapperSpec> = new Map(Object.entries({
  env: { valueOptions: ["-u", "-C", "-S", "--unset", "--chdir", "--split-string"], operands: 0 },
  command: { valueOptions: [], operands: 0 },
  exec: { valueOptions: ["-a"], operands: 0 },
  nice: { valueOptions: ["-n", "--adjustment"], operands: 0 },
  ionice: { valueOptions: ["-c", "-n", "-p", "--class", "--classdata", "--pid"], operands: 0 },
  nohup: { valueOptions: [], operands: 0 },
  setsid: { valueOptions: [], operands: 0 },
  stdbuf: { valueOptions: ["-i", "-o", "-e", "--input", "--output", "--error"], operands: 0 },
  time: { valueOptions: ["-f", "-o", "--format", "--output"], operands: 0 },
  timeout: { valueOptions: ["-s", "-k", "--signal", "--kill-after"], operands: 1 },
  sudo: { valueOptions: ["-u", "-g", "-h", "-p", "-C", "-D", "-R", "-T", "-U", "-r", "-t"], operands: 0 },
  xargs: { valueOptions: ["-n", "-I", "-L", "-P", "-s", "-d", "-E", "-a"], operands: 0 },
  busybox: { valueOptions: [], operands: 0 },
} satisfies Record<string, WrapperSpec>));

const SHELLS = new Set(["sh", "bash", "dash", "zsh", "ksh", "ash"]);
const NOOP_COMMANDS = new Set(["true", ":", ".", "exit", "echo", "printf", "cat", "tee", "touch", "rm", "sleep", "sed", "awk"]);
const INTERPRETERS = /^(python[0-9.]*|perl|node|ruby|php)$/;
const INTERPRETER_EXEC_FLAGS = new Set(["-c", "-e", "-E", "-p", "--eval", "--print"]);
const VI_FAMILY = new Set(["ex", "vi", "vim", "nvim", "view", "vimdiff"]);
// Ex commands that save/quit at once: `vim +wq`, `vim -c x` never wait for a person.
const VI_EXIT_COMMAND = /^(wq|x|xit|exit|q|quit|qa|qall|wqa|wqall|xa|xall)!?$/;

/** True when the editor command is judged a non-interactive no-op (an env
 * sentinel or config value that would skip a human editing the message).
 * BEST-EFFORT ONLY: the list can never be complete (any script or program can
 * ignore its file argument), so it is not a security boundary. The real
 * control is repo-commit's requirement of a terminal on stdin and stdout; this
 * check catches the common sentinels and drives the prepare-commit-msg warning.
 * Any editor string containing shell metacharacters is treated as a shell
 * program and refused. Wrappers (env, timeout, nice, stdbuf, sudo, xargs, ...)
 * are looked through, including their value-taking options, and judged by the
 * command they run. Shells, interpreters running an inline script, stream
 * editors and ex-mode scripting (`vim -es`) are refused. */
export function editorIsNoninteractive(candidate: string): boolean {
  if (SHELL_METACHARACTERS.test(candidate)) return true;
  const words = candidate.trim().split(/\s+/).filter((w) => w !== "");
  let i = 0;
  while (i < words.length) {
    const word = words[i] ?? "";
    i += 1;
    // leading VAR=value assignments belong to the command's environment
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(word)) continue;
    const base = word.split("/").pop() ?? word;
    const wrapper = WRAPPERS.get(base);
    if (wrapper !== undefined) {
      while (i < words.length) {
        const w = words[i] ?? "";
        if (w === "--") {
          i += 1;
          break;
        }
        if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(w)) i += 1;
        else if (w.startsWith("-")) i += wrapper.valueOptions.includes(w) ? 2 : 1;
        else break;
      }
      i += wrapper.operands;
      // xargs with no command runs echo
      if (base === "xargs" && i >= words.length) return true;
      continue;
    }
    if (SHELLS.has(base) || NOOP_COMMANDS.has(base)) return true;
    const args = words.slice(i);
    if (INTERPRETERS.test(base)) return args.some((a) => INTERPRETER_EXEC_FLAGS.has(a));
    if (VI_FAMILY.has(base)) {
      return args.some(
        (a, idx) =>
          /^-[A-Za-z]*s$/.test(a) ||
          (a.startsWith("+") && VI_EXIT_COMMAND.test(a.slice(1))) ||
          (a === "-c" && VI_EXIT_COMMAND.test(args[idx + 1] ?? "")),
      );
    }
    return false;
  }
  // nothing left to run
  return true;
}
