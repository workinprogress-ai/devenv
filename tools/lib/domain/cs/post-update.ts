// Resolution of the --post-update migration script shared by the cs update tools.
import { accessSync, constants, statSync } from "node:fs";
import { resolve } from "node:path";

export type PostUpdateResolution =
  | { ok: true; path: string }
  | { ok: false; reason: "missing" | "not-executable"; message: string };

/** Resolve `scriptArg` to an absolute path (against the current directory) and
 * check it is an executable file. Resolving once at the tool entry point keeps
 * the path valid after the tools change directory per repo. */
export function resolvePostUpdateScript(scriptArg: string): PostUpdateResolution {
  const path = resolve(scriptArg);
  let isFile = false;
  try {
    isFile = statSync(path).isFile();
  } catch {
    isFile = false;
  }
  if (!isFile) return { ok: false, reason: "missing", message: `--post-update script not found: ${path}` };
  try {
    accessSync(path, constants.X_OK);
  } catch {
    return { ok: false, reason: "not-executable", message: `--post-update script is not executable: ${path}` };
  }
  return { ok: true, path };
}
