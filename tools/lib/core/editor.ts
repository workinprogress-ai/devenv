// editor.ts — open a file in the user's editor (port of editor.bash).
// Preference order: VS Code with --wait (blocking), then PREF_EDITOR, then
// FALLBACK_EDITOR, then nano. All launches block until the editor closes —
// tools need the file's final state after the call returns.

import { spawnSync } from "node:child_process";
import { accessSync, constants as fsConstants } from "node:fs";

export interface EditorResult {
  ok: boolean;
  /** Which editor actually ran (for diagnostics), null when none succeeded. */
  editor: string | null;
}

export function openInEditor(file: string): EditorResult {
  const fallback = process.env["PREF_EDITOR"] ?? process.env["FALLBACK_EDITOR"] ?? "nano";

  const vscode = which("code");
  if (vscode !== null) {
    const r = spawnSync("code", ["--wait", file], { stdio: "inherit" });
    if (r.status === 0) return { ok: true, editor: "code" };
    process.stderr.write(`⚠️  Could not open with VS Code. Falling back to ${fallback}...\n`);
  }

  const fb = which(fallback);
  if (fb === null) return { ok: false, editor: null };
  const r = spawnSync(fb, [file], { stdio: "inherit" });
  return { ok: r.status === 0, editor: fallback };
}

/** Minimal which(1): first PATH dir holding an executable with that name. */
function which(cmd: string): string | null {
  for (const dir of (process.env["PATH"] ?? "").split(":")) {
    if (dir === "") continue;
    const candidate = `${dir}/${cmd}`;
    try {
      accessSyncExecutable(candidate);
      return candidate;
    } catch {
      // keep scanning
    }
  }
  return null;
}

function accessSyncExecutable(path: string): void {
  accessSync(path, fsConstants.X_OK);
}
