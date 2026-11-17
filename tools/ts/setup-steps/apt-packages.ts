#!/usr/bin/env node
// apt-packages.ts — install step: the stable OS package set plus the active
// provider's apt additions. Ported from the bash bootstrap's
// install_os_packages_round1 (same package list, same sudo apt mechanics).
//
// Provider packages: the OS packages the active provider's tooling needs (its
// CLI, for instance) come from PROVIDER_APT_PACKAGES, keyed by the provider
// detected from devenv.config. A [provider] name that is not shipped stops the
// step with the reason.
//
// Idempotent: apt install on installed packages is a no-op.
// Non-interactive: DEBIAN_FRONTEND=noninteractive.

import { execFileSync } from "node:child_process";
import { providerDetect, type ProviderName } from "../../lib/providers/provider-core.ts";

const STABLE_PACKAGES = [
  "curl", "wget", "gnupg", "bash-completion", "iputils-ping", "uuid", "fzf",
  "gcc", "g++", "make", "xmlstarlet", "redis-tools", "cifs-utils",
  "xmlstarlet", "software-properties-common", "sshfs", "apt-transport-https",
  "ca-certificates", "shellcheck", "ripgrep", "parallel",
];

function apt(args: string[]): void {
  execFileSync("sudo", ["apt", ...args], {
    stdio: "inherit",
    env: { ...process.env, DEBIAN_FRONTEND: "noninteractive" },
  });
}

/** OS packages each provider's tooling needs beyond the stable set. */
const PROVIDER_APT_PACKAGES: Record<ProviderName, string[]> = {
  github: ["gh"],
  azure: [],
};

function providerAptPackages(): string {
  return PROVIDER_APT_PACKAGES[providerDetect()].join(" ");
}

const providerPackages = providerAptPackages();
if (providerPackages.length > 0) console.error(`Provider packages: ${providerPackages}`);

apt(["update"]);
apt(["install", "-y", ...STABLE_PACKAGES]);
if (providerPackages.length > 0) {
  apt(["install", "-y", ...providerPackages.split(/\s+/).filter(Boolean)]);
}
console.log("apt-packages: ok");
