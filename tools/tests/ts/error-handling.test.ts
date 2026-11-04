// Port of test_error_handling.bats (13 tests): the error-handling.bash
// library contract — logging levels, exit codes, strict mode, and the
// require_option_value usage-error gate. Each bash behavior is driven in a
// fresh sourced subshell, as the source suite does.
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

// rov ARGS: run require_option_value in a fresh shell with ARGS; "accepted" is
// echoed past it so acceptance is visible.
function rov(...args: string[]): { status: number; out: string } {
  const r = spawnSync("bash", ["-c", `source '${LIB}'; require_option_value "$@"; echo accepted`, "_", ...args], { encoding: "utf8" });
  return { status: r.status ?? 1, out: (r.stdout ?? "") + (r.stderr ?? "") };
}

describe("error-handling library", () => {
  it("library can be sourced", () => {
    const r = bashLib("echo 'loaded'");
    expect(r.status).toBe(0);
    expect(r.out).toContain("loaded");
  });

  it("exit codes are defined", () => {
    const r = bashLib("echo $EXIT_SUCCESS");
    expect(r.status).toBe(0);
    expect(r.out.trim()).toBe("0");
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

  it("enable_strict_mode sets error handling", () => {
    const r = bashLib("enable_strict_mode && echo 'strict mode enabled'");
    expect(r.status).toBe(0);
    expect(r.out).toContain("strict mode enabled");
  });
});

describe("require_option_value", () => {
  it("an empty or absent value is a usage error (exit 2)", () => {
    const r = rov("--base", "");
    expect(r.status).toBe(2);
    expect(r.out).toContain("Missing value for --base");
    const absent = bashLib("require_option_value --base; echo accepted");
    expect(absent.status).toBe(2);
  });

  it("a value that is another option name is refused", () => {
    const r = rov("--base", "--force");
    expect(r.status).toBe(2);
    expect(r.out).toContain("--base");
    expect(r.out).toContain("--force");
  });

  it("ordinary values are accepted, including - and text that starts with dashes", () => {
    for (const v of ["main", "5", "-", "-- a note", "--- front matter", "-1", "some text", "a=b"]) {
      const r = rov("--opt", v);
      expect(r.status, `refused: [${v}] ${r.out}`).toBe(0);
      expect(r.out).toContain("accepted");
    }
  });

  it("set -u does not crash when the value is absent", () => {
    const r = spawnSync("bash", ["-c", `set -u; source '${LIB}'; require_option_value --x "\${2:-}"; echo accepted`], { encoding: "utf8" });
    expect(r.status ?? 1).toBe(2);
    expect(((r.stdout ?? "") + (r.stderr ?? ""))).not.toContain("unbound variable");
  });
});
