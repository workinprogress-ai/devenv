// kube-set-context — switch Kubernetes context with smart selection.
// Port of kube-set-context.sh: list contexts, filter by a case-insensitive
// substring, auto-select the single match, menu when several (clack on a
// TTY; first-line pick when KUBE_NO_INTERACTIVE=1, the test contract).

import { spawnSync } from "node:child_process";
import { assertNodeFloor } from "../lib/core/node-floor.ts";
import { EXIT_GENERAL_ERROR } from "../lib/core/exit-codes.ts";
import { logError } from "../lib/core/logging.ts";
import { select } from "../lib/ui/prompts.ts";
import { kubeInteractive } from "../lib/domain/kube/kube.ts";

assertNodeFloor();

function usage(): never {
  console.log(`Usage: kube-set-context [CONTEXT_FILTER]

Switch Kubernetes context. Contexts are filtered case-insensitively by
CONTEXT_FILTER; a single match is auto-selected, several offer a menu.

Options:
  -h, --help   Show this help`);
  process.exit(0);
}

if (process.argv.slice(2).includes("-h") || process.argv.slice(2).includes("--help")) usage();

const filter = process.argv.slice(2).find((a) => !a.startsWith("-")) ?? "";

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
} else {
  // Non-interactive: first line wins (the recorded-stub contract).
  selected = contexts[0] as string;
}

if (selected === "") {
  logError("Selection is empty");
  process.exit(EXIT_GENERAL_ERROR);
}

kubectl(["config", "use-context", selected]);
console.error(`Switched to context: ${kubectl(["config", "current-context"]).stdout.trim()}`);
