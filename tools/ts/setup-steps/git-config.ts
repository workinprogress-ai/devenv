#!/usr/bin/env node
// git-config.ts — provision step: configure git identity and hooks.
// Port of provision.bash configure_git (+ git-operations.bash
// configure_git_global / add_git_safe_directory).
//
// Identity: read from the .setup seeds (steps are separate processes, so no
// state travels between them through the environment).
//
// Idempotent: git config set operations converge; safe.directory add is
// guarded by an exact-match check.

import { execFileSync, spawnSync } from "node:child_process";
import { toolbox, seed } from "./lib.ts";

function git(args: string[]): void {
  execFileSync("git", args, { stdio: "pipe" });
}

const root = toolbox();

// Core settings
git(["config", "--global", "core.autocrlf", "false"]);
git(["config", "--global", "core.eol", "lf"]);
git(["config", "--global", "core.editor", "code --wait"]);
git(["config", "--global", "pull.ff", "only"]);
git(["config", "--global", "--bool", "push.autoSetupRemote", "true"]);

// Note: no global core.hooksPath installation here. Repos carry their own
// husky hooks (each self-installing the devenv wip-gate block), so a global
// hooksPath would override per-repo hooks with one shared directory.

// Merge and diff tools
git(["config", "--global", "merge.tool", "vscode"]);
git(["config", "--global", "mergetool.vscode.cmd", "code --wait $MERGED"]);
git(["config", "--global", "diff.tool", "vscode"]);
git(["config", "--global", "difftool.vscode.cmd", "code --wait --diff $LOCAL $REMOTE"]);

// Credential management. No plaintext 'store' helper (it would persist tokens
// in ~/.git-credentials), and none is needed: provider auth import wires the
// provider's own, host-scoped credential helper. This cache only spares repeat
// prompts for hosts without one, and is bounded to a working day.
git(["config", "--global", "credential.helper", "cache --timeout=28800"]);

// User identity from the .setup seeds. Absent: identity keys are left
// unchanged, exactly as the bash function's -n guards did.
const name = seed("name.txt");
const email = seed("email.txt");
if (name !== "") git(["config", "--global", "user.name", name]);
if (email !== "") git(["config", "--global", "user.email", email]);

// Add the devenv root to safe directories (exact-match guarded). The get-all
// probe exits 1 when the key is unset — that is "not present", not an error
// (the bash original's grep -Fxq on possibly-empty output had the same shape).
{
  const probe = spawnSync("git", ["config", "--global", "--get-all", "safe.directory"], { encoding: "utf8" });
  const listed = probe.status === 0 ? (probe.stdout ?? "") : "";
  const have = listed.split("\n").some((l) => l.trim() === root);
  if (!have) git(["config", "--global", "--add", "safe.directory", root]);
}

console.log(`git-config: configured (identity: ${name || "<unchanged>"} <${email || "<unchanged>"}>)`);
