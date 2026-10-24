// terraform-plan — run Terraform plan with sensible defaults and DigitalOcean
// token wiring. Port of terraform-plan.sh.

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { assertNodeFloor } from "../lib/core/node-floor.ts";
import { logError, logInfo, logSuccess } from "../lib/core/logging.ts";

assertNodeFloor();

function usage(): never {
  console.log(`Usage: terraform-plan [path] [-- additional terraform args]

Runs \`terraform init\` (if needed) and \`terraform plan\` in the given path (default: current directory).
If DIGITALOCEAN_API_TOKEN is set, it will be exported as TF_VAR_digitalocean_token for modules that expect it.`);
  process.exit(0);
}

const argv = process.argv.slice(2);
if (argv.includes("-h") || argv.includes("--help")) usage();

// terraform present?
const probe = spawnSync("terraform", ["version"], { stdio: "ignore" });
if (probe.error || (probe.status !== 0 && probe.status !== null)) {
  logError("terraform is required");
  process.exit(1);
}

let tfDir = ".";
const rest = [...argv];
if (rest[0] !== undefined && rest[0] !== "--") {
  tfDir = rest[0] as string;
  rest.shift();
}
if (rest[0] === "--") rest.shift();
const extraArgs = rest;

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
