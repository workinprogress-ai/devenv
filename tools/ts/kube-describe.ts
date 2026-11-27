// kube-describe — detailed state of a Kubernetes resource.
// Resolve the resource fragment via the listing seam (single-match rule:
// refuse on zero and on multiple), then `kubectl describe <kind> <name> -n
// <ns> [kubectl-options...]` with stdio inherited. This tool's options come
// first; the name word follows; everything after the name word (and the -n
// that may directly follow it, the family form) is forwarded verbatim.
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
  console.log(`Usage: kube-describe <name-part> [-k|--kind pod|deployment|statefulset] [-n|--namespace <ns>] [kubectl-options...]

Show detailed state of the resource matching name-part (auto-selects the
single match; errors when none matches or several match). kubectl-options
are forwarded verbatim.

Options:
  -k, --kind KIND         Resource kind (default: pod)
  -n, --namespace NS     Namespace (flag > KUBE_NAMESPACE env > partial match >
                         current-context default)
${usageCommonFlags({ noDryRun: true, noDevenv: true })}`);
  process.exit(0);
}

// Split: our options (with their values) come first, then the name word,
// then optionally one namespace option directly after it (the family
// form), then everything after is forwarded verbatim.
function splitDescribe(argv: string[]): { head: string[]; rest: string[] } {
  const valueFlags = ["-n", "--namespace", "-k", "--kind"];
  const head: string[] = [];
  let i = 0;
  while (i < argv.length) {
    const a = argv[i] as string;
    if (a === "--") {
      head.push(a);
      i += 1;
      if (i < argv.length) head.push(argv[i++] as string); // the word after --
      return { head, rest: argv.slice(i) };
    }
    if (a.startsWith("-") && a !== "-") {
      if (valueFlags.includes(a) && i + 1 < argv.length) {
        head.push(a, argv[i + 1] as string);
        i += 2;
      } else {
        head.push(a);
        i += 1;
      }
      continue;
    }
    // the name word
    head.push(a);
    i += 1;
    // family form: one namespace option directly after the word
    if (i < argv.length && valueFlags.includes(argv[i] as string) && i + 1 < argv.length) {
      head.push(argv[i++] as string, argv[i++] as string);
    }
    return { head, rest: argv.slice(i) };
  }
  return { head, rest: [] };
}

const { head, rest: forwarded } = splitDescribe(process.argv.slice(2));

let namePart = "";
let nsInput = "";
let kindInput = "";
try {
  const cli = toolCli({
    name: "kube-describe",
    version: "1.0.0",
    argv: head,
    noDryRun: true,
    options: {
      namespace: { type: "string", short: "n" },
      kind: { type: "string", short: "k" },
    },
  });
  if (cli.common.help) usage();
  namePart = cli.positionals[0] ?? "";
  nsInput = (cli.values["namespace"] as string | undefined) ?? "";
  kindInput = (cli.values["kind"] as string | undefined) ?? "";
} catch (err) {
  logError(errorMessage(err));
  console.error("Use --help for usage information");
  process.exit(EXIT_MISUSE);
}

if (namePart === "") {
  logError("usage: kube-describe <name-part> [-k|--kind pod|deployment|statefulset] [-n|--namespace <ns>]");
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

let matches: string[];
try {
  matches = listFnFor(kind)({ namespace: ns, filter: namePart });
} catch (err) {
  logError(errorMessage(err));
  process.exit(EXIT_GENERAL_ERROR);
}
if (matches.length === 0) {
  logError(`No matching resources found for pattern: ${namePart}`);
  process.exit(EXIT_GENERAL_ERROR);
}
if (matches.length > 1) {
  logError(`Name part '${namePart}' is ambiguous — matches: ${matches.join(" ")}`);
  process.exit(EXIT_GENERAL_ERROR);
}

const args = ["describe", kind, matches[0] as string, "-n", ns, ...forwarded];
const result = spawnKubectlInherit(args);
process.exit(result.ok ? 0 : result.status);
