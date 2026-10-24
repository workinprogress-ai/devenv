// args.ts — command-line argument helpers (from error-handling.bash's arg
// helpers + util.parseArgs wiring). Bash tools exit with EXIT_MISUSE on bad
// usage; TS tools do the same through these helpers, so the exit-code contract
// stays uniform. `die`-style helpers log through the shared logger and exit —
// the bash semantics, kept on purpose: tools are short-lived processes.

import { parseArgs } from "node:util";
import { existsSync, accessSync, constants as fsConstants } from "node:fs";
import { EXIT_MISUSE, EXIT_API_FAILURE, EXIT_GENERAL_ERROR } from "./exit-codes.ts";
import { logError } from "./logging.ts";

/** Log a usage error and exit 2 (EXIT_MISUSE). The bash invalid_args contract. */
export function invalidArgs(message: string): never {
  logError(message);
  console.log("Use --help for usage information");
  process.exit(EXIT_MISUSE);
}

/**
 * Validate that VALUE is present: non-empty, and not itself the name of an
 * option (a bare --word), which would mean the option's value was left out
 * and the next flag is being swallowed (`--base --force`). Free text starting
 * with dashes ("-- a note") is a value. Exits 2 on misuse.
 */
export function requireOptionValue(optionName: string, value: string | undefined): string {
  if (value === undefined || value === "") {
    invalidArgs(`Missing value for ${optionName}`);
  }
  if (typeof value === "boolean") {
    // parseArgs({ strict: false }) turns a bare `--opt` into boolean true —
    // the option's value was left out. Exit 2 rather than silently treating
    // "true" as the value (bash require_option_value parity).
    invalidArgs(`Missing value for ${optionName}`);
  }
  if (/^--[A-Za-z][A-Za-z0-9-]*$/.test(value)) {
    invalidArgs(
      `Missing value for ${optionName} (found the option '${value}' where a value was expected)`,
    );
  }
  return value;
}

/**
 * Require an environment variable to be set (presence, not emptiness — the
 * bash `require_env` semantics). Exits 2 when absent.
 */
export function requireEnv(name: string, message?: string): string {
  const value = process.env[name];
  if (value === undefined) {
    logError(message ?? `Environment variable '${name}' is required but not set.`);
    process.exit(EXIT_MISUSE);
  }
  return value;
}

/** Require a file to exist, or exit 4 (EXIT_API_FAILURE, bash parity). */
export function requireFile(path: string, message?: string): void {
  if (!existsSync(path)) {
    logError(message ?? `Required file not found: ${path}`);
    process.exit(EXIT_API_FAILURE);
  }
}

/** Require a directory to exist, or exit 4 (bash parity). */
export function requireDirectory(path: string, message?: string): void {
  if (!existsSync(path)) {
    logError(message ?? `Required directory not found: ${path}`);
    process.exit(EXIT_API_FAILURE);
  }
}

/** Require read/write/execute permission on a path, or exit 1. */
export function requirePermission(
  path: string,
  perm: "r" | "w" | "x",
  message?: string,
): void {
  const mode =
    perm === "r" ? fsConstants.R_OK : perm === "w" ? fsConstants.W_OK : fsConstants.X_OK;
  try {
    accessSync(path, mode);
  } catch {
    logError(message ?? `Permission denied: cannot ${perm} ${path}`);
    process.exit(EXIT_GENERAL_ERROR);
  }
}

export { parseArgs };

/**
 * Coerce a parseArgs({ strict: false }) valued-option result to a string,
 * exiting 2 when the option was given bare (boolean true — the value was
 * left out and the next flag would be swallowed). Use at the read site:
 * `repo = requireString(values.repo, "--repo")`.
 */
export function requireString(value: string | boolean | undefined, optionName: string): string {
  if (typeof value === "boolean") {
    invalidArgs(`Missing value for ${optionName}`);
  }
  return requireOptionValue(optionName, value);
}
