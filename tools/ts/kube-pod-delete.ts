// kube-pod-delete — delete a pod, guarded.
// Port of kube-pod-delete.sh: resolve the name fragment to exactly one pod
// (refuses on zero and on multiple matches), require confirmation (YES=1
// skips; a TTY prompt asks; non-TTY without YES refuses), then delete.
// Guard contract: multi-match exits 3, refusal exits 2, declined exits 130.

import { spawnSync } from "node:child_process";
import { assertNodeFloor } from "../lib/core/node-floor.ts";
import { errorMessage } from "../lib/core/logging.ts";
import { EXIT_CONFLICT, EXIT_GENERAL_ERROR, EXIT_MISUSE } from "../lib/core/exit-codes.ts";
import { logError } from "../lib/core/logging.ts";
import { toolCli, usageCommonFlags } from "../lib/core/cli.ts";
import { confirm } from "../lib/ui/prompts.ts";
import {
  KUBE_CONFIRM_DECLINED_STATUS,
  listPods,
  resolveNamespace,
  resolveSingleMatch, spawnKubectlInherit } from "../lib/domain/kube/kube.ts";

assertNodeFloor();

function usage(): never {
  console.log(`Usage: kube-pod-delete <pod-name-part> [-n|--namespace NS] [ns]

Delete the one pod whose name matches pod-name-part. Refuses on zero or
multiple matches so a partial name can never delete an unintended pod.

Options:
${usageCommonFlags({ noDryRun: true, noDevenv: true })}
  -n, --namespace NS     Namespace (a bare positional after the filter also works)`);
  process.exit(0);
}

let podPart = "";
let nsInput = "";
try {
  const cli = toolCli({
    name: "kube-pod-delete",
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
  nsInput = (cli.values.namespace as string | undefined) ?? (cli.values.n as string | undefined) ?? cli.positionals[1] ?? "";
} catch (err) {
  logError(errorMessage(err));
  usage();
}

if (podPart === "") {
  logError("usage: kube-pod-delete <pod-name-part> [-n|--namespace <ns>]");
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

const match = resolveSingleMatch((o) => listPods(o), { namespace: ns, filter: podPart });
if (match.kind === "none") {
  logError(match.message);
  process.exit(EXIT_MISUSE);
}
if (match.kind === "ambiguous") {
  logError(`Pattern '${podPart}' matches ${match.matches.length} resources — be more specific:`);
  console.error(match.matches.join("\n"));
  process.exit(EXIT_CONFLICT);
}
const pod = match.name;

const confirmed = process.env.YES === "1" || process.env.FORCE_YES === "1"
  ? true
  : await confirm({ message: `Delete pod '${pod}' in namespace ${ns}?`, fallback: false });
if (!confirmed) {
  if (process.stdin.isTTY !== true) {
    console.error(`Refusing to proceed without confirmation (set YES=1 to skip the prompt): Delete pod '${pod}' in namespace ${ns}`);
    process.exit(EXIT_MISUSE);
  }
  console.log("Aborted.");
  process.exit(KUBE_CONFIRM_DECLINED_STATUS);
}

console.log(`Deleting pod: ${pod}`);
const r = spawnKubectlInherit(["delete", "pod", pod, "-n", ns]);
process.exit(r.status);
