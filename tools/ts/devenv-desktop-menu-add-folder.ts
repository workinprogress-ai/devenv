// devenv-desktop-menu-add-folder — add a folder (submenu) to the Fluxbox
// desktop menu. Port over lib/domain/desktop-menu.ts.

import { existsSync } from "node:fs";
import { assertNodeFloor } from "../lib/core/node-floor.ts";
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
    -h, --help   Show this help message and exit

Examples:
    devenv-desktop-menu-add-folder "Databases"
    devenv-desktop-menu-add-folder "MongoDB" "Databases"

Environment:
    FLUXBOX_MENU   Override the default menu file path (~/.fluxbox/menu)`);
  process.exit(0);
}

const argv = process.argv.slice(2);
if (argv[0] === "-h" || argv[0] === "--help") usage();
if (argv.length < 1) {
  console.error("ERROR: Usage: devenv-desktop-menu-add-folder <folder-name> [parent-folder]  (use --help for details)");
  process.exit(EXIT_MISUSE);
}

const [folderName, parentFolder = ""] = argv as [string, string?];
const menu = menuFile();
if (!existsSync(menu)) {
  console.error(`ERROR: Fluxbox menu file not found: ${menu}`);
  process.exit(EXIT_API_FAILURE);
}
addFolder(menu, folderName as string, parentFolder);
