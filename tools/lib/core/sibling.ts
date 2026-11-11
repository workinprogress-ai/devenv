// sibling.ts — how one tool runs another tool of the same checkout.
//
// A tool never depends on a generated depth-1 stub (tools/<name>): stubs are
// install artifacts that do not exist in a clean clone, and the fork/custom
// swap they provide is for human invocation only. Tool-to-tool calls run the
// sibling's TypeScript entry point directly, resolved from this module's own
// location, so the sibling is always the one in the calling tool's checkout.
//
// A test (or caller) that injects a fixture tools root passes it as
// `overrideRoot`: the sibling is then `<overrideRoot>/<name>` exactly as the
// injected directory of stub scripts expects. A fixture checkout that carries
// this module but no `ts/<name>.ts` for the sibling (only a script named
// `<name>` at its root) is served the same way; a real checkout always has
// the TypeScript entry point, so the fallback is never taken there.
//
// Strip-only compatible: runs natively under `node <file>.ts`.
import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/** The tools directory of the checkout this module lives in. */
function ownToolsRoot(): string {
  return fileURLToPath(new URL("../..", import.meta.url));
}

/** Absolute path of `tools/ts/<name>.ts` in the checkout this module lives in. */
export function siblingScript(name: string): string {
  return join(ownToolsRoot(), "ts", `${name}.ts`);
}

/**
 * The argv (command first) that runs sibling tool `name`.
 *
 * Default: `[process.execPath, <checkout>/tools/ts/<name>.ts]`. With a
 * non-empty `overrideRoot`: `[<overrideRoot>/<name>]`, prefixed with `bash`
 * when `viaBash` is set (for fixture scripts that are not executable).
 */
export function siblingCommand(name: string, overrideRoot?: string, viaBash = false): string[] {
  const asScript = (path: string): string[] => (viaBash ? ["bash", path] : [path]);
  if (overrideRoot !== undefined && overrideRoot !== "") return asScript(join(overrideRoot, name));
  const script = siblingScript(name);
  if (!existsSync(script)) {
    const fixtureScript = join(ownToolsRoot(), name);
    if (existsSync(fixtureScript)) return asScript(fixtureScript);
  }
  return [process.execPath, script];
}

/** The `{ command, args }` pair for spawning sibling `name` with `args`
 * (the argv of {@link siblingCommand} split for `spawn`/`spawnSync`). */
export function siblingInvocation(
  name: string,
  args: string[],
  overrideRoot?: string,
  viaBash = false,
): { command: string; args: string[] } {
  const [command = "", ...prefix] = siblingCommand(name, overrideRoot, viaBash);
  return { command, args: [...prefix, ...args] };
}
