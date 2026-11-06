#!/usr/bin/env node
// dotnet-tools.ts — install step: the global dotnet tools and the HTTPS dev
// certificate trusted system-wide. Ported from the bash bootstrap's
// configure_dotnet_tools.
//
// Idempotent: each tool install is skipped when already present; cert export
// and ca-certificates refresh are idempotent operations.
// Non-interactive.

import { execFileSync, spawnSync } from "node:child_process";

function sh(cmd: string): { status: number; out: string } {
  const r = spawnSync("bash", ["-c", cmd], { encoding: "utf8" });
  return { status: r.status ?? 1, out: r.stdout ?? "" };
}

const dotnet = process.env["DEVENV_DOTNET_CMD"] || "/usr/bin/dotnet";

function ensureTool(name: string, pkg: string): void {
  const has = sh(`${dotnet} tool list -g | grep -q "${name}" && echo yes || echo no`).out.trim() === "yes";
  if (!has) {
    execFileSync(dotnet, ["tool", "install", "-g", pkg], { stdio: "inherit" });
  }
}

ensureTool("dotnet-reportgenerator", "dotnet-reportgenerator-globaltool");
ensureTool("dotnet-outdated", "dotnet-outdated-tool");

// Dev certificate: trust it and export the PEM for system-wide CA trust.
execFileSync("sudo", [dotnet, "dev-certs", "https"], { stdio: "inherit" });
execFileSync("sudo", ["mkdir", "-p", "/usr/local/share/ca-certificates/aspnet"], { stdio: "inherit" });
execFileSync("sudo", ["chmod", "755", "/usr/local/share/ca-certificates/aspnet"], { stdio: "inherit" });
const exported = spawnSync("sudo", ["-E", dotnet, "dev-certs", "https", "-ep", "/usr/local/share/ca-certificates/aspnet/https.crt", "--format", "PEM"], { stdio: "pipe", encoding: "utf8" });
if (exported.status !== 0) {
  console.log("WARNING: Failed to export HTTPS certificate");
}
execFileSync("sudo", ["update-ca-certificates"], { stdio: "inherit" });
console.log("dotnet-tools: ok");
