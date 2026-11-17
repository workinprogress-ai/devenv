#!/usr/bin/env node
// apt-repos.ts — install step: add the specialized package repositories and
// keys (HashiCorp, Kubernetes pkgs.k8s.io). Ported from the bash bootstrap's
// add_specialized_repositories.
//
// Idempotent: keyrings and list files are overwritten in place.
// Non-interactive: no prompts; downloads are read-only fetches.

import { execFileSync } from "node:child_process";
import { assertKeyFingerprints, primaryFingerprints } from "./download-verify.ts";

// K8S_APT_TRACK from tool-versions.bash (its shell single home; the setup
// consistency test pins this default to the bash export).
const K8S_APT_TRACK = "v1.31";

// Vendor key fingerprints a download must carry. Empty means unpinned: the
// key is installed and the step warns. Fill these from the vendors' published
// fingerprints (HashiCorp: security page; Kubernetes: pkgs.k8s.io release key).
const HASHICORP_KEY_FINGERPRINTS: readonly string[] = [];
const KUBERNETES_KEY_FINGERPRINTS: readonly string[] = [];

// pipefail so a failing stage in any pipeline fails the step.
function sh(cmd: string): string {
  return execFileSync("bash", ["-o", "pipefail", "-c", cmd], {
    encoding: "utf8",
    stdio: ["pipe", "pipe", "inherit"],
  });
}

/** Download an armored key, check it against the pinned fingerprints, and
 * install the dearmored keyring. Any failed stage throws before the keyring
 * is written, so a network failure cannot leave an empty keyring behind. */
function installKeyring(label: string, url: string, dest: string, pinned: readonly string[]): void {
  const armored = execFileSync("curl", ["-fsSL", url], { maxBuffer: 1 << 20 });
  const listing = execFileSync("gpg", ["--show-keys", "--with-colons"], { input: armored, encoding: "utf8" });
  const result = assertKeyFingerprints(label, primaryFingerprints(listing), pinned);
  if (result === "unpinned") console.warn(`apt-repos: ${label} key installed without a pinned fingerprint`);
  const keyring = execFileSync("gpg", ["--dearmor"], { input: armored });
  if (keyring.length === 0) throw new Error(`${label}: dearmored keyring is empty`);
  execFileSync("sudo", ["tee", dest], { input: keyring, stdio: ["pipe", "ignore", "inherit"] });
}

execFileSync("sudo", ["mkdir", "-p", "/etc/apt/keyrings"], { stdio: "inherit" });

// HashiCorp key + list.
installKeyring(
  "hashicorp",
  "https://apt.releases.hashicorp.com/gpg",
  "/usr/share/keyrings/hashicorp-archive-keyring.gpg",
  HASHICORP_KEY_FINGERPRINTS,
);
const codename = sh("lsb_release -cs").trim();
sh(
  `echo "deb [signed-by=/usr/share/keyrings/hashicorp-archive-keyring.gpg] https://apt.releases.hashicorp.com ${codename} main" | ` +
    "sudo tee /etc/apt/sources.list.d/hashicorp.list > /dev/null",
);

// Kubernetes pkgs.k8s.io key + list.
installKeyring(
  "kubernetes",
  `https://pkgs.k8s.io/core:/stable:/${K8S_APT_TRACK}/deb/Release.key`,
  "/etc/apt/keyrings/kubernetes-apt-keyring.gpg",
  KUBERNETES_KEY_FINGERPRINTS,
);
execFileSync("sudo", ["chmod", "644", "/etc/apt/keyrings/kubernetes-apt-keyring.gpg"], { stdio: "inherit" });
sh(
  `echo "deb [signed-by=/etc/apt/keyrings/kubernetes-apt-keyring.gpg] https://pkgs.k8s.io/core:/stable:/${K8S_APT_TRACK}/deb/ /" | ` +
    "sudo tee /etc/apt/sources.list.d/kubernetes.list > /dev/null",
);
execFileSync("sudo", ["chmod", "644", "/etc/apt/sources.list.d/kubernetes.list"], { stdio: "inherit" });

console.log("apt-repos: ok");
