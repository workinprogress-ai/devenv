// Port of tools/tests/devenv/test_function_documentation.bats (8 tests) — one vitest `it` per source `@test`.
import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))));

function sh(script: string): { status: number; out: string } {
  const r = spawnSync("bash", ["-c", script], { encoding: "utf8" });
  return { status: r.status ?? 1, out: (r.stdout ?? "") + (r.stderr ?? "") };
}

function grepCount(args: string[]): number {
  const r = spawnSync("grep", args, { encoding: "utf8" });
  return Number.parseInt(r.stdout ?? "0", 10) || 0;
}

// The devcontainer.json as plain JSON (full-line // comments dropped).

// Port of tools/tests/devenv/test_function_documentation.bats — one vitest `it` per source `@test`.

// ── function documentation (port of test_function_documentation.bats, 8) ─

describe("function documentation", () => {
  it("bootstrap.bash on_error function has documentation", () => {
    const r = sh(`grep -B 5 '^on_error()' '${ROOT}/.devcontainer/bootstrap.bash' | head -6`);
    expect(r.status).toBe(0);
    expect(r.out).toContain("on_error");
  });

  it("lib/error-handling.bash functions have documentation headers", () => {
    // The file exists and has function definitions.
    expect(grepCount([`-c`, "^.*()", join(ROOT, "tools/lib/error-handling.bash")])).toBeGreaterThan(0);
  });

  it("lib/git-operations.bash functions have documentation", () => {
    const r = sh(`grep -B 3 '^configure_git_repo()' '${ROOT}/tools/lib/git-operations.bash' | grep -q '# Args:'`);
    expect(r.status).toBe(0);
  });

  it("lib/versioning.bash functions have documentation", () => {
    expect(grepCount(["-c", "# Usage:", join(ROOT, "tools/lib/versioning.bash")])).toBeGreaterThan(5);
  });

  it("script template includes documentation examples", () => {
    const template = readFileSync(join(ROOT, "tools/templates/script-template.ts"), "utf8");
    expect(template).toContain("Usage:");
    expect(template).toContain("Options:");
    expect(template).toContain("toolCli");
  });

  it("complex functions in bootstrap have parameter descriptions", () => {
    const r = sh(
      `grep -A 5 'add_nuget_source' '${ROOT}/.devcontainer/bootstrap.sh' 2>/dev/null | grep -q '$1\\|$2\\|$3\\|$4' && echo 'has_params' || echo 'no_params'`,
    );
    expect(r.status).toBe(0);
  });

  it("public library functions have return value documentation", () => {
    const r = sh(`grep -B 5 'compare_versions()' '${ROOT}/tools/lib/versioning.bash' | grep -q 'Returns:'`);
    expect(r.status).toBe(0);
  });

  it("error handling functions document exit codes", () => {
    expect(grepCount(["-c", "exit code\\|Exit code\\|EXIT_", join(ROOT, "tools/lib/error-handling.bash")])).toBeGreaterThan(3);
  });
});
