// kube-intercept — intercept cluster traffic into local services via
// telepresence. Mappings come from a file and/or argv, each
// DEPLOYMENT=<port-spec> resolved against the namespace's deployments and
// intercepted at the deployment level (telepresence intercept semantics:
// port-spec names a declared container port; numeric specs keep the legacy
// number-form). A native watchdog (when this run starts the daemons)
// reconnects on drop and re-establishes the intercepts; SIGINT/SIGTERM
// leaves only what this run started.
//
// Mapping forms:
//   DEPLOY=LOCAL:PORTNAME   intercept DEPLOY's port named PORTNAME → local LOCAL
//   DEPLOY=PORTNAME         same, local port resolved from the named port
//   DEPLOY=LOCAL:NUMBER     legacy numeric pod port
//   DEPLOY=NUMBER           legacy bare numeric port
// Named ports are the primary form: telepresence matches declared container
// port names; unnamed ports are not interceptable.

import { spawnSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import { EXIT_CONFLICT, EXIT_MISUSE } from "../lib/core/exit-codes.ts";
import { assertNodeFloor } from "../lib/core/node-floor.ts";
import { errorMessage, logError } from "../lib/core/logging.ts";
import { EXIT_GENERAL_ERROR } from "../lib/core/exit-codes.ts";
import { toolCli, usageCommonFlags } from "../lib/core/cli.ts";
import { listDeployments, resolveNamespace, spawnKubectl } from "../lib/domain/kube/kube.ts";

assertNodeFloor();

const WATCHDOG_INTERVAL_MS = 5000;
const SCRIPT_VERSION = "2.0.0";

function usage(status = 0): never {
  (status === 0 ? console.log : console.error)(`Usage: kube-intercept [-n|--namespace <ns>] [mapping_file] DEPLOYMENT=<port-spec> [DEPLOYMENT=<port-spec> ...]

Intercept cluster traffic into local services via telepresence. Each mapping
targets a deployment; the port-spec names a declared container port (primary)
or gives a legacy numeric port. Comma-separate multiple port-specs per
deployment; mappings also load from a file (one per line, # comments).

Port-spec forms:
  LOCAL:PORTNAME   named port (e.g. api=5678:http) — telepresence matches
                   declared container port names; unnamed ports are not
                   interceptable
  PORTNAME         named port, local port = the named port's containerPort
  LOCAL:NUMBER     legacy numeric pod port
  NUMBER           legacy bare numeric port

Lifecycle: when the wrapper starts the telepresence daemons it keeps running
with a watchdog (reconnect re-establishes intercepts) — stop it with Ctrl-C
(interactive) or SIGINT/SIGTERM (exit 130, daemons stop). When attaching to
already-running daemons, interactive runs stay foreground; non-interactive
runs exit 0 after starting intercepts (the daemons hold them).

Options:
  -n, --namespace NS   Namespace
${usageCommonFlags({ noDryRun: true })}`);
  process.exit(status);
}

let nsInput = "";
let mappingsRaw: string[] = [];
try {
  const cli = toolCli({
    name: "kube-intercept",
    version: SCRIPT_VERSION,
    argv: process.argv.slice(2),
    noDryRun: true,
    options: {
      namespace: { type: "string", short: "n" },
    },
  });
  if (cli.common.help) usage();
  nsInput = (cli.values["namespace"] as string | undefined) ?? "";
  mappingsRaw = [...cli.positionals];
} catch (err) {
  logError(errorMessage(err));
  console.error("Use --help for usage information");
  process.exit(EXIT_MISUSE);
}
const resolution = resolveNamespace(nsInput);
if (resolution.kind === "unreachable") {
  console.error(resolution.message);
  // Split the two causes the umbrella message conflates: a missing kubectl
  // binary vs a present-but-broken kubectl vs a reachable-binary/unreachable
  // cluster. The probe bypasses kube.ts's single-seam rule deliberately: the
  // desired semantics here is the spawn's own not-found result.
  const probe = spawnSync("kubectl", ["version", "--client"], { encoding: "utf8" });
  if (probe.error !== undefined) {
    console.error("kubectl not found on PATH — it is preinstalled in the dev container; outside it, install kubectl first");
  } else if (probe.status !== 0) {
    console.error("kubectl exists but fails to run (broken install or shim) — reinstall kubectl");
  } else {
    console.error("kubectl is present but cannot reach the cluster — check the current context (kube-set-context) and that the cluster is up");
  }
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
const args = [...mappingsRaw];
if (args.length > 0 && statSync(args[0] as string, { throwIfNoEntry: false })?.isFile()) {
  const file = args.shift() as string;
  let content = "";
  try {
    content = readFileSync(file, "utf8");
  } catch (err) {
    logError(`Cannot read mapping file ${file}: ${errorMessage(err)}`);
    process.exit(EXIT_GENERAL_ERROR);
  }
  for (const line of content.split("\n")) {
    // CR-tolerant: a CRLF mapping file's trailing CR otherwise fails port
    // validation invisibly (the CR renders nowhere in the error message).
    const trimmed = line.replace(/\r$/, "");
    if (trimmed === "" || trimmed.startsWith("#")) continue;
    mappings.push(trimmed);
  }
}
mappings.push(...args);

if (mappings.length === 0) {
  usage(EXIT_MISUSE);
}

const isPortName = (value: string): boolean => /^[a-z][a-z0-9-]*$/i.test(value) && !/^[0-9]+$/.test(value);

/** Resolve a named container port's containerPort for DEPLOYMENT via
 * kubectl. Exits misuse when the deployment declares no such port — the
 * named-port form is only valid against a declared name. */
function fetchDeploymentSpec(deployment: string, portName: string, mapping: string): {
  spec?: { template?: { spec?: { containers?: Array<{ ports?: Array<{ name?: string; containerPort?: number }> }> } } };
} {
  let stdout = "";
  try {
    const r = spawnKubectl(["get", "deployment", deployment, "-n", ns, "-o", "json"]);
    if (r.status !== 0) {
      console.error(`Cannot read deployment ${deployment} to resolve port '${portName}': ${mapping}`);
      process.exit(EXIT_GENERAL_ERROR);
    }
    stdout = r.stdout;
  } catch (err) {
    console.error(errorMessage(err));
    process.exit(EXIT_GENERAL_ERROR);
  }
  // Parse failure is an environment problem (polluted output), not a mapping
  // problem — diagnose it as such instead of claiming the port is undeclared.
  try {
    return JSON.parse(stdout) as ReturnType<typeof fetchDeploymentSpec>;
  } catch {
    console.error(`kubectl returned unparseable output reading deployment ${deployment} (port '${portName}'): ${mapping}`);
    process.exit(EXIT_GENERAL_ERROR);
  }
}

function resolveContainerPort(deployment: string, portName: string, mapping: string): string {
  const spec = fetchDeploymentSpec(deployment, portName, mapping);
  for (const c of spec.spec?.template?.spec?.containers ?? []) {
    for (const p of c.ports ?? []) {
      if (p.name === portName && p.containerPort !== undefined) return String(p.containerPort);
    }
  }
  console.error(`Deployment ${deployment} declares no port named '${portName}' in mapping: ${mapping}`);
  process.exit(EXIT_MISUSE);
}

interface Intercept {
  deployment: string;
  /** "--port local:target" segments, one per port pair. */
  portArgs: string[];
}

const intercepts: Intercept[] = [];
for (const mapping of mappings) {
  const eq = mapping.indexOf("=");
  const depId = eq === -1 ? "" : mapping.slice(0, eq);
  const portSpecRaw = eq === -1 ? "" : mapping.slice(eq + 1);
  if (depId === "" || portSpecRaw === "") {
    console.error(`Invalid mapping format: ${mapping}`);
    process.exit(EXIT_MISUSE);
  }
  // Resolve the deployment (unique match required; several matches are a
  // wrong-target hazard and refuse, mirroring the pod contract).
  let deployments: string[];
  try {
    // Exact match first: the listing filter is a regex, and a regex-
    // metacharactered exact name (api.foo) could otherwise single-match a
    // different deployment (api-foo). An exact hit bypasses the filter.
    deployments = listDeployments({ namespace: ns });
    if (deployments.includes(depId)) {
      deployments = [depId];
    } else {
      try {
        const re = new RegExp(depId, "i");
        deployments = deployments.filter((d) => re.test(d));
      } catch {
        console.error(`invalid deployment name pattern: ${depId}`);
        process.exit(EXIT_MISUSE);
      }
    }
  } catch (err) {
    console.error(errorMessage(err));
    process.exit(EXIT_GENERAL_ERROR);
  }
  if (deployments.length === 0) {
    console.error(`Failed to select deployment for intercept: ${depId}`);
    process.exit(EXIT_GENERAL_ERROR);
  }
  if (deployments.length > 1) {
    // An intercept replacing the wrong deployment among several matches is a
    // silent wrong-target action — refuse, even under KUBE_NO_INTERACTIVE=1
    // (blind picking is not safe here).
    if (process.env.KUBE_NO_INTERACTIVE === "1") {
      console.error(`KUBE_NO_INTERACTIVE=1 cannot pick among ${deployments.length} deployments matching '${depId}' — pin the exact deployment name.`);
      process.exit(EXIT_CONFLICT);
    }
    console.error(`Multiple deployments match '${depId}' (${deployments.length} found) — be more specific.`);
    process.exit(EXIT_CONFLICT);
  }
  const deployment = deployments[0] as string;

  const portArgs: string[] = [];
  for (const pair of portSpecRaw.split(",")) {
    let localPort: string;
    let targetPort: string;
    if (pair.includes(":")) {
      // JS split-with-limit truncates: a third segment would vanish
      // silently (api=8080:http:grpc parsed as 8080:http). Refuse instead.
      const segments = pair.split(":");
      if (segments.length > 2) {
        console.error(`Port pair has too many ':' segments in mapping: ${mapping}`);
        process.exit(EXIT_MISUSE);
      }
      localPort = segments[0] ?? "";
      targetPort = segments[1] ?? "";
    } else if (/^[0-9]+$/.test(pair)) {
      // Legacy bare numeric: local = pod port.
      localPort = pair;
      targetPort = pair;
    } else if (isPortName(pair)) {
      // DEPLOY=PORTNAME: resolve the named port's containerPort for the
      // local side so telepresence receives a numeric local port.
      localPort = resolveContainerPort(deployment, pair, mapping);
      targetPort = pair;
    } else {
      console.error(`Port must be a name or numeric in mapping: ${mapping}`);
      process.exit(EXIT_MISUSE);
    }
    if (localPort === "" || !/^[0-9]+$/.test(localPort)) {
      console.error(`Local port must be numeric in mapping: ${mapping}`);
      process.exit(EXIT_MISUSE);
    }
    // Target: numeric (legacy) or a declared port name (primary form).
    if (!/^[0-9]+$/.test(targetPort) && !isPortName(targetPort)) {
      console.error(`Port target must be a port name or numeric in mapping: ${mapping}`);
      process.exit(EXIT_MISUSE);
    }
    // Pair form validates the declared name too — the bare form refuses
    // eagerly; asymmetry would push the failure into telepresence's generic
    // error after side effects have run. Same status-aware resolution path:
    // a kubectl failure must not masquerade as "port not declared".
    if (isPortName(targetPort)) resolveContainerPort(deployment, targetPort, mapping);
    portArgs.push("--port", `${localPort}:${targetPort}`);
  }
  // Duplicate mappings for one deployment would run a second `telepresence
  // intercept` under the same default intercept name — the later run
  // replaces the earlier's ports and cleanup `leave`s twice. Refuse loudly.
  if (intercepts.some((i) => i.deployment === deployment)) {
    console.error(`Duplicate mapping for deployment ${deployment} — combine the ports in one mapping (comma-separated).`);
    process.exit(EXIT_MISUSE);
  }
  intercepts.push({ deployment, portArgs });
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

function ensureOssClient(): void {
  // The OSS line is the only wall-free client; an enterprise client on PATH
  // walls connect behind an Ambassador Cloud account. Fail loud rather than
  // hang so the fix (install the pinned OSS client) is discoverable.
  const v = spawnSync("telepresence", ["version"], { encoding: "utf8" });
  const out = (v.stdout ?? "") + (v.stderr ?? "");
  if (v.status !== 0 || /enterprise/i.test(out)) {
    console.error("telepresence client is missing or enterprise-walled — install it with: install-extras telepresence (or the kubernetes-tools set)");
    process.exit(EXIT_GENERAL_ERROR);
  }
}

let watchdogTimer: ReturnType<typeof setInterval> | undefined;
/** True when this run started the telepresence daemons (vs attaching to a
 * user's pre-existing session) — cleanup only stops what we started. */
let ownsDaemons = false;

function runIntercepts(): void {
  for (const it of intercepts) {
    const r = spawnSync("telepresence", ["intercept", it.deployment, ...it.portArgs], { stdio: "inherit" });
    if (r.status !== 0) {
      if (r.status === null && r.signal === "SIGINT") cleanup(130);
      console.error(`telepresence intercept failed for deployment ${it.deployment}`);
      cleanup(EXIT_GENERAL_ERROR);
    }
  }
}

function startWatchdog(): void {
  // Native loop: poll the JSON status; reconnect when the daemon drops, and
  // re-establish the intercepts — a reconnect alone leaves zero intercepts
  // while the wrapper would keep claiming they are active.
  watchdogTimer = setInterval(() => {
    if (telepresenceConnected()) return;
    console.error("[telepresence-watchdog] not connected — reconnecting...");
    const r = spawnSync("telepresence", ["connect"], { stdio: "inherit" });
    if (r.status !== 0) {
      if (r.status === null && r.signal === "SIGINT") cleanup(130);
      console.error("[telepresence-watchdog] reconnect failed; will retry");
      return;
    }
    console.error("[telepresence-watchdog] reconnected — re-establishing intercepts...");
    runIntercepts();
  }, WATCHDOG_INTERVAL_MS);
  watchdogTimer.unref();
}

function cleanup(exitCode = 0): never {
  console.error("\nStopping all intercepts...");
  if (watchdogTimer !== undefined) clearInterval(watchdogTimer);
  if (ownsDaemons) {
    spawnSync("telepresence", ["quit", "--stop-daemons"], { stdio: "ignore" });
  } else {
    // Leave the user's session alone; drop only this run's intercepts.
    for (const it of intercepts) spawnSync("telepresence", ["leave", it.deployment], { stdio: "ignore" });
  }
  process.exit(exitCode);
}

process.on("SIGINT", () => cleanup(130));
process.on("SIGTERM", () => cleanup(130));

ensureOssClient();

// Ensure the OSS traffic-manager exists (install when missing). The OSS
// client does not auto-install on connect (enterprise clients do), so this
// must run before the first connect attempt. The check targets the OSS
// default manager namespace (ambassador); a manager installed elsewhere
// needs telepresence's own --manager-namespace — not expressible here yet.
let tm: { status: number };
try {
  tm = spawnKubectl(["get", "deployment", "traffic-manager", "-n", "ambassador", "--no-headers"]);
} catch (err) {
  console.error(errorMessage(err));
  process.exit(EXIT_GENERAL_ERROR);
}
if (tm.status !== 0) {
  console.log("Installing OSS traffic-manager on cluster...");
  const helm = spawnSync("telepresence", ["helm", "install"], { stdio: "inherit" });
  if (helm.status === null && helm.signal === "SIGINT") cleanup(130);
  if (helm.status !== 0) {
    console.error("telepresence helm install failed — cannot intercept without a traffic-manager");
    cleanup(EXIT_GENERAL_ERROR);
  }
}

if (!telepresenceConnected()) {
  console.log("Starting telepresence...");
  // Set before the connect attempt: a SIGINT during connect (partial
  // daemons already running) must take the quit-daemons cleanup path, not
  // the attach path's `leave`-against-a-half-connected-session.
  ownsDaemons = true;
  const c = spawnSync("telepresence", ["connect"], { stdio: "inherit" });
  if (c.status === null && c.signal === "SIGINT") cleanup(130);
  if (c.status !== 0) {
    console.error("telepresence connect failed");
    cleanup(EXIT_GENERAL_ERROR);
  }
  startWatchdog();
} else {
  console.log("Telepresence already connected (attaching; daemons are left running on exit).");
}

console.log("Starting intercepts...");
runIntercepts();

if (watchdogTimer !== undefined) {
  if (process.stdin.isTTY) {
    console.log("Intercepts are active with a connection watchdog (reconnect re-establishes intercepts). To exit, press Ctrl-C.");
  } else {
    console.log("Intercepts are active with a connection watchdog (reconnect re-establishes intercepts). Non-interactive run: stop with SIGINT/SIGTERM (exit 130); the daemons stop with it.");
  }
  // Keep the process alive while the watchdog runs — in scripts as well: the
  // watchdog is the durability guarantee (a dropped daemon is reconnected and
  // the intercepts re-established). Killing the process ends that.
  setInterval(() => undefined, 1 << 30);
} else if (process.stdin.isTTY) {
  console.log("Intercepts are active (attached; no watchdog on this path). To exit, press Ctrl-C — intercepts are left, daemons untouched.");
  setInterval(() => undefined, 1 << 30);
} else {
  // Non-interactive attach: the intercepts live in the user's pre-existing
  // daemons, which outlive this process; exit clean.
  console.log("Intercepts are active (non-interactive attach; the running daemons hold them).");
  process.exit(0);
}
