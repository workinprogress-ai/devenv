// harness/run-tool.ts — the shared black-box tool runner (the 42 divergent
// per-suite runTool copies unified here; suites no longer own spawn glue).
//
// One signature: runTool(tool, args, {env, stdin, cwd, toolbox}) spawns
// `node tools/ts/<tool>.ts` with stub-aware env construction and returns
// status + separated + merged output. Suites keep their assertions;
// only the spawn boilerplate collapses.
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const TESTS_DIR = fileURLToPath(new URL(".", import.meta.url));
// harness/ sits at <root>/tools/tests/ts/harness/ — four levels to root.
export const REPO_ROOT = join(TESTS_DIR, "..", "..", "..", "..");
export const TOOLS = join(REPO_ROOT, "tools");

export interface RunToolOptions {
  /** Extra/overriding env entries (PATH stubs are the caller's job — see
   * stubs.ts; set the whole PATH here when a suite needs custom stubs). */
  env?: Record<string, string | undefined>;
  /** Piped stdin content (default: empty — a closed pipe, not a TTY). */
  stdin?: string | undefined;
  /** Working directory (default: a suite-provided repoRoot or the checkout). */
  cwd?: string | undefined;
}

export interface RunToolResult {
  status: number;
  stdout: string;
  stderr: string;
  output: string;
}

/** Absolute path of a tool's TypeScript entry point. Tests run it with `node`
 * and never depend on the generated depth-1 stubs, which are an install
 * artifact (see entry-stubs-sync) rather than part of the checkout. */
export function toolScript(tool: string): string {
  return join(TOOLS, "ts", `${tool}.ts`);
}

/** Run a TS tool by bare name (no extension) as a node child. */
export function runTool(tool: string, args: string[], opts: RunToolOptions = {}): RunToolResult {
  const r = spawnSync("node", [toolScript(tool), ...args], {
    encoding: "utf8",
    input: opts.stdin ?? "",
    cwd: opts.cwd,
    env: { ...process.env, ...opts.env } as NodeJS.ProcessEnv,
  });
  const stdout = r.stdout ?? "";
  const stderr = r.stderr ?? "";
  return { status: r.status ?? 1, stdout, stderr, output: stdout + stderr };
}
