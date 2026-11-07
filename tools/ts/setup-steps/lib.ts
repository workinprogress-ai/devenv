#!/usr/bin/env node
// setup-steps/lib.ts — shared helpers for the setup step modules.
//
// Step modules are short-lived processes executed by the setup orchestrator
// (tools/ts/setup.ts): stdio is inherited (or piped under --json), failures
// exit non-zero, output chatter goes to stdout, warnings to stderr — matching
// the bash step functions they replace.

import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { configGetRaw } from "../../lib/core/config.ts";

/** The toolbox root every step operates on (the orchestrator passes it
 * through DEVENV_TOOLBOX_ROOT; default matches the orchestrator's own). */
export function toolbox(): string {
  return process.env.DEVENV_TOOLBOX_ROOT || "/workspaces/devenv";
}

/** The step's view of HOME (tests drive it via the env; production uses the
 * user's real home). */
export function home(): string {
  return process.env.HOME || "/home/vscode";
}

/** Run a shell snippet (string-interpolation free — callers pass scripts
 * with already-resolved absolute paths, mirroring the bash functions' local
 * variables). Returns stdout; non-zero exits throw. */
export function sh(script: string): string {
  return execFileSync("bash", ["-c", script], {
    encoding: "utf8",
    stdio: ["pipe", "pipe", "inherit"],
  });
}

/** sh() variant tolerating failure: returns "" instead of throwing. */
export function shOk(script: string): string {
  const r = spawnSync("bash", ["-c", script], { encoding: "utf8" });
  return r.status === 0 ? (r.stdout ?? "") : "";
}

/** True when COMMAND resolves on PATH (bash `command -v`). */
export function have(cmd: string): boolean {
  return spawnSync("bash", ["-c", `command -v '${cmd}' >/dev/null 2>&1`]).status === 0;
}

/** Run ARGS with live output (sudo apt, piped installs). Non-zero throws. */
export function run(cmd: string, args: string[]): void {
  execFileSync(cmd, args, {
    stdio: "inherit",
    env: { ...process.env, DEBIAN_FRONTEND: "noninteractive" },
  });
}

/** The .setup seed files directory. */
export function setupDir(): string {
  return join(toolbox(), ".setup");
}

/** Read a seed file, trimmed; "" when absent. */
export function seed(name: string): string {
  const p = join(setupDir(), name);
  try {
    return readFileSync(p, "utf8").trim();
  } catch {
    return "";
  }
}

/** Read a config value via the shared INI reader (last occurrence wins). */
export function configGet(section: string, key: string): string {
  return configGetRaw(join(toolbox(), "devenv.config"), section, key) ?? "";
}
