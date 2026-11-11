// terraform-plan — run Terraform plan with sensible defaults and DigitalOcean
// token wiring. Port of terraform-plan.sh.

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { assertNodeFloor } from "../lib/core/node-floor.ts";
import { errorMessage } from "../lib/core/logging.ts";
import { logError, logInfo, logSuccess } from "../lib/core/logging.ts";
import { EXIT_MISUSE } from "../lib/core/exit-codes.ts";
import { toolCli, usageCommonFlags } from "../lib/core/cli.ts";

assertNodeFloor();

function usage(): never {
  console.log(`Usage: terraform-plan [path] [-- additional terraform args]

Runs \`terraform init\` (if needed) and \`terraform plan\` in the given path (default: current directory).
If DIGITALOCEAN_API_TOKEN is set, it will be exported as TF_VAR_digitalocean_token for modules that expect it.

Options:
${usageCommonFlags({ noDryRun: true, noDevenv: true })}`);
  process.exit(0);
}

// The `--` separator splits tool flags from forwarded terraform args before
// the parse (the same probe-command split repo-bisect uses).
const raw = process.argv.slice(2);
const sep = raw.indexOf("--");
const flagSide = sep === -1 ? raw : raw.slice(0, sep);
const extraSide = sep === -1 ? [] : raw.slice(sep + 1);

let tfDir = ".";
try {
  const cli = toolCli({
    name: "terraform-plan",
    version: "1.0.0",
    argv: flagSide,
    noDryRun: true,
  });
  if (cli.common.help) usage();
  if (cli.positionals.length > 1) {
    logError("Too many arguments: at most one path (terraform arguments go after --)");
    console.error("Use --help for usage information");
    process.exit(EXIT_MISUSE);
  }
  tfDir = cli.positionals[0] ?? ".";
} catch (err) {
  logError(errorMessage(err));
  console.error("Use --help for usage information");
  process.exit(EXIT_MISUSE);
}
const extraArgs = extraSide;

// terraform present?
const probe = spawnSync("terraform", ["version"], { stdio: "ignore" });
if (probe.error || (probe.status !== 0 && probe.status !== null)) {
  logError("terraform is required");
  process.exit(1);
}

if (!existsSync(tfDir)) {
  logError(`Directory not found: ${tfDir}`);
  process.exit(4);
}

const env = { ...process.env };
if (env.DIGITALOCEAN_API_TOKEN) {
  env.TF_VAR_digitalocean_token = env.DIGITALOCEAN_API_TOKEN;
  logInfo("Exported TF_VAR_digitalocean_token from DIGITALOCEAN_API_TOKEN");
}

if (!existsSync(`${tfDir}/.terraform`)) {
  logInfo("Running terraform init");
  const init = spawnSync("terraform", ["init"], { stdio: "inherit", cwd: tfDir, env });
  if (init.status !== 0) process.exit(init.status ?? 1);
}

logInfo(`Running terraform plan ${extraArgs.join(" ")}`.trimEnd());
const plan = spawnSync("terraform", ["plan", ...extraArgs], { stdio: "inherit", cwd: tfDir, env });
if (plan.status !== 0) process.exit(plan.status ?? 1);
logSuccess("Terraform plan completed");
process.exit(0);
