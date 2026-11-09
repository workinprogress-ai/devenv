// tooling-create-script — create a new script from the standard template.
// Generates TypeScript only: every new tool is born on the shared libs
// (toolCli + house flags) via tools/templates/script-template.ts. The
// bash lane is gone (audit decision); recovery-path/bootstrap work uses
// the TS template like everything else.

import { copyFileSync, existsSync, mkdirSync, chmodSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { assertNodeFloor } from "../lib/core/node-floor.ts";
import { errorMessage } from "../lib/core/logging.ts";
import { selfRoot } from "../lib/core/self-root.ts";
import { toolCli, usageCommonFlags } from "../lib/core/cli.ts";
import { EXIT_MISUSE } from "../lib/core/exit-codes.ts";
import { logError } from "../lib/core/logging.ts";

assertNodeFloor();

const SCRIPT_VERSION = "2.0.0";

function usage(): never {
  console.log(`Usage: tooling-create-script [OPTIONS] SCRIPT_NAME

Create a new TypeScript script from the standard template (toolCli +
house flags + core-lib imports with the correct relative prefix).

Arguments:
    SCRIPT_NAME     Name of the script to create (.ts added when missing)

Options:
${usageCommonFlags({ noDryRun: true, noDevenv: true })}
    -d, --dir DIR   Output directory (default: scripts/)
    -f, --force     Overwrite existing file

Examples:
    tooling-create-script my-new-tool
    tooling-create-script --dir tools/ my-tool
    tooling-create-script --force my-script`);
  process.exit(0);
}

let scriptName = "";
let outputDir = "";
let force = false;

try {
  const cli = toolCli({
    name: "tooling-create-script",
    version: SCRIPT_VERSION,
    argv: process.argv.slice(2),
    noDryRun: true,
    options: {
      dir: { type: "string", short: "d" },
      force: { type: "boolean", short: "f", default: false },
    },
  });
  if (cli.common.help) usage();
  outputDir = (cli.values["dir"] as string | undefined) ?? "";
  force = cli.values["force"] === true;
  const positionals = cli.positionals;
  if (positionals.length > 1) {
    logError(`Unexpected argument: ${positionals[1]}`);
    console.log("Use --help for usage information");
    process.exit(EXIT_MISUSE);
  }
  scriptName = positionals[0] ?? "";
} catch (err) {
  logError(errorMessage(err));
  console.log("Use --help for usage information");
  process.exit(EXIT_MISUSE);
}

if (scriptName === "") {
  logError("Script name is required");
  console.log("Use --help for usage information");
  process.exit(EXIT_MISUSE);
}

if (!scriptName.endsWith(".ts")) scriptName = `${scriptName}.ts`;

// This generator's own checkout is the template source — deriving from cwd
// picks up a different devenv checkout when one is nested above (the
// workspace-root shadow copy ships its own, possibly stale, templates).
const toolsRoot = join(selfRoot(import.meta.url), "tools");
const templateFile = join(toolsRoot, "templates", "script-template.ts");
if (!existsSync(templateFile)) {
  logError(`Template file not found: ${templateFile}`);
  process.exit(1);
}

if (outputDir === "") outputDir = `${process.env.PROJECT_ROOT ?? process.env.DEVENV_ROOT ?? process.cwd()}/scripts`;
mkdirSync(outputDir, { recursive: true });

const outputFile = join(outputDir, scriptName);
if (existsSync(outputFile) && !force) {
  logError(`File already exists: ${outputFile}`);
  console.log("Use --force to overwrite");
  process.exit(1);
}

console.log(`Creating script: ${outputFile}`);
copyFileSync(templateFile, outputFile);

// Customize: script name, the date placeholder, and the REL_LIB import
// prefix — the relative path from the output directory to tools/lib, so
// generated imports resolve wherever the tool is created.
let content = readFileSync(outputFile, "utf8");
content = content.split("SCRIPT_NAME").join(scriptName.replace(/\.ts$/, ""));
const libRel = relative(dirname(outputFile), join(toolsRoot, "lib"));
content = content.split("REL_LIB").join(libRel);
const today = new Date().toISOString().slice(0, 10);
content = content.split("YYYY-MM-DD").join(today);
writeFileSync(outputFile, content);
chmodSync(outputFile, 0o755);

console.log("✓ Script created successfully");
console.log("");
console.log("Next steps:");
console.log(`  1. Edit ${outputFile}`);
console.log("  2. Update the description and version");
console.log("  3. Implement your script logic (add tool flags to the toolCli options table)");
console.log(`  4. Create tests in tools/tests/ts/test_${scriptName.replace(/\.ts$/, "")}.test.ts`);
console.log("  5. Run: pnpm test:ts");
