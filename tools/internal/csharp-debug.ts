// csharp-debug — drive the vsdbg .NET Core debugger (installed by bootstrap).
// Port of tools/internal/csharp-debug.sh. Bridge between the workspace's
// vsdbg installation and CLI/DAP clients: launch, attach, version. The
// default (--interpreter=vscode) mode speaks the debug adapter protocol on
// stdin/stdout. All scratchpad-safe (Rung-3 instrumentation; never mutates
// the working tree).

import { existsSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { assertNodeFloor } from "../lib/core/node-floor.ts";
import { resolveToolsRoot } from "../lib/core/self-root.ts";

assertNodeFloor();

const EXIT_MISUSE = 2;
const EXIT_API_FAILURE = 4;

function debuggerHome(): string {
  const override = process.env["DEVENV_ROOT_DEBUGGER_HOME"];
  if (override !== undefined && override !== "" && existsSync(override)) return override;
  const root = process.env["DEVENV_ROOT"] ?? "";
  if (root !== "" && existsSync(join(root, ".debug", "remote_debugger"))) {
    return join(root, ".debug", "remote_debugger");
  }
  // Fall back to the checkout root (where bootstrap puts it).
  return join(dirname(dirname(resolveToolsRoot(import.meta.url))), ".debug", "remote_debugger");
}

function usage(): never {
  console.log(`Usage: csharp-debug launch <app.dll> [-- additional app args]
       csharp-debug attach <pid>
       csharp-debug version

Drive the vsdbg .NET Core debugger installed by bootstrap. The default
(--interpreter=vscode) mode speaks the debug adapter protocol on
stdin/stdout: point a DAP client at it for breakpoints, stepping, watch,
and expression evaluation.

  launch <app.dll>   Start a .NET app under the debugger and enter DAP mode.
  attach <pid>       Attach to a running .NET process and enter DAP mode.
  version            Print the vsdbg version and exit.

Scratchpad-safe (Rung-3 instrumentation): the debugger observes and controls
execution; it does not modify the working tree.

Exit codes:
    0   Session ended normally
    2   Invalid arguments (EXIT_MISUSE)
    4   Debugger not installed / process not found (EXIT_API_FAILURE)
Version: 1.0.0`);
  process.exit(0);
}

function requireDebugger(): string {
  const home = debuggerHome();
  const vsdbg = join(home, "vsdbg");
  if (!existsSync(vsdbg)) {
    process.stderr.write(
      `Error: vsdbg not found at ${vsdbg} — bootstrap installs it (download-csharp-debugger.sh). Run bootstrap, or set DEVENV_ROOT_DEBUGGER_HOME.\n`,
    );
    process.exit(EXIT_API_FAILURE);
  }
  return vsdbg;
}

const argv = process.argv.slice(2);
const first = argv[0];
if (first === undefined || first === "--help" || first === "-h") usage();
if (first === "--version" || first === "-v") {
  console.log("csharp-debug");
  process.exit(0);
}

const cmd = first!;
const rest = argv.slice(1);

switch (cmd) {
  case "version": {
    const vsdbg = requireDebugger();
    const r = spawnSync(vsdbg, ["--help"], { encoding: "utf8" });
    const lines = ((r.stdout ?? "") + (r.stderr ?? "")).split("\n", 2);
    console.log(lines.join("\n").trimEnd());
    process.exit(0);
  }
  case "launch": {
    if (rest.length < 1) {
      process.stderr.write("Error: launch requires an app dll\n");
      process.exit(EXIT_MISUSE);
    }
    const vsdbg = requireDebugger();
    const app = rest[0]!;
    const child = spawn(vsdbg, ["--interpreter=vscode", `--session-id=csharp-debug-${process.pid}`, app, ...rest.slice(1)], {
      stdio: "inherit",
    });
    child.on("exit", (code) => process.exit(code ?? 1));
    break;
  }
  case "attach": {
    if (rest.length !== 1) {
      process.stderr.write("Error: attach requires exactly one pid\n");
      process.exit(EXIT_MISUSE);
    }
    const vsdbg = requireDebugger();
    const child = spawn(vsdbg, ["--interpreter=vscode", "--attach", rest[0]!], { stdio: "inherit" });
    child.on("exit", (code) => process.exit(code ?? 1));
    break;
  }
  default:
    process.stderr.write(`Error: unknown command '${cmd}'\n`);
    process.exit(EXIT_MISUSE);
}
