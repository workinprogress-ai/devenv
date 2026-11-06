#!/usr/bin/env node
// node-globals.ts — install step: the global node packages (pnpm, turbo,
// zx) onto the ACTIVE node. Ported from the bash bootstrap's
// install_node_packages (the npm globals half).
//
// Ordering contract: the thin bootstrap has put the pinned node on PATH
// before this step — `npm install -g` lands in the active version's global
// bin, exactly as the bash task did after install_or_configure_nvm.
//
// Idempotent: npm install -g pkg@version converges to the named version.
// Non-interactive: CI=1 for npm/pnpm child processes.

import { execFileSync } from "node:child_process";

// PNPM_VERSION / TURBO_VERSION from tool-versions.bash (the setup
// consistency test pins these constants to the bash exports).
const PNPM_VERSION = "11.9.0";
const TURBO_VERSION = "2.0.6";

function npm(args: string[]): void {
  execFileSync("npm", args, {
    stdio: "inherit",
    env: { ...process.env, CI: "1" },
  });
}

npm(["install", "-g", "zx"]);

// Reclaim a root-owned pnpm module left by a feature-era image build: npm
// run as the current user cannot rename/replace it in place (EACCES).
// Safe to call when no such directory exists.
{
  const root = execFileSync("npm", ["root", "-g"], { encoding: "utf8" }).trim();
  const pnpmDir = `${root}/pnpm`;
  try {
    const stat = execFileSync("stat", ["-c", "%U", pnpmDir], { encoding: "utf8" }).trim();
    const me = execFileSync("whoami", { encoding: "utf8" }).trim();
    if (stat && stat !== me) {
      execFileSync("sudo", ["chown", "-R", `${me}:${me}`, pnpmDir], { stdio: "inherit" });
    }
  } catch {
    // no pnpm dir yet — nothing to reclaim
  }
}

npm(["install", "-g", `pnpm@${PNPM_VERSION}`]);
npm(["install", "-g", `turbo@${TURBO_VERSION}`]);
console.log("node-globals: ok");
