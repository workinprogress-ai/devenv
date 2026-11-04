// Port of tools/tests/devenv/test_logging_documentation.bats (11 tests) — one vitest `it` per source `@test`.
import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))));
const DOC = join(ROOT, "docs", "Tooling-Standards.md");

function grepCount(args: string[]): number {
  const r = spawnSync("grep", args, { encoding: "utf8" });
  return Number.parseInt(r.stdout ?? "0", 10) || 0;
}

function grepStatus(args: string[]): number {
  return spawnSync("grep", args, { encoding: "utf8" }).status ?? 1;
}

describe("logging documentation", () => {
  it("Logging framework documentation exists", () => {
    expect(grepStatus(["-q", "^## Logging & error handling", DOC])).toBe(0);
  });

  it("Documentation covers log levels", () => {
    expect(grepCount(["-c", "log_debug\\|log_info\\|log_warn\\|log_error", DOC])).toBeGreaterThan(5);
  });

  it("Documentation includes usage guidance", () => {
    expect(grepStatus(["-q", "### Logging functions\\|### Usage conventions", DOC])).toBe(0);
  });

  it("Documentation explains DEBUG environment variable", () => {
    expect(grepStatus(["-q", "DEBUG=1\\|DEBUG environment", DOC])).toBe(0);
  });

  it("Documentation includes code examples", () => {
    expect(grepCount(["-c", "```bash\\|```sh", DOC])).toBeGreaterThan(2);
  });

  it("Documentation references error-handling.bash", () => {
    expect(grepStatus(["-q", "error-handling", DOC])).toBe(0);
  });

  it("Documentation includes best practices or guidelines", () => {
    expect(grepStatus(["-qi", "best practice\\|guidelines\\|when to use\\|usage conventions", DOC])).toBe(0);
  });

  it("Documentation explains log output streams", () => {
    expect(grepStatus(["-qi", "stderr\\|stdout", DOC])).toBe(0);
  });

  it("Documentation shows how to source the library", () => {
    expect(grepStatus(["-q", "source.*error-handling.bash", DOC])).toBe(0);
  });

  it("error-handling.bash library exists", () => {
    expect(existsSync(join(ROOT, "tools/lib/error-handling.bash"))).toBe(true);
  });

  it("error-handling.bash defines log functions", () => {
    expect(grepCount(["-c", "^log_info\\|^log_warn\\|^log_error\\|^log_debug", join(ROOT, "tools/lib/error-handling.bash")])).toBeGreaterThan(2);
  });
});
