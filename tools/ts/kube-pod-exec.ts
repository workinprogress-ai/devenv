// kube-pod-exec — run a command in a Kubernetes pod.
// Resolve the pod fragment via the listing seam,
// then `kubectl exec <pod> -n <ns> -- <command...>` with stdio inherited.
// The command and its arguments — INCLUDING dash-prefixed ones — are
// forwarded verbatim: only the options before the command word (the namespace option,
// before or right after the pod word) are parsed (strictly,
// via toolCli), everything after it is never inspected.

import { assertNodeFloor } from "../lib/core/node-floor.ts";
import { errorMessage } from "../lib/core/logging.ts";
import { EXIT_CONFLICT, EXIT_GENERAL_ERROR, EXIT_MISUSE } from "../lib/core/exit-codes.ts";
import { toolCli, usageCommonFlags } from "../lib/core/cli.ts";
import { splitAfterPodWord } from "../lib/core/forward-argv.ts";
import { logError } from "../lib/core/logging.ts";
import { listPods, resolveNamespace, resolveSingleMatch, spawnKubectlInherit } from "../lib/domain/kube/kube.ts";

assertNodeFloor();

function usage(): never {
  console.log(`Usage: kube-pod-exec <pod-name-part> [-n|--namespace <ns>] <command>...

Run <command> (with its arguments, forwarded verbatim) inside the pod
matching pod-name-part.

Options:
  -n, --namespace NS     Namespace
${usageCommonFlags({ noDryRun: true, noDevenv: true })}`);
  process.exit(0);
}

// Option scanning stops after the pod word and the namespace option that may
// directly follow it: the first other token and everything after is forwarded
// verbatim (the child's -n/-h/-f are never ours). `--` ends scanning.
const { head, rest: command } = splitAfterPodWord(process.argv.slice(2), ["-n", "--namespace"]);

let podPart = "";
let nsInput = "";
try {
  const cli = toolCli({
    name: "kube-pod-exec",
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
  logError("usage: kube-pod-exec <pod-name-part> [-n|--namespace <ns>] <command>...");
  process.exit(EXIT_MISUSE);
}
if (command.length === 0) {
  logError("usage: kube-pod-exec <pod-name-part> [-n|--namespace <ns>] <command>... — a command is required");
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

console.log(`Executing command for pod: ${pod} in namespace: ${ns}`);
const r = spawnKubectlInherit(["exec", pod, "-n", ns, "--", ...command]);
process.exit(r.status);
