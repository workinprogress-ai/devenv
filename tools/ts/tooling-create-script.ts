// tooling-create-script — create a new script from the standard template.
// Port of tooling-create-script.sh: TypeScript is the default language;
// bash remains available for recovery-path/bootstrap-adjacent tools.

import { copyFileSync, existsSync, mkdirSync, chmodSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { assertNodeFloor } from "../lib/core/node-floor.ts";
import { selfRoot } from "../lib/core/self-root.ts";

assertNodeFloor();

function usage(): never {
  console.log(`Usage: tooling-create-script [OPTIONS] SCRIPT_NAME

Create a new script from the standard template. TypeScript is the default
language; bash remains available for recovery-path/bootstrap-adjacent tools.

Arguments:
    SCRIPT_NAME     Name of the script to create (extension added per --lang)

Options:
    -h, --help      Show this help message
    -d, --dir DIR   Output directory (default: scripts/)
    -f, --force     Overwrite existing file
    -l, --lang LANG Template language: ts (default) or bash

Examples:
    # Create a TypeScript tool (default)
    tooling-create-script my-new-tool

    # Create a bash script (recovery-path/bootstrap-adjacent tools)
    tooling-create-script --lang bash my-legacy-script

    # Create script in custom directory
    tooling-create-script --dir tools/ my-tool

    # Overwrite existing script
    tooling-create-script --force my-script`);
  process.exit(0);
}

const argv = process.argv.slice(2);
if (argv.includes("-h") || argv.includes("--help")) usage();

let scriptName = "";
let outputDir = "";
let force = false;
let lang = "ts";

for (let i = 0; i < argv.length; i++) {
  const a = argv[i] as string;
  if (a === "-d" || a === "--dir") {
    const v = argv[i + 1];
    if (v === undefined) { console.error("ERROR: Missing value for --dir"); process.exit(2); }
    outputDir = v as string;
    i++;
  } else if (a === "-f" || a === "--force") force = true;
  else if (a === "-l" || a === "--lang") {
    const v = argv[i + 1];
    if (v === undefined) { console.error("ERROR: Missing value for --lang"); process.exit(2); }
    lang = v as string;
    i++;
  } else if (a.startsWith("-")) {
    console.error(`ERROR: Unknown option: ${a}`);
    process.exit(2);
  } else {
    scriptName = a;
  }
}

if (scriptName === "") {
  console.error("ERROR: Script name is required");
  console.error("Use --help for usage information");
  process.exit(2);
}

const ext = lang === "ts" ? "ts" : lang === "bash" ? "sh" : null;
if (ext === null) {
  console.error(`ERROR: Unknown language: ${lang} (expected ts or bash)`);
  process.exit(2);
}
if (!scriptName.endsWith(`.${ext}`)) scriptName = `${scriptName}.${ext}`;

const tools = selfRoot(process.cwd()) + "/tools";
const templateFile = join(tools, "templates", `script-template.${ext}`);
if (!existsSync(templateFile)) {
  console.error(`ERROR: Template file not found: ${templateFile}`);
  process.exit(1);
}

if (outputDir === "") outputDir = `${process.env.PROJECT_ROOT ?? process.env.DEVENV_ROOT ?? process.cwd()}/scripts`;
mkdirSync(outputDir, { recursive: true });

const outputFile = join(outputDir, scriptName);
if (existsSync(outputFile) && !force) {
  console.error(`ERROR: File already exists: ${outputFile}`);
  console.error("Use --force to overwrite");
  process.exit(1);
}

console.log(`Creating script: ${outputFile}`);
copyFileSync(templateFile, outputFile);

// Customize: script name, then the date placeholder.
let content = readFileSync(outputFile, "utf8");
content = content.split(`SCRIPT_NAME.${ext}`).join(scriptName);
const today = new Date().toISOString().slice(0, 10);
content = content.split("YYYY-MM-DD").join(today);
writeFileSync(outputFile, content);
chmodSync(outputFile, 0o755);

console.log("✓ Script created successfully");
console.log("");
console.log("Next steps:");
console.log(`  1. Edit ${outputFile}`);
console.log("  2. Update the description and version");
console.log("  3. Implement your script logic");
if (lang === "ts") {
  console.log(`  4. Create tests in tools/tests/ts/test_${scriptName.replace(/\.ts$/, "")}.test.ts`);
  console.log("  5. Run: pnpm test:ts");
} else {
  console.log(`  4. Create tests in tests/test_${scriptName.replace(/\.sh$/, "")}.bats`);
  console.log(`  5. Run: bats tests/test_${scriptName.replace(/\.sh$/, "")}.bats`);
}
