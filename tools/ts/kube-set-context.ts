// kube-set-context — switch Kubernetes context with smart selection.
// Port of kube-set-context.sh: list contexts, filter by a case-insensitive
// substring, auto-select the single match, menu when several (clack on a
// TTY; first-line pick when KUBE_NO_INTERACTIVE=1, the test contract).

import { spawnSync } from "node:child_process";
import { assertNodeFloor } from "../lib/core/node-floor.ts";
import { errorMessage } from "../lib/core/logging.ts";
import { EXIT_CONFLICT, EXIT_GENERAL_ERROR, EXIT_MISUSE } from "../lib/core/exit-codes.ts";
import { logError } from "../lib/core/logging.ts";
import { toolCli, usageCommonFlags } from "../lib/core/cli.ts";
import { select } from "../lib/ui/prompts.ts";
import { kubeInteractive, spawnKubectl } from "../lib/domain/kube/kube.ts";

assertNodeFloor();

function usage(exitCode = 0): never {
  console.log(`Usage: kube-set-context [CONTEXT_FILTER]

Switch Kubernetes context. Contexts are filtered case-insensitively by
CONTEXT_FILTER; a single match is auto-selected, several offer a menu.

Options:
${usageCommonFlags({ noDryRun: true, noDevenv: true })}`);
  process.exit(exitCode);
}

let filter = "";
try {
  const cli = toolCli({
    name: "kube-set-context",
    version: "1.0.0",
    argv: process.argv.slice(2),
    noDryRun: true,
  });
  if (cli.common.help) usage();
  if (cli.positionals.length > 1) {
    logError("Too many arguments: at most one CONTEXT_FILTER");
    usage(EXIT_MISUSE);
  }
  filter = cli.positionals[0] ?? "";
} catch (err) {
  logError(errorMessage(err));
  usage(EXIT_MISUSE);
}

function kubectl(args: string[]): { stdout: string; status: number } {
  return spawnKubectl(args);
}

const all = kubectl(["config", "get-contexts", "-o", "name"]).stdout.trim().split("\n").filter((l) => l !== "");
if (all.length === 0) {
  console.log("No clusters found.");
  process.exit(EXIT_GENERAL_ERROR);
}

const contexts = filter === "" ? all : all.filter((c) => c.toLowerCase().includes(filter.toLowerCase()));
if (contexts.length === 0) {
  console.error(`Error: No clusters match '${filter}'.`);
  process.exit(EXIT_GENERAL_ERROR);
}

let selected: string;
if (contexts.length === 1) {
  selected = contexts[0] as string;
} else if (kubeInteractive()) {
  const picked = await select({
    message: "Select a cluster: ",
    fallback: "",
    options: contexts.map((c) => ({ value: c, label: c })),
  });
  if (picked === "") {
    logError("No cluster selected");
    process.exit(EXIT_GENERAL_ERROR);
  }
  selected = picked;
} else if (process.env.KUBE_NO_INTERACTIVE === "1") {
  selected = contexts[0] as string;
} else {
  // Plain non-TTY: refuse to silently pick from several candidates.
  logError("Multiple clusters match — be more specific:");
  console.error(contexts.join("\n"));
  process.exit(EXIT_CONFLICT);
}

if (selected === "") {
  logError("Selection is empty");
  process.exit(EXIT_GENERAL_ERROR);
}

const use = kubectl(["config", "use-context", selected]);
if (use.status !== 0) {
  console.error(`ERROR: failed to switch to context '${selected}'`);
  process.exit(EXIT_GENERAL_ERROR);
}
console.error(`Switched to context: ${kubectl(["config", "current-context"]).stdout.trim()}`);
