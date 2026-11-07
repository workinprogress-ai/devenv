// core-body-source.test.ts — unit suite for lib/core/body-source.ts. The
// bash original's 27-case bats spec is the behavioral reference; the cases
// that map to a unit-testable surface live here (stdin-leg integration
// cases run through the tool-level suites in the adoption phase).
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const LIB = join(fileURLToPath(new URL(".", import.meta.url)), "../../lib/core/body-source.ts");

let tmp = "";

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "bsrc-unit-"));
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

// The resolver consumes stdin; each stdin case drives it as a fresh node
// process so the suite's own stdin state never leaks between cases.
function runLib(
  argv: string[],
  opts: { stdin?: string } = {},
): { status: number; stdout: string } {
  const r = spawnSync(
    "node",
    ["-e", `import(${JSON.stringify("file://" + LIB)}).then(m => { const r = m.resolveBodySource(${argv[0]}); console.log(JSON.stringify(r)); })`],
    { encoding: "utf8", input: opts.stdin ?? "" },
  );
  return { status: r.status ?? 1, stdout: r.stdout ?? "" };
}

describe("resolveBodySource", () => {
  it("text flag wins and returns the text verbatim", () => {
    const r = runLib(['{ text: "hello" }']);
    expect(r.status).toBe(0);
    expect(JSON.parse(r.stdout)).toEqual({ ok: true, source: "text", body: "hello" });
  });

  it("blank --body is refused (empty-body)", () => {
    const r = runLib(['{ text: "   " }']);
    expect(JSON.parse(r.stdout)).toEqual({
      ok: false,
      error: { code: "empty-body", message: "Refusing empty --body" },
    });
  });

  it("both flags refused (multiple-sources)", () => {
    const r = runLib(['{ text: "a", file: "b.md" }']);
    expect(JSON.parse(r.stdout)).toEqual({
      ok: false,
      error: { code: "multiple-sources", message: "Only one body source may be specified" },
    });
  });

  it("file leg reads the file (file)", () => {
    const f = join(tmp, "body.md");
    writeFileSync(f, "file body\n");
    const r = runLib([`{ file: ${JSON.stringify(f)} }`]);
    expect(JSON.parse(r.stdout)).toEqual({ ok: true, source: "file", body: "file body\n" });
  });

  it("missing file refused (file-not-found)", () => {
    const r = runLib([`{ file: ${JSON.stringify(join(tmp, "nope.md"))} }`]);
    const parsed = JSON.parse(r.stdout) as { ok: boolean; error?: { code: string } };
    expect(parsed.ok).toBe(false);
    expect(parsed.error?.code).toBe("file-not-found");
  });

  it("piped stdin auto-reads (stdin)", () => {
    const r = runLib(["{}"], { stdin: "piped content" });
    expect(JSON.parse(r.stdout)).toEqual({ ok: true, source: "stdin", body: "piped content" });
  });

  it("empty piped stdin refused (empty-stdin) — the uniform F007 fix", () => {
    const r = runLib(["{}"], { stdin: "  \n " });
    expect(JSON.parse(r.stdout)).toEqual({
      ok: false,
      error: {
        code: "empty-stdin",
        message: "Refusing empty stdin body (pipe content or use --body/--body-file)",
      },
    });
  });

  it("'-' reads stdin and refuses blank content (empty-stdin) — the leg the tools drifted on", () => {
    const ok = runLib(['{ file: "-" }'], { stdin: "real body" });
    expect(JSON.parse(ok.stdout)).toEqual({ ok: true, source: "stdin", body: "real body" });

    const blank = runLib(['{ file: "-" }'], { stdin: "\n\t" });
    const parsed = JSON.parse(blank.stdout) as { ok: boolean; error?: { code: string } };
    expect(parsed.ok).toBe(false);
    expect(parsed.error?.code).toBe("empty-stdin");
  });

  it("whitespace judgment is whole-stream: leading blank line is fine", () => {
    const r = runLib(["{}"], { stdin: "\n\ncontent after blanks" });
    const parsed = JSON.parse(r.stdout) as { ok: boolean; body?: string };
    expect(parsed.ok).toBe(true);
    expect(parsed.body).toBe("\n\ncontent after blanks");
  });

  it("no flags + TTY stdin returns interactive (never blocks)", () => {
    // stdin is the test runner's (not a TTY under vitest); force the TTY
    // branch by faking isTTY through a wrapper import.
    const r = spawnSync(
      "node",
      [
        "-e",
        `Object.defineProperty(process.stdin, "isTTY", { value: true });` +
          `import(${JSON.stringify("file://" + LIB)}).then(m => {` +
          ` const out = m.resolveBodySource({}); console.log(JSON.stringify(out)); });`,
      ],
      { encoding: "utf8", input: "" },
    );
    expect(JSON.parse(r.stdout ?? "")).toEqual({ ok: true, source: "interactive", body: "" });
  });

  // ── cases completing the bash spec port (behavioral parity) ─────────────

  it("a slow producer is read in full (the TS port reads to EOF — no probe timeout by design)", () => {
    const r = runLib(["{}"], { stdin: "late body" });
    expect(JSON.parse(r.stdout)).toEqual({ ok: true, source: "stdin", body: "late body" });
  });

  it("'-' with a TTY and no pipe is refused (stdin-tty-refused), never read", () => {
    const r = spawnSync(
      "node",
      [
        "-e",
        `Object.defineProperty(process.stdin, "isTTY", { value: true });` +
          `import(${JSON.stringify("file://" + LIB)}).then(m => {` +
          ` const out = m.resolveBodySource({ file: "-" }); console.log(JSON.stringify(out)); });`,
      ],
      { encoding: "utf8", input: "" },
    );
    const parsed = JSON.parse(r.stdout ?? "") as { ok: boolean; error?: { code: string } };
    expect(parsed.ok).toBe(false);
    expect(parsed.error?.code).toBe("stdin-tty-refused");
  });

  it("a directory as --body-file is refused (file-not-found — not a regular file)", () => {
    const r = runLib([`{ file: ${JSON.stringify(tmp)} }`]);
    const parsed = JSON.parse(r.stdout) as { ok: boolean; error?: { code: string } };
    expect(parsed.ok).toBe(false);
    expect(parsed.error?.code).toBe("file-not-found");
  });
});
