// spawn.ts — typed argv wrapper over child_process. The ergonomics budget
// that zx/execa would otherwise carry: explicit argv arrays (no shell
// quoting), captured stdout/stderr/exit, and error messages that name the
// command that failed.
//
// Strip-only compatible: this module runs natively under `node <file>.ts`
// (Node's default type stripping rejects parameter properties, enums, and
// namespaces), so the syntax here stays inside the strip-only subset.
import { spawn } from "node:child_process";

export interface SpawnResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

export interface SpawnOptions {
  /** Working directory (default: inherit). */
  cwd?: string;
  /** Extra environment entries merged over process.env. */
  env?: Record<string, string>;
  /** Drop the inherited environment and use only `env`. Default: false. */
  cleanEnv?: boolean;
  /** Timeout in ms; on expiry the child is killed and status is null. */
  timeoutMs?: number;
  /** Stdin bytes fed to the child (default: none). */
  input?: string;
}

export class SpawnError extends Error {
  readonly argv: string[];
  readonly result: SpawnResult;
  readonly timedOut: boolean;

  constructor(argv: string[], result: SpawnResult, timedOut: boolean) {
    const cmd = argv.join(" ");
    super(
      `command failed (${timedOut ? "timeout" : `exit ${result.status ?? "signal"}`}): ${cmd}` +
        (result.stderr.trim() ? `${"\n"}stderr: ${result.stderr.trim().split("\n").slice(0, 5).join("\n")}` : ""),
    );
    this.name = "SpawnError";
    this.argv = argv;
    this.result = result;
    this.timedOut = timedOut;
  }
}

/**
 * Run a command to completion. Never throws for non-zero exits — inspect
 * `result.status`. Throws SpawnError only for launch failures.
 */
export function run(
  argv: string[],
  opts: SpawnOptions = {},
): Promise<SpawnResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(argv[0] ?? "", argv.slice(1), {
      cwd: opts.cwd,
      env: opts.cleanEnv
        ? { ...opts.env }
        : { ...process.env, ...opts.env },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let settled = false;

    const timer = opts.timeoutMs
      ? setTimeout(() => {
          timedOut = true;
          child.kill("SIGKILL");
        }, opts.timeoutMs)
      : undefined;

    child.stdout.on("data", (d: Buffer) => {
      stdout += d.toString();
    });
    child.stderr.on("data", (d: Buffer) => {
      stderr += d.toString();
    });
    child.on("error", (_err: NodeJS.ErrnoException) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      // Launch failures (ENOENT, EACCES) are not timeouts — report them as
      // what they are so the failure message points at the real cause.
      reject(new SpawnError(argv, { status: null, stdout, stderr }, timedOut));
    });
    child.on("close", (status) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolve({ status, stdout, stderr });
    });

    // A child that exits without reading a large `input` raises EPIPE on the
    // pipe write; without a listener the unhandled error would kill the host
    // process. The failure still surfaces via the child's close/error path.
    child.stdin.on("error", () => {});
    if (opts.input !== undefined) {
      child.stdin.write(opts.input);
    }
    child.stdin.end();
  });
}

/**
 * Run a command and require exit 0. Non-zero exits and timeouts throw
 * SpawnError; use for steps where failure aborts the tool.
 */
export async function mustRun(
  argv: string[],
  opts: SpawnOptions = {},
): Promise<SpawnResult> {
  const result = await run(argv, opts);
  if (result.status !== 0) {
    throw new SpawnError(argv, result, false);
  }
  return result;
}
