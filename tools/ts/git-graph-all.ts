#!/usr/bin/env node
// git-graph-all.ts - Display a graphical representation of all git branches
// Version: 1.1.0
// Description: Shows a one-line, decorated, graphical view of the entire
//              commit history including all branches and remotes. All
//              arguments are passed through to git log.
// Requirements: Node >= 23.6 (native type-stripping execution)

import { spawnSync } from "node:child_process";
import { assertNodeFloor } from "../lib/core/node-floor.ts";

assertNodeFloor();

const r = spawnSync("git", ["log", "--all", "--decorate", "--oneline", "--graph", ...process.argv.slice(2)], {
  stdio: "inherit",
});
process.exit(r.status ?? 1);
