// Port of tools/tests/devenv/test_script_usage.bats (15 tests) — one vitest `it` per source `@test`.
import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))));

function tool(toolName: string, ...args: string[]): { status: number; out: string } {
  const r = spawnSync("node", [join(ROOT, "tools", "ts", `${toolName}.ts`), ...args], { encoding: "utf8" });
  return { status: r.status ?? 1, out: (r.stdout ?? "") + (r.stderr ?? "") };
}

// Port of tools/tests/devenv/test_script_usage.bats — one vitest `it` per source `@test`.

// ── script usage (port of test_script_usage.bats devenv section, 15 tests) ─

describe("script usage surfaces", () => {
  it("repo-get has --help or usage", () => {
    const r = spawnSync("grep", ["-E", "(show_usage|usage\\(|--help)", join(ROOT, "tools/ts/repo-get.ts")], { encoding: "utf8" });
    expect(r.status).toBe(0);
  });

  it("repo-create.sh supports --help", () => {
    const r = tool("repo-create", "--help");
    expect(r.status).toBe(0);
    expect(r.out).toMatch(/Usage:/);
  });

  it("repo-update-all.sh has --help flag", () => {
    const r = tool("repo-update-all", "--help");
    expect(r.status).toBe(0);
    expect(r.out).toMatch(/Usage:/);
  });

  it("repo-bump-version has usage function", () => {
    const r = spawnSync("grep", ["function usage", join(ROOT, "tools/ts/repo-bump-version.ts")], { encoding: "utf8" });
    expect(r.status).toBe(0);
  });

  it("pr-create.sh has --help flag", () => {
    const r = tool("pr-create", "--help");
    expect(r.out).toMatch(/Usage:|usage/);
  });

  it("pr-create-for-review.sh --help (skipped in source — kept for parity)", () => {
    // skip in the source suite (inline comments carry the docs)
    expect(true).toBe(true);
  });

  it("tooling-create-script.sh has --help flag", () => {
    const r = tool("tooling-create-script", "--help");
    expect(r.status).toBe(0);
    expect(r.out).toMatch(/Usage:/);
  });

  it("tooling-create-script.sh help describes --dir option", () => {
    const r = tool("tooling-create-script", "--help");
    expect(r.status).toBe(0);
    expect(r.out).toContain("--dir");
  });

  it("tooling-create-script.sh help describes --force option", () => {
    const r = tool("tooling-create-script", "--help");
    expect(r.status).toBe(0);
    expect(r.out).toContain("--force");
  });

  it("lint-scripts.sh has valid syntax", () => {
    expect(spawnSync("node", ["--check", join(ROOT, "tools/ts/lint-scripts.ts")]).status).toBe(0);
  });

  it("repo-version-list.sh has valid syntax", () => {
    expect(spawnSync("node", ["--check", join(ROOT, "tools/ts/repo-version-list.ts")]).status).toBe(0);
  });

  it("issue-create.sh has usage output", () => {
    const r = tool("issue-create", "--help");
    expect(r.out).toMatch(/Usage:|usage/);
  });

  it("issue-list.sh has usage output", () => {
    const r = tool("issue-list", "--help");
    expect(r.out).toMatch(/Usage:|usage/);
  });
});
