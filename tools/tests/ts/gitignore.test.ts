// Port of tools/tests/devenv/test_gitignore.bats (4 tests) — one vitest `it` per source `@test`.
import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const ROOT = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url))))); // file → ts → tests → tools → devenv root

function sh(script: string, input = ""): { status: number; out: string } {
  const r = spawnSync("bash", ["-c", script], { encoding: "utf8", input });
  return { status: r.status ?? 1, out: (r.stdout ?? "") + (r.stderr ?? "") };
}

function gitRepo(...args: string[]): { status: number; out: string } {
  const r = spawnSync("git", ["-C", ROOT, ...args], { encoding: "utf8" });
  return { status: r.status ?? 1, out: r.stdout ?? "" };
}

// Port of tools/tests/devenv/test_gitignore.bats — one vitest `it` per source `@test`.

// ── gitignore (port of test_gitignore.bats, 4 tests) ─────────────────────

describe("gitignore", () => {
  it(".gitignore has no redundant bare .update-time entry", () => {
    const r = sh(`grep -nx '\\.update-time' '${ROOT}/.gitignore'`);
    expect(r.status).toBe(1);
  });

  it("the real update-time file is still ignored through the .runtime/ patterns", () => {
    const r = gitRepo("check-ignore", "-q", ".runtime/.update-time");
    expect(r.status).toBe(0);
  });

  it("the repo-wide runtime directory pattern is present", () => {
    const lines = readFileSync(join(ROOT, ".gitignore"), "utf8").split("\n");
    expect(lines).toContain(".runtime/");
  });

  it("tools/fork/ is tracked (a fork commits it) while tools/custom/ stays ignored", () => {
    expect(gitRepo("check-ignore", "-q", "tools/fork/example.sh").status).toBe(1);
    expect(gitRepo("check-ignore", "-q", "tools/custom/example.sh").status).toBe(0);
  });
});
