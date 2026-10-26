// Tests for issue-artifact-doc-id.ts — the doc_id generator. doc_id
// identity is byte-format-critical: every case here pins the exact string
// the bash tool emitted (plus the misuse exit codes).
import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const TOOL = join(fileURLToPath(new URL(".", import.meta.url)), "../../ts/issue-artifact-doc-id.ts");

function runTool(args: string[], env: Record<string, string> = {}): { status: number; stdout: string; stderr: string; output: string } {
  const r = spawnSync("node", [TOOL, ...args], {
    encoding: "utf8",
    input: "",
    env: { ...process.env, ...env },
  });
  const stdout = r.stdout ?? "";
  const stderr = r.stderr ?? "";
  return { status: r.status ?? 1, stdout, stderr, output: stdout + stderr };
}

describe("issue-artifact-doc-id", () => {
  it("generates the exact bash-tool doc_id from a slug", () => {
    const r = runTool(["--issue", "123", "--artifact-type", "spike", "--slug", "Retry Strategy", "--repo", "workinprogress-ai/devenv"]);
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toBe("dv1:workinprogress-ai/devenv:issue-123:spike:retry-strategy");
  });

  it("generates from a source file's basename (extension stripped)", () => {
    const r = runTool(["--issue", "77", "--artifact-type", "redesign", "--source-file", "Redesign--003-Auth-Flow.md", "--repo", "workinprogress-ai/devenv"]);
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toBe("dv1:workinprogress-ai/devenv:issue-77:redesign:redesign-003-auth-flow");
  });

  it("canonicalizes implementation-plan to plan in the emitted id", () => {
    const r = runTool(["--issue", "91", "--artifact-type", "implementation-plan", "--slug", "Plan-issue-91-001", "--repo", "org/repo"]);
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toBe("dv1:org/repo:issue-91:plan:plan-issue-91-001");
  });

  it("output matches the plan-parse lint regex shape", () => {
    const r = runTool(["--issue", "91", "--artifact-type", "plan", "--slug", "Plan-issue-91-001", "--repo", "workinprogress-ai/lib.cs.backing.document-data"]);
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toMatch(/^dv1:[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+:(issue-[0-9]+|local):[a-z-]+:[A-Za-z0-9_.-]+$/);
  });

  it("both slug sources is a misuse failure", () => {
    const r = runTool(["--issue", "123", "--artifact-type", "spike", "--slug", "one", "--source-file", "two.md", "--repo", "o/r"]);
    expect(r.status).toBe(2);
    expect(r.output).toContain("Only one of --slug or --source-file");
  });

  it("an invalid artifact type is a misuse failure naming the allowed set", () => {
    const r = runTool(["--issue", "123", "--artifact-type", "invalid", "--slug", "thing", "--repo", "o/r"]);
    expect(r.status).toBe(2);
    expect(r.output).toContain("Allowed values:");
  });

  it("no slug source is a misuse failure", () => {
    const r = runTool(["--issue", "123", "--artifact-type", "spike"]);
    expect(r.status).toBe(2);
    expect(r.output).toContain("One slug source is required");
  });

  it("a missing repo resolves to nothing and fails defined without DEVENV_REPO", () => {
    // Resolution has a cwd leg now (org + git-root basename), so the
    // unresolvable case needs a cwd with no git root and cleared env legs.
    const r = spawnSync("node", [TOOL, "--issue", "123", "--artifact-type", "spike", "--slug", "x"], {
      encoding: "utf8",
      cwd: tmpdir(),
      env: { ...process.env, DEVENV_REPO: "", GH_REPO: "" },
    });
    expect(r.status).toBe(2);
    expect((r.stdout ?? "") + (r.stderr ?? "")).toContain("Repository is required");
  });

  it("DEVENV_REPO resolves the repo when --repo is absent", () => {
    const r = runTool(["--issue", "5", "--artifact-type", "research", "--slug", "Demo Path"], { DEVENV_REPO: "org/demo" });
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toBe("dv1:org/demo:issue-5:research:demo-path");
  });

  it("the research type remains accepted and help lists it", () => {
    const r = runTool(["--issue", "12", "--artifact-type", "research", "--source-file", "research-003-retry-strategy.md", "--repo", "workinprogress-ai/devenv"]);
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toBe("dv1:workinprogress-ai/devenv:issue-12:research:research-003-retry-strategy");
    const help = runTool(["--help"]);
    expect(help.stdout).toContain("research");
  });

  it("an unknown flag exits 2 (canonical invalid-args contract)", () => {
    const r = runTool(["--bogus"]);
    expect(r.status).toBe(2);
  });

  it("the spike type remains accepted", () => {
    const r = runTool(["--issue", "12", "--artifact-type", "spike", "--slug", "old finding", "--repo", "o/r"]);
    expect(r.status).toBe(0);
  });
});
