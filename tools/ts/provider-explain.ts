#!/usr/bin/env node
// provider-explain.ts - explain the active provider's wrapper-calling
// requirements, sourced from the provider module itself.
//
// The tool reads its explain data FROM the active provider (never a doc
// file the provider could drift from) and prints what an agent needs
// before calling target-scoped wrappers:
//   provider-explain              -> active provider + per-family one-liners
//   provider-explain <FAMILY>     -> that family's full requirements
//
// Families: issues, pr, project, pipelines, repos, artifact (a prefix
// like "issue" also matches "issues").
//
// Requirements: Node >= 23.6 (native type-stripping execution)

import { basename } from "node:path";
import { assertNodeFloor } from "../lib/core/node-floor.ts";
import { errorMessage } from "../lib/core/logging.ts";
import { EXIT_MISUSE } from "../lib/core/exit-codes.ts";
import { logError } from "../lib/core/logging.ts";
import { toolCli, usageCommonFlags } from "../lib/core/cli.ts";
import type { ProviderExplain, FamilyExplain } from "../lib/providers/explain.ts";
import { providerExplain } from "../lib/providers/facade/explain.ts";

assertNodeFloor();

const SCRIPT_NAME = basename(process.argv[1] ?? "provider-explain");

function showUsage(): void {
  console.log(`Usage: ${SCRIPT_NAME} [FAMILY]

Explain the active provider's wrapper-calling requirements, read from the
provider module itself (never a doc file).

Options:
${usageCommonFlags({ noDryRun: true, noDevenv: true })}

  (no arg)   Active provider + one line per wrapper family.
  FAMILY     One family's full requirements: issues, pr, project, pipelines,
             repos, artifact (prefixes match).`);
}

function oneLiner(f: FamilyExplain): string {
  const target =
    f.repoTarget.reads === "never" && f.repoTarget.writes === "never"
      ? "no repo target needed"
      : `repo target ${f.repoTarget.reads} for reads, ${f.repoTarget.writes} for writes`;
  return `${f.family.padEnd(10)} ${target} — ${f.identifierScoping}`;
}

function printFamily(f: FamilyExplain): void {
  console.log(`family:        ${f.family}`);
  console.log(`wrappers:      ${f.wrappers.join(", ")}`);
  console.log(`identifiers:   ${f.identifierScoping}`);
  console.log(`repo target:   reads ${f.repoTarget.reads}, writes ${f.repoTarget.writes}`);
  console.log(`resolution:    ${f.resolution}`);
  console.log(`credentials:   ${f.credentials}`);
  for (const g of f.wrapperGates) console.log(`gate:          ${g}`);
  for (const n of f.notes) console.log(`note:          ${n}`);
}

async function main(): Promise<void> {
  const positionals = (() => {
    try {
      const cli = toolCli({
        name: "provider-explain",
        version: "1.0.0",
        argv: process.argv.slice(2),
        noDryRun: true,
        strict: true,
        allowPositionals: true,
      });
      if (cli.common.help) return null;
      return cli.positionals;
    } catch (err) {
      logError(errorMessage(err));
      process.exit(EXIT_MISUSE);
    }
  })();
  if (positionals === null) {
    showUsage();
    return;
  }

  let explain: ProviderExplain;
  try {
    explain = await providerExplain();
  } catch (err) {
    // providerDetect's named errors (missing config, unshipped name) are
    // exactly what this tool exists to surface — print them as-is.
    logError(errorMessage(err));
    process.exit(EXIT_MISUSE);
  }

  if (positionals.length === 0) {
    console.log(`active provider: ${explain.provider}`);
    console.log("");
    for (const f of explain.families) console.log(oneLiner(f));
    console.log("");
    console.log(`Run ${basename(SCRIPT_NAME.replace(/\.ts$/, ""))} <family> for the full requirements of one family.`);
    return;
  }

  const arg = positionals[0] ?? "";
  const family = explain.families.find(
    (f) => f.family === arg || f.family.startsWith(arg) || f.wrappers.some((w) => w.startsWith(arg)),
  );
  if (family === undefined) {
    logError(
      `no family matches '${arg}' for provider '${explain.provider}' (families: ${explain.families.map((f) => f.family).join(", ")})`,
    );
    process.exit(EXIT_MISUSE);
  }
  console.log(`active provider: ${explain.provider}`);
  printFamily(family);
}

await main();
