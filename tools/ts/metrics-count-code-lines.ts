// metrics-count-code-lines — count lines of code across the repository.
// Port of metrics-count-code-lines.sh: `git ls-files` over the tracked
// source extensions, piped through wc -l (spawns wc to keep the output
// byte-identical with the bash tool).

import { spawnSync } from "node:child_process";
import { assertNodeFloor } from "../lib/core/node-floor.ts";

assertNodeFloor();

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
