#!/usr/bin/env node
// SCRIPT_NAME.ts - Brief description of what this script does
// Version: 1.0.0
// Description: Detailed description of the script's purpose and functionality
// Requirements: Node >= 23.6 (native type-stripping execution)
//
// Run via the depth-1 bash stub: `exec node "<resolved-src>.ts" "$@"`

import { toolCli, usageCommonFlags } from "REL_LIB/core/cli.ts";
import { logError, logInfo } from "REL_LIB/core/logging.ts";
import { assertNodeFloor } from "REL_LIB/core/node-floor.ts";

// The floor check runs before anything else: an older Node dies with a raw
// strip-types syntax error instead of a clear message.
assertNodeFloor();

const SCRIPT_VERSION = "1.0.0";
const TOOL_NAME = "SCRIPT_NAME";

// ============================================================================
// Usage
// ============================================================================

function showUsage(): never {
  console.log(`Usage: ${TOOL_NAME} [OPTIONS]

Brief description of what this script does.

Options:
${usageCommonFlags()}

Examples:
    ${TOOL_NAME}
`);
  process.exit(0);
}

// ============================================================================
// Main
// ============================================================================

async function main(argv: string[]): Promise<number> {
  try {
    const cli = toolCli({
      name: TOOL_NAME,
      version: SCRIPT_VERSION,
      argv,
      // Tool-specific flags merge over the house table; caller entries win
      // on key collision. Add them here, e.g.:
      // options: { format: { type: "string", short: "f", default: "table" } },
    });
    if (cli.common.help) showUsage();
    // -v printed and exited inside toolCli; -V wired DEBUG logging.
    // Tool flags read from cli.values["..."]; positionals from cli.positionals.
    void cli;
  } catch (err) {
    // Parse failures report with a usage hint and exit 2 (house contract).
    logError(err instanceof Error ? err.message : String(err));
    console.log("Use --help for usage information");
    return 2;
  }

  // TODO: implement the tool's behavior here.

  logInfo("done");
  return 0;
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (err: unknown) => {
    logError(err instanceof Error ? err.message : String(err));
    process.exit(1);
  },
);
