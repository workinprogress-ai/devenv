// fork-setup — one-time setup of this repo's upstream relationship.
// Port of fork-setup.sh: idempotently adds a fetch-only `upstream` remote and
// confirms the [fork] config values. --dry-run reports without changing.

import { spawnSync } from "node:child_process";
import { assertNodeFloor } from "../lib/core/node-floor.ts";
import { EXIT_GENERAL_ERROR, EXIT_MISUSE } from "../lib/core/exit-codes.ts";
import { loadConfig, upstreamMatches } from "../lib/domain/fork/index.ts";
import { selfRoot } from "../lib/core/self-root.ts";

assertNodeFloor();

const die = (msg: string, code: number): never => {
  console.error(`ERROR: ${msg}`);
  process.exit(code);
};

if (process.argv[2] === "--help" || process.argv[2] === "-h") {
  console.log(`fork-setup — one-time setup of this repo's upstream relationship

Idempotently adds a fetch-only \`upstream\` git remote and confirms the
\`upstream_repo\` and \`upstream_branch\` values from the \`[fork]\` section in
\`devenv.config\`. \`--dry-run\` reports the change without adding the remote.
See docs/Forking.md.

USAGE
  fork-setup [--dry-run]`);
  process.exit(0);
}

process.env.DEVENV_ROOT = process.env.DEVENV_ROOT ?? selfRoot(process.cwd());
const config = loadConfig();

let dryRun = false;
for (const a of process.argv.slice(2)) {
  if (a === "--dry-run") dryRun = true;
  else die(`unknown option: ${a}`, EXIT_MISUSE);
}

const gr = (args: string[]): { out: string; ok: boolean } => {
  const r = spawnSync("git", args, { encoding: "utf8" });
  return { out: (r.stdout ?? "").trim(), ok: r.status === 0 };
};

const repoRoot = gr(["rev-parse", "--show-toplevel"]).out;
if (repoRoot === "") die("run fork-setup from inside a git repository", EXIT_GENERAL_ERROR);

const existing = gr(["-C", repoRoot, "remote", "get-url", "upstream"]).out;
if (existing !== "" && !upstreamMatches(repoRoot, config.upstreamRepo)) {
  die(`upstream remote already points to a different URL: ${existing}`, EXIT_GENERAL_ERROR);
}

let pushUrl = "";
if (existing !== "") {
  pushUrl = gr(["-C", repoRoot, "remote", "get-url", "--push", "upstream"]).out;
}

if (dryRun) {
  if (existing === "") {
    console.log(`dry run: would add fetch-only upstream remote: ${config.upstreamRepo}`);
  } else if (pushUrl === "/dev/null") {
    console.log(`upstream remote already configured: ${config.upstreamRepo}`);
  }
  if (pushUrl !== "/dev/null") {
    console.log("dry run: would set upstream push URL to /dev/null");
  }
  console.log(`upstream branch: ${config.upstreamBranch}`);
  process.exit(0);
}

if (existing === "") {
  if (!gr(["-C", repoRoot, "remote", "add", "upstream", config.upstreamRepo]).ok) {
    die("failed to add upstream remote", EXIT_GENERAL_ERROR);
  }
}

if (pushUrl !== "/dev/null") {
  // Git treats an explicit push URL as authoritative; /dev/null makes pushes fail.
  if (!gr(["-C", repoRoot, "config", "--local", "--replace-all", "remote.upstream.pushurl", "/dev/null"]).ok) {
    die("failed to make upstream fetch-only", EXIT_GENERAL_ERROR);
  }
}

console.log(existing === ""
  ? `added fetch-only upstream remote: ${config.upstreamRepo}`
  : `upstream remote already configured: ${config.upstreamRepo}`);
console.log(`upstream branch: ${config.upstreamBranch}`);
