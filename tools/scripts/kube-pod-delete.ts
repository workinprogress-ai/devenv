// kube-pod-delete — delete a pod, guarded.
// Port of kube-pod-delete.sh: resolve the name fragment to exactly one pod
// (refuses on zero and on multiple matches), require confirmation (YES=1
// skips; a TTY prompt asks; non-TTY without YES refuses), then delete.
// Guard contract: multi-match exits 3, refusal exits 2, declined exits 130.

import { spawnSync } from "node:child_process";
import { parseArgs } from "node:util";
import { assertNodeFloor } from "../lib/core/node-floor.ts";
import { EXIT_CONFLICT, EXIT_GENERAL_ERROR, EXIT_MISUSE } from "../lib/core/exit-codes.ts";
import { logError } from "../lib/core/logging.ts";
import { confirm } from "../lib/ui/prompts.ts";
import {
  KUBE_CONFIRM_DECLINED_STATUS,
  listPods,
  resolveNamespace,
  resolveSingleMatch,
} from "../lib/domain/kube/kube.ts";

assertNodeFloor();

function usage(): never {
  console.log(`Usage: kube-pod-delete <pod-name-part> [-n|--namespace NS] [ns]

Delete the one pod whose name matches pod-name-part. Refuses on zero or
multiple matches so a partial name can never delete an unintended pod.

Options:
  -n, --namespace NS   Namespace (a bare positional after the filter also works)
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
  logError("usage: kube-pod-delete <pod-name-part> [-n|--namespace <ns>]");
  process.exit(EXIT_MISUSE);
}
const nsInput = (values.namespace as string | undefined) ?? (values.n as string | undefined) ?? positionals[1] ?? "";

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
const r = spawnSync("kubectl", ["delete", "pod", pod, "-n", ns], { stdio: "inherit" });
process.exit(r.status ?? 1);
