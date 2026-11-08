// commands.ts — the one required-command probe for all tools (the five
// divergent per-tool requireCommand copies were unified here).
//
// One signature: requireCommand(cmd, hint?) — throws a named error the
// tool's catch renders (or exits directly via the helper when a tool is
// too thin to carry a catch). The error message names the command and the
// install hint, matching the strongest wording of the five retired copies.
//
// Strip-only compatible: no parameter properties, enums, or namespaces.

import { execFileSync } from "node:child_process";
import { EXIT_MISUSE } from "./exit-codes.ts";
import { logError } from "./logging.ts";

// Exit codes are a load-bearing cross-suite contract: adopting tools keep
// their historical missing-command exit code via the optional parameter.

export class MissingCommandError extends Error {
  constructor(cmd: string, hint?: string) {
    super(
      `Required command '${cmd}' is not available on PATH.` +
        (hint ? ` ${hint}` : " Install it and re-run."),
    );
    this.name = "MissingCommandError";
  }
}

/** True when CMD resolves on PATH. `which` (not the shell builtin
 * `command -v`, which cannot be spawned as a child process). */
export function commandAvailable(cmd: string): boolean {
  try {
    execFileSync("which", [cmd], { stdio: ["ignore", "ignore", "ignore"] });
    return true;
  } catch {
    return false;
  }
}

/** Throw when CMD is missing; return void when present. Callers that want
 * the exit-direct shape use requireCommandOrExit. */
export function requireCommand(cmd: string, hint?: string): void {
  if (!commandAvailable(cmd)) throw new MissingCommandError(cmd, hint);
}

/** The exit-direct variant (thin tools with no catch block): logs and
 * exits EXIT_MISUSE by default, or the caller's historical exit code. */
export function requireCommandOrExit(cmd: string, hint?: string, exitCode?: number): void {
  if (!commandAvailable(cmd)) {
    logError(new MissingCommandError(cmd, hint).message);
    process.exit(exitCode ?? EXIT_MISUSE);
  }
}
