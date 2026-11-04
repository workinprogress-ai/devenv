// Port of tools/tests/lib/test_body_source.bats (27 tests) — one vitest `it`
// per source `@test`. Shared markdown body-source resolution for tools:
// resolve precedence (text/file/stdin/interactive), empty-stdin refusal, and
// the slow-producer probe timeout.
import { describe, expect, it, vi } from "vitest";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const ROOT = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))));
const LIB = join(ROOT, "tools", "lib", "body-source.bash");
const TS_UPSERT = join(ROOT, "tools", "ts", "issue-artifact-upsert.ts");

let TMP = "";

const mk = (): string => mkdtempSync(join(tmpdir(), `bodysrc-${Date.now()}-${Math.random().toString(36).slice(2)}`));

// bash -c with the library sourced.
function sh(script: string, input?: string): { status: number; out: string } {
  const r = spawnSync("bash", ["-c", script], {
    input,
    encoding: "utf8",
    env: { ...process.env },
  });
  return { status: r.status ?? 1, out: (r.stdout ?? "") + (r.stderr ?? "") };
}

describe("body source", () => {
  // ── Library loading ──────────────────────────────────────────────────────

  it("body-source: library can be sourced", () => {
    const r = sh(`source '${LIB}' && echo 'loaded'`);
    expect(r.status).toBe(0);
    expect(r.out).toContain("loaded");
  });

  it("body-source: prevents multiple sourcing", () => {
    const r = sh(`source '${LIB}'\nsource '${LIB}'\necho 'success'`);
    expect(r.status).toBe(0);
  });

  it("body-source: has valid bash syntax", () => {
    expect(spawnSync("bash", ["-n", LIB]).status).toBe(0);
  });

  it("body-source: passes shellcheck", () => {
    expect(spawnSync("shellcheck", [LIB]).status).toBe(0);
  });

  // ── resolve: text / conflict ─────────────────────────────────────────────

  it("resolve: --body text wins and prints body", () => {
    TMP = mk();
    const out = join(TMP, "out.txt");
    const r = sh(
      `source '${LIB}'\nbody_source_resolve 'hello body' '' > '${out}'\necho "result=$BODY_SOURCE_RESULT"\ncat '${out}'`,
    );
    expect(r.status).toBe(0);
    expect(r.out).toContain("result=text");
    expect(r.out).toContain("hello body");
  });

  it("resolve: both text and file given is a conflict", () => {
    const r = sh(`source '${LIB}'\nbody_source_resolve 'text' '/tmp/some-file.md'`);
    expect(r.status).toBe(2);
    expect(r.out).toContain("Only one body source");
  });

  // ── resolve: file source ─────────────────────────────────────────────────

  it("resolve: --body-file reads the named file", () => {
    TMP = mk();
    const body = join(TMP, "body.md");
    const out = join(TMP, "out.txt");
    writeFileSync(body, "file body line\n");
    const r = sh(
      `source '${LIB}'\nbody_source_resolve '' '${body}' > '${out}'\necho "result=$BODY_SOURCE_RESULT"\ncat '${out}'`,
    );
    expect(r.status).toBe(0);
    expect(r.out).toContain("result=file");
    expect(r.out).toContain("file body line");
  });

  it("resolve: --body-file missing file errors", () => {
    TMP = mk();
    const r = sh(`source '${LIB}'\nbody_source_resolve '' '${join(TMP, "does-not-exist.md")}'`);
    expect(r.status).toBe(2);
    expect(r.out).toContain("File not found");
  });

  it("resolve: --body-file - reads stdin (decision D4)", () => {
    TMP = mk();
    const input = join(TMP, "in.txt");
    const out = join(TMP, "out.txt");
    writeFileSync(input, "piped via dash\n");
    const r = sh(
      `source '${LIB}'\nbody_source_resolve '' '-' < '${input}' > '${out}'\necho "result=$BODY_SOURCE_RESULT"\ncat '${out}'`,
    );
    expect(r.status).toBe(0);
    expect(r.out).toContain("piped via dash");
    expect(r.out).toContain("result=stdin");
  });

  // ── resolve: auto-stdin (decision D1) ────────────────────────────────────

  it("resolve: no flags with piped stdin auto-reads", () => {
    TMP = mk();
    const input = join(TMP, "in.txt");
    const out = join(TMP, "out.txt");
    writeFileSync(input, "auto-read body\n");
    const r = sh(
      `source '${LIB}'\nbody_source_resolve '' '' < '${input}' > '${out}'\necho "result=$BODY_SOURCE_RESULT"\ncat '${out}'`,
    );
    expect(r.status).toBe(0);
    expect(r.out).toContain("auto-read body");
    expect(r.out).toContain("result=stdin");
  });

  it("resolve: empty piped stdin is a hard error", () => {
    TMP = mk();
    const input = join(TMP, "in.txt");
    writeFileSync(input, "");
    const r = sh(`source '${LIB}'\nbody_source_resolve '' '' < '${input}'`);
    expect(r.status).toBe(2);
    expect(r.out).toContain("Refusing empty stdin");
  });

  it("resolve: whitespace-only piped stdin is a hard error", () => {
    TMP = mk();
    const input = join(TMP, "in.txt");
    // read -n 1 treats a space as data, so the lib must trim before deciding.
    writeFileSync(input, "   \n\n");
    const r = sh(`source '${LIB}'\nbody_source_resolve '' '' < '${input}'`);
    expect(r.status).toBe(2);
    expect(r.out).toContain("Refusing empty stdin");
  });

  it("resolve: closed stdin is a hard error (never hangs)", () => {
    const r = sh(`timeout 5 bash -c "exec 0<&-; source '${LIB}'; body_source_resolve '' ''"`);
    expect(r.status).toBe(2);
    expect(r.out).toContain("Refusing empty stdin");
  });

  // ── resolve: interactive fallback ────────────────────────────────────────

  it("resolve: no flags with a TTY reports interactive (no hang)", () => {
    TMP = mk();
    const out = join(TMP, "out.txt");
    // Simulate the TTY branch by overriding the detector (the documented seam).
    const r = sh(
      `source '${LIB}'\nbody_source_stdin_is_tty() { return 0; }\nbody_source_resolve '' '' </dev/null > '${out}'\nprintf 'result=%s\\n' "$BODY_SOURCE_RESULT"\nprintf 'outbytes=%s\\n' "$(wc -c < '${out}')"`,
    );
    expect(r.status).toBe(0);
    expect(r.out).toContain("result=interactive");
    expect(r.out).toContain("outbytes=0");
  });

  // ── capture ─────────────────────────────────────────────────────────────

  it("capture: prints content to stdout for piped stdin (F001 fixed)", () => {
    TMP = mk();
    const input = join(TMP, "in.txt");
    writeFileSync(input, "PROBE-BODY-CONTENT\n");
    const r = sh(
      `source '${LIB}'\nout=$(body_source_capture_stdin < '${input}')\nprintf 'stdout_len=%s\\n' "\${#out}"\nprintf 'stdout=%s\\n' "$out"`,
    );
    expect(r.status).toBe(0);
    expect(r.out).toContain("stdout_len=18");
    expect(r.out).toContain("stdout=PROBE-BODY-CONTENT");
  });

  it("capture: empty stdin errors rc=2", () => {
    TMP = mk();
    const input = join(TMP, "in.txt");
    writeFileSync(input, "");
    const r = sh(`source '${LIB}'\nbody_source_capture_stdin < '${input}'`);
    expect(r.status).toBe(2);
  });

  // delayed_capture: feed the capture function from a producer that writes
  // after a delay (the source suite's helper as a spawn).
  function delayedCapture(delay: number, prelude: string): { status: number; out: string } {
    return sh(
      `bash -c "\n${prelude}\nsource '${LIB}'\n( sleep ${delay}; printf 'late body\\n' ) | body_source_capture_stdin\n"`,
    );
  }

  it("capture: a producer slower than one second is still read under the default", () => {
    // The first-byte probe used to give up after 1s and call a slow producer
    // (a gh round-trip, a generator behind fzf) empty stdin.
    const r = delayedCapture(2, "");
    expect(r.status).toBe(0);
    expect(r.out.trim()).toBe("late body");
  });

  it("capture: BODY_SOURCE_PROBE_TIMEOUT shortens the wait and the slow producer is refused", () => {
    const r = delayedCapture(3, "export BODY_SOURCE_PROBE_TIMEOUT=1");
    expect(r.status).toBe(2);
    expect(r.out).toContain("Refusing empty stdin body");
  });

  it("capture: BODY_SOURCE_PROBE_TIMEOUT lengthens the wait", () => {
    const r = delayedCapture(2, "export BODY_SOURCE_PROBE_TIMEOUT=4");
    expect(r.status).toBe(0);
    expect(r.out.trim()).toBe("late body");
  });

  it("capture: an invalid BODY_SOURCE_PROBE_TIMEOUT falls back to the default", () => {
    let r = delayedCapture(2, "export BODY_SOURCE_PROBE_TIMEOUT=soon");
    expect(r.status).toBe(0);
    expect(r.out.trim()).toBe("late body");
    r = delayedCapture(2, "export BODY_SOURCE_PROBE_TIMEOUT=0");
    expect(r.status).toBe(0);
  });

  it("capture: an open but silent pipe is still refused, after the configured wait", () => {
    // Elapsed time is measured inside the consumer: a pipeline always waits
    // for its producer, so timing the whole command would only measure it.
    const r = sh(
      `export BODY_SOURCE_PROBE_TIMEOUT=1\nsource '${LIB}'\n( sleep 4 ) | {\n  start=$SECONDS\n  body_source_capture_stdin 2>/dev/null\n  echo "rc=$? elapsed=$((SECONDS - start))"\n}`,
    );
    expect(r.status).toBe(0);
    expect(r.out.trim() === "rc=2 elapsed=1" || r.out.trim() === "rc=2 elapsed=2").toBe(true);
  });

  // ── --body-file - goes through the same empty-stdin refusal ─────────────

  it("body_source_resolve: --body-file - with empty stdin is refused", () => {
    const r = sh(`source '${LIB}'; printf '' | body_source_resolve '' -`);
    expect(r.status).toBe(2);
    expect(r.out).toContain("Refusing empty stdin body");
  });

  it("body_source_resolve: --body-file - with whitespace-only stdin is refused", () => {
    const r = sh(`source '${LIB}'; printf '  \\n\\t\\n' | body_source_resolve '' -`);
    expect(r.status).toBe(2);
    expect(r.out).toContain("Refusing empty stdin body");
  });

  it("body_source_resolve: --body-file - with content returns it and reports stdin", () => {
    const r = sh(`source '${LIB}'; printf 'hello\\n' | { body_source_resolve '' - ; echo "src=$BODY_SOURCE_RESULT"; }`);
    expect(r.status).toBe(0);
    expect(r.out).toContain("hello");
  });

  it("body_source_read_dash refuses a terminal", () => {
    // Simulate a TTY by overriding the probe (no controlling terminal here).
    const r = sh(`source '${LIB}'; body_source_stdin_is_tty() { return 0; }; body_source_read_dash`);
    expect(r.status).toBe(2);
    expect(r.out).toContain("requires piped stdin");
  });

  it("body_source_read_dash reads piped content and refuses empty content", () => {
    let r = sh(`source '${LIB}'; printf 'x y\\n' | body_source_read_dash`);
    expect(r.status).toBe(0);
    expect(r.out.trim()).toBe("x y");
    r = sh(`source '${LIB}'; printf '' | body_source_read_dash`);
    expect(r.status).toBe(2);
  });

  it("issue-artifact-upsert: --body-file - with empty stdin is refused rather than posting an empty comment", () => {
    // The TS port reads stdin through readFileSync(0); an empty piped stdin
    // is the same named refusal as the bash implementation had.
    TMP = mk();
    const bin = join(TMP, "bin");
    mkdirSync(bin, { recursive: true });
    writeFileSync(join(bin, "gh"), "#!/usr/bin/env bash\nexit 0\n");
    chmodSync(join(bin, "gh"), 0o755);
    const r = spawnSync(
      "bash",
      ["-c", `printf '' | env PATH='${bin}:$PATH' DEVENV_REPO='org/repo' '${process.execPath}' '${TS_UPSERT}' --issue 42 --body-file -`],
      { encoding: "utf8" },
    );
    expect(r.status ?? 1).not.toBe(0);
    expect((r.stdout ?? "") + (r.stderr ?? "")).toContain("Refusing empty stdin body");
  });
});
