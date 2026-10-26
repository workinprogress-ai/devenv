// config-read — read one value from devenv.config for skills and scripts.
// Port of config-read.sh over lib/core/config.ts (expansion included).

import { existsSync } from "node:fs";
import { join } from "node:path";
import { assertNodeFloor } from "../lib/core/node-floor.ts";
import { logError } from "../lib/core/logging.ts";
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
    --config FILE   Config file to read (default: $DEVENV_ROOT/devenv.config)
    -h, --help      Show this help message
    -v, --version   Show version and exit

Exit codes:
    0 value printed
    1 invalid arguments / config problem

Examples:
    config-read copilot engineering_repo
    config-read copilot knowledge_repo
    config-read workflows status_workflow`);
  process.exit(0);
}

const argv = process.argv.slice(2);
if (argv.includes("-h") || argv.includes("--help")) usage();
if (argv.includes("-v") || argv.includes("--version")) {
  console.log("1.0.0");
  process.exit(0);
}

let section = "";
let key = "";
let fallback = "";
let configFile = process.env.DEVENV_ROOT
  ? join(process.env.DEVENV_ROOT, "devenv.config")
  : join(selfRoot(process.cwd()), "devenv.config");

for (let i = 0; i < argv.length; i++) {
  const a = argv[i] as string;
  if (a === "--config") {
    const v = argv[i + 1];
    if (v === undefined) { logError("Missing value for --config"); process.exit(1); }
    configFile = v as string;
    i++;
  } else if (a.startsWith("--")) {
    logError(`Unknown option: ${a}`);
    process.exit(1);
  } else if (section === "") section = a;
  else if (key === "") key = a;
  else if (fallback === "") fallback = a;
  else { logError("Too many arguments"); process.exit(1); }
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
