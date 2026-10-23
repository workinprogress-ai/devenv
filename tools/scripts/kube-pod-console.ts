// kube-pod-console — open an interactive shell on a pod.
// Port of kube-pod-console.sh: resolve the namespace, first matching pod,
// default to /bin/bash when no command is given, then kubectl exec -it.

import { spawnSync } from "node:child_process";
import { parseArgs } from "node:util";
import { assertNodeFloor } from "../lib/core/node-floor.ts";
import { EXIT_GENERAL_ERROR } from "../lib/core/exit-codes.ts";
import { logError } from "../lib/core/logging.ts";
import { listPods, resolveNamespace } from "../lib/domain/kube/kube.ts";

assertNodeFloor();

function usage(): never {
  console.log(`Usage: kube-pod-console <pod-name-part> [-n|--namespace NS] [command...]

Open an interactive shell (or the given command) on the first pod whose name
matches pod-name-part in the resolved namespace. Defaults to /bin/bash.

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

const podPart = positionals[0];
if (podPart === undefined || podPart === "") {
  logError("usage: kube-pod-console <pod-name-part> [-n|--namespace <ns>] [command...]");
  process.exit(EXIT_GENERAL_ERROR);
}
const command = positionals.slice(1);

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

const cmd = command.length > 0 ? command : ["/bin/bash"];
console.log(`Executing command on console for pod: ${pod} in namespace: ${ns}`);

// Interactive exec: inherit stdio so the shell works.
const r = spawnSync("kubectl", ["exec", "-it", pod, "-n", ns, "--", ...cmd], {
  stdio: "inherit",
});
process.exit(r.status ?? 1);
