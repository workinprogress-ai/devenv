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
// writing. The seed path reads labels-config.yml (override: LABELS_CONFIG) and
// validates every entry before the first label is written.

import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync, readFileSync } from "node:fs";

import { load, JSON_SCHEMA } from "js-yaml";

import { EXIT_API_FAILURE, EXIT_GENERAL_ERROR, EXIT_MISUSE } from "../lib/core/exit-codes.ts";
import { logError, logInfo } from "../lib/core/logging.ts";
import { resolveToolsRoot } from "../lib/core/self-root.ts";
import { assertNodeFloor } from "../lib/core/node-floor.ts";
import { errorMessage } from "../lib/core/logging.ts";
import { toolCli, usageCommonFlags } from "../lib/core/cli.ts";
import { checkTargetRepo, requireRepoTarget, providerRepoTarget } from "../lib/providers/provider-core.ts";
import { issuesLabelList, issuesLabelCreate, issuesLabelUpdate } from "../lib/providers/facade/issues.ts";

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
${usageCommonFlags()}
    -c, --color HEX             Label color as 6-digit hex, no '#' (e.g. d73a4a)
    -d, --description TEXT      Label description
    --update                    If the label exists, update color/description
                                instead of skipping
    --seed                      Create the standard triage vocabulary from
                                tools/config/labels-config.yml (ignores NAME)

Examples:
    ${SCRIPT_NAME} "area/auth" --color 1d76db --description "Authentication area"
    ${SCRIPT_NAME} "priority/P1" --color d93f0b --update
    ${SCRIPT_NAME} --seed
`);
  process.exit(0);
}

interface SeedLabel {
  name: string;
  color: string;
  description: string;
}

/** Validate every seed entry; the first problem is returned as the error text. */
function parseSeedLabels(entries: unknown[]): SeedLabel[] | string {
  const out: SeedLabel[] = [];
  for (const [i, raw] of entries.entries()) {
    const e = raw as { name?: unknown; color?: unknown; description?: unknown } | null;
    if (e === null || typeof e !== "object" || typeof e.name !== "string" || e.name.trim() === "") {
      return `Seed label #${i + 1} needs a 'name'`;
    }
    const color = e.color === undefined || e.color === null ? "" : String(e.color);
    if (color !== "" && !/^[0-9a-fA-F]{6}$/.test(color)) {
      return `Invalid color: ${color} for label '${e.name}' (must be 6-digit hex, no '#')`;
    }
    out.push({ name: e.name.trim(), color, description: typeof e.description === "string" ? e.description : "" });
  }
  return out;
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
    const cli = toolCli({
      rejectEmptyValues: true,
      name: SCRIPT_NAME,
      version: SCRIPT_VERSION,
      argv,
      options: {
        "dry-run": { type: "boolean", short: "n", default: false },
        color: { type: "string", short: "c" },
        description: { type: "string", short: "d" },
        update: { type: "boolean", default: false },
        seed: { type: "boolean", default: false },
      },
    });
    if (cli.common.help) showUsage();
    dryRun = cli.common.dryRun;
    update = cli.values["update"] === true;
    seed = cli.values["seed"] === true;
    devenv = cli.common.devenv;
    color = ((cli.values["color"] as string | undefined) ?? "");
    description = ((cli.values["description"] as string | undefined) ?? "");
    for (const p of cli.positionals) {
      if (labelName === "") {
        labelName = p;
      } else {
        logError(`Unknown option: ${p}`);
        console.error("Use --help for usage information");
        return EXIT_MISUSE;
      }
    }
  } catch (err) {
    logError(errorMessage(err));
    console.error("Use --help for usage information");
    return EXIT_MISUSE;
  }

  if (seed === false && labelName === "") {
    logError("Label NAME is required (or use --seed)");
    return EXIT_MISUSE;
  }
  if (color !== "" && !/^[0-9a-fA-F]{6}$/.test(color)) {
    logError(`Invalid color: ${color} (must be 6-digit hex, no '#')`);
    return EXIT_MISUSE;
  }

  let seedLabels: SeedLabel[] = [];
  let seedConfig = "";
  if (seed) {
    // The seed config lives in THIS checkout's tools/ (self-root contract),
    // unless LABELS_CONFIG points elsewhere.
    const override = process.env["LABELS_CONFIG"];
    seedConfig = override !== undefined && override !== ""
      ? override
      : join(resolveToolsRoot(fileURLToPath(import.meta.url)), "config", "labels-config.yml");
    if (!existsSync(seedConfig)) {
      logError(`Seed config not found: ${seedConfig}`);
      return EXIT_API_FAILURE;
    }
    let doc: unknown;
    try {
      doc = load(readFileSync(seedConfig, "utf8"), { schema: JSON_SCHEMA });
    } catch (err) {
      logError(`Failed to read seed config: ${seedConfig} (${errorMessage(err).split("\n")[0]})`);
      return EXIT_API_FAILURE;
    }
    const entries = (doc as { labels?: unknown } | null)?.labels;
    if (!Array.isArray(entries) || entries.length === 0) {
      logError(`No labels defined in ${seedConfig}`);
      return EXIT_GENERAL_ERROR;
    }
    const parsed = parseSeedLabels(entries);
    if (typeof parsed === "string") {
      logError(parsed);
      return EXIT_MISUSE;
    }
    seedLabels = parsed;
  }

  checkTargetRepo(devenv);

  const repo = requireRepoTarget(providerRepoTarget(""), "issue-label-create", "issues");

  /** Existing label names, lower-cased (label names are case-insensitive). */
  async function listExisting(): Promise<Set<string> | null> {
    try {
      const listed = await issuesLabelList(repo, { limit: 200, json: "name" });
      return new Set((JSON.parse(listed) as Array<{ name?: unknown }>).map((l) => String(l.name).toLowerCase()));
    } catch (err) {
      logError(`Failed to list labels: ${errorMessage(err)}`);
      return null;
    }
  }

  async function ensureOneLabel(name: string, labelColor: string, labelDescription: string, existing: Set<string>): Promise<number> {
    if (existing.has(name.toLowerCase())) {
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
          logError(`Failed to update label: ${name} — ${errorMessage(err)}`);
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
      await issuesLabelCreate(repo, name, {
        ...(labelColor !== "" ? { color: labelColor } : {}),
        ...(labelDescription !== "" ? { description: labelDescription } : {}),
      });
      existing.add(name.toLowerCase());
      logInfo(`Created label: ${name}`);
      return 0;
    } catch (err) {
      logError(`Failed to create label: ${name} — ${errorMessage(err)}`);
      return 1;
    }
  }

  const existing = await listExisting();
  if (existing === null) return EXIT_API_FAILURE;

  if (seed) {
    logInfo(`Seeding ${seedLabels.length} labels from ${basename(seedConfig)}`);
    let failures = 0;
    for (const l of seedLabels) {
      if ((await ensureOneLabel(l.name, l.color, l.description, existing)) !== 0) failures++;
    }
    if (failures > 0) {
      logError(`Seed finished with ${failures} failure${failures === 1 ? "" : "s"}`);
      return EXIT_GENERAL_ERROR;
    }
    logInfo("Seed complete");
    return 0;
  }

  return ensureOneLabel(labelName, color, description, existing);
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (err: unknown) => {
    logError(errorMessage(err));
    process.exit(EXIT_API_FAILURE);
  },
);
