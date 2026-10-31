// kube-intercept — intercept cluster traffic into local services via
// telepresence. Port of kube-intercept.sh: mappings from a file and/or argv
// (DEPLOYMENT=PORT[,PORT...] — commas for multiple ports), each deployment
// resolved to a pod via the namespace's pod listing; a watchdog keeps the
// telepresence daemon connected; SIGINT/SIGTERM stops intercepts and the
// daemon.

import { spawn, spawnSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import { parseArgs } from "node:util";
import { EXIT_CONFLICT } from "../lib/core/exit-codes.ts";
import { assertNodeFloor } from "../lib/core/node-floor.ts";
import { logError } from "../lib/core/logging.ts";
import { EXIT_GENERAL_ERROR } from "../lib/core/exit-codes.ts";
import { listPods, resolveNamespace } from "../lib/domain/kube/kube.ts";

assertNodeFloor();

const WATCHDOG_INTERVAL_MS = 5000;
const PREFIX = "[telepresence-watchdog]";

function usage(): never {
  console.log(`Usage: kube-intercept [-n|--namespace <ns>] [mapping_file] DEPLOYMENT=PORT[,PORT...] [DEPLOYMENT=PORT ...]

Intercept cluster traffic into local services via telepresence. Mappings
come from a mapping file (one DEPLOYMENT=PORT per line, # comments allowed)
and/or argv; comma-separate multiple ports. Each deployment resolves to a
pod in the namespace. A watchdog reconnects the daemon while intercepts run.

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

interface Intercept {
  pod: string;
  /** "--port local:remote" segments, one per port pair. */
  portArgs: string[];
}

const intercepts: Intercept[] = [];
for (const mapping of mappings) {
  const eq = mapping.indexOf("=");
  const depId = eq === -1 ? "" : mapping.slice(0, eq);
  const portMapping = eq === -1 ? "" : mapping.slice(eq + 1);
  if (depId === "" || portMapping === "") {
    console.error(`Invalid mapping format: ${mapping}`);
    process.exit(EXIT_GENERAL_ERROR);
  }
  // Resolve the deployment's pod (the bash tool used get_deployment_info's
  // picker; the listing contract here is first matching pod, failing loud).
  let pods: string[];
  try {
    pods = listPods({ namespace: ns, filter: depId });
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(EXIT_GENERAL_ERROR);
  }
  if (pods.length === 0) {
    console.error(`Failed to select pod for deployment: ${depId}`);
    process.exit(EXIT_GENERAL_ERROR);
  }
  if (pods.length > 1) {
    // Same contract as kube-forward-ports: an intercept replacing the wrong
    // pod among several matches is a silent wrong-target action — refuse,
    // even under KUBE_NO_INTERACTIVE=1 (blind picking is not safe here).
    if (process.env.KUBE_NO_INTERACTIVE === "1") {
      console.error(`KUBE_NO_INTERACTIVE=1 cannot pick among ${pods.length} pods matching '${depId}' — pin the exact pod name.`);
      process.exit(EXIT_CONFLICT);
    }
    console.error(`Multiple pods match '${depId}' (${pods.length} found) — be more specific.`);
    process.exit(EXIT_CONFLICT);
  }
  const pod = pods[0] as string;

  const portArgs: string[] = [];
  for (const pair of portMapping.split(",")) {
    let localPort: string;
    let podPort: string;
    if (pair.includes(":")) {
      const parts = pair.split(":", 2);
      localPort = parts[0] ?? "";
      podPort = parts[1] ?? "";
    } else {
      localPort = pair;
      podPort = pair;
    }
    if (!/^[0-9]+$/.test(localPort) || !/^[0-9]+$/.test(podPort)) {
      console.error(`Ports must be numeric in mapping: ${mapping}`);
      process.exit(EXIT_GENERAL_ERROR);
    }
    portArgs.push("--port", `${localPort}:${podPort}`);
  }
  intercepts.push({ pod, portArgs });
}

function telepresenceConnected(): boolean {
  const r = spawnSync("telepresence", ["status", "--output", "json"], { encoding: "utf8" });
  try {
    const j = JSON.parse(r.stdout) as { user_daemon?: { status?: string } };
    return j.user_daemon?.status === "Connected";
  } catch {
    return false;
  }
}

let watchdog: ReturnType<typeof spawn> | undefined;

function watchdogLoop(): void {
  // A detached background loop (bash ran it with &); keep it as a child so
  // cleanup can kill it. It polls until killed.
  const child = spawn(
    "bash",
    [
      "-c",
      `while true; do
  if ! telepresence status --output json 2>/dev/null | grep -q '"Connected"'; then
    echo "${PREFIX} [$(date)] Telepresence is not connected. Attempting to reconnect..."
    if telepresence connect >/dev/null 2>&1; then
      sleep ${WATCHDOG_INTERVAL_MS / 1000}
    else
      echo "${PREFIX} [$(date)] Failed to connect to telepresence. Attempting to remove hung socket..."
      sudo rm -f /var/run/telepresence-daemon.socket >/dev/null 2>&1
      sleep 1
      if telepresence connect >/dev/null 2>&1; then
        sleep ${WATCHDOG_INTERVAL_MS / 1000}
      else
        echo "${PREFIX} [$(date)] Failed to connect to telepresence. Exiting..."
        exit 1
      fi
    fi
  fi
  sleep ${WATCHDOG_INTERVAL_MS / 1000}
done`,
    ],
    { stdio: "ignore", detached: false },
  );
  watchdog = child;
}

function cleanup(): void {
  console.error("\nStopping all intercepts...");
  if (watchdog !== undefined) watchdog.kill("SIGTERM");
  spawnSync("telepresence", ["quit", "--stop-daemons"], { stdio: "ignore" });
  process.exit(0);
}

process.on("SIGINT", cleanup);
process.on("SIGTERM", cleanup);

// Ensure traffic-manager exists (install when missing).
const tm = spawnSync("kubectl", ["get", "deployment", "traffic-manager", "-n", "ambassador", "--no-headers"], {
  stdio: ["ignore", "ignore", "ignore"],
});
if (tm.status !== 0) {
  console.log("Installing traffic-manager on cluster...");
  spawnSync("telepresence", ["helm", "install"], { stdio: "inherit" });
}

if (!telepresenceConnected()) {
  console.log("Starting telepresence...");
  watchdogLoop();
  spawnSync("sleep", ["3"]);
}

console.log("Starting intercepts...");
for (const it of intercepts) {
  const r = spawnSync("telepresence", ["replace", it.pod, ...it.portArgs], { stdio: "inherit" });
  if (r.status !== 0) {
    console.error(`telepresence replace failed for pod ${it.pod}`);
    cleanup();
    // A failed intercept must not report success (cleanup alone exited 0).
    process.exit(EXIT_GENERAL_ERROR);
  }
}

if (watchdog === undefined) {
  // Reachable only when telepresence was already connected (no watchdog was
  // started). The old bash wording claimed a watchdog was running — it was not.
  console.log("Telepresence already connected; no connection watchdog needed.");
  console.log("Intercepts are active.  To exit the intercept, run telepresence leave (or quit the daemon).");
  process.exit(0);
}

// Watchdog active: stay alive while intercepts run.
setInterval(() => undefined, 1 << 30);
