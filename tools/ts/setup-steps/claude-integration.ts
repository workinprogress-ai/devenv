#!/usr/bin/env node
// claude-integration.ts — provision step: link Copilot instructions and the
// skills entries into ~/.claude so Claude Code reads the same instructions.
// Port of provision.bash install_claude_code_integration.
//
// Contract: never replace Claude's personal skills directory (a real
// ~/.claude/skills dir is preserved with a warning + failure, matching the
// bash step's return 1); individual real-file entries are preserved; the
// `synced` account-skills dir is never linked.

import { existsSync, lstatSync, mkdirSync, readdirSync, symlinkSync, unlinkSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { toolbox, home } from "./lib.ts";

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
const claudeDir = join(home(), ".claude");

// Instructions
const instrSrc = join(root, "copilot", "copilot-instructions.md");
const instrDest = join(claudeDir, "CLAUDE.md");
if (existsSync(instrSrc)) {
  mkdirSync(claudeDir, { recursive: true });
  linkReplacingSymlinkOnly(instrSrc, instrDest);
} else {
  console.error("WARNING: copilot/copilot-instructions.md not found, skipping");
}

// Skills entries (without touching a real personal skills root)
const skillsSrc = join(root, "copilot", "skills");
const skillsLink = join(claudeDir, "skills");
if (existsSync(skillsSrc)) {
  mkdirSync(claudeDir, { recursive: true });
  let skillsLinkExists = false;
  let isSymlink = false;
  try {
    isSymlink = lstatSync(skillsLink).isSymbolicLink();
    skillsLinkExists = true;
  } catch {
    skillsLinkExists = false;
  }
  if (skillsLinkExists && isSymlink) {
    // bash: [ -L "$skills_link" ] — a symlinked skills ROOT is the refused
    // shape (its entries could not be linked individually); a REAL directory
    // is the wanted state and the entries link into it below.
    console.error("WARNING: Claude skills root must be a real directory; leaving it unchanged");
    console.error("claude-integration: skills root conflict");
    process.exit(1);
  }
  mkdirSync(skillsLink, { recursive: true });
  for (const entry of readdirSync(skillsSrc)) {
    if (entry === "synced") continue; // Claude's synced account skills
    const entryPath = join(skillsSrc, entry);
    const target = join(skillsLink, entry);
    let targetIsReal = false;
    try {
      targetIsReal = !lstatSync(target).isSymbolicLink();
    } catch {
      targetIsReal = false;
    }
    if (targetIsReal) {
      console.error(`WARNING: existing Claude skills entry preserved: ${target}`);
      continue;
    }
    try {
      unlinkSync(target);
    } catch {
      // not present
    }
    symlinkSync(entryPath, target);
  }
  console.log(`claude-integration: skill links installed under ${skillsLink}`);
} else {
  console.error("WARNING: copilot/skills not found, skipping skills symlink");
}
