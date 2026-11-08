// kube-pod-select — interactive Kubernetes pod selection.
// Port of kube-pod-select.sh: resolve the namespace, list matching pods,
// then smart-select — auto-select the single match, menu when several
// (clack select on a TTY; first-line pick when KUBE_NO_INTERACTIVE=1 as the
// test contract requires; otherwise errors naming the candidates).

import { assertNodeFloor } from "../lib/core/node-floor.ts";
import { EXIT_CONFLICT, EXIT_GENERAL_ERROR } from "../lib/core/exit-codes.ts";
import { logError } from "../lib/core/logging.ts";
import { toolCli, usageCommonFlags } from "../lib/core/cli.ts";
import { select } from "../lib/ui/prompts.ts";
import { kubeInteractive, listPods, resolveNamespace } from "../lib/domain/kube/kube.ts";

assertNodeFloor();

function usage(): never {
  console.log(`Usage: kube-pod-select [-n|--namespace NS] [FILTER] [HEADER]

Interactive pod selection: auto-selects when one pod matches, offers a menu
when several match. Prints the selected pod name.

Options:
${usageCommonFlags({ noDryRun: true, noDevenv: true })}
  -n, --namespace NS     Namespace (flag > NAMESPACE env > partial match >
                         current-context default)

FILTER is an optional regex filter; HEADER overrides the menu header.`);
  process.exit(0);
}

let nsInput = "";
let filter = "";
let header = "";
try {
  const cli = toolCli({
    name: "kube-pod-select",
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
  header = cli.positionals[1] ?? "";
} catch (err) {
  logError(err instanceof Error ? err.message : String(err));
  usage();
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
  pods = filter === "" ? listPods({ namespace: ns }) : listPods({ namespace: ns, filter });
} catch (err) {
  logError(err instanceof Error ? err.message : String(err));
  process.exit(EXIT_GENERAL_ERROR);
}

if (pods.length === 0) {
  console.error("No matching pods found.");
  process.exit(EXIT_GENERAL_ERROR);
}

// Smart selection: one match auto-selects; several offer a pick.
if (pods.length === 1) {
  console.log(pods[0]);
  process.exit(0);
}

const prompt = header !== "" ? header : `Select a pod (ns: ${ns})`;

if (kubeInteractive()) {
  const picked = await select({
    message: prompt,
    fallback: "",
    options: pods.map((p) => ({ value: p, label: p })),
  });
  if (picked === "") {
    logError("No pod selected");
    process.exit(EXIT_GENERAL_ERROR);
  }
  console.log(picked);
  process.exit(0);
}

// Non-interactive: KUBE_NO_INTERACTIVE=1 picks the first line (the
// recorded-stub test contract); plain non-TTY errors with the candidates
// rather than silently acting on an un-chosen target.
if (process.env.KUBE_NO_INTERACTIVE === "1") {
  console.log(pods[0]);
  process.exit(0);
}
logError("Multiple pods match — be more specific:");
console.error(pods.join("\n"));
process.exit(EXIT_CONFLICT);
