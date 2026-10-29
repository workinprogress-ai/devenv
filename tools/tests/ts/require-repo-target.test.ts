// Unit tests for requireRepoTarget (15.8): named-error with remediation on
// an empty resolved target, pass-through when resolved, and the explain-data
// arbiter (azure issues reads = never -> empty passes). Each case fresh-imports
// the facade under its own DEVENV_ROOT (providerDetect caches per module).
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let root: string;
let saved: string | undefined;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "reqrepo-"));
  saved = process.env.DEVENV_ROOT;
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  if (saved === undefined) delete process.env.DEVENV_ROOT;
  else process.env.DEVENV_ROOT = saved;
});

async function load() {
  vi.resetModules();
  const core = await import("../../lib/providers/provider-core.ts");
  return core;
}

describe("requireRepoTarget", () => {
  it("a resolved target passes through untouched (no detection needed)", async () => {
    const { requireRepoTarget } = await load();
    expect(requireRepoTarget("org/repo", "issue-get", "issues")).toBe("org/repo");
  });

  it("an empty target on a required family throws the named remediation error", async () => {
    process.env.DEVENV_ROOT = root;
    writeFileSync(join(root, "devenv.config"), "[provider]\nname=github\n");
    const { requireRepoTarget } = await load();
    expect(() => requireRepoTarget("", "issue-get", "issues")).toThrow(/no repository target resolved/);
    expect(() => requireRepoTarget("", "issue-get", "issues")).toThrow(/set DEVENV_REPO/);
  });

  it("an empty target on a never-family passes through (project-scoped providers)", async () => {
    process.env.DEVENV_ROOT = root;
    writeFileSync(join(root, "devenv.config"), "[provider]\nname=azure\n");
    const { requireRepoTarget } = await load();
    expect(requireRepoTarget("", "issue-get", "issues")).toBe("");
  });
});
