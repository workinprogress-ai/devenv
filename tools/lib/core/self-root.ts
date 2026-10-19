// self-root.ts — devenv self-location resolver (port of self-root.bash).
//
// Contract: self-location wins unless the exported value realpath-resolves to
// the same root. A tool derives its own checkout from its module path; an
// exported DEVENV_TOOLS/DEVENV_ROOT is honored only when it points at that
// same checkout (after normalization), so a foreign checkout's exports can
// never redirect a tool onto the wrong tree (nested-clone development under
// repos/devenv/ must operate on the clone).
//
// Node-only: fs + path + realpath. No dependencies.
import { realpathSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** Canonicalize a path, tolerating a missing target (symlink best-effort). */
function canonical(p: string): string {
  try {
    return realpathSync(p);
  } catch {
    return p;
  }
}

/**
 * Derive the devenv checkout root (the directory containing tools/) from a
 * file path inside that checkout. Works for files under tools/, tools/lib/,
 * tools/scripts/, tools/tests/, and .devcontainer/. Falls back to a bounded
 * upward walk looking for a directory containing tools/.
 */
export function selfRoot(fromPath: string): string {
  const scriptPath = canonical(fromPath);
  const scriptDir = canonical(dirname(scriptPath));

  let root: string | undefined;
  if (/(^|\/)tools(\/lib|\/scripts|\/tests)?$/.test(scriptDir)) {
    root = scriptDir.replace(/\/tools(\/lib|\/scripts|\/tests)?$/, "");
  } else if (/\/tools\/tests\/(scripts|lib|fixtures)$/.test(scriptDir)) {
    root = scriptDir.replace(/\/tools\/tests\/(scripts|lib|fixtures)$/, "");
  } else if (/\/\.devcontainer(\/install-extras)?$/.test(scriptDir)) {
    root = scriptDir.replace(/\/\.devcontainer(\/install-extras)?$/, "");
  } else {
    let cur = scriptDir;
    while (cur !== "/" && !existsSync(join(cur, "tools"))) {
      const parent = dirname(cur);
      if (parent === cur) break;
      cur = parent;
    }
    if (existsSync(join(cur, "tools"))) root = cur;
  }
  if (root === undefined) {
    throw new Error(`self-root: cannot derive devenv root from ${fromPath}`);
  }
  return canonical(root);
}

/**
 * Resolve the effective tools root. Prints (returns) the exported
 * DEVENV_TOOLS only when it realpath-matches this checkout's own tools
 * root; otherwise returns the self-derived root. Never adopts a foreign
 * checkout.
 */
export function resolveToolsRoot(fromPath: string): string {
  const own = join(selfRoot(fromPath), "tools");
  const exported = process.env["DEVENV_TOOLS"];
  if (exported) {
    const exportedReal = canonical(exported);
    if (exportedReal === canonical(own)) return exportedReal;
  }
  return canonical(own);
}

/** Resolve root + tools in one call; the common entry for tool scripts. */
export function resolveDevenv(): { root: string; tools: string } {
  const here = fileURLToPath(import.meta.url);
  const root = selfRoot(here);
  return { root, tools: resolveToolsRoot(here) };
}
