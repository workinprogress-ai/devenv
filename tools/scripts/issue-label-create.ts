#!/usr/bin/env node
// issue-label-create.ts - Create a GitHub issue label (idempotent; --seed
// bootstraps the triage vocabulary from tools/config/labels-config.yml).
// Version: 1.0.0
// Requirements: Node >= 23.6 (native type-stripping execution)
//
// Run via the depth-1 bash stub: `exec node "<resolved-src>.ts" "$@"`
//
// Contract: when the label exists the tool skips (exit 0) unless --update,
// in which case color/description are updated. --dry-run previews without
// writing. The seed path reads labels-config.yml through yq (same engine
// the bash tool used).

import { parseArgs } from "node:util";
import { basename, join } from "node:path";
import { existsSync } from "node:fs";
import { spawnSync, execFileSync } from "node:child_process";

import { EXIT_API_FAILURE, EXIT_GENERAL_ERROR, EXIT_MISUSE } from "../lib/core/exit-codes.ts";
import { logError, logInfo } from "../lib/core/logging.ts";
import { assertNodeFloor } from "../lib/core/node-floor.ts";
import { isDevenvRepoGated, providerRepoTarget } from "../lib/providers/provider-core.ts";
import { issuesLabelList, issuesLabelCreate, issuesLabelUpdate } from "../lib/providers/github/issues.ts";

assertNodeFloor();

const SCRIPT_VERSION = "1.0.0";
const SCRIPT_NAME = basename(process.argv[1] ?? "issue-label-create.ts");

function showUsage(): never {
  console.log(`Usage: ${SCRIPT_NAME} NAME [--color HEX] [--description TEXT] [OPTIONS]
       ${SCRIPT_NAME} --seed [OPTIONS]
Create a GitHub issue label. Idempotent: when the label already exists the
command skips it (exit 0) unless --update is given, in which case color and
description are updated.
Arguments:
    NAME                        Label name to create
Options:
    -h, --help                  Show this help message and exit
    -v, --version               Show version information and exit
    -V, --verbose               Enable verbose output
    -n, --dry-run               Show what would be done without creating
    -c, --color HEX             Label color as 6-digit hex, no '#' (e.g. d73a4a)
    -d, --description TEXT      Label description
    --update                    If the label exists, update color/description
                                instead of skipping
    --seed                      Create the standard triage vocabulary from
                                tools/config/labels-config.yml (ignores NAME)
    --devenv                    Safety override to create labels in devenv repo

Examples:
    ${SCRIPT_NAME} "area/auth" --color 1d76db --description "Authentication area"
    ${SCRIPT_NAME} "priority/P1" --color d93f0b --update
    ${SCRIPT_NAME} --seed
`);
  process.exit(0);
}

function checkTargetRepo(allowDevenv: boolean): void {
  const r = spawnSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" });
  if (r.status !== 0) {
    logError("Not in a git repository");
    process.exit(1);
  }
  if (!isDevenvRepoGated()) return;
  if (process.env["DEVENV_REPO"] !== undefined && process.env["DEVENV_REPO"] !== "") return;
  if (allowDevenv) return;
  logError("The current repository appears to be the devenv repository itself");
  console.log("Operations should be performed in target project repositories, not in devenv");
  console.log("To target a project repo, prefix the command with DEVENV_REPO=<owner>/<repo>");
  console.log("To override this safety check (devenv-repo work only), pass the --devenv flag");
  process.exit(1);
}

