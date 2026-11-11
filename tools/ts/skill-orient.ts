// skill-orient — shared orientation stanza for devenv skills.
// Port of skill-orient.sh: compact JSON blob — active plan census, scoped
// TODO markers, git staging counts, provenance hint. Read-only, bounded.

import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { assertNodeFloor } from "../lib/core/node-floor.ts";
import { errorMessage } from "../lib/core/logging.ts";
import { EXIT_MISUSE } from "../lib/core/exit-codes.ts";
import { toolCli, usageCommonFlags } from "../lib/core/cli.ts";
import { siblingInvocation } from "../lib/core/sibling.ts";

assertNodeFloor();

const SCRIPT_VERSION = "1.0.0";

function usage(): never {
  console.log(`Usage: skill-orient [--scope <paths...>] [--plan <plan-file>]

Emits a JSON orientation blob:
  { "plan": {...}|null, "todos": [...], "staged": N, "unstaged": N,
    "untracked": N, "provenance_hint": "..." }

Read-only. No exploration, no network.

Options:
${usageCommonFlags({ noDryRun: true, noDevenv: true })}`);
  process.exit(0);
}

const scope: string[] = [];
let plan = "";
try {
  const cli = toolCli({
    name: "skill-orient",
    version: SCRIPT_VERSION,
    argv: process.argv.slice(2),
    noDryRun: true,
    options: {
      scope: { type: "string", multiple: true },
      plan: { type: "string" },
    },
  });
  if (cli.common.help) usage();
  // --scope takes one path per flag (bash consumed the next single arg)
  scope.push(...((cli.values["scope"] as string[] | undefined) ?? []));
  plan = (cli.values["plan"] as string | undefined) ?? "";
  scope.push(...cli.positionals);
} catch (err) {
  console.error(errorMessage(err));
  console.error("Use --help for usage information");
  process.exit(EXIT_MISUSE);
}

const repoRoot = (() => {
  try {
    return execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
  } catch {
    return process.cwd();
  }
})();
const scopeArgs = scope.length > 0 ? scope : [repoRoot];

function gitCount(args: string[]): number {
  try {
    const out = execFileSync("git", ["-C", repoRoot, ...args], { encoding: "utf8" });
    return out.split("\n").filter((l) => l !== "").length;
  } catch {
    return 0;
  }
}

// --- git staging counts ---
const staged = gitCount(["diff", "--cached", "--name-only"]);
const unstaged = gitCount(["diff", "--name-only"]);
const untracked = gitCount(["ls-files", "--others", "--exclude-standard"]);
const provenance = `run files plus ${untracked > 0 ? `${untracked} untracked` : "no untracked"} paths; review with git status`;

// --- plan discovery ---
if (plan === "") {
  const dir = join(repoRoot, ".local-artifacts");
  try {
    const newest = readdirSync(dir)
      .filter((e) => /^Plan-.*\.md$/.test(e))
      .map((e) => ({ e, t: statSync(join(dir, e)).mtimeMs }))
      .sort((a, b) => b.t - a.t)[0];
    if (newest) plan = join(dir, newest.e);
  } catch { /* no artifacts dir */ }
}

let planJson: unknown = null;
if (plan !== "" && existsSync(plan)) {
  const census = siblingInvocation("plan-parse", [plan, "--census"]);
  const r = execFileSync(census.command, census.args, { encoding: "utf8" });
  try {
    const totals = (JSON.parse(r) as { totals?: { done?: number; tasks?: number; open?: number } }).totals ?? {};
    planJson = { path: plan, done: totals.done ?? 0, total: totals.tasks ?? 0, open: totals.open ?? 0 };
  } catch {
    planJson = null;
  }
}

// --- scoped TODO markers (devenv-marker-check --todo-report) ---
const todos: { file: string; line: number; text: string }[] = [];
try {
  const markers = siblingInvocation("devenv-marker-check", ["--todo-report", ...scopeArgs]);
  const out = execFileSync(markers.command, markers.args,
    { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  for (const m of out.matchAll(/^(\S+?):(\d+):(.+)$/gm)) {
    todos.push({ file: m[1] as string, line: Number(m[2]), text: (m[3] as string).trim().slice(0, 120) });
  }
} catch { /* marker-check failures leave the list empty */ }

const blob = { plan: planJson, todos, staged, unstaged, untracked, provenance_hint: provenance };
console.log(JSON.stringify(blob, null, 2));
