// kube-list-pods — list pod names in a namespace, optionally filtered.
// Port of kube-list-pods.sh: -n/--namespace flag > NAMESPACE env >
// partial-match > context default; the filter is a regex against pod names
// (jq test() semantics, metacharacter-safe via argv, never shell).

import { assertNodeFloor } from "../lib/core/node-floor.ts";
import { errorMessage } from "../lib/core/logging.ts";
import { EXIT_GENERAL_ERROR, EXIT_MISUSE } from "../lib/core/exit-codes.ts";
import { logError } from "../lib/core/logging.ts";
import { toolCli, usageCommonFlags } from "../lib/core/cli.ts";
import { listPods, resolveNamespace } from "../lib/domain/kube/kube.ts";

assertNodeFloor();

function usage(): never {
  console.log(`Usage: kube-list-pods [-n|--namespace NS] [POD_NAME_FILTER]

List pod names in a namespace (one per line).

Options:
${usageCommonFlags({ noDryRun: true, noDevenv: true })}
  -n, --namespace NS     Namespace (flag > NAMESPACE env > partial match >
                         current-context default)

POD_NAME_FILTER is an optional positional regex filter applied to pod names.`);
  process.exit(0);
}

let nsInput = "";
let filter = "";
try {
  const cli = toolCli({
    name: "kube-list-pods",
    version: "1.0.0",
    argv: process.argv.slice(2),
    noDryRun: true,
    options: {
      namespace: { type: "string" },
      n: { type: "string" },
    },
  });
  if (cli.common.help) usage();
  nsInput = (cli.values.namespace as string | undefined) ?? (cli.values.n as string | undefined) ?? "";
  filter = cli.positionals[0] ?? "";
} catch (err) {
  logError(errorMessage(err));
  console.error("Use --help for usage information");
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

let names: string[];
try {
  names = filter === "" ? listPods({ namespace: ns }) : listPods({ namespace: ns, filter });
} catch (err) {
  logError(errorMessage(err));
  process.exit(EXIT_GENERAL_ERROR);
}

if (names.length === 0) process.exit(0);
console.log(names.join("\n"));
