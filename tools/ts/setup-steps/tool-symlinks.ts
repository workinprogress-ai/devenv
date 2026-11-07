#!/usr/bin/env node
// tool-symlinks.ts — provision step: sync the depth-1 tool entry points and
// link the system editor. Port of provision.bash create_tool_symlinks.
//
// The stub sync itself stays in .devcontainer/entry-stubs-sync.sh (it is the
// one non-scripts/ script with a public entry point; its bats-derived vitest
// suite pins its contract). This step invokes it, then maintains
// /bin/editor → tools/editor as before.
//
// Idempotent: the sync script is a verified no-op on a synchronized tree;
// the editor link is force-refreshed (sudo).

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { toolbox } from "./lib.ts";

const root = toolbox();

execFileSync("bash", [`${root}/.devcontainer/entry-stubs-sync.sh`], { stdio: "inherit" });

// Ensure system editor points to our wrapper (done after entry points exist).
const systemEditor = "/bin/editor";
const targetEditor = `${root}/tools/editor`;
if (!existsSync(targetEditor)) {
  console.error(`ERROR: editor wrapper missing: ${targetEditor}`);
  process.exit(1);
}
// rm -f || true then ln -sfn, as the bash step did.
spawnSync("sudo", ["rm", "-f", systemEditor], { stdio: "ignore" });
execFileSync("sudo", ["ln", "-sfn", targetEditor, systemEditor], { stdio: "inherit" });
console.log(`tool-symlinks: linked ${systemEditor} -> ${targetEditor}`);
