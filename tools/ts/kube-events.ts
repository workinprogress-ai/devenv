// kube-events — stream Kubernetes events for a namespace (or a specific
// resource). Namespace resolution follows the family seam (flag > env >
// partial-match > context default); the resource fragment resolves to a
// single match exactly like kube-logs. This tool's options come first; the
// resource word (if any) follows; everything after the resource word (and
// the -n that may directly follow it, the family form) is forwarded
// verbatim to `kubectl get events` (--watch, --sort-by, ...).
import { assertNodeFloor } from "../lib/core/node-floor.ts";
import { errorMessage } from "../lib/core/logging.ts";
import { EXIT_GENERAL_ERROR, EXIT_MISUSE } from "../lib/core/exit-codes.ts";
import { toolCli, usageCommonFlags } from "../lib/core/cli.ts";
import { logError } from "../lib/core/logging.ts";
import {
  listDeployments,
  listPods,
  listStatefulsets,
  resolveNamespace,
  spawnKubectlInherit,
  type ListOptions,
} from "../lib/domain/kube/kube.ts";

assertNodeFloor();

const KINDS = ["pod", "deployment", "statefulset"] as const;
type Kind = (typeof KINDS)[number];

function listFnFor(kind: Kind): (opts: ListOptions) => string[] {
  switch (kind) {
    case "pod":
      return listPods;
    case "deployment":
      return listDeployments;
    case "statefulset":
      return listStatefulsets;
  }
}

function usage(): never {
  console.log(`Usage: kube-events [resource-name-part] [-k|--kind pod|deployment|statefulset] [-n|--namespace <ns>] [kubectl-options...]

Stream events for the namespace (all events, or only those about the
resource matching resource-name-part when given — auto-selects the single
match; errors when none matches or several match). kubectl-options are
forwarded verbatim (--watch, --sort-by=.lastTimestamp, ...).

Options:
  -k, --kind KIND         Resource kind for the fragment (default: pod)
  -n, --namespace NS     Namespace (flag > KUBE_NAMESPACE env > partial match >
                         current-context default)
${usageCommonFlags({ noDryRun: true, noDevenv: true })}`);
  process.exit(0);
}

// Split: our options (with their values) come first, then at most one
// resource word, then optionally one namespace option directly after it
// (the family form), then everything after is forwarded verbatim.
// Wordless invocations are legitimate (namespace-wide events): our scanner
// keeps only the options it recognizes (namespace, kind, and house flags);
// any other leading flag is a kubectl flag and is forwarded, not parsed.
// A leading `--` is consumed with the resource word after it.
function splitEvents(argv: string[]): { head: string[]; rest: string[] } {
  const valueFlags = ["-n", "--namespace", "-k", "--kind"];
  const houseFlags = new Set(["-h", "--help", "-v", "--version", "-V", "--verbose"]);
  const head: string[] = [];
  const rest: string[] = [];
  let i = 0;
  let word = "";
  while (i < argv.length) {
    const a = argv[i] as string;
    if (a === "--") {
      i += 1;
      if (i < argv.length) word = argv[i++] as string; // the word after --
      break;
    }
    if (a.startsWith("-") && a !== "-") {
      if (valueFlags.includes(a) && i + 1 < argv.length && word === "") {
        head.push(a, argv[i + 1] as string);
        i += 2;
      } else if (houseFlags.has(a) && word === "") {
        head.push(a);
        i += 1;
      } else {
        rest.push(a);
        i += 1;
      }
      continue;
    }
    // the resource word — everything after is forwarded
    word = a;
    i += 1;
    // family form: one namespace option directly after the word
    if (i < argv.length && ["-n", "--namespace"].includes(argv[i] as string) && i + 1 < argv.length) {
      head.push(argv[i++] as string, argv[i++] as string);
    }
    break;
  }
  if (word !== "") head.push(word);
  rest.push(...argv.slice(i));
  return { head, rest };
}

const { head, rest: forwarded } = splitEvents(process.argv.slice(2));

let resourcePart = "";
let nsInput = "";
let kindInput = "";
try {
  const cli = toolCli({
    name: "kube-events",
    version: "1.0.0",
    argv: head,
    noDryRun: true,
    options: {
      namespace: { type: "string", short: "n" },
      kind: { type: "string", short: "k" },
    },
  });
  if (cli.common.help) usage();
  resourcePart = cli.positionals[0] ?? "";
  nsInput = (cli.values["namespace"] as string | undefined) ?? "";
  kindInput = (cli.values["kind"] as string | undefined) ?? "";
} catch (err) {
  logError(errorMessage(err));
  console.error("Use --help for usage information");
  process.exit(EXIT_MISUSE);
}

const kind: Kind = (kindInput === "" ? "pod" : kindInput) as Kind;
if (!KINDS.includes(kind)) {
  logError(`Unknown kind '${kindInput}' — supported: ${KINDS.join(" | ")}`);
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

let fieldSelector: string | undefined;
if (resourcePart !== "") {
  // The resource fragment resolves against the chosen kind in the
  // namespace — the family's single-match rule (refuse on zero and on
  // multiple, so a partial name can never describe the wrong resource's
  // events).
  let matches: string[];
  try {
    matches = listFnFor(kind)({ namespace: ns, filter: resourcePart });
  } catch (err) {
    logError(errorMessage(err));
    process.exit(EXIT_GENERAL_ERROR);
  }
  if (matches.length === 0) {
    logError(`No matching resources found for pattern: ${resourcePart}`);
    process.exit(EXIT_GENERAL_ERROR);
  }
  if (matches.length > 1) {
    logError(`Name part '${resourcePart}' is ambiguous — matches: ${matches.join(" ")}`);
    process.exit(EXIT_GENERAL_ERROR);
  }
  fieldSelector = `involvedObject.name=${matches[0]}`;
}

const args = ["get", "events", "-n", ns];
if (fieldSelector !== undefined) args.push("--field-selector", fieldSelector);
args.push(...forwarded);
const result = spawnKubectlInherit(args);
process.exit(result.ok ? 0 : result.status);
