#!/usr/bin/env node
// repo-reset-merge-config.ts — one-time org-wide reset of merge
// configuration to the rebase-only policy (TS port of
// tools/special/repo-reset-merge-config.sh; the bash original and the four
// bash libs it sourced delete with this port).
//
// Dry-run default: report per-repo type/open-PRs/WIP state. --apply is
// gated: type detected, rebase-only in repo-types.yaml, attention report
// clear — and "clear" means known: an unreadable open-PR count or a failed WIP
// scan counts as attention. Anything else reports NOT APPLIED with the reason
// and exits 1 at the end; so does a ruleset that could not be applied.
//
// Org identity: config [organization] org first (the policy layer's
// resolution order), then the provider accessor.

import { existsSync } from "node:fs";
import { join } from "node:path";
import { assertNodeFloor } from "../lib/core/node-floor.ts";
import { EXIT_API_FAILURE, EXIT_GENERAL_ERROR, EXIT_MISUSE } from "../lib/core/exit-codes.ts";
import { configGetRaw } from "../lib/core/config.ts";
import { logError, logInfo, logWarn } from "../lib/core/logging.ts";
import { toolCli, usageCommonFlags } from "../lib/core/cli.ts";
import { selfRoot } from "../lib/core/self-root.ts";
import { gitCapture } from "../lib/core/git.ts";
import { wipRangeScan } from "../lib/core/git.ts";
import { providerOrgGet, providerRepoTarget } from "../lib/providers/provider-core.ts";
import { reposList } from "../lib/providers/facade/repos.ts";
import { prsList } from "../lib/providers/facade/prs.ts";
import {
  loadRepoTypesConfig,
  detectRepoType,
  getType,
  configureRulesetsForType,
  configureMergeTypesForType,
} from "../lib/domain/repos/types.ts";

assertNodeFloor();

const SCRIPT_VERSION = "1.0.0";

function usage(status: number = EXIT_MISUSE): never {
  // Requested help is stdout / exit 0; a misuse hint is stderr / exit 2.
  (status === 0 ? console.log : console.error)(`Usage: repo-reset-merge-config [--apply] [--all | <name>...] [--limit <n>]

One-time reset of merge configuration to the rebase-only policy.
Default mode is dry-run (report only). --apply performs the configuration.

Target selection (exactly one of):
  --all              Sweep every repository in the organization
  <name>...          Restrict to the named repositories (positional)

Options:
  --apply            Apply the configuration (default: dry-run report only)
  --limit <n>        Max org repositories to scan in --all mode (default 1000)
${usageCommonFlags({ noDryRun: true, noDevenv: true })}`);
  process.exit(status);
}

let apply = false;
let allRepos = false;
let limit = "1000";
const targetRepos: string[] = [];

try {
  const cli = toolCli({
    name: "repo-reset-merge-config",
    version: SCRIPT_VERSION,
    argv: process.argv.slice(2),
    noDryRun: true,
    options: {
      apply: { type: "boolean", default: false },
      all: { type: "boolean", default: false },
      limit: { type: "string", default: "1000" },
    },
  });
  if (cli.common.help) usage(0);
  apply = cli.values["apply"] === true;
  allRepos = cli.values["all"] === true;
  limit = (cli.values["limit"] as string | undefined) ?? "1000";
  targetRepos.push(...cli.positionals);
} catch (err) {
  logError(err instanceof Error ? err.message : String(err));
  usage();
}

if (allRepos && targetRepos.length > 0) {
  logError("Choose one target mode: --all for the org sweep, or positional repo names.");
  usage();
}
if (!allRepos && targetRepos.length === 0) {
  logError("No target selected — pass --all for the org-wide sweep, or positional repo names.");
  usage();
}

// Org identity: config first (the policy layer's order), then provider.
const devenvRoot = selfRoot(import.meta.url);
let org = configGetRaw(join(devenvRoot, "devenv.config"), "organization", "org") ?? "";
if (org === "") org = providerOrgGet();
if (org === "") {
  logError("No organization identity resolved (policy layer + provider). Aborting.");
  process.exit(EXIT_GENERAL_ERROR);
}

const modeLabel = apply ? "APPLY" : "dry-run (report only)";
logInfo(`repo-reset-merge-config — org: ${org} — mode: ${modeLabel}`);

