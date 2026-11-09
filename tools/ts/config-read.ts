// config-read — read one value from devenv.config for skills and scripts.
// Port of config-read.sh over lib/core/config.ts (expansion included).

import { existsSync } from "node:fs";
import { join } from "node:path";
import { assertNodeFloor } from "../lib/core/node-floor.ts";
import { errorMessage } from "../lib/core/logging.ts";
import { logError } from "../lib/core/logging.ts";
import { toolCli, usageCommonFlags } from "../lib/core/cli.ts";
import { configGet } from "../lib/core/config.ts";
import { providerOrgGet, providerUserGet } from "../lib/providers/provider-core.ts";
import { selfRoot } from "../lib/core/self-root.ts";

assertNodeFloor();

function usage(): never {
  console.log(`Usage: config-read SECTION KEY [DEFAULT] [--config FILE]

Read one value from devenv.config (INI-style: [section] + key=value).
Template variables (\${PROVIDER_ORG} etc.) are expanded. Prints the value, or
DEFAULT when the key is absent.

Options:
${usageCommonFlags({ noDryRun: true, noDevenv: true })}
    --config FILE   Config file to read (default: $DEVENV_ROOT/devenv.config)

Exit codes:
    0 value printed
    1 invalid arguments / config problem

Examples:
    config-read copilot engineering_repo
    config-read copilot knowledge_repo
    config-read workflows status_workflow`);
  process.exit(0);
}

let section = "";
let key = "";
let fallback = "";
let configFile = process.env.DEVENV_ROOT
  ? join(process.env.DEVENV_ROOT, "devenv.config")
  : join(selfRoot(process.cwd()), "devenv.config");

try {
  const cli = toolCli({
    name: "config-read",
    version: "1.0.0",
    argv: process.argv.slice(2),
    noDryRun: true,
    options: {
      config: { type: "string" },
    },
  });
  if (cli.common.help) usage();
  if (cli.positionals.length > 3) {
    logError("Too many arguments");
    process.exit(1);
  }
  section = cli.positionals[0] ?? "";
  key = cli.positionals[1] ?? "";
  fallback = cli.positionals[2] ?? "";
  configFile = typeof cli.values.config === "string" && cli.values.config !== ""
    ? cli.values.config
    : configFile;
} catch (err) {
  logError(errorMessage(err));
  process.exit(1);
}

if (section === "" || key === "") {
  logError("Usage: config-read SECTION KEY [DEFAULT]");
  process.exit(1);
}
if (!existsSync(configFile)) {
  logError(`Config file not found: ${configFile}`);
  process.exit(1);
}

const value = configGet(configFile, section, key, {
  org: () => providerOrgGet(),
  user: () => providerUserGet(),
});
console.log(value ?? fallback);
