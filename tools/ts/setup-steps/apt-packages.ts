#!/usr/bin/env node
// apt-packages.ts — install step: the stable OS package set plus the active
// provider's apt additions. Ported from the bash bootstrap's
// install_os_packages_round1 (same package list, same sudo apt mechanics).
//
// Provider hook: packages the active provider's tooling needs (its CLI, for
// instance) come from the provider's bootstrap-side bash module
// (providers/<name>/bootstrap.bash, provider_bootstrap_apt_packages) — the
// bootstrap-chain rule keeps provider modules bash, so this step probes the
// hook through a bash -c session loading the seam. A provider defining no
// hook is a no-op success (provider_bootstrap_call's contract).
//
// Idempotent: apt install on installed packages is a no-op.
// Non-interactive: DEBIAN_FRONTEND=noninteractive.

import { execFileSync } from "node:child_process";

const TOOLBOX = process.env.DEVENV_TOOLBOX_ROOT || "/workspaces/devenv";

const STABLE_PACKAGES = [
  "curl", "wget", "gnupg", "bash-completion", "iputils-ping", "uuid", "fzf",
  "gcc", "g++", "make", "xmlstarlet", "redis-tools", "cifs-utils",
  "xmlstarlet", "software-properties-common", "sshfs", "apt-transport-https",
  "ca-certificates", "bats", "shellcheck", "ripgrep", "parallel",
];

function apt(args: string[]): void {
  execFileSync("sudo", ["apt", ...args], {
    stdio: "inherit",
    env: { ...process.env, DEBIAN_FRONTEND: "noninteractive" },
  });
}

function providerAptPackages(): string {
  const script = [
    `toolbox_root='${TOOLBOX}'`,
    `export DEVENV_ROOT='${TOOLBOX}'`,
    `source '${TOOLBOX}/tools/lib/providers/provider-core.bash'`,
    // A [provider] name that is not shipped stops with the reason.
    `provider_detect '${TOOLBOX}/devenv.config' || exit 1`,
    `auth_mod="$(dirname '${TOOLBOX}/tools/lib/providers/provider-core.bash')/\${PROVIDER_NAME}/bootstrap.bash"`,
    `[ -f "$auth_mod" ] && source "$auth_mod"`,
    `provider_bootstrap_call apt_packages`,
  ].join("\n");
  const r = execFileSync("bash", ["-c", script], { encoding: "utf8" });
  return r.trim();
}

const providerPackages = providerAptPackages();
if (providerPackages.length > 0) console.error(`Provider packages: ${providerPackages}`);

apt(["update"]);
apt(["install", "-y", ...STABLE_PACKAGES]);
if (providerPackages.length > 0) {
  apt(["install", "-y", ...providerPackages.split(/\s+/).filter(Boolean)]);
}
console.log("apt-packages: ok");
