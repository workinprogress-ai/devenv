// kube-logs — fetch logs from a Kubernetes pod.
// Port of kube-logs.sh: resolve the pod fragment via the listing seam, then
// `kubectl logs <pod> -n <ns> [kubectl-options...]` with stdio inherited
// (log streams belong on the caller's terminal). Everything after the pod
// fragment — INCLUDING dash-prefixed kubectl flags like -f/--tail — is
// forwarded verbatim (the tool's purpose is forwarding), so argv is scanned
// manually instead of via parseArgs.

import { spawnSync } from "node:child_process";
import { assertNodeFloor } from "../lib/core/node-floor.ts";
import { EXIT_GENERAL_ERROR, EXIT_MISUSE } from "../lib/core/exit-codes.ts";
import { logError } from "../lib/core/logging.ts";
import { listPods, resolveNamespace } from "../lib/domain/kube/kube.ts";

assertNodeFloor();

function usage(): never {
  console.log(`Usage: kube-logs <pod-name-part> [-n|--namespace <ns>] [kubectl-options...]

Fetch logs from the pod matching pod-name-part (auto-selects the single
match; errors when none matches). All kubectl-options are forwarded verbatim
(-f, --tail=100, --since=1h, -p, ...).

Options:
  -n, --namespace NS   Namespace
  -h, --help           Show this help`);
  process.exit(0);
}

// Manual argv scan: only -n/--namespace (and -h/--help) are ours; everything
// else — dash-prefixed or not — forwards to kubectl logs.
const argv = process.argv.slice(2);
if (argv.includes("-h") || argv.includes("--help")) usage();

let podPart: string | undefined;
let nsInput: string | undefined;
const forwarded: string[] = [];

for (let i = 0; i < argv.length; i++) {
  const a = argv[i] as string;
  if (a === "-n" || a === "--namespace") {
    nsInput = argv[i + 1];
    if (nsInput === undefined) {
      logError(`Missing value for ${a}`);
      process.exit(EXIT_MISUSE);
    }
    i++;
  } else if (podPart === undefined) {
    podPart = a;
  } else {
    forwarded.push(a);
  }
}

if (podPart === undefined || podPart === "") {
  logError("usage: kube-logs <pod-name-part> [-n|--namespace <ns>] [kubectl-options...]");
  process.exit(EXIT_GENERAL_ERROR);
}

const resolution = resolveNamespace(nsInput ?? "");
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

let pods: string[];
try {
  pods = listPods({ namespace: ns, filter: podPart });
} catch (err) {
  logError(err instanceof Error ? err.message : String(err));
  process.exit(EXIT_GENERAL_ERROR);
}
if (pods.length === 0) {
  console.error(`No matching pod found for pattern: ${podPart}`);
  process.exit(EXIT_GENERAL_ERROR);
}
const pod = pods[0] as string;

console.log(`Fetching logs for pod: ${pod} in namespace: ${ns}`);
const r = spawnSync("kubectl", ["logs", pod, "-n", ns, ...forwarded], { stdio: "inherit" });
process.exit(r.status ?? 1);
