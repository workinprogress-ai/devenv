// spawn.ts — typed argv wrapper over child_process. The ergonomics budget
// that zx/execa would otherwise carry: explicit argv arrays (no shell
// quoting), captured stdout/stderr/exit, and error messages that name the
// command that failed.
//
// Strip-only compatible: this module runs natively under `node <file>.ts`
// (Node's default type stripping rejects parameter properties, enums, and
// namespaces), so the syntax here stays inside the strip-only subset.
import { spawn } from "node:child_process";
import type { SpawnSyncReturns } from "node:child_process";
import { StringDecoder } from "node:string_decoder";

/** Output ceiling for every synchronous capture helper. The Node default
 * (1 MiB) silently truncates large output and fails the call, so shared
 * helpers pass this explicitly. */
export const SPAWN_MAX_BUFFER = 256 * 1024 * 1024;

/** Throw when a synchronous spawn did not run to a normal exit because its
 * output overflowed `maxBuffer` or the child was killed by a signal: the
 * captured output is truncated or absent, so it must never be read as
 * empty output or as an ordinary non-zero exit. */
export function assertSpawnCompleted(r: SpawnSyncReturns<string>, argv: string[]): void {
  const code = (r.error as NodeJS.ErrnoException | undefined)?.code;
  if (code === "ENOBUFS") {
    throw new Error(`command output exceeded ${SPAWN_MAX_BUFFER} bytes: ${argv.join(" ")}`);
  }
  if (r.status === null && r.signal) {
    throw new Error(`command killed by ${r.signal}: ${argv.join(" ")}`);
  }
}

export interface SpawnResult {
  status: number | null;
  stdout: string;
  stderr: string;
  /** True when the run was killed because it exceeded `timeoutMs`. */
  timedOut?: boolean;
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
    // Streaming decoders keep a multibyte character split across chunk
    // boundaries intact.
    const outDecoder = new StringDecoder("utf8");
    const errDecoder = new StringDecoder("utf8");
    let timedOut = false;
    let settled = false;

    const timer = opts.timeoutMs
      ? setTimeout(() => {
          timedOut = true;
          child.kill("SIGKILL");
        }, opts.timeoutMs)
      : undefined;

    child.stdout.on("data", (d: Buffer) => {
      stdout += outDecoder.write(d);
    });
    child.stderr.on("data", (d: Buffer) => {
      stderr += errDecoder.write(d);
    });
    child.on("error", (_err: NodeJS.ErrnoException) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      // Launch failures (ENOENT, EACCES) are not timeouts — report them as
      // what they are so the failure message points at the real cause.
      reject(new SpawnError(argv, { status: null, stdout, stderr, timedOut }, timedOut));
    });
    child.on("close", (status) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      stdout += outDecoder.end();
      stderr += errDecoder.end();
      resolve({ status, stdout, stderr, timedOut });
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
    throw new SpawnError(argv, result, result.timedOut === true);
  }
  return result;
}
