// kube-rollout — rollout status and history for a deployment.
// Resolve the deployment fragment via the listing seam (single-match rule),
// then forward to `kubectl rollout status|history` with stdio inherited.
// Read-only by design: rollout *restart* and *undo* stay out of the wrapper
// family (they are mutations — the builtin command descriptors record this
// boundary) so this tool can never restart anything.
import { assertNodeFloor } from "../lib/core/node-floor.ts";
import { errorMessage } from "../lib/core/logging.ts";
import { EXIT_GENERAL_ERROR, EXIT_MISUSE } from "../lib/core/exit-codes.ts";
import { toolCli, usageCommonFlags } from "../lib/core/cli.ts";
import { logError } from "../lib/core/logging.ts";
import { listDeployments, resolveNamespace, spawnKubectlInherit } from "../lib/domain/kube/kube.ts";

assertNodeFloor();

const SUBCOMMANDS = ["status", "history"] as const;
type Subcommand = (typeof SUBCOMMANDS)[number];

function usage(): never {
  console.log(`Usage: kube-rollout status|history <deployment-name-part> [-n|--namespace <ns>] [kubectl-options...]

Rollout status or history of the deployment matching deployment-name-part
(auto-selects the single match; errors when none matches or several match).
kubectl-options are forwarded verbatim (e.g. --revision=2 for history).
Read-only by design: restart and undo are mutations and stay out of this
wrapper.

Options:
  -n, --namespace NS     Namespace (flag > KUBE_NAMESPACE env > partial match >
                         current-context default)
${usageCommonFlags({ noDryRun: true, noDevenv: true })}`);
  process.exit(0);
}

// Split: our options (with their values) come first, then the two leading
// words (subcommand + name), then optionally one namespace option directly
// after (the family form), then everything after is forwarded verbatim.
function splitRollout(argv: string[]): { head: string[]; rest: string[] } {
  const valueFlags = ["-n", "--namespace"];
  const head: string[] = [];
  let i = 0;
  while (i < argv.length) {
    const a = argv[i] as string;
    if (a === "--") {
      head.push(a);
      i += 1;
      // the two words after --
      for (let w = 0; w < 2 && i < argv.length; w += 1) head.push(argv[i++] as string);
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
    // the two leading words (subcommand + name)
    for (let w = 0; w < 2 && i < argv.length; w += 1) {
      const t = argv[i] as string;
      if (t === "--") break;
      head.push(t);
      i += 1;
    }
    // family form: one namespace option directly after the name
    if (i < argv.length && valueFlags.includes(argv[i] as string) && i + 1 < argv.length) {
      head.push(argv[i++] as string, argv[i++] as string);
    }
    return { head, rest: argv.slice(i) };
  }
  return { head, rest: [] };
}

const { head, rest: forwarded } = splitRollout(process.argv.slice(2));

let sub = "";
let namePart = "";
let nsInput = "";
try {
  const cli = toolCli({
    name: "kube-rollout",
    version: "1.0.0",
    argv: head,
    noDryRun: true,
    options: { namespace: { type: "string", short: "n" } },
  });
  if (cli.common.help) usage();
  sub = cli.positionals[0] ?? "";
  namePart = cli.positionals[1] ?? "";
  nsInput = (cli.values["namespace"] as string | undefined) ?? "";
} catch (err) {
  logError(errorMessage(err));
  console.error("Use --help for usage information");
  process.exit(EXIT_MISUSE);
}

if (sub === "" || namePart === "") {
  logError("usage: kube-rollout status|history <deployment-name-part> [-n|--namespace <ns>]");
  process.exit(EXIT_MISUSE);
}
if (!SUBCOMMANDS.includes(sub as Subcommand)) {
  logError(`Unknown rollout subcommand '${sub}' — supported: ${SUBCOMMANDS.join(" | ")} (restart and undo are mutations; use the mutation wrappers — kube-pod-restart or the confirm-guarded family)`);
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
  matches = listDeployments({ namespace: ns, filter: namePart });
} catch (err) {
  logError(errorMessage(err));
  process.exit(EXIT_GENERAL_ERROR);
}
if (matches.length === 0) {
  logError(`No matching deployments found for pattern: ${namePart}`);
  process.exit(EXIT_GENERAL_ERROR);
}
if (matches.length > 1) {
  logError(`Deployment name part '${namePart}' is ambiguous — matches: ${matches.join(" ")}`);
  process.exit(EXIT_GENERAL_ERROR);
}

const args = ["rollout", sub, `deployment/${matches[0]}`, "-n", ns, ...forwarded];
const result = spawnKubectlInherit(args);
process.exit(result.ok ? 0 : result.status);
