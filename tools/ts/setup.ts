#!/usr/bin/env node
// setup.ts — the setup orchestrator: first-run provisioning AND the convergent
// post-update setup runner, as one non-interactive TypeScript tool.
//
// Handoff contract (from the slim bash bootstrap): every step is idempotent,
// individually callable, and strictly non-interactive; `--all` runs them in
// the bootstrap order. Fork bootstraps and CI run this unattended.
//
// One registry, two lanes (17.2: the provision bridge retired — every step
// is a TS module under tools/ts/setup-steps/; tools/lib/provision.bash is
// deleted):
//   PROVISION_STEPS — the configure-half steps (credentials, shell files,
//     integrations, package sources).
//   INSTALL_STEPS — the post-node install stage (system packages,
//     toolchains, node globals, repo deps).
// The provider token resolution each credential-needing step uses lives in
// setup-steps/provider-seam.ts (env-allowlist + provider token impl — the
// provider credential store stays the single secret source).
//
// Degraded path: when node itself is absent the slim bootstrap prints the
// manual recovery instructions — this tool never runs in that world.

import { toolCli, usageCommonFlags } from "../lib/core/cli.ts";
import { spawnSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { EXIT_GENERAL_ERROR, EXIT_MISUSE } from "../lib/core/exit-codes.ts";
import { logInfo, logError } from "../lib/core/logging.ts";
import { assertNodeFloor } from "../lib/core/node-floor.ts";

assertNodeFloor();

const HERE = dirname(fileURLToPath(import.meta.url));
const TOOLS = dirname(HERE);
const ROOT = dirname(TOOLS);
const STEP_MODULES_DIR = join(HERE, "setup-steps");

/** The toolbox root the steps operate on. Defaults to this checkout (the
 * bootstrap resolves toolbox_root from its own location the same way).
 * DEVENV_TOOLBOX_ROOT overrides it for tests and cross-checkout runs; the
 * bootstrap never sets it. */
const toolboxRoot = process.env.DEVENV_TOOLBOX_ROOT || ROOT;

/** Version pins for the install steps. Single home: .devcontainer/tool-versions.bash
 * (sourced by the shell lanes too); this constant must stay equal to its
 * NODE_VERSION export — the setup-consistency test enforces the pair. */
export const NODE_VERSION = "24.18.0";

/** A setup step: every step is a TS module under tools/ts/setup-steps/
 * (executed by runModuleStep); `kind` tags the lane for --list display and
 * ordering only. */
interface StepImpl {
  kind: "provision" | "install";
  name: string;
  description: string;
  module: string;
}

export type Step = StepImpl;
export type ProvisionStep = StepImpl;
export type InstallStep = StepImpl;

// The provisioning steps, in the historical bootstrap order (the slim chain's
// task list after the TS-side minimum). Each is idempotent in the bridge lib.
const PROVISION_STEPS: ProvisionStep[] = [
  { kind: "provision", name: "credentials", description: "load .setup credentials into the provider credential store", module: "credentials.ts" },
  { kind: "provision", name: "bash-functions", description: "write the shared bash functions file (shell aliases + helpers)", module: "bash-functions.ts" },
  { kind: "provision", name: "env-vars", description: "generate env-vars.sh from .setup configuration", module: "env-vars.ts" },
  { kind: "provision", name: "tool-symlinks", description: "create depth-1 tool entry symlinks", module: "tool-symlinks.ts" },
  { kind: "provision", name: "devenvrc", description: "write the shared ~/.devenvrc", module: "devenvrc.ts" },
  { kind: "provision", name: "bashrc", description: "append devenv sourcing to ~/.bashrc", module: "bashrc.ts" },
  { kind: "provision", name: "git-config", description: "configure git identity and hooks", module: "git-config.ts" },
  { kind: "provision", name: "copilot-instructions", description: "install copilot instructions into ~/.copilot", module: "copilot-instructions.ts" },
  { kind: "provision", name: "claude-integration", description: "install Claude Code integration into ~/.claude", module: "claude-integration.ts" },
  { kind: "provision", name: "knowledge-sync", description: "sync the copilot knowledge side-repo", module: "knowledge-sync.ts" },
  { kind: "provision", name: "engineering-sync", description: "sync the engineering standards side-repo", module: "engineering-sync.ts" },
  { kind: "provision", name: "directories", description: "ensure runtime directories and settings exist", module: "directories.ts" },
  { kind: "provision", name: "nuget-sources", description: "configure NuGet package sources", module: "nuget-sources.ts" },
  { kind: "provision", name: "npmrc", description: "configure the user npmrc with provider credentials", module: "npmrc.ts" },
  { kind: "provision", name: "custom-bootstrap", description: "run fork/user custom bootstrap hooks if present", module: "custom-bootstrap.ts" },
  { kind: "provision", name: "cleanup", description: "clean up package caches from the install", module: "cleanup.ts" },
];

// The install-stage steps, in the historical bootstrap order. Ordering
// constraint: `node-globals` must run after `node` is on PATH (the thin
// bootstrap's job); `repo-deps` runs pnpm install with HUSKY=0 (bootstrap
// contexts must not install git hooks). Idempotence lives in each module.
const INSTALL_STEPS: InstallStep[] = [
  { kind: "install", name: "apt-packages", description: "install OS packages (stable set + active provider's apt additions)", module: "apt-packages.ts" },
  { kind: "install", name: "apt-repos", description: "add specialized package repositories and keys (HashiCorp, Kubernetes)", module: "apt-repos.ts" },
  { kind: "install", name: "apt-packages-extra", description: "install OS packages from the specialized repositories", module: "apt-packages-extra.ts" },
  { kind: "install", name: "dotnet", description: "install the .NET SDK channels and dotnet-format", module: "dotnet.ts" },
  { kind: "install", name: "node-globals", description: "install global node packages (pnpm, turbo) onto the active node", module: "node-globals.ts" },
  { kind: "install", name: "dotnet-tools", description: "install global dotnet tools and the HTTPS dev certificate", module: "dotnet-tools.ts" },
  { kind: "install", name: "repo-deps", description: "install repository dependencies (pnpm install, hooks suppressed)", module: "repo-deps.ts" },
];

const STEPS: Step[] = [...INSTALL_STEPS, ...PROVISION_STEPS];

const SCRIPT_VERSION = "1.0.0";

function showUsage(): never {
  console.log(`Usage: ${basename("setup")} [STEP...] | --all | --list | --skip STEP,...

Setup for a devenv checkout: provisioning (credentials, shell files,
integrations, package sources) plus the post-node install stage (system
packages, toolchains, node globals, repo dependencies). Non-interactive by
contract: every step is idempotent, skippable when already satisfied, and
safe to run unattended (fork bootstraps, CI).

Steps:
${STEPS.map((s) => `    ${s.name.padEnd(20)} ${s.description}`).join("\n")}

Options:
    -h, --help      Show this help message
${usageCommonFlags({ noDryRun: true })}
    --all           Run every step in bootstrap order
    --skip STEP,... Run every step EXCEPT the named ones (use with --all)
    --list          List steps and exit
    --json          Emit step results as JSON (for tooling)

Exit codes:
    0 all requested steps succeeded
    1 a step failed (its output names the cause)
    2 invalid arguments
`);
  process.exit(0);
}

/** Run one TS step module: spawn it so a crash exits this process tree the
 * way a bash step failure does. Stdio: inherited for live output in normal
 * mode; piped under --json so the step's chatter (apt lines, npm progress)
 * cannot corrupt the JSON document on stdout. */
function runModuleStep(step: StepImpl, quiet: boolean): void {
  const modulePath = join(STEP_MODULES_DIR, step.module);
  const r = spawnSync(process.execPath, [modulePath], {
    stdio: quiet ? ["pipe", "pipe", "pipe"] : "inherit",
    env: { ...process.env, DEVENV_TOOLBOX_ROOT: toolboxRoot },
  });
  if (r.status !== 0) {
    throw new Error(`install step ${step.name} failed (exit ${r.status ?? "signal"})`);
  }
}

async function main(argv: string[]): Promise<number> {
  let all = false;
  let list = false;
  let json = false;
  let skipArg: string | undefined;
  const requested: string[] = [];

  try {
    const cli = toolCli({
      name: "setup",
      version: SCRIPT_VERSION,
      argv,
      noDryRun: true,
      options: {
        all: { type: "boolean", default: false },
        list: { type: "boolean", default: false },
        json: { type: "boolean", default: false },
        skip: { type: "string" },
      },
    });
    if (cli.common.help) showUsage();
    all = cli.values["all"] === true;
    list = cli.values["list"] === true;
    json = cli.values["json"] === true;
    skipArg = cli.values["skip"] as string | undefined;
    requested.push(...cli.positionals);
  } catch (err) {
    logError(err instanceof Error ? err.message : String(err));
    return EXIT_MISUSE;
  }

  if (list) {
    for (const s of STEPS) {
      const tag = s.kind === "install" ? " [install]" : "";
      console.log(`${s.name.padEnd(20)} ${s.description}${tag}`);
    }
    return 0;
  }

  const skip = new Set(
    (skipArg ?? "").split(",").map((s) => s.trim()).filter(Boolean),
  );
  const unknownSkips = [...skip].filter((r) => !STEPS.some((s) => s.name === r));
  if (unknownSkips.length > 0) {
    logError(`unknown --skip step(s): ${unknownSkips.join(", ")} — see --list`);
    return EXIT_MISUSE;
  }

  let selected: Step[];
  if (all) {
    selected = STEPS.filter((s) => !skip.has(s.name));
  } else if (requested.length > 0) {
    if (skipArg !== undefined) {
      logError("--skip applies to --all; name explicit steps directly instead");
      return EXIT_MISUSE;
    }
    const unknown = requested.filter((r) => !STEPS.some((s) => s.name === r));
    if (unknown.length > 0) {
      logError(`unknown step(s): ${unknown.join(", ")} — see --list`);
      return EXIT_MISUSE;
    }
    selected = STEPS.filter((s) => requested.includes(s.name));
  } else {
    logError("nothing to do: pass --all or one or more step names (see --list)");
    return EXIT_MISUSE;
  }

  const results: { step: string; status: string }[] = [];
  let failed = false;
  try {
    // Historical bootstrap order: the install stage precedes the configure
    // half (nuget-sources/npmrc need dotnet; repo-deps provides pnpm for the
    // provision lane's cleanup). Execution follows two lane rules, always in
    // STEPS order: every step spawns its module — one process per step, so
    // a crash exits that step's tree exactly as a bash task failure did.
    // Cross-step state travels by file (the .setup seeds), not shell
    // globals: git-config resolves identity from the seeds the credentials
    // step read (the single source of truth).
    for (const s of selected) {
      runModuleStep(s, json);
      logInfo(`[setup] ${s.name}: ${s.description}`);
      results.push({ step: s.name, status: "ok" });
    }
  } catch (err) {
    // Attribute the failure to the first step that has not yet been reported
    // ok. bash -e stops at the failing function; install-step failures throw
    // with the step name in the message.
    const markerRe = /^\[step\] (\S+)$/gm;
    let lastFn = "";
    {
      const eo = err as { stdout?: unknown };
      const outText = typeof eo.stdout === "string"
        ? eo.stdout
        : eo.stdout instanceof Buffer ? eo.stdout.toString() : "";
      let m: RegExpExecArray | null;
      while ((m = markerRe.exec(outText)) !== null) lastFn = m[1] ?? "";
    }
    const failName = lastFn ||
      (err instanceof Error ? err.message.match(/install step (\S+) failed/)?.[1] : undefined) || "";
    const failedIdx = Math.max(
      0,
      selected.findIndex((s) => s.name === failName),
    );
    for (let i = 0; i < selected.length; i++) {
      const step: Step = selected[i] as Step;
      if (i < failedIdx) {
        if (!results.some((r) => r.step === step.name)) {
          results.push({ step: step.name, status: "ok" });
        }
      } else if (i === failedIdx) {
        logInfo(`[setup] ${step.name}: ${step.description}`);
        // Surface the step's own output, not the spawn-failure boilerplate:
        // the execFileSync message is generic; the diagnostic lives in the
        // captured stdout/stderr of the failed session.
        const eo = err as { stdout?: unknown; stderr?: unknown };
        const detail = [eo.stdout, eo.stderr]
          .map((v) => (typeof v === "string" ? v : v instanceof Buffer ? v.toString() : ""))
          .join("")
          .trim();
        logError(`[setup] ${step.name} failed${detail ? `:\n${detail}` : `: ${err instanceof Error ? err.message : String(err)}`}`);
        results.push({ step: step.name, status: "failed" });
        failed = true;
      } else if (!results.some((r) => r.step === step.name)) {
        results.push({ step: step.name, status: "skipped" });
      }
    }
    failed = true; // bootstrap order is sequence-meaningful: stop at first failure
  }

  if (json) {
    console.log(JSON.stringify(results, null, 2));
  }

  if (failed) {
    logError("setup incomplete — fix the failing step and re-run (steps are idempotent)");
    return EXIT_GENERAL_ERROR;
  }
  logInfo(`[setup] ${results.length} step(s) completed`);
  return 0;
}

function basename(s: string): string {
  return s.split("/").pop() ?? s;
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (err: unknown) => {
    logError(err instanceof Error ? err.message : String(err));
    process.exit(EXIT_GENERAL_ERROR);
  },
);
