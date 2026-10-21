#!/usr/bin/env node
// SCRIPT_NAME.ts - Brief description of what this script does
// Version: 1.0.0
// Description: Detailed description of the script's purpose and functionality
// Requirements: Node >= 23.6 (native type-stripping execution)
//
// Run via the depth-1 bash stub: `exec node "<resolved-src>.ts" "$@"`

import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";

// ============================================================================
// Library imports (core is self-locating; see tools/lib/core/self-root.ts)
// ============================================================================

import { EXIT_GENERAL_ERROR, EXIT_MISUSE } from "DEVENV_TOOLS/lib/core/exit-codes.ts";
import { logInfo, logError } from "DEVENV_TOOLS/lib/core/logging.ts";
import { assertNodeFloor } from "DEVENV_TOOLS/lib/core/node-floor.ts";
import { invalidArgs } from "DEVENV_TOOLS/lib/core/args.ts";

// The floor check runs before anything else: an older Node dies with a raw
// strip-types syntax error instead of a clear message.
assertNodeFloor();

// ============================================================================
// Constants
// ============================================================================

const SCRIPT_VERSION = "1.0.0";
const SCRIPT_NAME = fileURLToPath(import.meta.url).split("/").pop() ?? "unknown";

interface CliArgs {
  help: boolean;
  version: boolean;
  values: parseArgs.ParseArgsConfig["values"];
}

// ============================================================================
// Argument parsing
// ============================================================================

function showUsage(): never {
  console.log(`Usage: ${SCRIPT_NAME} [OPTIONS]

Brief description of what this script does.

Options:
    -h, --help      Show this help message
    -V, --version   Show version
    --verbose       Enable verbose logging

Examples:
    ${SCRIPT_NAME}
    ${SCRIPT_NAME} --verbose
`);
  process.exit(0);
}

function parseCliArgs(argv: string[]): CliArgs {
  try {
    const { values } = parseArgs({
      args: argv,
      options: {
        help: { type: "boolean", short: "h", default: false },
        version: { type: "boolean", short: "V", default: false },
        verbose: { type: "boolean", default: false },
      },
      strict: true,
    });
    return { help: Boolean(values["help"]), version: Boolean(values["version"]), values };
  } catch (err) {
    // parseArgs throws on unknown flags / missing values: report and exit 2.
    logError(err instanceof Error ? err.message : String(err));
    process.exit(EXIT_MISUSE);
  }
}

// ============================================================================
// Main
// ============================================================================

async function main(argv: string[]): Promise<number> {
  const args = parseCliArgs(argv);

  if (args.help) showUsage();
  if (args.version) {
    console.log(`${SCRIPT_NAME} ${SCRIPT_VERSION}`);
    return 0;
  }

  // TODO: implement the tool's behavior here.

  logInfo("done");
  return 0;
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (err: unknown) => {
    logError(err instanceof Error ? err.message : String(err));
    process.exit(EXIT_GENERAL_ERROR);
  },
);

// Keep invalidArgs referenced: the args helper is part of the template's
// standard surface even before the tool grows real argument validation.
void invalidArgs;
