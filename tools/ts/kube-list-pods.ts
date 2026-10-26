// kube-list-pods — list pod names in a namespace, optionally filtered.
// Port of kube-list-pods.sh: -n/--namespace flag > NAMESPACE env >
// partial-match > context default; the filter is a regex against pod names
// (jq test() semantics, metacharacter-safe via argv, never shell).

import { parseArgs } from "node:util";
import { assertNodeFloor } from "../lib/core/node-floor.ts";
import { EXIT_GENERAL_ERROR } from "../lib/core/exit-codes.ts";
import { logError } from "../lib/core/logging.ts";
import { listPods, resolveNamespace } from "../lib/domain/kube/kube.ts";

assertNodeFloor();

function usage(): never {
  console.log(`Usage: kube-list-pods [-n|--namespace NS] [POD_NAME_FILTER]

List pod names in a namespace (one per line).

Options:
  -n, --namespace NS   Namespace (flag > NAMESPACE env > partial match >
                       current-context default)
  POD_NAME_FILTER      Regex filter applied to pod names
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

const nsInput = (values.namespace as string | undefined) ?? (values.n as string | undefined) ?? "";
const filter = positionals[0] ?? "";

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

let names: string[];
try {
  names = filter === "" ? listPods({ namespace: ns }) : listPods({ namespace: ns, filter });
} catch (err) {
  logError(err instanceof Error ? err.message : String(err));
  process.exit(EXIT_GENERAL_ERROR);
}

if (names.length === 0) process.exit(0);
console.log(names.join("\n"));
