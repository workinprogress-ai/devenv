// readLineStdin: the blocking one-line stdin reader shared by the interactive
// tools. Driven through a child process so fd 0 is a real pipe.
import { afterAll, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { readLineStdin, type StdinReader } from "../../lib/core/stdin-line.ts";

const dir = mkdtempSync(join(tmpdir(), "stdin-line-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const modUrl = pathToFileURL(join(import.meta.dirname, "..", "..", "lib", "core", "stdin-line.ts")).href;
const script = join(dir, "read.ts");
writeFileSync(
  script,
  `import { readLineStdin } from ${JSON.stringify(modUrl)};
const out: Array<string | null> = [];
for (let i = 0; i < Number(process.argv[2]); i++) out.push(readLineStdin());
process.stdout.write(JSON.stringify(out));
`,
);

function read(stdin: string | null, count = 1): Array<string | null> {
  const r = spawnSync(process.execPath, [script, String(count)], {
    encoding: "utf8",
    ...(stdin === null ? { stdio: ["ignore", "pipe", "pipe"] } : { input: stdin }),
  });
  expect(r.status, r.stderr).toBe(0);
  return JSON.parse(r.stdout) as Array<string | null>;
}

describe("core/stdin-line readLineStdin", () => {
  it("returns the first line without its newline, trimmed", () => {
    expect(read("  yes \nnext\n")).toEqual(["yes"]);
  });

  it("consumes only one line so a later read sees the rest", () => {
    expect(read("one\ntwo\nthree\n", 3)).toEqual(["one", "two", "three"]);
  });

  it("returns an empty string for a blank line", () => {
    expect(read("\n")).toEqual([""]);
  });

  it("returns the partial last line at end of input", () => {
    expect(read("tail  ")).toEqual(["tail"]);
  });

  it("non-interactive: empty or closed stdin yields null, never throws", () => {
    expect(read("")).toEqual([null]);
    expect(read(null)).toEqual([null]);
  });

  it("returns null on every read once input is exhausted", () => {
    expect(read("only\n", 3)).toEqual(["only", null, null]);
  });
});

/** A reader that replays steps: a Buffer is delivered one byte per call, an Error is thrown. */
function scripted(steps: Array<Buffer | Error>): StdinReader & { calls: number } {
  const queue = steps.map((s) => (s instanceof Buffer ? [...s].map((b) => Buffer.from([b])) : [s])).flat();
  const reader = ((chunk: Buffer): number => {
    reader.calls++;
    const next = queue.shift();
    if (next === undefined) return 0;
    if (next instanceof Error) throw next;
    chunk[0] = next[0] as number;
    return 1;
  }) as StdinReader & { calls: number };
  reader.calls = 0;
  return reader;
}

const errno = (code: string): NodeJS.ErrnoException => Object.assign(new Error(code), { code });

describe("core/stdin-line read errors", () => {
  it("retries a non-blocking stdin that is not ready (EAGAIN) and then reads the data", () => {
    const sleeps: number[] = [];
    const reader = scripted([errno("EAGAIN"), errno("EAGAIN"), Buffer.from("yes\n")]);
    expect(readLineStdin({ read: reader, sleep: (ms) => sleeps.push(ms) })).toBe("yes");
    expect(sleeps.length).toBe(2);
  });

  it("retries EAGAIN after some bytes were read instead of returning the partial line", () => {
    const reader = scripted([Buffer.from("ye"), errno("EAGAIN"), Buffer.from("s\n")]);
    expect(readLineStdin({ read: reader, sleep: () => {} })).toBe("yes");
  });

  it("gives up with the EAGAIN error once the retry cap is exhausted", () => {
    const reader = scripted(Array.from({ length: 50 }, () => errno("EAGAIN")));
    expect(() => readLineStdin({ read: reader, sleep: () => {}, maxRetries: 3 })).toThrow(/EAGAIN/);
    expect(reader.calls).toBe(4);
  });

  it("rethrows any other read error (EIO) instead of reporting end of input", () => {
    expect(() => readLineStdin({ read: scripted([errno("EIO")]), sleep: () => {} })).toThrow(/EIO/);
    expect(() => readLineStdin({ read: scripted([Buffer.from("ab"), errno("EIO")]), sleep: () => {} })).toThrow(/EIO/);
  });

  it("treats the EOF error code (reported by some platforms) as end of input", () => {
    expect(readLineStdin({ read: scripted([errno("EOF")]), sleep: () => {} })).toBeNull();
    expect(readLineStdin({ read: scripted([Buffer.from("tail"), errno("EOF")]), sleep: () => {} })).toBe("tail");
  });
});
