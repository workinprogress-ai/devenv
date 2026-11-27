// kube-top — resource usage per pod (or per node).
// `kubectl top pods|nodes` pass-through with the family's namespace
// resolution (pods only; nodes are cluster-scoped). Our options come first;
// the subcommand word follows; kubectl flags after the subcommand are
// forwarded verbatim (--containers, --sort-by=memory, ...).
import { assertNodeFloor } from "../lib/core/node-floor.ts";
import { errorMessage } from "../lib/core/logging.ts";
import { EXIT_GENERAL_ERROR, EXIT_MISUSE } from "../lib/core/exit-codes.ts";
import { toolCli, usageCommonFlags } from "../lib/core/cli.ts";
import { logError } from "../lib/core/logging.ts";
import { commandAvailable } from "../lib/core/commands.ts";
import { resolveNamespace, spawnKubectlInherit } from "../lib/domain/kube/kube.ts";

assertNodeFloor();

const SUBCOMMANDS = ["pods", "nodes"] as const;
type Subcommand = (typeof SUBCOMMANDS)[number];

function usage(): never {
  console.log(`Usage: kube-top pods|nodes [-n|--namespace <ns>] [kubectl-options...]

Resource usage per pod (namespace-scoped) or per node (cluster-scoped).
kubectl-options are forwarded verbatim (--containers, --sort-by=memory, ...).

Options:
  -n, --namespace NS     Namespace for pods (flag > KUBE_NAMESPACE env > partial
                         match > current-context default); ignored for nodes
${usageCommonFlags({ noDryRun: true, noDevenv: true })}`);
  process.exit(0);
}

// Split: our options (with their values) come first, then the subcommand
// word; everything after the word is forwarded verbatim.
function splitTop(argv: string[]): { head: string[]; rest: string[] } {
  const valueFlags = ["-n", "--namespace"];
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
    // the subcommand word
    head.push(a);
    i += 1;
    return { head, rest: argv.slice(i) };
  }
  return { head, rest: [] };
}

const { head, rest: forwarded } = splitTop(process.argv.slice(2));

let sub = "";
let nsInput = "";
try {
  const cli = toolCli({
    name: "kube-top",
    version: "1.0.0",
    argv: head,
    noDryRun: true,
    options: { namespace: { type: "string", short: "n" } },
  });
  if (cli.common.help) usage();
  sub = cli.positionals[0] ?? "";
  nsInput = (cli.values["namespace"] as string | undefined) ?? "";
} catch (err) {
  logError(errorMessage(err));
  console.error("Use --help for usage information");
  process.exit(EXIT_MISUSE);
}

if (sub === "") {
  logError("usage: kube-top pods|nodes [-n|--namespace <ns>]");
  process.exit(EXIT_MISUSE);
}
if (!SUBCOMMANDS.includes(sub as Subcommand)) {
  logError(`Unknown top subcommand '${sub}' — supported: ${SUBCOMMANDS.join(" | ")}`);
  process.exit(EXIT_MISUSE);
}

let ns = "";
if (sub === "pods") {
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
  ns = resolution.ns;
}

const args: string[] = ["top", sub];
if (sub === "pods") args.push("-n", ns);
// Forwarded flags are kubectl's own (parsing stopped at the subcommand
// word) — forwarded verbatim, never filtered.
args.push(...forwarded);
// kubectl-absent preflight (the family's namespace preflight covers the
// pods path; nodes is cluster-scoped and would otherwise fail silently).
if (!commandAvailable("kubectl")) {
  logError("kubectl is not available on PATH — install it (install-extras kubernetes-tools) or check PATH");
  process.exit(EXIT_GENERAL_ERROR);
}
const result = spawnKubectlInherit(args);
process.exit(result.ok ? 0 : result.status);
