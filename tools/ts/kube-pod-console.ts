// kube-pod-console — open an interactive shell on a pod.
// Port of kube-pod-console.sh: resolve the namespace, single matching pod,
// default to /bin/bash when no command is given, then kubectl exec -it.

import { assertNodeFloor } from "../lib/core/node-floor.ts";
import { errorMessage } from "../lib/core/logging.ts";
import { EXIT_CONFLICT, EXIT_GENERAL_ERROR, EXIT_MISUSE } from "../lib/core/exit-codes.ts";
import { logError } from "../lib/core/logging.ts";
import { toolCli, usageCommonFlags } from "../lib/core/cli.ts";
import { splitAfterPodWord } from "../lib/core/forward-argv.ts";
import { listPods, resolveNamespace, resolveSingleMatch, spawnKubectlInherit } from "../lib/domain/kube/kube.ts";

assertNodeFloor();

function usage(): never {
  console.log(`Usage: kube-pod-console <pod-name-part> [-n|--namespace NS] [command...]

Open an interactive shell (or the given command) on the one pod whose name
matches pod-name-part in the resolved namespace (refuses on several matches). Defaults to /bin/bash.

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

// A fragment matching several pods is a wrong-target hazard: refuse.
const match = resolveSingleMatch((o) => listPods(o), { namespace: ns, filter: podPart });
if (match.kind === "none") {
  logError(match.message);
  process.exit(EXIT_GENERAL_ERROR);
}
if (match.kind === "ambiguous") {
  logError(`Pattern '${podPart}' matches ${match.matches.length} pods — be more specific:`);
  console.error(match.matches.join("\n"));
  process.exit(EXIT_CONFLICT);
}
const pod = match.name;

const cmd = command.length > 0 ? command : ["/bin/bash"];
console.log(`Executing command on console for pod: ${pod} in namespace: ${ns}`);

// Interactive exec: inherit stdio so the shell works.
const r = spawnKubectlInherit(["exec", "-it", pod, "-n", ns, "--", ...cmd]);
process.exit(r.status);
