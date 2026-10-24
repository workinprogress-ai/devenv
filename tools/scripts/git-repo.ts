#!/usr/bin/env node
// git-repo.ts - Alias for repo-get (identity-preserved passthrough)
// Version: 1.0.0
// Description: git-repo forwards to repo-get with all arguments, exactly as
//              the bash wrapper did: bash exec'd the same-directory repo-get
//              source directly, so this port spawns the same-layer repo-get.ts
//              (not the stub chain) to preserve that dispatch.
// Requirements: Node >= 23.6 (native type-stripping execution)

import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { assertNodeFloor } from "../lib/core/node-floor.ts";

assertNodeFloor();

const toolsDir = dirname(dirname(fileURLToPath(import.meta.url)));
const r = spawnSync("node", [join(toolsDir, "scripts", "repo-get.ts"), ...process.argv.slice(2)], {
  stdio: "inherit",
});
process.exit(r.status ?? 1);
