#!/usr/bin/env node
// apt-packages-extra.ts — install step: the packages that come from the
// specialized repositories added by apt-repos (terraform, kubectl). Ported
// from the bash bootstrap's install_os_packages_round2.
//
// Idempotent: apt install on installed packages is a no-op.

import { execFileSync } from "node:child_process";

function apt(args: string[]): void {
  execFileSync("sudo", ["apt", ...args], {
    stdio: "inherit",
    env: { ...process.env, DEBIAN_FRONTEND: "noninteractive" },
  });
}

apt(["update"]);
apt(["install", "-y", "terraform", "kubectl"]);
console.log("apt-packages-extra: ok");
