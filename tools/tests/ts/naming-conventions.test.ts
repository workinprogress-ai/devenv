// Port of tools/tests/devenv/test_naming_conventions.bats (12 tests) — one vitest `it` per source `@test`.
import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))));

function sh(script: string): { status: number; out: string } {
  const r = spawnSync("bash", ["-c", script], { encoding: "utf8" });
  return { status: r.status ?? 1, out: (r.stdout ?? "") + (r.stderr ?? "") };
}

// Port of tools/tests/devenv/test_naming_conventions.bats — one vitest `it` per source `@test`.

// ── naming conventions (port of test_naming_conventions.bats, 12 tests) ──

describe("naming conventions", () => {
  it("Function naming conventions documentation exists", () => {
    expect(existsSync(join(ROOT, "docs/Function-Naming-Conventions.md"))).toBe(true);
  });

  it("Documentation covers snake_case standard", () => {
    expect(readFileSync(join(ROOT, "docs/Function-Naming-Conventions.md"), "utf8")).toContain("snake_case");
  });

  it("Documentation includes verb prefix table", () => {
    expect(readFileSync(join(ROOT, "docs/Function-Naming-Conventions.md"), "utf8"))
      .toContain("| Prefix | Purpose | Example |");
  });

  it("Documentation includes good and bad examples", () => {
    const doc = readFileSync(join(ROOT, "docs/Function-Naming-Conventions.md"), "utf8");
    expect(doc).toContain("Good Names");
    expect(doc).toContain("Bad Names");
  });

  it("lib functions follow snake_case convention", () => {
    const r = sh(`cd '${ROOT}' && grep -hE '^[a-zA-Z_][a-zA-Z0-9_]*\\(\\)' tools/lib/*.bash | grep -E '[a-z][A-Z]'`);
    expect(r.status).not.toBe(0);
  });

  it("lib functions use descriptive verb prefixes", () => {
    const r = sh(`cd '${ROOT}' && grep -hE '^(get_|set_|check_|validate_|require_|is_|has_|add_|create_|remove_|enable_|configure_|log_|parse_|compare_|on_|use_|run_|assert|success|warn|info|die|retry_|safe_|command_|config_|version_|script_)[a-z_]+\\(\\)' tools/lib/*.bash | wc -l`);
    expect(r.status).toBe(0);
    expect(Number.parseInt(r.out.trim(), 10)).toBeGreaterThan(10);
  });

  it("error-handling.bash functions use consistent naming", () => {
    const r = sh(`grep -E '^(log_|require_|validate_|command_|create_|enable_|safe_)[a-z_]+\\(\\)' '${ROOT}/tools/lib/error-handling.bash' || true`);
    expect(r.out).not.toBe("");
  });

  it("versioning.bash functions use descriptive names", () => {
    const r = sh(`grep -E '^(parse_|compare_|version_|get_|check_|require_|script_)[a-z_]+\\(\\)' '${ROOT}/tools/lib/versioning.bash' || true`);
    expect(r.out).not.toBe("");
  });

  it("git-config.bash functions use configure_ or add_ prefix", () => {
    const r = sh(`grep -E '^(configure_|add_)[a-z_]+\\(\\)' '${ROOT}/tools/lib/git-config.bash' || true`);
    expect(r.out).not.toBe("");
  });

  it("no functions use camelCase in libraries", () => {
    const r = sh(`cd '${ROOT}' && grep -hE '^[a-z]+[A-Z][a-zA-Z]*\\(\\)' tools/lib/*.bash`);
    expect(r.status).not.toBe(0);
  });

  it("no functions use PascalCase in libraries", () => {
    const r = sh(`cd '${ROOT}' && grep -hE '^[A-Z][a-zA-Z]*\\(\\)' tools/lib/*.bash`);
    expect(r.status).not.toBe(0);
  });

  it("bootstrap.sh has valid syntax", () => {
    expect(spawnSync("bash", ["-n", join(ROOT, ".devcontainer/bootstrap.sh")]).status).toBe(0);
  });
});
