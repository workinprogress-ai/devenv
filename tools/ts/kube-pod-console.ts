// kube-pod-console — open an interactive shell on a pod.
// Port of kube-pod-console.sh: resolve the namespace, first matching pod,
// default to /bin/bash when no command is given, then kubectl exec -it.

import { spawnSync } from "node:child_process";
import { assertNodeFloor } from "../lib/core/node-floor.ts";
import { errorMessage } from "../lib/core/logging.ts";
import { EXIT_GENERAL_ERROR } from "../lib/core/exit-codes.ts";
import { logError } from "../lib/core/logging.ts";
import { toolCli, usageCommonFlags } from "../lib/core/cli.ts";
import { listPods, resolveNamespace, spawnKubectlInherit } from "../lib/domain/kube/kube.ts";

assertNodeFloor();

function usage(): never {
  console.log(`Usage: kube-pod-console <pod-name-part> [-n|--namespace NS] [command...]

Open an interactive shell (or the given command) on the first pod whose name
matches pod-name-part in the resolved namespace. Defaults to /bin/bash.

Options:
${usageCommonFlags({ noDryRun: true, noDevenv: true })}
  -n, --namespace NS     Namespace`);
  process.exit(0);
}

let podPart = "";
let command: string[] = [];
let nsInput = "";
try {
  const cli = toolCli({
    name: "kube-pod-console",
    version: "1.0.0",
    argv: process.argv.slice(2),
    noDryRun: true,
    options: {
      namespace: { type: "string" },
      n: { type: "string" },
    },
  });
  if (cli.common.help) usage();
  podPart = cli.positionals[0] ?? "";
  command = cli.positionals.slice(1);
  nsInput = (cli.values.namespace as string | undefined) ?? (cli.values.n as string | undefined) ?? "";
} catch (err) {
  logError(errorMessage(err));
  usage();
}

if (podPart === "") {
  logError("usage: kube-pod-console <pod-name-part> [-n|--namespace <ns>] [command...]");
  process.exit(EXIT_GENERAL_ERROR);
}

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
  logError(errorMessage(err));
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
const r = spawnKubectlInherit(["exec", "-it", pod, "-n", ns, "--", ...cmd]);
process.exit(r.status);
