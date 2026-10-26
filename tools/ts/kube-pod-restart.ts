// kube-pod-restart — restart a deployment by scaling to 0 and back.
// Port of kube-pod-restart.sh: resolve the deployment fragment to exactly
// one match (refuses on zero/multiple), require confirmation, read the
// current replica count, scale to 0, wait, scale back. Guard contract:
// multi-match exits 3, refusal exits 2, declined exits 130.

import { spawnSync } from "node:child_process";
import { parseArgs } from "node:util";
import { assertNodeFloor } from "../lib/core/node-floor.ts";
import { EXIT_CONFLICT, EXIT_GENERAL_ERROR, EXIT_MISUSE } from "../lib/core/exit-codes.ts";
import { logError } from "../lib/core/logging.ts";
import { confirm } from "../lib/ui/prompts.ts";
import {
  KUBE_CONFIRM_DECLINED_STATUS,
  getResourceJson,
  listDeployments,
  resolveNamespace,
  resolveSingleMatch,
} from "../lib/domain/kube/kube.ts";

assertNodeFloor();

function usage(): never {
  console.log(`Usage: kube-pod-restart <deployment-name-part> [-n|--namespace NS]

Restart the one deployment matching deployment-name-part (scale to 0, wait,
scale back to the recorded replica count). Refuses on zero or multiple
matches so a partial name can never restart an unintended workload.

Options:
  -n, --namespace NS   Namespace
  -h, --help           Show this help`);
  process.exit(0);
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

const depPart = positionals[0];
if (depPart === undefined || depPart === "") {
  logError("usage: kube-pod-restart <deployment-name-part> [-n|--namespace <ns>]");
  process.exit(EXIT_MISUSE);
}

const nsInput = (values.namespace as string | undefined) ?? (values.n as string | undefined) ?? "";
const resolution = resolveNamespace(nsInput);
if (resolution.kind === "unreachable") {
  logError(resolution.message);
  process.exit(EXIT_GENERAL_ERROR);
}
if (resolution.kind === "ambiguous") {
  logError(`Namespace '${resolution.candidate}' is ambiguous — matches: ${resolution.matches.join(" ")}`);
  process.exit(EXIT_GENERAL_ERROR);
}
if (resolution.kind === "no-match") {
  logError(`No namespace matches '${resolution.candidate}' — available: ${resolution.available.join(" ")}`);
  process.exit(EXIT_GENERAL_ERROR);
}
const ns = resolution.ns;

const match = resolveSingleMatch((o) => listDeployments(o), { namespace: ns, filter: depPart });
if (match.kind === "none") {
  logError(match.message);
  process.exit(EXIT_MISUSE);
}
if (match.kind === "ambiguous") {
  logError(`Pattern '${depPart}' matches ${match.matches.length} resources — be more specific:`);
  console.error(match.matches.join("\n"));
  process.exit(EXIT_CONFLICT);
}
const deployment = match.name;

const confirmed = process.env.YES === "1" || process.env.FORCE_YES === "1"
  ? true
  : await confirm({ message: `Restart deployment '${deployment}' (scale to 0 and back in namespace ${ns})?`, fallback: false });
if (!confirmed) {
  if (process.stdin.isTTY !== true) {
    console.error(`Refusing to proceed without confirmation (set YES=1 to skip the prompt): Restart deployment '${deployment}' (scale to 0 and back in namespace ${ns})`);
    process.exit(EXIT_MISUSE);
  }
  console.log("Aborted.");
  process.exit(KUBE_CONFIRM_DECLINED_STATUS);
}

// Current replica count, read AFTER confirmation (bash order).
let currentReplicas = 0;
try {
  const info = JSON.parse(getResourceJson("deployment", deployment, ns)) as { spec?: { replicas?: number } };
  currentReplicas = info.spec?.replicas ?? 0;
} catch {
  console.error(`Could not determine the current number of replicas for ${deployment}.`);
  process.exit(EXIT_GENERAL_ERROR);
}

console.log(`Restarting deployment: ${deployment} (Current replicas: ${currentReplicas})`);

console.log(`Scaling ${deployment} to 0 replicas...`);
const down = spawnSync("kubectl", ["scale", "deployment", deployment, "--replicas=0", "-n", ns], { stdio: "inherit" });
if (down.status !== 0) process.exit(down.status ?? 1);

console.log("Waiting for pods to terminate...");
spawnSync("sleep", ["5"]);

console.log(`Scaling ${deployment} back to ${currentReplicas} replicas...`);
const up = spawnSync("kubectl", ["scale", "deployment", deployment, `--replicas=${currentReplicas}`, "-n", ns], { stdio: "inherit" });
if (up.status !== 0) process.exit(up.status ?? 1);

console.log(`Deployment ${deployment} restarted successfully.`);
