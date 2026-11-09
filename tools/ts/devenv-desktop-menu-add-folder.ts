// devenv-desktop-menu-add-folder — add a folder (submenu) to the Fluxbox
// desktop menu. Port over lib/domain/desktop-menu.ts.

import { existsSync } from "node:fs";
import { assertNodeFloor } from "../lib/core/node-floor.ts";
import { errorMessage } from "../lib/core/logging.ts";
import { toolCli, usageCommonFlags } from "../lib/core/cli.ts";
import { EXIT_API_FAILURE, EXIT_MISUSE } from "../lib/core/exit-codes.ts";
import { addFolder, menuFile } from "../lib/domain/desktop-menu.ts";

assertNodeFloor();

function usage(): never {
  console.log(`Usage: devenv-desktop-menu-add-folder <folder-name> [parent-folder]

Add a folder (submenu) to the Fluxbox desktop application menu.
If a folder with the same name already exists the command exits silently.

Arguments:
    folder-name    Display name for the new folder
    parent-folder  Optional -- name of an existing folder to nest this one inside.

Options:
${usageCommonFlags({ noDryRun: true, noDevenv: true })}

Examples:
    devenv-desktop-menu-add-folder "Databases"
    devenv-desktop-menu-add-folder "MongoDB" "Databases"

Environment:
    FLUXBOX_MENU   Override the default menu file path (~/.fluxbox/menu)`);
  process.exit(0);
}

let folderName = "";
let parentFolder = "";
try {
  const cli = toolCli({
    name: "devenv-desktop-menu-add-folder",
    version: "1.0.0",
    argv: process.argv.slice(2),
    noDryRun: true,
  });
  if (cli.common.help) usage();
  if (cli.positionals.length < 1 || cli.positionals.length > 2) {
    console.error("ERROR: Usage: devenv-desktop-menu-add-folder <folder-name> [parent-folder]  (use --help for details)");
    process.exit(EXIT_MISUSE);
  }
  folderName = cli.positionals[0] ?? "";
  parentFolder = cli.positionals[1] ?? "";
} catch (err) {
  console.error(errorMessage(err));
  usage();
}

const menu = menuFile();
if (!existsSync(menu)) {
  console.error(`ERROR: Fluxbox menu file not found: ${menu}`);
  process.exit(EXIT_API_FAILURE);
}
addFolder(menu, folderName as string, parentFolder);
