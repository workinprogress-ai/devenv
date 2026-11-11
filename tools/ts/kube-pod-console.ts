// kube-pod-console — open an interactive shell on a pod.
// Port of kube-pod-console.sh: resolve the namespace, first matching pod,
// default to /bin/bash when no command is given, then kubectl exec -it.

import { assertNodeFloor } from "../lib/core/node-floor.ts";
import { errorMessage } from "../lib/core/logging.ts";
import { EXIT_GENERAL_ERROR, EXIT_MISUSE } from "../lib/core/exit-codes.ts";
import { logError } from "../lib/core/logging.ts";
import { toolCli, usageCommonFlags } from "../lib/core/cli.ts";
import { splitAfterPodWord } from "../lib/core/forward-argv.ts";
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

// Option scanning stops after the pod word and the namespace option that may
// directly follow it: the command's own dashed arguments (ls -la) are
// forwarded untouched. `--` ends scanning.
const { head, rest: command } = splitAfterPodWord(process.argv.slice(2), ["-n", "--namespace"]);

let podPart = "";
let nsInput = "";
try {
  const cli = toolCli({
    name: "kube-pod-console",
    version: "1.0.0",
    argv: head,
    noDryRun: true,
    options: { namespace: { type: "string", short: "n" } },
  });
  if (cli.common.help) usage();
  podPart = cli.positionals[0] ?? "";
  nsInput = (cli.values["namespace"] as string | undefined) ?? "";
} catch (err) {
  logError(errorMessage(err));
  console.error("Use --help for usage information");
  process.exit(EXIT_MISUSE);
}

if (podPart === "") {
  logError("usage: kube-pod-console <pod-name-part> [-n|--namespace <ns>] [command...]");
  process.exit(EXIT_MISUSE);
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
