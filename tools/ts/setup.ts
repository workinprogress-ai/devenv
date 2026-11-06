#!/usr/bin/env node
// setup.ts — the setup orchestrator: first-run provisioning AND the convergent
// post-update setup runner, as one non-interactive TypeScript tool.
//
// Handoff contract (from the slim bash bootstrap): every step is idempotent,
// individually callable, and strictly non-interactive; `--all` runs them in
// the bootstrap order. Fork bootstraps and CI run this unattended.
//
// Two registries, one surface:
//   PROVISION_STEPS — the configure-half steps (credentials, shell files,
//     integrations, package sources). These bridge tools/lib/provision.bash
//     (the provisioning library): this tool orchestrates, it does not
//     re-implement. Function-by-function the library retires as steps port to
//     TS step modules (issue-72 Phase 17.2).
//   INSTALL_STEPS — the post-node install stage (system packages, toolchains,
//     node globals, repo deps), ported from the bash bootstrap's install
//     functions. TS-native; each module re-exports a `run` that throws on
//     failure. The provider token gate stays bash-invoked upstream of the
//     handoff (providers' bootstrap-side bash modules are the Phase 3
//     non-goal), so install steps never prompt.
//
// Degraded path: when node itself is absent the slim bootstrap prints the
// manual recovery instructions — this tool never runs in that world.

