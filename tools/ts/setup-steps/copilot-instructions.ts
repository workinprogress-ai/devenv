#!/usr/bin/env node
// copilot-instructions.ts — provision step: install Copilot instructions and
// the skills folder into ~/.copilot. Port of provision.bash
// install_copilot_instructions (with link_replacing_symlink_only semantics).
//
// Link contract (link_replacing_symlink_only): replace ONLY symlinks — an
// existing real file/directory is never clobbered (warned and left); a
// correct existing link is a no-op.
//
// Idempotent: re-linking the same target is a no-op.

import { existsSync, lstatSync, mkdirSync, symlinkSync, unlinkSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { toolbox, home } from "./lib.ts";

/** bash link_replacing_symlink_only: replace only symlinks; never clobber a
 * real file/dir; same-target link is a no-op. */
function linkReplacingSymlinkOnly(src: string, dest: string): void {
  try {
    const st = lstatSync(dest);
    if (st.isSymbolicLink()) {
      const current = execFileSync("readlink", [dest], { encoding: "utf8" }).trim();
      if (current === src) return;
      unlinkSync(dest);
      symlinkSync(src, dest);
    } else {
      console.error(`WARNING: ${dest} exists and is not a symlink; left in place (move it aside to link it to ${src})`);
    }
  } catch {
    symlinkSync(src, dest);
  }
}

const root = toolbox();
const copilotDir = join(home(), ".copilot");

// Instructions file
const instrSrc = join(root, "copilot", "copilot-instructions.md");
const instrDest = join(copilotDir, "copilot-instructions.md");
if (existsSync(instrSrc)) {
  mkdirSync(copilotDir, { recursive: true });
  linkReplacingSymlinkOnly(instrSrc, instrDest);
} else {
  console.error("WARNING: copilot/copilot-instructions.md not found, skipping");
}

// Skills folder → ~/.copilot/skills (skills available in every VS Code
// window regardless of which repo is open).
const skillsSrc = join(root, "copilot", "skills");
const skillsLink = join(copilotDir, "skills");
if (existsSync(skillsSrc)) {
  mkdirSync(copilotDir, { recursive: true });
  linkReplacingSymlinkOnly(skillsSrc, skillsLink);
} else {
  console.error("WARNING: copilot/skills not found, skipping skills symlink");
}

console.log("copilot-instructions: ok");