async function main(argv: string[]): Promise<number> {
  let labelName = "";
  let color = "";
  let description = "";
  let dryRun = false;
  let update = false;
  let seed = false;
  let devenv = false;
  try {
    const { values, positionals } = parseArgs({
      args: argv,
      options: {
        help: { type: "boolean", short: "h", default: false },
        version: { type: "boolean", short: "v", default: false },
        "dry-run": { type: "boolean", short: "n", default: false },
        color: { type: "string", short: "c" },
        description: { type: "string", short: "d" },
        update: { type: "boolean", default: false },
        seed: { type: "boolean", default: false },
        devenv: { type: "boolean", default: false },
      },
      allowPositionals: true,
      strict: true,
    });
    dryRun = Boolean(values["dry-run"]);
    update = Boolean(values["update"]);
    seed = Boolean(values["seed"]);
    devenv = Boolean(values["devenv"]);
    color = values["color"] ?? "";
    description = values["description"] ?? "";
    for (const p of positionals) {
      if (labelName === "") {
        labelName = p;
      } else {
        logError(`Unknown option: ${p}`);
        console.log("Use --help for usage information");
        return EXIT_MISUSE;
      }
    }
  } catch (err) {
    logError(err instanceof Error ? err.message : String(err));
    console.log("Use --help for usage information");
    return EXIT_MISUSE;
  }

  if (argv.includes("-h") || argv.includes("--help")) showUsage();
  if (argv.includes("-v") || argv.includes("--version")) {
    console.log(SCRIPT_VERSION);
    return 0;
  }

  if (seed === false && labelName === "") {
    logError("Label NAME is required (or use --seed)");
    return EXIT_MISUSE;
  }
  if (color !== "" && !/^[0-9a-fA-F]{6}$/.test(color)) {
    logError(`Invalid color: ${color} (must be 6-digit hex, no '#')`);
    return EXIT_MISUSE;
  }

  checkTargetRepo(devenv);

  const repo = providerRepoTarget("");

  async function ensureOneLabel(name: string, labelColor: string, labelDescription: string): Promise<number> {
    let listed: string;
    try {
      listed = await issuesLabelList(repo, { limit: 200, json: "name" });
    } catch (err) {
      logError(`Failed to list labels: ${err instanceof Error ? err.message : String(err)}`);
      return EXIT_API_FAILURE;
    }
    let names: string[] = [];
    try {
      names = (JSON.parse(listed) as Array<{ name?: unknown }>).map((l) => String(l.name));
    } catch {
      logError("Failed to parse label list");
      return EXIT_API_FAILURE;
    }
    if (names.includes(name)) {
      if (update) {
        if (dryRun) {
          logInfo(`[DRY RUN] Would update label: ${name} (color: ${labelColor || "unchanged"}, description: ${labelDescription || "unchanged"})`);
          return 0;
        }
        try {
          await issuesLabelUpdate(repo, name, {
            ...(labelColor !== "" ? { color: labelColor } : {}),
            ...(labelDescription !== "" ? { description: labelDescription } : {}),
          });
          logInfo(`Updated label: ${name}`);
          return 0;
        } catch (err) {
          logError(`Failed to update label: ${name} — ${err instanceof Error ? err.message : String(err)}`);
          return 1;
        }
      }
      logInfo(`Label already exists (skipped): ${name}`);
      return 0;
    }
    if (dryRun) {
      logInfo(`[DRY RUN] Would create label: ${name} (color: ${labelColor || "default"}, description: ${labelDescription || "none"})`);
      return 0;
    }
    try {
      await issuesLabelCreate(repo, name, labelColor !== "" ? labelColor : undefined, labelDescription !== "" ? labelDescription : undefined);
      logInfo(`Created label: ${name}`);
      return 0;
    } catch (err) {
      logError(`Failed to create label: ${name} — ${err instanceof Error ? err.message : String(err)}`);
      return 1;
    }
  }

  if (seed) {
    const config = join(providerRepoTarget("") !== "" ? process.cwd() : process.cwd(), "tools/config/labels-config.yml");
    if (!existsSync(config)) {
      logError(`Seed config not found: ${config}`);
      return EXIT_API_FAILURE;
    }
    // yq stays the seed engine (same YAML dialect the bash tool parsed).
    let count: string;
    try {
      count = execFileSync("yq", [".labels | length", config], { encoding: "utf8" }).trim();
    } catch {
      logError(`Failed to read seed config: ${config}`);
      return EXIT_API_FAILURE;
    }
    if (count === "0" || count === "" || count === "null") {
      logError(`No labels defined in ${config}`);
      return EXIT_GENERAL_ERROR;
    }
    logInfo(`Seeding ${count} labels from ${basename(config)}`);
    const n = Number.parseInt(count, 10);
    for (let i = 0; i < n; i++) {
      const name = execFileSync("yq", [`.labels[${i}].name`, config], { encoding: "utf8" }).trim();
      const c = execFileSync("yq", [`.labels[${i}].color // ""`, config], { encoding: "utf8" }).trim();
      const d = execFileSync("yq", [`.labels[${i}].description // ""`, config], { encoding: "utf8" }).trim();
      const rc = await ensureOneLabel(name, c, d);
      if (rc !== 0) return EXIT_GENERAL_ERROR;
    }
    logInfo("Seed complete");
    return 0;
  }

  return ensureOneLabel(labelName, color, description);
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (err: unknown) => {
    logError(err instanceof Error ? err.message : String(err));
    process.exit(EXIT_API_FAILURE);
  },
);
