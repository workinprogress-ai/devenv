// kube-pod-exec — run a command in a Kubernetes pod.
// Port of kube-pod-exec.sh: resolve the pod fragment via the listing seam,
// then `kubectl exec <pod> -n <ns> -- <command...>` with stdio inherited.
// The command and its arguments — INCLUDING dash-prefixed ones — are
// forwarded verbatim, so argv is scanned manually instead of via parseArgs.

import { spawnSync } from "node:child_process";
import { assertNodeFloor } from "../lib/core/node-floor.ts";
import { EXIT_GENERAL_ERROR, EXIT_MISUSE } from "../lib/core/exit-codes.ts";
import { logError } from "../lib/core/logging.ts";
import { listPods, resolveNamespace } from "../lib/domain/kube/kube.ts";

assertNodeFloor();

function usage(): never {
  console.log(`Usage: kube-pod-exec <pod-name-part> [-n|--namespace <ns>] <command>...

Run <command> (with its arguments, forwarded verbatim) inside the pod
matching pod-name-part.

Options:
  -n, --namespace NS   Namespace
  -h, --help           Show this help`);
  process.exit(0);
}

// Manual argv scan: only -n/--namespace (and -h/--help) are ours; the rest
// is the forwarded command.
const argv = process.argv.slice(2);
if (argv.includes("-h") || argv.includes("--help")) usage();

let podPart: string | undefined;
let nsInput: string | undefined;
const command: string[] = [];

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
    command.push(a);
  }
}

if (podPart === undefined || podPart === "") {
  logError("usage: kube-pod-exec <pod-name-part> [-n|--namespace <ns>] <command>...");
  process.exit(EXIT_GENERAL_ERROR);
}
if (command.length === 0) {
  logError("usage: kube-pod-exec <pod-name-part> [-n|--namespace <ns>] <command>... — a command is required");
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

console.log(`Executing command for pod: ${pod} in namespace: ${ns}`);
const r = spawnSync("kubectl", ["exec", pod, "-n", ns, "--", ...command], { stdio: "inherit" });
process.exit(r.status ?? 1);
