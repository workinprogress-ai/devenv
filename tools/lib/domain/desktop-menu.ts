// desktop-menu.ts — Fluxbox menu mutation helpers (domain/headless).
// Get menu file, folder/shortcut existence,
// add folder/shortcut with the awk engines' insertion semantics.

import { readFileSync, writeFileSync, renameSync, existsSync } from "node:fs";

export function menuFile(): string {
  return process.env.FLUXBOX_MENU ?? `${process.env.HOME}/.fluxbox/menu`;
}

/**
 * Escape user text for a Fluxbox menu entry. Backslash, parentheses and
 * braces are the syntax delimiters and get a backslash prefix; a line break
 * would start a new menu line, so it is rejected instead.
 */
export function escapeMenuText(text: string): string {
  if (/[\r\n]/.test(text)) throw new Error(`Menu text must not contain line breaks: ${JSON.stringify(text)}`);
  return text.replace(/[\\(){}]/g, (c) => `\\${c}`);
}

export function folderExists(menu: string, name: string): boolean {
  return readFileSync(menu, "utf8").includes(`[submenu] (${escapeMenuText(name)})`);
}

export function shortcutExists(menu: string, label: string): boolean {
  return readFileSync(menu, "utf8").includes(`[exec] (${escapeMenuText(label)})`);
}

function writeMenu(menu: string, lines: string[]): void {
  const tmp = `${menu}.tmp-${process.pid}`;
  writeFileSync(tmp, lines.join("\n"));
  renameSync(tmp, menu);
}

/** Insert CONTENT inside folder NAME, just before its matching [end]. */
export function insertIntoFolder(menu: string, folder: string, content: string[]): void {
  const folderMarker = `[submenu] (${escapeMenuText(folder)})`;
  const lines = readFileSync(menu, "utf8").split("\n");
  const out: string[] = [];
  let inFolder = false, depth = 0, inserted = false;
  for (const line of lines) {
    if (!inFolder && line.includes(folderMarker)) {
      inFolder = true;
      depth = 1;
      out.push(line);
      continue;
    }
    if (inFolder) {
      if (line.includes("[submenu]")) depth++;
      if (line.includes("[end]")) {
        depth--;
        if (depth === 0 && !inserted) {
          out.push(...content);
          inserted = true;
          inFolder = false;
        }
      }
    }
    out.push(line);
  }
  writeMenu(menu, out);
}

/** Insert CONTENT before the root [end] (or [config]/[workspaces] lines). */
export function insertBeforeRootEnd(menu: string, content: string[]): void {
  const lines = readFileSync(menu, "utf8").split("\n");
  const out: string[] = [];
  let inserted = false;
  for (const line of lines) {
    if (!inserted &&
        (/^[ \t]*\[config\]/.test(line) || /^[ \t]*\[workspaces\]/.test(line) || /^\[end\]$/.test(line))) {
      out.push(...content);
      inserted = true;
    }
    out.push(line);
  }
  writeMenu(menu, out);
}

export function addFolder(menu: string, name: string, parent = ""): void {
  if (!existsSync(menu)) {
    throw new Error(`Menu file not found: ${menu}`);
  }
  if (folderExists(menu, name)) return; // silent skip (bash contract)
  if (parent !== "") {
    if (!folderExists(menu, parent)) {
      throw new Error(`Parent folder '${parent}' does not exist in '${menu}'`);
    }
    insertIntoFolder(menu, parent, [`        [submenu] (${escapeMenuText(name)}) {}`, "        [end]"]);
  } else {
    insertBeforeRootEnd(menu, [`    [submenu] (${escapeMenuText(name)}) {}`, "    [end]"]);
  }
  console.log(`INFO: Added folder '${name}' to desktop menu`);
}

export function addShortcut(menu: string, label: string, command: string, folder = ""): void {
  if (!existsSync(menu)) {
    throw new Error(`Menu file not found: ${menu}`);
  }
  if (shortcutExists(menu, label)) return; // silent skip
  if (folder !== "") {
    if (!folderExists(menu, folder)) {
      throw new Error(`Folder '${folder}' does not exist in '${menu}'`);
    }
    insertIntoFolder(menu, folder, [`        [exec] (${escapeMenuText(label)}) { ${escapeMenuText(command)} } <>`]);
  } else {
    insertBeforeRootEnd(menu, [`    [exec] (${escapeMenuText(label)}) { ${escapeMenuText(command)} } <>`]);
  }
  console.log(`INFO: Added shortcut '${label}' to desktop menu`);
}
