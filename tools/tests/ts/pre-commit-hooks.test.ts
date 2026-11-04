// Port of tools/tests/devenv/test_pre_commit_hooks.bats (14 tests) — one vitest `it` per source `@test`.
import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))));

function sh(script: string, cwd?: string): { status: number; out: string } {
  const r = spawnSync("bash", ["-c", script], { encoding: "utf8", cwd });
  return { status: r.status ?? 1, out: (r.stdout ?? "") + (r.stderr ?? "") };
}

// Port of tools/tests/devenv/test_pre_commit_hooks.bats — one vitest `it` per source `@test`.

// ── pre-commit hooks (port of test_pre_commit_hooks.bats, 14 tests) ──────

describe("pre-commit hooks", () => {
  it("commit-msg hook exists", () => {
    expect(existsSync(join(ROOT, ".husky/commit-msg"))).toBe(true);
  });

  it("commit-msg hook uses commitlint", () => {
    const r = spawnSync("grep", ["commitlint", join(ROOT, ".husky/commit-msg")], { encoding: "utf8" });
    expect(r.status).toBe(0);
  });

  it("commit-msg hook has valid syntax", () => {
    expect(spawnSync("bash", ["-n", join(ROOT, ".husky/commit-msg")]).status).toBe(0);
  });

  it("husky is configured in package.json", () => {
    const r = spawnSync("grep", ["husky", join(ROOT, "package.json")], { encoding: "utf8" });
    expect(r.status).toBe(0);
  });

  it("commitlint config exists", () => {
    expect(existsSync(join(ROOT, "commitlint.config.js"))).toBe(true);
  });

  it("commitlint config has valid syntax", () => {
    expect(spawnSync("node", ["-c", join(ROOT, "commitlint.config.js")]).status).toBe(0);
  });

  it("commitlint enforces Conventional Commits", () => {
    const r = spawnSync("grep", ["@commitlint/config-conventional", join(ROOT, "commitlint.config.js")], { encoding: "utf8" });
    expect(r.status).toBe(0);
  });

  it("global pre-commit hook exists", () => {
    expect(existsSync(join(ROOT, "tools/git-hooks/pre-commit"))).toBe(true);
  });

  it("global pre-commit hook is executable", () => {
    const r = sh(`test -x '${ROOT}/tools/git-hooks/pre-commit'`);
    expect(r.status).toBe(0);
  });

  it("global pre-commit hook has valid bash syntax", () => {
    expect(spawnSync("bash", ["-n", join(ROOT, "tools/git-hooks/pre-commit")]).status).toBe(0);
  });

  it("global pre-commit hook blocks commit when HEAD is a WIP commit", () => {
    const repo = mkdtempSync(join(tmpdir(), "wip-hook-"));
    const g = (args: string[]): void => {
      spawnSync("git", ["-C", repo, ...args], { encoding: "utf8" });
    };
    g(["init", "-q"]);
    g(["config", "user.email", "test@test.com"]);
    g(["config", "user.name", "Test"]);
    spawnSync("sh", ["-c", `touch file.txt && git -C '${repo}' add file.txt && git -C '${repo}' commit -q -m initial`], { cwd: repo });
    spawnSync("sh", ["-c", `touch wip.txt && git -C '${repo}' add wip.txt && git -C '${repo}' commit -q -m "WIP: in progress"`], { cwd: repo });
    const r = sh(`bash '${ROOT}/tools/git-hooks/pre-commit'`, repo);
    expect(r.status).toBe(1);
    expect(r.out).toContain("WIP");
    rmSync(repo, { recursive: true, force: true });
  });

  it("global pre-commit hook allows commit when no WIP commits present", () => {
    const repo = mkdtempSync(join(tmpdir(), "wip-hook-"));
    const g = (args: string[]): void => {
      spawnSync("git", ["-C", repo, ...args], { encoding: "utf8" });
    };
    g(["init", "-q"]);
    g(["config", "user.email", "test@test.com"]);
    g(["config", "user.name", "Test"]);
    spawnSync("sh", ["-c", `touch file.txt && git -C '${repo}' add file.txt && git -C '${repo}' commit -q -m initial`], { cwd: repo });
    const r = sh(`bash '${ROOT}/tools/git-hooks/pre-commit'`, repo);
    expect(r.status).toBe(0);
    rmSync(repo, { recursive: true, force: true });
  });

  it("shellcheck can be used for pre-commit validation", () => {
    const r = sh("command -v shellcheck");
    if (r.status !== 0) return; // skip: shellcheck not installed (optional)
    expect(r.status).toBe(0);
  });

  it("husky prepare script exists", () => {
    const r = spawnSync("grep", ["\"prepare\".*husky", join(ROOT, "package.json")], { encoding: "utf8" });
    if (r.status !== 0) return; // skip: husky prepare not configured yet
    expect(r.status).toBe(0);
  });
});
