// devenv-desktop-menu-add-shortcut — add an [exec] launcher to the Fluxbox
// desktop menu. Port over lib/domain/desktop-menu.ts.

import { existsSync } from "node:fs";
import { assertNodeFloor } from "../lib/core/node-floor.ts";
import { errorMessage } from "../lib/core/logging.ts";
import { toolCli, usageCommonFlags } from "../lib/core/cli.ts";
import { EXIT_API_FAILURE, EXIT_MISUSE } from "../lib/core/exit-codes.ts";
import { addShortcut, menuFile } from "../lib/domain/desktop-menu.ts";

assertNodeFloor();

function usage(): never {
  console.log(`Usage: devenv-desktop-menu-add-shortcut <label> <command> [folder]

Add an application shortcut to the Fluxbox desktop application menu.
If a shortcut with the same label already exists the command exits silently.

Arguments:
    label     Display label for the shortcut
    command   Shell command to launch
    folder    Optional -- name of an existing folder to place the shortcut inside.

Options:
${usageCommonFlags({ noDryRun: true, noDevenv: true })}

Examples:
    devenv-desktop-menu-add-shortcut "MongoDB Compass" "mongodb-compass"
    devenv-desktop-menu-add-shortcut "Compass" "mongodb-compass" "Databases"

Environment:
    FLUXBOX_MENU   Override the default menu file path (~/.fluxbox/menu)`);
  process.exit(0);
}

let label = "";
let cmd = "";
let folder = "";
try {
  const cli = toolCli({
    name: "devenv-desktop-menu-add-shortcut",
    version: "1.0.0",
    argv: process.argv.slice(2),
    noDryRun: true,
  });
  if (cli.common.help) usage();
  if (cli.positionals.length < 2 || cli.positionals.length > 3) {
    console.error("ERROR: Usage: devenv-desktop-menu-add-shortcut <label> <command> [folder]  (use --help for details)");
    process.exit(EXIT_MISUSE);
  }
  label = cli.positionals[0] ?? "";
  cmd = cli.positionals[1] ?? "";
  folder = cli.positionals[2] ?? "";
} catch (err) {
  console.error(errorMessage(err));
  usage();
}

const menu = menuFile();
if (!existsSync(menu)) {
  console.error(`ERROR: Fluxbox menu file not found: ${menu}`);
  process.exit(EXIT_API_FAILURE);
}
addShortcut(menu, label as string, cmd as string, folder);
