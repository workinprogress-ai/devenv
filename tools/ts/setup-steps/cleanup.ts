#!/usr/bin/env node
// cleanup.ts — provision step: post-install package cache cleanup.
// Port of provision.bash cleanup_packages.
//
// `pkill ssh-agent || true`: pkill exits 1 with no match, which must not
// fail the step (the bash original swallowed it for the same reason).

import { spawnSync } from "node:child_process";

spawnSync("bash", ["-c", "pkill ssh-agent &>/dev/null || true"]);
spawnSync("sudo", ["apt", "autoremove", "-y"], { stdio: "inherit" });
console.log("cleanup: ok");
