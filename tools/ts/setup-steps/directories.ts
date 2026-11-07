#!/usr/bin/env node
// directories.ts — provision step: runtime directories, the C# debugger
// download + sanity check, dotnet diagnostic optics, and the system settings
// (inotify limit, docker group). Port of provision.bash
// ensure_directories_and_settings.
//
// Idempotent: mkdir -p everywhere; each optional install is skipped when its
// marker/already-present check hits; the sysctl append is grep-guarded.

import { existsSync, mkdirSync } from "node:fs";
import { execFileSync, spawnSync } from "node:child_process";
import { join } from "node:path";
import { toolbox } from "./lib.ts";

const root = toolbox();

for (const dir of [
  join(root, ".debug", "data"),
  join(root, ".debug", "config"),
  join(root, "repos"),
  join(root, "tmp"),
  join(root, "playground"),
  join(root, "tools", "custom"),
  join(root, ".runtime"),
]) {
  mkdirSync(dir, { recursive: true });
}

// C# debugger: download when absent, then verify it actually works (a
// downloaded-but-broken vsdbg fails LATE mid-hunt otherwise).
const debuggerScript = join(root, ".devcontainer", "download-csharp-debugger.sh");
const vsdbg = join(root, ".debug", "remote_debugger", "vsdbg");
if (!existsSync(join(root, ".debug", "remote_debugger"))) {
  if (existsSync(debuggerScript)) {
    execFileSync("bash", [debuggerScript], { stdio: "inherit" });
  } else {
    console.log("INFO: download-csharp-debugger.sh not found (optional)");
  }
}
if (existsSync(vsdbg)) {
  const probe = spawnSync(vsdbg, ["--help"], { stdio: "ignore" });
  if (probe.status !== 0) {
    console.error("WARN: vsdbg downloaded but not executable-functional — C# debugging unavailable this session");
  }
} else {
  console.log("INFO: vsdbg not installed (optional; C# debugger attach unavailable)");
}

// dotnet diagnostic optics (traces, counters, dumps) — local global tools,
// best-effort (network-independent boot).
if (spawnSync("bash", ["-c", "command -v dotnet >/dev/null 2>&1"]).status === 0) {
  for (const tool of ["dotnet-trace", "dotnet-counters", "dotnet-dump"]) {
    const has = spawnSync("bash", ["-c", `dotnet tool list --global 2>/dev/null | grep -q ${tool}`]).status === 0;
    if (!has) {
      const r = spawnSync("dotnet", ["tool", "install", "--global", tool], { stdio: "ignore" });
      if (r.status !== 0) console.log(`INFO: ${tool} not installed (optional diagnostic optic)`);
    }
  }
}

// inotify limit for watch-heavy workloads (grep-guarded append).
{
  const sysctl = "/etc/sysctl.conf";
  const has = spawnSync("bash", ["-c", `grep -qF 'fs.inotify.max_user_instances=524288' ${sysctl}`], { encoding: "utf8" }).status === 0;
  if (!has) {
    spawnSync("bash", ["-c", `echo fs.inotify.max_user_instances=524288 | sudo tee -a ${sysctl} &>/dev/null`]);
  }
  const applied = spawnSync("sudo", ["sysctl", "-p"], { stdio: "pipe" });
  if ((applied.status ?? 1) !== 0) console.log("INFO: Some sysctl settings may not be applicable in container environment");
}

spawnSync("sudo", ["usermod", "-aG", "docker", "vscode"], { stdio: "ignore" });
spawnSync("sudo", ["mkdir", "-p", "/etc/docker"], { stdio: "ignore" });

console.log("directories: ok");
