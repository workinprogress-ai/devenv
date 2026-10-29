// Tests for provider-explain: both providers' explain data shapes, the
// tool's two output modes, family matching, unknown-family error, and
// the missing-config surface (providerDetect's named error passes through).
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { githubExplain } from "../../lib/providers/github/explain.ts";
import { azureExplain } from "../../lib/providers/azure/explain.ts";
import type { ProviderExplain } from "../../lib/providers/explain.ts";

const TOOL = join(fileURLToPath(new URL(".", import.meta.url)), "../../ts/provider-explain.ts");

function runTool(args: string[], env: Record<string, string | undefined>): {
  status: number;
  stdout: string;
  stderr: string;
} {
  const r = spawnSync("node", [TOOL, ...args], {
    encoding: "utf8",
    env: { ...process.env, ...env } as NodeJS.ProcessEnv,
  });
  return { status: r.status ?? 1, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

function fixtureRoot(provider: string | null): string {
  const root = mkdtempSync(join(tmpdir(), "pexplain-"));
  const body = provider === null ? "[organization]\norg=x\n" : `[provider]\nname=${provider}\n`;
  writeFileSync(join(root, "devenv.config"), body);
  return root;
}

describe("explain data shapes", () => {
  it("github covers the six wrapper families with required-issue scoping", () => {
    const e: ProviderExplain = githubExplain();
    expect(e.provider).toBe("github");
    const names = e.families.map((f) => f.family);
    for (const f of ["issues", "pr", "project", "pipelines", "repos", "artifact"]) {
      expect(names).toContain(f);
    }
    const issues = e.families.find((f) => f.family === "issues");
    expect(issues?.repoTarget.reads).toBe("required");
    expect(issues?.identifierScoping).toMatch(/per-repositor/);
  });

  it("azure marks issues reads+writes as never (project-scoped ids)", () => {
    const e: ProviderExplain = azureExplain();
    expect(e.provider).toBe("azure");
    const issues = e.families.find((f) => f.family === "issues");
    expect(issues?.repoTarget.reads).toBe("never");
    expect(issues?.repoTarget.writes).toBe("never");
    expect(issues?.identifierScoping).toMatch(/org\/project-global/);
    expect(issues?.notes.some((n) => n.includes("azure_issue_types"))).toBe(true);
  });
});

describe("provider-explain tool", () => {
  let root: string;
  beforeEach(() => {
    root = fixtureRoot("github");
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("no arg prints the active provider + one line per family", () => {
    const r = runTool([], { DEVENV_ROOT: root });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("active provider: github");
    expect(r.stdout).toContain("issues");
    expect(r.stdout).toContain("repo target required");
  });

  it("a family arg prints the full requirement block", () => {
    const r = runTool(["issues"], { DEVENV_ROOT: root });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("repo target:");
    expect(r.stdout).toContain("checkTargetRepo");
  });

  it("an unknown family exits non-zero naming the families", () => {
    const r = runTool(["nonsense"], { DEVENV_ROOT: root });
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain("no family matches");
  });

  it("a missing config surfaces providerDetect's named error", () => {
    const missing = fixtureRoot(null);
    rmSync(join(missing, "devenv.config"));
    const r = runTool([], { DEVENV_ROOT: missing });
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain("devenv.config not found");
    rmSync(missing, { recursive: true, force: true });
  });

  it("an azure config routes to azure's explain data", () => {
    const azureRoot = fixtureRoot("azure");
    const r = runTool(["issues"], { DEVENV_ROOT: azureRoot });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("active provider: azure");
    expect(r.stdout).toContain("reads never");
    rmSync(azureRoot, { recursive: true, force: true });
  });
});
