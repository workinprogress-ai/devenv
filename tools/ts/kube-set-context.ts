// kube-set-context — switch Kubernetes context with smart selection.
// Port of kube-set-context.sh: list contexts, filter by a case-insensitive
// substring, auto-select the single match, menu when several (clack on a
// TTY; first-line pick when KUBE_NO_INTERACTIVE=1, the test contract).

import { spawnSync } from "node:child_process";
import { assertNodeFloor } from "../lib/core/node-floor.ts";
import { EXIT_CONFLICT, EXIT_GENERAL_ERROR, EXIT_MISUSE } from "../lib/core/exit-codes.ts";
import { logError } from "../lib/core/logging.ts";
import { select } from "../lib/ui/prompts.ts";
import { kubeInteractive } from "../lib/domain/kube/kube.ts";

assertNodeFloor();

function usage(exitCode = 0): never {
  console.log(`Usage: kube-set-context [CONTEXT_FILTER]

Switch Kubernetes context. Contexts are filtered case-insensitively by
CONTEXT_FILTER; a single match is auto-selected, several offer a menu.

Options:
  -h, --help   Show this help`);
  process.exit(exitCode);
}

const argv = process.argv.slice(2);
if (argv.includes("-h") || argv.includes("--help")) usage();
const unknownOpt = argv.find((a) => a.startsWith("-"));
if (unknownOpt !== undefined) {
  logError(`Unknown option: ${unknownOpt}`);
  usage(EXIT_MISUSE);
}

const filter = argv.find((a) => !a.startsWith("-")) ?? "";

function kubectl(args: string[]): { stdout: string; status: number } {
  const r = spawnSync("kubectl", args, { encoding: "utf8" });
  return { stdout: r.stdout ?? "", status: r.status ?? 1 };
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

kubectl(["config", "use-context", selected]);
console.error(`Switched to context: ${kubectl(["config", "current-context"]).stdout.trim()}`);
