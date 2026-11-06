#!/usr/bin/env node
// repo-deps.ts — install step: repository dependencies via pnpm install.
// Ported from the bash bootstrap's install_repo_dependencies.
//
// Contract: CI=1 HUSKY=0 — bootstrap contexts (fresh container, CI) must not
// install git hooks; a failed or unwanted husky prepare would fail the whole
// install and break the bootstrap chain. Local dev installs run without this
// and get hooks as usual.
//
// Failure semantics match the historical task: a pnpm failure WARNS but does
// not fail the step (the bash bootstrap set PNPM_INSTALL_FAILED and let the
// chain continue; finish_message carried the ACTION REQUIRED line).
//
// Idempotent: pnpm install on a satisfied lockfile is a fast no-op.

import { spawnSync } from "node:child_process";

const TOOLBOX = process.env.DEVENV_TOOLBOX_ROOT || "/workspaces/devenv";

const r = spawnSync("pnpm", ["install"], {
  cwd: TOOLBOX,
  stdio: "inherit",
  env: { ...process.env, CI: "1", HUSKY: "0" },
});

if (r.status !== 0) {
  console.log("WARNING: pnpm install failed; the repo's git hooks and node tooling may be missing");
  console.log(`ACTION REQUIRED: 'pnpm install' failed during setup. Run it in ${TOOLBOX} and check the output.`);
}
console.log("repo-deps: ok");
