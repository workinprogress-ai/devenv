// stdin-line.ts — blocking single-line read from stdin (fd 0).
//
// Reads one byte at a time so nothing past the newline is consumed: a later
// reader (or a child process inheriting stdin) still sees the rest of the
// stream. Works on a TTY and on a pipe/file/closed stdin alike; there is no
// TTY check here — callers that must refuse non-interactive sessions test
// `process.stdin.isTTY` themselves.
//
// Strip-only compatible: runs natively under `node <file>.ts`.
import { readSync } from "node:fs";

/** Reads at most one byte into `chunk` and returns the count; 0 is end of input. */
export type StdinReader = (chunk: Buffer) => number;

export interface ReadLineOptions {
  /** Byte reader (default: a blocking read of fd 0). */
  read?: StdinReader;
  /** Pause between retries of a not-ready stdin (default: a short blocking sleep). */
  sleep?: (ms: number) => void;
  /** Consecutive not-ready retries tolerated before the error is rethrown. */
  maxRetries?: number;
}

const RETRY_PAUSE_MS = 20;
// A person may take minutes to answer on a non-blocking terminal; 20 ms x 15000 is five minutes.
const DEFAULT_MAX_RETRIES = 15_000;

const readFd0: StdinReader = (chunk) => readSync(0, chunk, 0, 1, null);

const sleepBlocking = (ms: number): void => {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
};

const codeOf = (err: unknown): string | undefined => (err as NodeJS.ErrnoException | null)?.code;

/**
 * Read one line from stdin, trimmed of surrounding whitespace.
 *
 * - A newline ends the line (the newline is not part of the result).
 * - End of input after some bytes returns those bytes, trimmed.
 * - End of input with nothing read returns `null`, so a prompt loop can tell
 *   "no more input" from an empty answer.
 * - Only end of input is end of input: a read that fails because a
 *   non-blocking stdin has no data yet (EAGAIN) is retried after a short pause
 *   (bounded by `maxRetries`), and every other read error is rethrown rather
 *   than reported as an empty or truncated answer.
 */
export function readLineStdin(options: ReadLineOptions = {}): string | null {
  const read = options.read ?? readFd0;
  const sleep = options.sleep ?? sleepBlocking;
  const maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
  let buf = Buffer.alloc(0);
  const chunk = Buffer.alloc(1);
  let retries = 0;
  while (true) {
    const idx = buf.indexOf(0x0a);
    if (idx !== -1) return buf.subarray(0, idx).toString("utf8").trim();
    let n = 0;
    try {
      n = read(chunk);
    } catch (err) {
      const code = codeOf(err);
      if (code === "EOF") {
        n = 0;
      } else if (code === "EAGAIN" && retries < maxRetries) {
        retries++;
        sleep(RETRY_PAUSE_MS);
        continue;
      } else {
        throw err;
      }
    }
    if (n <= 0) return buf.length > 0 ? buf.toString("utf8").trim() : null;
    retries = 0;
    buf = Buffer.concat([buf, chunk.subarray(0, n)]);
  }
}
