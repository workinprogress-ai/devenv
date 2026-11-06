#!/usr/bin/env node
// apt-repos.ts — install step: add the specialized package repositories and
// keys (HashiCorp, Kubernetes pkgs.k8s.io). Ported from the bash bootstrap's
// add_specialized_repositories.
//
// Idempotent: keys are written (dearmor --yes overwrites), list files are
// overwritten via tee.
// Non-interactive: no prompts; downloads are read-only fetches.

import { execFileSync } from "node:child_process";

// K8S_APT_TRACK from tool-versions.bash (its shell single home; the setup
// consistency test pins this default to the bash export).
const K8S_APT_TRACK = "v1.31";

function sh(cmd: string): string {
  return execFileSync("bash", ["-c", cmd], {
    encoding: "utf8",
    stdio: ["pipe", "pipe", "inherit"],
  });
}

execFileSync("sudo", ["mkdir", "-p", "/etc/apt/keyrings"], { stdio: "inherit" });

// HashiCorp key + list (the historical pipeline, command by command).
sh(
  "wget -qO- https://apt.releases.hashicorp.com/gpg | gpg --dearmor | " +
    "sudo tee /usr/share/keyrings/hashicorp-archive-keyring.gpg > /dev/null",
);
const codename = sh("lsb_release -cs").trim();
sh(
  `echo "deb [signed-by=/usr/share/keyrings/hashicorp-archive-keyring.gpg] https://apt.releases.hashicorp.com ${codename} main" | ` +
    "sudo tee /etc/apt/sources.list.d/hashicorp.list > /dev/null",
);

// Kubernetes pkgs.k8s.io key + list.
sh(
  `curl -fsSL "https://pkgs.k8s.io/core:/stable:/${K8S_APT_TRACK}/deb/Release.key" | ` +
    "sudo gpg --dearmor --yes -o /etc/apt/keyrings/kubernetes-apt-keyring.gpg",
);
execFileSync("sudo", ["chmod", "644", "/etc/apt/keyrings/kubernetes-apt-keyring.gpg"], { stdio: "inherit" });
sh(
  `echo "deb [signed-by=/etc/apt/keyrings/kubernetes-apt-keyring.gpg] https://pkgs.k8s.io/core:/stable:/${K8S_APT_TRACK}/deb/ /" | ` +
    "sudo tee /etc/apt/sources.list.d/kubernetes.list > /dev/null",
);
execFileSync("sudo", ["chmod", "644", "/etc/apt/sources.list.d/kubernetes.list"], { stdio: "inherit" });

console.log("apt-repos: ok");
