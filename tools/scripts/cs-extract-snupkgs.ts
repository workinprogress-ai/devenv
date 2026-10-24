// cs-extract-snupkgs — extract a .snupkg (symbol package) zip.
// Port of cs-extract-snupkgs.sh: unzip the package into
// <output-root>/<name-without-extension>/.

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { basename, join } from "node:path";
import { assertNodeFloor } from "../lib/core/node-floor.ts";
import { EXIT_API_FAILURE, EXIT_MISUSE } from "../lib/core/exit-codes.ts";
import { logError, logInfo, logSuccess } from "../lib/core/logging.ts";

assertNodeFloor();

function usage(exitCode = 0): never {
  console.log(`Usage: cs-extract-snupkgs <snupkg-path> [output-root]

Extract a .snupkg symbol package (a zip) into
<output-root>/<name-without-extension>/ (default output root: snupkg-extracted).

Options:
  -h, --help   Show this help`);
  process.exit(exitCode);
}

function requireCommand(cmd: string, message: string): void {
  try {
    execFileSync("bash", ["-c", `command -v ${cmd}`], { stdio: "ignore" });
  } catch {
    logError(message);
    process.exit(EXIT_API_FAILURE);
  }
}

if (process.argv.slice(2).some((a) => a === "-h" || a === "--help")) usage();

requireCommand("unzip", "unzip is required to extract snupkgs");

const args = process.argv.slice(2).filter((a) => !a.startsWith("-"));
if (args.length < 1) {
  usage(EXIT_MISUSE);
}

const snupkgPath = args[0] as string;
const outputRoot = args[1] ?? "snupkg-extracted";

if (!existsSync(snupkgPath)) {
  logError(`File not found: ${snupkgPath}`);
  process.exit(EXIT_API_FAILURE);
}

mkdirSync(outputRoot, { recursive: true });
const baseName = basename(snupkgPath, ".snupkg");
const targetDir = join(outputRoot, baseName);
mkdirSync(targetDir, { recursive: true });

logInfo(`Extracting ${snupkgPath} -> ${targetDir}`);
const r = spawnSync("unzip", ["-q", "-o", snupkgPath, "-d", targetDir], { stdio: "inherit" });
if (r.status !== 0) process.exit(r.status ?? 1);

logSuccess(`Extracted to ${targetDir}`);
