// The error-handling.bash library contract: leveled logging to stderr, with
// timestamps and the DEBUG switch. Each behavior is driven in a fresh sourced
// subshell.
import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))));
const LIB = join(ROOT, "tools/lib/error-handling.bash");

function bashLib(script: string, env: Record<string, string> = {}): { status: number; out: string } {
  const r = spawnSync("bash", ["-c", `source '${LIB}' && ${script}`], { encoding: "utf8", env: { ...process.env, ...env } });
  return { status: r.status ?? 1, out: (r.stdout ?? "") + (r.stderr ?? "") };
}

describe("error-handling library", () => {
  it("library can be sourced", () => {
    const r = bashLib("echo 'loaded'");
    expect(r.status).toBe(0);
    expect(r.out).toContain("loaded");
  });

  it("log_info outputs message", () => {
    const r = bashLib("log_info 'test message'");
    expect(r.status).toBe(0);
    expect(r.out).toContain("INFO");
    expect(r.out).toContain("test message");
  });

  it("log_warn outputs warning", () => {
    const r = bashLib("log_warn 'warning message'");
    expect(r.status).toBe(0);
    expect(r.out).toContain("WARN");
    expect(r.out).toContain("warning message");
  });

  it("log_error outputs error", () => {
    const r = bashLib("log_error 'error message'");
    expect(r.status).toBe(0);
    expect(r.out).toContain("ERROR");
    expect(r.out).toContain("error message");
  });

  it("log_debug respects DEBUG flag (default: silent)", () => {
    const r = bashLib("log_debug 'debug message'");
    expect(r.status).toBe(0);
    expect(r.out).not.toContain("debug message");
  });

  it("log_debug shows when DEBUG=1", () => {
    const r = bashLib("log_debug 'debug message'", { DEBUG: "1" });
    expect(r.status).toBe(0);
    expect(r.out).toContain("DEBUG");
    expect(r.out).toContain("debug message");
  });

  it("timestamps are included in logs", () => {
    const r = bashLib("log_info 'timestamp test'");
    expect(r.status).toBe(0);
    // ISO-like timestamp prefix: [YYYY-MM-DD ...
    expect(r.out).toMatch(/\[[0-9]{4}-[0-9]{2}-[0-9]{2}/);
  });
});
