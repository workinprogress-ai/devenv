// cli.ts — the shared CLI scaffold: one parse of the house flags every
// tool carries, plus the shared usage-text blocks.
//
// House flags parsed here once (per-tool hand-rolled tables retire):
//   -h, --help       show usage (caller renders; the flag is lifted)
//   -v, --version    print SCRIPT_VERSION and exit 0 (caller owns the
//                    version string via the version option)
//   -V, --verbose    enable DEBUG logging (setLogLevel(LOG_LEVEL_DEBUG))
//   -n, --dry-run    preview only (lifted; caller decides semantics)
//   --devenv         safety override for the devenv-repo gate (lifted;
//                    caller wires checkTargetRepo)
//
// Caller-owned flags pass through: toolCli merges the caller's option
// table with the house table (caller entries win on collision — a tool
// with its own --repo keeps it), and parseArgs strictness follows the
// caller's setting. Common flags are lifted into `common`; the raw values
// object stays available for tool-specific reads. Positionals pass
// through untouched.
//
// Error contract: parse failures are the caller's to report (the function
// re-exports parseArgs's throw) — tools keep their existing catch →
// usage-hint → EXIT_MISUSE shape. Version printing happens here (the one
// behavior that is genuinely uniform) unless `noVersionExit` is set.
//
// Strip-only compatible: no parameter properties, enums, or namespaces.

import { parseArgs } from "node:util";
import { LOG_LEVEL_DEBUG, setLogLevel } from "./logging.ts";
import { EXIT_SUCCESS } from "./exit-codes.ts";

/** The lifted common flags, post-parse. */
export interface CommonFlags {
  help: boolean;
  version: boolean;
  verbose: boolean;
  dryRun: boolean;
  devenv: boolean;
}

/** House option table (parseArgs shape). Frozen so callers cannot mutate
 * the shared definition. */
const HOUSE_OPTIONS = {
  help: { type: "boolean", short: "h", default: false },
  version: { type: "boolean", short: "v", default: false },
  verbose: { type: "boolean", short: "V", default: false },
  "dry-run": { type: "boolean", short: "n", default: false },
  devenv: { type: "boolean", default: false },
} as const;

export interface ToolCliOptions {
  /** Tool name for the version banner (usually SCRIPT_NAME). */
  name: string;
  /** Version string printed by -v/--version. */
  version: string;
  /** Caller option table entries; merged over the house table. A caller
   * entry with the same key as a house flag replaces it (tools with
   * tool-specific semantics for a name keep their behavior). */
  options?: Record<string, { type: "string" | "boolean"; short?: string; default?: string | boolean; multiple?: boolean }>;
  /** Skip the built-in version printing (a tool with a richer banner). */
  noVersionExit?: boolean;
  /** Drop the house dry-run flag entirely — for tools whose own -n short
   * belongs to a non-dry-run flag (e.g. issue-list/issue-search --limit -n).
   * Without this, two entries claiming -n would make `-n 5` set dry-run
   * and swallow the value into a positional. */
  noDryRun?: boolean;
  /** parseArgs strict setting; defaults true like every existing tool. */
  strict?: boolean;
  /** Whether positional arguments are accepted; defaults true. Tools that
   * previously parsed with allowPositionals:false must opt out here — a
   * forced true silently converts their exit-2 stray-argument error into
   * silent acceptance (a stray flag-like value from a quoting bug would
   * proceed instead of failing fast). */
  allowPositionals?: boolean;
  /** Extra argv (defaults to process.argv.slice(2)). */
  argv?: string[];
  /** Refuse an empty value (`--opt ""`, `--opt=`) for any string option: a
   * mutating tool must not act on a value an unset variable left empty. The
   * throw takes the caller's usual catch → hint → exit 2 path. */
  rejectEmptyValues?: boolean;
}

export interface ToolCliResult {
  common: CommonFlags;
  /** The raw parsed values (caller flags included). */
  values: Record<string, string | boolean | undefined>;
  /** Positional arguments, untouched. */
  positionals: string[];
}

/** Parse the house flags plus the caller's table in one parseArgs call.
 * Side effects: -V wires setLogLevel(LOG_LEVEL_DEBUG); -v prints the
 * version and exits 0 (unless noVersionExit). */
export function toolCli(opts: ToolCliOptions): ToolCliResult {
  const merged: Record<string, { type: "string" | "boolean"; short?: string; default?: string | boolean; multiple?: boolean }> = {};
  for (const [k, v] of Object.entries(HOUSE_OPTIONS)) merged[k] = { ...v };
  if (opts.noDryRun) delete merged["dry-run"];
  for (const [k, v] of Object.entries(opts.options ?? {})) merged[k] = v;

  const { values, positionals } = parseArgs({
    args: opts.argv ?? process.argv.slice(2),
    options: merged,
    allowPositionals: opts.allowPositionals ?? true,
    strict: opts.strict ?? true,
  });

  if (opts.rejectEmptyValues) {
    for (const [name, value] of Object.entries(values)) {
      const given = Array.isArray(value) ? value : [value];
      if (merged[name]?.type === "string" && given.some((v) => v === "")) throw new Error(`Missing value for --${name}`);
    }
  }

  const common: CommonFlags = {
    help: Boolean(values["help"]),
    version: Boolean(values["version"]),
    verbose: Boolean(values["verbose"]),
    dryRun: Boolean(values["dry-run"]),
    devenv: Boolean(values["devenv"]),
  };

  if (common.verbose) setLogLevel(LOG_LEVEL_DEBUG);

  if (common.version && !opts.noVersionExit) {
    console.log(opts.version);
    process.exit(EXIT_SUCCESS);
  }

  return { common, values: values as Record<string, string | boolean | undefined>, positionals };
}

// ---------------------------------------------------------------------------
// Shared usage-text blocks (docs drift with the change that changes them)
// ---------------------------------------------------------------------------

/** The house Options block: the five common flags, rendered in the
 * suite-wide wording. Tools embed this in their usage text. Options:
 * - `noDryRunShort` renders the dry-run line long-only (the tool carries
 *   dry-run but its own flag owns the -n short).
 * - `noDryRun` omits the dry-run line entirely — used together with the
 *   toolCli noDryRun option: a tool without the flag must not advertise it
 *   (the advertised flag must parse; an advertised-but-absent flag is a
 *   usage lie in both the erroring and the silently-ignoring direction).
 * - `noDevenv` omits the --devenv line (the tool runs no devenv-repo gate;
 *   advertising the override for a nonexistent gate is decoration — the
 *   same advertised-must-mean-something rule). */
export function usageCommonFlags(opts?: { noDryRunShort?: boolean; noDryRun?: boolean; noDevenv?: boolean }): string {
  const dryRunLine = opts?.noDryRun
    ? null
    : opts?.noDryRunShort
      ? "    --dry-run                   Show what would be done without acting"
      : "    -n, --dry-run               Show what would be done without acting";
  const devenvLine = opts?.noDevenv ? null : "    --devenv                    Safety override for devenv-repo operations";
  return `    -h, --help                  Show this help message and exit
    -v, --version               Show version information and exit
    -V, --verbose               Enable verbose output (debug logging)
${dryRunLine === null ? "" : dryRunLine + "\n"}${devenvLine === null ? "" : devenvLine}`;
}

/** The shared environment-variables block (DEVENV_REPO contract). */
export function usageEnvBlock(): string {
  return `Environment Variables:
    DEVENV_REPO                 Repository in format owner/repo (default: current repo)`;
}
