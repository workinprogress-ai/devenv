// kube-forward-ports — port-forward to one or more pods, auto-reconnecting.
// Port of kube-forward-ports.sh: mappings come from a file (POD=PORT or
// POD=LOCAL:PODPORT per line) and/or argv; each mapping resolves its pod
// via kube-pod-select; forwards run in parallel and reconnect until
// interrupted. SIGINT/SIGTERM stops all forwards cleanly.

import { spawn, spawnSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import { parseArgs } from "node:util";
import { EXIT_CONFLICT } from "../lib/core/exit-codes.ts";
import { assertNodeFloor } from "../lib/core/node-floor.ts";
import { logError } from "../lib/core/logging.ts";
import { EXIT_GENERAL_ERROR } from "../lib/core/exit-codes.ts";
import { listPods, resolveNamespace } from "../lib/domain/kube/kube.ts";

assertNodeFloor();

function usage(): never {
  console.log(`Usage: kube-forward-ports [-n|--namespace <ns>] [mapping_file] POD=PORT or POD=LOCAL_PORT:POD_PORT [POD=PORT ...]

Forward local ports to pods. Mappings come from a mapping file and/or argv;
each value is POD=PORT (same local and pod port) or POD=LOCAL_PORT:POD_PORT.
Pods are resolved via kube-pod-select (auto-select on a unique match).
All forwards run in parallel and reconnect when they die until interrupted.

Options:
  -n, --namespace NS   Namespace
  -h, --help           Show this help`);
  process.exit(1);
}

const { values, positionals } = parseArgs({
  args: process.argv.slice(2),
  options: {
    help: { type: "boolean", default: false },
    namespace: { type: "string" },
    n: { type: "string" },
  },
  allowPositionals: true,
  strict: false,
});

if (values.help) usage();

const nsInput = (values.namespace as string | undefined) ?? (values.n as string | undefined) ?? "";
const resolution = resolveNamespace(nsInput);
if (resolution.kind === "unreachable") {
  console.error(resolution.message);
  process.exit(EXIT_GENERAL_ERROR);
}
if (resolution.kind === "ambiguous") {
  console.error(`Namespace '${resolution.candidate}' is ambiguous — matches: ${resolution.matches.join(" ")}`);
  process.exit(EXIT_GENERAL_ERROR);
}
if (resolution.kind === "no-match") {
  console.error(`No namespace matches '${resolution.candidate}' — available: ${resolution.available.join(" ")}`);
  process.exit(EXIT_GENERAL_ERROR);
}
const ns = resolution.ns;

// Mappings: first argv entry may be a mapping file; the rest are inline.
const mappings: string[] = [];
const args = [...positionals];
if (args.length > 0 && statSync(args[0] as string, { throwIfNoEntry: false })?.isFile()) {
  const file = args.shift() as string;
  let content = "";
  try {
    content = readFileSync(file, "utf8");
  } catch (err) {
    logError(`Cannot read mapping file ${file}: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(EXIT_GENERAL_ERROR);
  }
  for (const line of content.split("\n")) {
    if (line === "" || line.startsWith("#")) continue;
    mappings.push(line);
  }
}
mappings.push(...args);

if (mappings.length === 0) {
  usage();
}

interface Forward {
  pod: string;
  localPort: string;
  podPort: string;
}

const forwards: Forward[] = [];
for (const mapping of mappings) {
  const eq = mapping.indexOf("=");
  const podId = eq === -1 ? "" : mapping.slice(0, eq);
  const portMapping = eq === -1 ? "" : mapping.slice(eq + 1);
  if (podId === "" || portMapping === "") {
    console.error(`Invalid mapping format: ${mapping}`);
    process.exit(EXIT_GENERAL_ERROR);
  }
  let localPort: string;
  let podPort: string;
  if (portMapping.includes(":")) {
    const parts = portMapping.split(":", 2);
    localPort = parts[0] ?? "";
    podPort = parts[1] ?? "";
  } else {
    localPort = portMapping;
    podPort = portMapping;
  }
  if (!/^[0-9]+$/.test(localPort) || !/^[0-9]+$/.test(podPort)) {
    console.error(`Ports must be numeric in mapping: ${mapping}`);
    process.exit(EXIT_GENERAL_ERROR);
  }
  // Resolve the pod via the select flow (unique match auto-selects; several
  // offer the pick; none errors) — the bash tool shelled to kube-pod-select.
  let pods: string[];
  try {
    pods = listPods({ namespace: ns, filter: podId });
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(EXIT_GENERAL_ERROR);
  }
  if (pods.length === 0) {
    console.error(`No matching pods found for '${podId}'.`);
    process.exit(EXIT_GENERAL_ERROR);
  }
  if (pods.length > 1) {
    // A forward attaching to the wrong pod among several matches is a silent
    // wrong-target action — refuse (kube-pod-select owns interactive picking).
    // Divergence from kube-pod-select's non-TTY contract is deliberate:
    // KUBE_NO_INTERACTIVE=1 keeps first-match only for the single-match
    // case; among several matches even that env picks blind, so it errors
    // too. CI/recorded flows must pin the pod name exactly.
    if (process.env.KUBE_NO_INTERACTIVE === "1") {
      console.error(`KUBE_NO_INTERACTIVE=1 cannot pick among ${pods.length} pods matching '${podId}' — pin the exact pod name.`);
      process.exit(EXIT_CONFLICT);
    }
    console.error(`Multiple pods match '${podId}' (${pods.length} found) — be more specific.`);
    process.exit(EXIT_CONFLICT);
  }
  const pod = pods[0] as string;
  console.log(`Mapping: local port ${localPort} to pod '${pod}' on port ${podPort}.`);
  forwards.push({ pod, localPort, podPort });
}

console.log("Starting port-forwards...");
let terminated = false;

const children: ReturnType<typeof spawn>[] = [];

function cleanup(): void {
  console.error("\nStopping all port-forwards...");
  terminated = true;
  for (const c of children) c.kill("SIGTERM");
  spawnSync("stty", ["sane"], { stdio: "ignore" });
  process.exit(0);
}

process.on("SIGINT", cleanup);
process.on("SIGTERM", cleanup);

for (const f of forwards) {
  const label = `${f.pod}:${f.localPort}->${f.podPort}`;
  const runOnce = (): void => {
    if (terminated) return;
    console.log(`[${label}] Starting port-forward...`);
    const child = spawn("kubectl", ["port-forward", "-n", ns, f.pod, `${f.localPort}:${f.podPort}`], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    children.push(child);
    child.stdout?.on("data", (d: Buffer) => process.stdout.write(`[${label}] ${d.toString()}`));
    child.stderr?.on("data", (d: Buffer) => process.stdout.write(`[${label}] ${d.toString()}`));
    child.on("exit", () => {
      const idx = children.indexOf(child);
      if (idx >= 0) children.splice(idx, 1);
      if (!terminated) {
        console.log(`[${label}] Port-forward died. Reconnecting...`);
        setTimeout(runOnce, 100);
      } else {
        console.log(`[${label}] Terminated.`);
      }
    });
  };
  runOnce();
}

// Keep the process alive while forwards run.
setInterval(() => undefined, 1 << 30);
