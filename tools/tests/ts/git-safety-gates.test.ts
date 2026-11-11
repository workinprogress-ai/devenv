// git-safety-gates.test.ts — TS-twin coverage for the safety-gate helpers
// the retired bash suites (repo-foreign-safety, repo-target-unified over
// git-operations.bash) used to pin: the devenv-repo gate, the nested-clone
// rule, and the target-unification contract (one resolver:
// providerRepoTarget — the TS core already owns it).
import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isDevenvRepo, isNestedDevenvClone } from "../../lib/core/git.ts";

const HERE = import.meta.dirname;

function makeDevenvMarker(dir: string): void {
  mkdirSync(join(dir, "tools"), { recursive: true });
  writeFileSync(join(dir, "devenv.config"), "");
}

describe("devenv-repo detection (TS twin)", () => {
  it("a directory with tools/ + devenv.config is a devenv repo", () => {
    const dir = mkdtempSync(join(tmpdir(), "dv-detect-"));
    try {
      makeDevenvMarker(dir);
      expect(isDevenvRepo(dir)).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("a plain directory is not a devenv repo", () => {
    const dir = mkdtempSync(join(tmpdir(), "dv-plain-"));
    try {
      expect(isDevenvRepo(dir)).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("isNestedDevenvClone: a devenv repo nested under another devenv repo", () => {
    const outer = mkdtempSync(join(tmpdir(), "dv-outer-"));
    try {
      makeDevenvMarker(outer);
      const inner = join(outer, "repos", "nested");
      makeDevenvMarker(inner);
      expect(isNestedDevenvClone(inner)).toBe(true);
      expect(isNestedDevenvClone(outer)).toBe(false);
    } finally {
      rmSync(outer, { recursive: true, force: true });
    }
  });
});

describe("one resolver: providerRepoTarget", () => {
  it("reads DEVENV_REPO when set", () => {
    const r = spawnSync("node", [
      "--input-type=module", "-e",
      `process.env.DEVENV_REPO = "acme/widgets";
       const m = await import("file://${join(HERE, "../../lib/providers/provider-core.ts")}");
       console.log(m.providerRepoTarget(""));`,
    ], { encoding: "utf8", env: { ...process.env } });
    expect((r.stdout ?? "").trim()).toBe("acme/widgets");
  });

  it("empty spec with no DEVENV_REPO falls back to cwd inference", () => {
    const r = spawnSync("node", [
      "--input-type=module", "-e",
      `process.env.DEVENV_REPO = "";
       const m = await import("file://${join(HERE, "../../lib/providers/provider-core.ts")}");
       console.log(m.providerRepoTarget(""));`,
    ], { encoding: "utf8", cwd: HERE, env: { ...process.env, DEVENV_REPO: "" } });
    // cwd here is inside this repo, so the inference resolves it — the
    // contract is that empty never errors and never guesses a foreign repo.
    expect((r.stdout ?? "").trim()).not.toBe("");
  });

  it("an explicit spec wins over the environment", () => {
    const r = spawnSync("node", [
      "--input-type=module", "-e",
      `process.env.DEVENV_REPO = "acme/from-env";
       const m = await import("file://${join(HERE, "../../lib/providers/provider-core.ts")}");
       console.log(m.providerRepoTarget("acme/explicit"));`,
    ], { encoding: "utf8", env: { ...process.env } });
    expect((r.stdout ?? "").trim()).toBe("acme/explicit");
  });
});