// Named targeting bypasses org enumeration: the requested names are the
// list; unknown names surface as per-repo failures, not an abort.
let reposListOut: string;
if (targetRepos.length > 0) {
  reposListOut = targetRepos.join("\n");
} else {
  try {
    const raw = await reposList(org, { limit: Number(limit) || 1000, json: "name", jq: ".[].name" });
    reposListOut = raw;
  } catch (err) {
    logError(`Failed to enumerate org repositories: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(EXIT_API_FAILURE);
  }
}

const names = reposListOut.split("\n").map((l) => l.trim()).filter((l) => l !== "");
if (names.length === 0) {
  logInfo(`No repositories found in org '${org}'.`);
  process.exit(0);
}

const config = loadRepoTypesConfig(undefined, join(devenvRoot, "tools"));
const report: string[] = [];
let repoCount = 0;
let attentionCount = 0;
let appliedCount = 0;
let notAppliedCount = 0;

for (const repoName of names) {
  repoCount += 1;
  const fullName = `${org}/${repoName}`;

  const repoType = detectRepoType(fullName, config) ?? "none";

  let attention = "";

  // Open PR count (a provider outage must not kill the run, but an unknown
  // count is not a clean one: it blocks --apply like an open PR does).
  let openPrs = "?";
  try {
    const r = await prsList(fullName, { state: "open", limit: 100, json: "number" });
    const parsed = JSON.parse(r.stdout) as unknown[];
    openPrs = String(parsed.length);
  } catch {
    openPrs = "?";
  }

  // WIP-range scan needs a local clone; the checked-out branch only (the
  // open-PR count is the broader signal).
  const localClone = join(process.env.DEVENV_ROOT !== undefined && process.env.DEVENV_ROOT !== "" ? process.env.DEVENV_ROOT : devenvRoot, "repos", repoName);
  let wipNote = "";
  if (existsSync(join(localClone, ".git"))) {
    const ref = gitCapture(localClone, ["symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"]).out.trim();
    const defaultBranch = ref.replace(/^origin\//, "") || "master";
    const offenders = wipRangeScan(localClone, `${defaultBranch}..HEAD`);
    if (offenders === null) {
      // The scan could not run (unknown range): fail closed, never "clean".
      wipNote = `scan failed (${defaultBranch}..HEAD)`;
      attention = "yes";
    } else if (offenders.length === 0) {
      wipNote = "clean(checked-out)";
    } else {
      wipNote = `WIP in checked-out branch (${defaultBranch}..HEAD)`;
      attention = "yes";
    }
  } else {
    wipNote = "no local clone (unscanned)";
  }

  if (openPrs !== "0") attention = "yes";

  // --apply gate: decide before writing the report line.
  let applyNote = "";
  if (apply) {
    const allowed = JSON.stringify(getType(repoType, config)?.allowedMergeTypes ?? []);
    if (repoType === "none") {
      applyNote = "NOT APPLIED: type undetected (resolved to 'none', which allows every merge method)";
    } else if (allowed !== '["rebase"]') {
      applyNote = `NOT APPLIED: type '${repoType}' is not rebase-only in repo-types.yaml`;
    } else if (attention !== "") {
      applyNote = "NOT APPLIED: needs attention first (open PRs, an unreadable PR count, or WIP / a failed WIP scan — see the line above)";
    }
  }

  const line = `${fullName}: type=${repoType} open_prs=${openPrs} wip(checked-out)=${wipNote}`;
  if (attention !== "") {
    report.push(`ATTENTION ${line}`);
    attentionCount += 1;
  } else {
    report.push(`ok        ${line}`);
  }

  if (apply) {
    if (applyNote !== "") {
      report.push(`          ${applyNote}`);
      logError(`${fullName}: ${applyNote}`);
      notAppliedCount += 1;
    } else {
      const rulesets = await configureRulesetsForType(fullName, repoType, config, join(devenvRoot, "tools"));
      const mergeOk = await configureMergeTypesForType(fullName, repoType, config);
      if (mergeOk && rulesets.failures.length === 0) {
        appliedCount += 1;
        logInfo(`Applied rebase-only config to ${fullName} (type: ${repoType})`);
      } else {
        if (!mergeOk) report.push("          NOT APPLIED: Failed to apply merge types (provider call failed)");
        for (const failure of rulesets.failures) {
          report.push(`          NOT APPLIED: ruleset: ${failure}`);
          logError(`${fullName}: ruleset: ${failure}`);
        }
        logWarn(`Failed to fully apply config to ${fullName} — check provider connectivity and type mapping.`);
        notAppliedCount += 1;
      }
    }
  }
}

console.log("");
console.log(`=== repo-reset-merge-config report (${modeLabel}) ===`);
for (const l of report.toSorted((a, b) => a.localeCompare(b))) console.log(l);
console.log(`=== end report — repos: ${repoCount}, attention: ${attentionCount}, applied: ${appliedCount}, not applied: ${notAppliedCount} ===`);

if (apply && notAppliedCount > 0) {
  logError(`${notAppliedCount} repositor${notAppliedCount === 1 ? "y" : "ies"} not applied — see the report above.`);
  process.exit(EXIT_GENERAL_ERROR);
}
if (!apply) {
  logInfo("Dry-run only — re-run with --apply to enforce the rebase-only policy.");
}
void providerRepoTarget;
void EXIT_MISUSE;
