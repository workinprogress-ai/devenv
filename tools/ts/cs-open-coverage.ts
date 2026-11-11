// cs-open-coverage — open generated coverage reports in a browser.
// Port of cs-open-coverage.sh: find index.html files under coverage.report
// paths and open each in chromium or firefox (detached).

import { execFileSync, spawn } from "node:child_process";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { assertNodeFloor } from "../lib/core/node-floor.ts";
import { errorMessage } from "../lib/core/logging.ts";
import { toolCli, usageCommonFlags } from "../lib/core/cli.ts";
import { EXIT_GENERAL_ERROR, EXIT_MISUSE } from "../lib/core/exit-codes.ts";

assertNodeFloor();

try {
  const cli = toolCli({
    name: "cs-open-coverage",
    version: "1.0.0",
    argv: process.argv.slice(2),
    noDryRun: true,
    allowPositionals: false,
  });
  if (cli.common.help) {
    console.log(`Usage: cs-open-coverage

Open generated coverage reports in a browser: find index.html files under
coverage.report paths (cwd walk) and open each in chromium or firefox
(detached). Takes no arguments.

Options:
${usageCommonFlags({ noDryRun: true, noDevenv: true })}`);
    process.exit(0);
  }
} catch (err) {
  console.error(errorMessage(err));
  process.exit(EXIT_MISUSE);
}

function commandExists(cmd: string): boolean {
  try {
    execFileSync("bash", ["-c", `command -v ${cmd}`], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

let browser = "";
if (commandExists("chromium")) browser = "chromium";
else if (commandExists("firefox")) browser = "firefox";
else {
  console.error("Error: Neither chromium nor firefox is installed");
  process.exit(EXIT_GENERAL_ERROR);
}

// Find index.html files under coverage.report directories (cwd walk, the
// bash find's exact scope: ./<anywhere>/coverage.report*/index.html shapes).
function walk(dir: string, depth: number): string[] {
  if (depth > 6) return [];
  const found: string[] = [];
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return found;
  }
  for (const e of entries) {
    if (e.name === "node_modules" || e.name === ".git") continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) found.push(...walk(p, depth + 1));
    else if (e.name === "index.html" && p.includes("coverage.report")) found.push(p);
  }
  return found;
}

const files = walk(process.cwd(), 0);
for (const file of files) {
  console.log(`Opening ${file} in ${browser}`);
  // Detached: the browser outlives this tool (nohup parity).
  const child = spawn(browser, [file], { detached: true, stdio: "ignore" });
  child.unref();
}
