// metrics-count-code-lines — count lines of code across the repository.
// Port of metrics-count-code-lines.sh: `git ls-files` over the tracked
// source extensions, piped through wc -l (spawns wc to keep the output
// byte-identical with the bash tool).

import { spawnSync } from "node:child_process";
import { assertNodeFloor } from "../lib/core/node-floor.ts";
import { errorMessage } from "../lib/core/logging.ts";
import { toolCli, usageCommonFlags } from "../lib/core/cli.ts";

assertNodeFloor();

try {
  const cli = toolCli({
    name: "metrics-count-code-lines",
    version: "1.0.0",
    argv: process.argv.slice(2),
    noDryRun: true,
    // Positionals are accepted (the bash original ignored them; callers
    // pass '.' for cwd semantics) but never read.
    allowPositionals: true,
  });
  if (cli.common.help) {
    console.log(`Usage: metrics-count-code-lines

Count lines of code across the repository's tracked source files (git
ls-files over the source extensions, piped through wc -l). Takes no
arguments.

Options:
${usageCommonFlags({ noDryRun: true, noDevenv: true })}`);
    process.exit(0);
  }
} catch (err) {
  console.error(errorMessage(err));
  process.exit(2);
}

const globs = [
  "*/*.cs", "*.cs", "*/*.html", "*.html", "*/*.js", "*.js", "*/*.ts", "*.ts",
  "*/*.json", "*.json", "*/*.xml", "*.xml", "*/*.csproj", "*.csproj",
  "*/*.sln", "*.sln", "*/*.slnx", "*.slnx", "*/*.sh", "*.sh",
];

const ls = spawnSync("git", ["ls-files", ...globs], { encoding: "utf8" });
const files = (ls.stdout ?? "").split("\n").filter((f) => f !== "");
if (files.length === 0) process.exit(0);

// A huge file list can exceed the exec argv limit (the E2BIG lesson from the
// provider layer). A single `wc -l` prints per-file blocks plus one `total`
// block. This port passes the whole list unchunked — a very large tree can
// regress to E2BIG; chunk (summing per-chunk totals) if that ever bites.
const wc = spawnSync("wc", ["-l", ...files], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
process.stdout.write(wc.stdout ?? "");
process.exit(wc.status ?? 1);
