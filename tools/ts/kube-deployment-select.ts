// kube-deployment-select — interactive deployment selection.
// Port of kube-deployment-select.sh: resolve the namespace, list
// deployments, apply a case-insensitive filter, then smart-select —
// auto-select the single match, menu when several (clack on a TTY;
// first-line pick when KUBE_NO_INTERACTIVE=1, the test contract).

import { assertNodeFloor } from "../lib/core/node-floor.ts";
import { errorMessage } from "../lib/core/logging.ts";
import { EXIT_CONFLICT, EXIT_GENERAL_ERROR, EXIT_MISUSE } from "../lib/core/exit-codes.ts";
import { logError } from "../lib/core/logging.ts";
import { toolCli, usageCommonFlags } from "../lib/core/cli.ts";
import { select } from "../lib/ui/prompts.ts";
import { kubeInteractive, listDeployments, resolveNamespace } from "../lib/domain/kube/kube.ts";

assertNodeFloor();

function usage(): never {
  console.log(`Usage: kube-deployment-select [FILTER] [HEADER] [-n|--namespace NS]

Interactive deployment selection: auto-selects when one deployment matches,
offers a menu when several match. Prints the selected deployment name.

Options:
${usageCommonFlags({ noDryRun: true, noDevenv: true })}
  -n, --namespace NS     Namespace

FILTER is an optional case-insensitive regex filter; HEADER overrides the
menu header.`);
  process.exit(0);
}

let filter = "";
let header = "";
let nsInput = "";
try {
  const cli = toolCli({
    name: "kube-deployment-select",
    version: "1.0.0",
    argv: process.argv.slice(2),
    noDryRun: true,
    options: {
      namespace: { type: "string" },
      n: { type: "string" },
    },
  });
  if (cli.common.help) usage();
  filter = cli.positionals[0] ?? "";
  header = cli.positionals[1] ?? "";
  nsInput = (cli.values.namespace as string | undefined) ?? (cli.values.n as string | undefined) ?? "";
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

let deployments: string[];
try {
  // Regex filter through the listing seam — parity with bash `grep -i`.
  deployments = listDeployments({ namespace: ns, filter });
} catch (err) {
  logError(errorMessage(err));
  process.exit(EXIT_GENERAL_ERROR);
}

if (deployments.length === 0) {
  console.error("No matching deployments found.");
  process.exit(EXIT_GENERAL_ERROR);
}

if (deployments.length === 1) {
  console.log(deployments[0]);
  process.exit(0);
}

const prompt = header !== "" ? header : `Select a deployment (ns: ${ns})`;

if (kubeInteractive()) {
  const picked = await select({
    message: prompt,
    fallback: "",
    options: deployments.map((d) => ({ value: d, label: d })),
  });
  if (picked === "") {
    logError("No deployment selected");
    process.exit(EXIT_GENERAL_ERROR);
  }
  console.log(picked);
  process.exit(0);
}

// Non-interactive: KUBE_NO_INTERACTIVE=1 picks the first line (the
// recorded-stub contract); plain non-TTY errors with the candidates.
if (process.env.KUBE_NO_INTERACTIVE === "1") {
  console.log(deployments[0]);
  process.exit(0);
}
logError("Multiple deployments match — be more specific:");
console.error(deployments.join("\n"));
process.exit(EXIT_CONFLICT);
