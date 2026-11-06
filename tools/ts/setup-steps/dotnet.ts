#!/usr/bin/env node
// dotnet.ts — install step: the .NET SDK channels (side by side) and the
// dotnet-format global tool. Ported from the bash bootstrap's install_dotnet.
//
// Idempotent: skips the SDK install when dotnet already resolves; dotnet
// tool install is skipped when the tool is already present.
// Non-interactive.

import { execFileSync, spawnSync } from "node:child_process";

const TOOLBOX = process.env.DEVENV_TOOLBOX_ROOT || "/workspaces/devenv";

// DOTNET_CHANNELS from tool-versions.bash (space-separated; the setup
// consistency test pins this constant to the bash export).
const DOTNET_CHANNELS = ["8.0", "9.0", "10.0"];

function sh(cmd: string, opts: { inherit?: boolean } = {}): { status: number; out: string } {
  const r = spawnSync("bash", ["-c", cmd], {
    encoding: "utf8",
    stdio: opts.inherit ? ["pipe", "inherit", "inherit"] : ["pipe", "pipe", "pipe"],
  });
  return { status: r.status ?? 1, out: r.stdout ?? "" };
}

const hasDotnet = sh("command -v dotnet >/dev/null 2>&1 && echo yes || echo no").out.trim() === "yes";

if (!hasDotnet) {
  // dotnet-install.sh is an accepted unverified download (tool-versions.bash
  // exceptions list: the vendor's updated-in-place convenience script).
  execFileSync("bash", ["-c", "wget -q https://dot.net/v1/dotnet-install.sh -O dotnet-install.sh && chmod +x dotnet-install.sh"], {
    cwd: TOOLBOX,
    stdio: "inherit",
  });
  for (const channel of DOTNET_CHANNELS) {
    execFileSync("sudo", [`${TOOLBOX}/dotnet-install.sh`, "-c", channel, "-i", "/usr/share/dotnet"], { stdio: "inherit" });
  }
  execFileSync("sudo", ["ln", "-sf", "/usr/share/dotnet/dotnet", "/usr/bin/dotnet"], { stdio: "inherit" });
  execFileSync("rm", ["-f", `${TOOLBOX}/dotnet-install.sh`]);
} else {
  const v = spawnSync("dotnet", ["--version"], { encoding: "utf8" }).stdout?.trim();
  console.log(`dotnet already installed: ${v}`);
}

const dotnet = "/usr/bin/dotnet";
execFileSync("sudo", [dotnet, "workload", "update"], { stdio: "inherit" });

const hasFormat = sh(`${dotnet} tool list -g | grep -q dotnet-format && echo yes || echo no`).out.trim() === "yes";
if (hasFormat !== true) {
  execFileSync(dotnet, ["tool", "install", "-g", "dotnet-format"], { stdio: "inherit" });
}
console.log("dotnet: ok");
