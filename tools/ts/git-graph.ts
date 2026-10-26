#!/usr/bin/env node
// git-graph.ts - Display a graphical representation of the git commit history
// Version: 1.1.0
// Description: Shows a one-line, decorated, graphical view of the commit
//              history. All arguments are passed through to git log.
// Requirements: Node >= 23.6 (native type-stripping execution)

import { spawnSync } from "node:child_process";
import { assertNodeFloor } from "../lib/core/node-floor.ts";

assertNodeFloor();

const r = spawnSync("git", ["log", "--decorate", "--oneline", "--graph", ...process.argv.slice(2)], {
  stdio: "inherit",
});
process.exit(r.status ?? 1);
