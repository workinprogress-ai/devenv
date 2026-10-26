// skill-orient — shared orientation stanza for devenv skills.
// Port of skill-orient.sh: compact JSON blob — active plan census, scoped
// TODO markers, git staging counts, provenance hint. Read-only, bounded.

import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { assertNodeFloor } from "../lib/core/node-floor.ts";
import { selfRoot } from "../lib/core/self-root.ts";

assertNodeFloor();

function usage(): never {
  console.log(`Usage: skill-orient [--scope <paths...>] [--plan <plan-file>]

Emits a JSON orientation blob:
  { "plan": {...}|null, "todos": [...], "staged": N, "unstaged": N,
    "untracked": N, "provenance_hint": "..." }

Read-only. No exploration, no network.`);
  process.exit(0);
}

const argv = process.argv.slice(2);
if (argv.includes("-h") || argv.includes("--help")) usage();

const scope: string[] = [];
let plan = "";
for (let i = 0; i < argv.length; i++) {
  const a = argv[i] as string;
  if (a === "--scope") {
    // --scope takes one path per flag (bash consumed the next single arg)
    const v = argv[i + 1];
    if (v !== undefined) { scope.push(v as string); i++; }
  } else if (a === "--plan") {
    const v = argv[i + 1];
    if (v === undefined) { console.error("Missing value for --plan"); process.exit(2); }
    plan = v as string;
    i++;
  } else {
    scope.push(a);
  }
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
const tools = join(selfRoot(process.cwd()), "tools");
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
  const r = execFileSync("bash", [join(tools, "plan-parse"), plan, "--census"], { encoding: "utf8" });
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
  const out = execFileSync("bash", [join(tools, "devenv-marker-check"), "--todo-report", ...scopeArgs],
    { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  for (const m of out.matchAll(/^(\S+?):(\d+):(.+)$/gm)) {
    todos.push({ file: m[1] as string, line: Number(m[2]), text: (m[3] as string).trim().slice(0, 120) });
  }
} catch { /* marker-check failures leave the list empty */ }

const blob = { plan: planJson, todos, staged, unstaged, untracked, provenance_hint: provenance };
console.log(JSON.stringify(blob, null, 2));
