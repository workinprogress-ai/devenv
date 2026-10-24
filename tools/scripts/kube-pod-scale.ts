// kube-pod-scale — scale a deployment, guarded.
// Port of kube-pod-scale.sh: validate replicas numerically BEFORE touching
// kubectl, resolve the deployment fragment to exactly one match (refuses on
// zero/multiple), require confirmation, then scale. Guard contract:
// multi-match exits 3, refusal exits 2, declined exits 130.

import { spawnSync } from "node:child_process";
import { parseArgs } from "node:util";
import { assertNodeFloor } from "../lib/core/node-floor.ts";
import { EXIT_CONFLICT, EXIT_GENERAL_ERROR, EXIT_MISUSE } from "../lib/core/exit-codes.ts";
import { logError } from "../lib/core/logging.ts";
import { confirm } from "../lib/ui/prompts.ts";
import { KUBE_CONFIRM_DECLINED_STATUS } from "../lib/domain/kube/kube.ts";
import { listDeployments, resolveNamespace, resolveSingleMatch } from "../lib/domain/kube/kube.ts";

assertNodeFloor();

function usage(): never {
  console.log(`Usage: kube-pod-scale <deployment-name-part> <replicas> [-n|--namespace NS]

Scale the one deployment matching deployment-name-part to <replicas>.
Refuses on zero or multiple matches so a partial name can never scale an
unintended workload.

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
const replicas = positionals[1];
if (depPart === undefined || depPart === "" || replicas === undefined || replicas === "") {
  logError("usage: kube-pod-scale <deployment-name-part> <replicas> [-n|--namespace <ns>]");
  process.exit(EXIT_MISUSE);
}

// Replica count must be a non-negative integer before anything touches kubectl.
if (!/^[0-9]+$/.test(replicas)) {
  logError(`Replica count must be a non-negative integer, got: '${replicas}'`);
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
  : await confirm({ message: `Scale deployment '${deployment}' to ${replicas} replicas in namespace ${ns}?`, fallback: false });
if (!confirmed) {
  if (process.stdin.isTTY !== true) {
    console.error(`Refusing to proceed without confirmation (set YES=1 to skip the prompt): Scale deployment '${deployment}' to ${replicas} replicas in namespace ${ns}`);
    process.exit(EXIT_MISUSE);
  }
  console.log("Aborted.");
  process.exit(KUBE_CONFIRM_DECLINED_STATUS);
}

console.log(`Scaling deployment: ${deployment} to ${replicas} replicas...`);
const r = spawnSync("kubectl", ["scale", "deployment", deployment, `--replicas=${replicas}`, "-n", ns], { stdio: "inherit" });
process.exit(r.status ?? 1);
