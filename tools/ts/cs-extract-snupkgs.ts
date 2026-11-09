// cs-extract-snupkgs — extract a .snupkg (symbol package) zip.
// Port of cs-extract-snupkgs.sh: unzip the package into
// <output-root>/<name-without-extension>/.

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { basename, join } from "node:path";
import { assertNodeFloor } from "../lib/core/node-floor.ts";
import { errorMessage } from "../lib/core/logging.ts";
import { toolCli, usageCommonFlags } from "../lib/core/cli.ts";
import { EXIT_API_FAILURE, EXIT_MISUSE } from "../lib/core/exit-codes.ts";
import { logError, logInfo, logSuccess } from "../lib/core/logging.ts";
import { requireCommandOrExit } from "../lib/core/commands.ts";

assertNodeFloor();

function usage(exitCode = 0): never {
  console.log(`Usage: cs-extract-snupkgs <snupkg-path> [output-root]

Extract a .snupkg symbol package (a zip) into
<output-root>/<name-without-extension>/ (default output root: snupkg-extracted).

Options:
${usageCommonFlags({ noDryRun: true, noDevenv: true })}`);
  process.exit(exitCode);
}

let snupkgPath = "";
let outputRoot = "snupkg-extracted";
try {
  const cli = toolCli({
    name: "cs-extract-snupkgs",
    version: "1.0.0",
    argv: process.argv.slice(2),
    noDryRun: true,
  });
  if (cli.common.help) usage();
  if (cli.positionals.length < 1) usage(EXIT_MISUSE);
  snupkgPath = cli.positionals[0] ?? "";
  outputRoot = cli.positionals[1] ?? "snupkg-extracted";
} catch (err) {
  logError(errorMessage(err));
  usage(EXIT_MISUSE);
}

requireCommandOrExit("unzip", "unzip is required to extract snupkgs", EXIT_API_FAILURE);

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
