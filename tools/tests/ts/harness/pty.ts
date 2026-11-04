// harness/pty.ts — drive a tool's clack pickers and /dev/tty read prompts
// through a pseudo-terminal from vitest. Port of the bats `_drive_clack`
// driver (test_fork_export.bats): keys are paced ~0.6s apart so clack's
// raw-mode reader has its listener attached; `W` waits 2.5s before a
// /dev/tty read (the terminal line discipline batches input that arrives
// before the read starts); the pty stays open 20s after the last key so the
// tool never sees EOF mid-run.

import { spawn } from "node:child_process";

export type Key =
  | "s"   // space (toggle a multiselect mark)
  | "d"   // down arrow
  | "r"   // Enter (CR — clack submit)
  | "e"   // Escape (clack cancel)
  | "y" | "n"  // clack confirm answer (single key, no Enter)
  | "Y" | "N"  // y/n + CR for the tool's [y/N] /dev/tty read after an export
  | "A" | "C"  // a/c + CR for the [n/a/c] /dev/tty read after an export
  | "W"   // 2.5s wait (before a /dev/tty read opens)
  | (string & {});  // any other key + CR

export interface DriveOptions {
  /** Keys fed to the pty, in order. */
  keys: Key[];
  /** Per-key pacing in ms (default 600 — clack's listener needs the delay). */
  paceMs?: number;
  /** Initial delay before the first key (default 800). */
  initialDelayMs?: number;
  /** How long the pty stays open after the last key (default 20_000). */
  tailHoldMs?: number;
  /** Env overrides for the spawned command. */
  env?: Record<string, string>;
  /** Working directory for the spawned command. */
  cwd?: string;
  /** Hard kill after this many ms (default 120_000). */
  timeoutMs?: number;
}

export interface DriveResult {
  status: number;
  /** Combined stdout+stderr with ANSI escapes and box-drawing chrome stripped —
   * the same normalization the bats driver's sed pipeline applied. */
  out: string;
}

const KEY_BYTES: Record<string, string> = {
  s: " ",
  d: "\x1b[B",
  r: "\r",
  e: "\x1b",
};

/** Normalize pty output: strip ANSI escapes, table chrome, and collapse runs
 * of spaces (mirrors the bats driver's sed pipeline). */
function normalize(raw: string): string {
  return raw
    .replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, "")
    .replace(/│ */g, "")
    .replace(/ {2,}/g, " ");
}

/** Run `command` under a pty, feeding the paced key sequence. */
export async function drivePty(command: string, args: string[], options: DriveOptions): Promise<DriveResult> {
  const paceMs = options.paceMs ?? 600;
  const initialDelayMs = options.initialDelayMs ?? 800;
  const tailHoldMs = options.tailHoldMs ?? 20_000;
  const timeoutMs = options.timeoutMs ?? 120_000;

  // node's stdio is not a tty; script(1) allocates the pty and keeps it open,
  // exactly as the bats driver does.
  const child = spawn("script", ["-qfec", [command, ...args].join(" "), "/dev/null"], {
    env: { ...process.env, ...(options.env ?? {}) },
    cwd: options.cwd,
    stdio: ["pipe", "pipe", "pipe"],
  });

  let raw = "";
  child.stdout!.on("data", (d) => { raw += d.toString(); });
  child.stderr!.on("data", (d) => { raw += d.toString(); });

  const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
  const write = (s: string): Promise<void> =>
    new Promise((r) => child.stdin!.write(s, () => r()));

  const run = (async (): Promise<void> => {
    await sleep(initialDelayMs);
    for (const k of options.keys) {
      if (k === "W") {
        await sleep(2500);
        continue;
      }
      const bytes = KEY_BYTES[k] ?? `${k}\r`;
      await write(bytes);
      await sleep(paceMs);
    }
    await sleep(tailHoldMs);
    child.stdin!.end();
  })();

  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    child.kill("SIGKILL");
  }, timeoutMs);

  const status: number = await new Promise((resolve) => {
    child.on("exit", (code, signal) => {
      if (signal === "SIGKILL" && timedOut) resolve(124);
      else resolve(code ?? 1);
    });
  });
  clearTimeout(timer);
  await run.catch(() => undefined);

  return { status, out: normalize(raw) };
}