import { parseArgs } from "node:util";
import { execFileSync, spawnSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { EXIT_GENERAL_ERROR, EXIT_MISUSE } from "../lib/core/exit-codes.ts";
import { logInfo, logError } from "../lib/core/logging.ts";
import { assertNodeFloor } from "../lib/core/node-floor.ts";

assertNodeFloor();

const HERE = dirname(fileURLToPath(import.meta.url));
const TOOLS = dirname(HERE);
const ROOT = dirname(TOOLS);
const PROVISION_LIB = join(TOOLS, "lib", "provision.bash");
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

interface ProvisionStep {
  kind: "provision";
  name: string;
  description: string;
  /** The bash function invoked via the bridge library (single source of truth). */
  fn: string;
}

interface InstallStep {
  kind: "install";
  name: string;
  description: string;
  /** The TS step module under tools/ts/setup-steps/ (re-exports run). */
  module: string;
}

export type Step = ProvisionStep | InstallStep;

// The provisioning steps, in the historical bootstrap order (the slim chain's
// task list after the TS-side minimum). Each is idempotent in the bridge lib.
const PROVISION_STEPS: ProvisionStep[] = [
  { kind: "provision", name: "credentials", description: "load .setup credentials into the provider credential store", fn: "load_setup_credentials" },
  { kind: "provision", name: "bash-functions", description: "write the shared bash functions file (shell aliases + helpers)", fn: "write_bash_functions_file" },
  { kind: "provision", name: "env-vars", description: "generate env-vars.sh from .setup configuration", fn: "generate_env_vars_file" },
  { kind: "provision", name: "tool-symlinks", description: "create depth-1 tool entry symlinks", fn: "create_tool_symlinks" },
  { kind: "provision", name: "devenvrc", description: "write the shared ~/.devenvrc", fn: "write_devenvrc" },
  { kind: "provision", name: "bashrc", description: "append devenv sourcing to ~/.bashrc", fn: "append_bashrc" },
  { kind: "provision", name: "git-config", description: "configure git identity and hooks", fn: "configure_git" },
  { kind: "provision", name: "copilot-instructions", description: "install copilot instructions into ~/.copilot", fn: "install_copilot_instructions" },
  { kind: "provision", name: "claude-integration", description: "install Claude Code integration into ~/.claude", fn: "install_claude_code_integration" },
  { kind: "provision", name: "knowledge-sync", description: "sync the copilot knowledge side-repo", fn: "sync_copilot_knowledge" },
  { kind: "provision", name: "engineering-sync", description: "sync the engineering standards side-repo", fn: "sync_copilot_engineering" },
  { kind: "provision", name: "directories", description: "ensure runtime directories and settings exist", fn: "ensure_directories_and_settings" },
  { kind: "provision", name: "nuget-sources", description: "configure NuGet package sources", fn: "configure_nuget_sources" },
  { kind: "provision", name: "npmrc", description: "configure the user npmrc with provider credentials", fn: "configure_user_npmrc" },
  { kind: "provision", name: "custom-bootstrap", description: "run fork/user custom bootstrap hooks if present", fn: "run_custom_bootstrap_if_present" },
  { kind: "provision", name: "cleanup", description: "clean up package caches from the install", fn: "cleanup_packages" },
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

/** Bootstrap-owned globals the provision step functions consume. The
 * bootstrap's initialize_paths sets these as plain shell globals (never
 * exported), so this tool reproduces them explicitly — without them, steps
 * like credentials silently no-op (`cat: ''`) while reporting success. */
function stepPrelude(toolboxRoot: string): string {
  return [
    `toolbox_root='${toolboxRoot}'`,
    `devenv='${toolboxRoot}'`,
    `setup_dir='${toolboxRoot}/.setup'`,
    `name_file='${toolboxRoot}/.setup/name.txt'`,
    `email_file='${toolboxRoot}/.setup/email.txt'`,
    `config_file='${toolboxRoot}/devenv.config'`,
    "dotnet_cmd=\"$(command -v dotnet || echo /usr/bin/dotnet)\"",
    `export DEVENV_ROOT='${toolboxRoot}'`,
    `export DEVENV_TOOLS='${toolboxRoot}/tools'`,
  ].join("\n");
}

/** One bash session runs the invocation's provision steps, in order: the
 * bridge library's step functions exchange state through shell globals
 * (credentials sets HUMAN_NAME/USER_EMAIL; git-config consumes them), which
 * only survives if they share a shell — the historical bootstrap behavior. */
function runProvisionStepsInSession(steps: ProvisionStep[], toolboxRoot: string, quiet: boolean): void {
  const body = steps
    .map((s) => `echo "[step] ${s.fn}"; ${s.fn}`)
    .join("\n");
  const script = [
    "set -e",
    `source '${PROVISION_LIB}'`,
    stepPrelude(toolboxRoot),
    body,
  ].join("\n");
  execFileSync("bash", ["-c", script], {
    cwd: toolboxRoot,
    stdio: quiet ? "pipe" : "inherit",
    env: { ...process.env, toolbox_root: toolboxRoot },
  });
}

/** Run one TS install step: spawn its module so a crash exits this process
 * tree the way a bash step failure does. Stdio: inherited for live output in
 * normal mode; piped under --json so the step's chatter (apt lines, npm
 * progress) cannot corrupt the JSON document on stdout. */
function runInstallStep(step: InstallStep, quiet: boolean): void {
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
    const { values, positionals } = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        help: { type: "boolean", short: "h", default: false },
        all: { type: "boolean", default: false },
        list: { type: "boolean", default: false },
        json: { type: "boolean", default: false },
        skip: { type: "string" },
      },
      strict: true,
    });
    all = Boolean(values["all"]);
    list = Boolean(values["list"]);
    json = Boolean(values["json"]);
    skipArg = values["skip"];
    requested.push(...positionals);
  } catch (err) {
    logError(err instanceof Error ? err.message : String(err));
    return EXIT_MISUSE;
  }

  if (valuesHelp(argv)) showUsage();

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
    // STEPS order: install steps spawn one module each; provision steps run
    // in ONE bash session — consecutive provision steps are batched into a
    // single session call so cross-step shell state survives (credentials
    // seeds HUMAN_NAME/USER_EMAIL; git-config consumes it).
    const session: ProvisionStep[] = [];
    const flush = (): void => {
      if (session.length === 0) return;
      runProvisionStepsInSession(session, toolboxRoot, json);
      for (const s of session) {
        logInfo(`[setup] ${s.name}: ${s.description}`);
        results.push({ step: s.name, status: "ok" });
      }
      session.length = 0;
    };
    for (const s of selected) {
      if (s.kind === "install") {
        flush();
        runInstallStep(s, json);
        logInfo(`[setup] ${s.name}: ${s.description}`);
        results.push({ step: s.name, status: "ok" });
      } else {
        session.push(s);
      }
    }
    flush();
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
      selected.findIndex((s) => (s.kind === "provision" ? s.fn : s.name) === failName),
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

function valuesHelp(argv: string[]): boolean {
  return argv.includes("-h") || argv.includes("--help");
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
