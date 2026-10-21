// Tests for issue-update.ts — the single-edit contract over a stubbed gh:
// existence verification, type normalization, add/remove filters, state
// transitions, and refusal paths.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const TOOL = join(fileURLToPath(new URL(".", import.meta.url)), "../../scripts/issue-update.ts");

let stubDir = "";
let repoRoot = "";

function installGhStub(opts: { missingIssue?: boolean } = {}): void {
  writeFileSync(
    join(stubDir, "gh"),
    [
      "#!/usr/bin/env bash",
      'printf \'%s\\n\' "gh $*" >> "__LOG__"',
      `if [ "${opts.missingIssue ? "1" : "0"}" = "1" ] && [ "$1 $2" = "issue view" ]; then exit 1; fi`,
      "exit 0",
      "",
    ].join("\n").replaceAll("__LOG__", join(stubDir, "calls.log")),
    { mode: 0o755 },
  );
  writeFileSync(
    join(stubDir, "git"),
    [
      "#!/usr/bin/env bash",
      `if [ "$1" = "rev-parse" ]; then printf '%s\\n' "${repoRoot}"; exit 0; fi`,
      "exit 0",
      "",
    ].join("\n"),
    { mode: 0o755 },
  );
}

function ghCalls(): string[] {
  const log = join(stubDir, "calls.log");
  if (!existsSync(log)) return [];
  return readFileSync(log, "utf8").split("\n").filter((l) => l.startsWith("gh "));
}

function runTool(args: string[]): { status: number; stdout: string; stderr: string; output: string } {
  const r = spawnSync("node", [TOOL, ...args], {
    encoding: "utf8",
    input: "",
    cwd: repoRoot,
    env: { ...process.env, PATH: `${stubDir}:${process.env.PATH ?? ""}`, DEVENV_REPO: "org/repo" },
  });
  const stdout = r.stdout ?? "";
  const stderr = r.stderr ?? "";
  return { status: r.status ?? 1, stdout, stderr, output: stdout + stderr };
}

describe("issue-update", () => {
  beforeEach(() => {
    stubDir = mkdtempSync(join(tmpdir(), "iux-stub-"));
    repoRoot = mkdtempSync(join(tmpdir(), "iux-repo-"));
    installGhStub();
  });

  afterEach(() => {
    rmSync(stubDir, { recursive: true, force: true });
    rmSync(repoRoot, { recursive: true, force: true });
  });

  it("verifies existence, then applies a single edit", () => {
    const r = runTool(["123", "--title", "New name"]);
    expect(r.status).toBe(0);
    const calls = ghCalls().join("\n");
    expect(calls).toContain("issue view 123");
    expect(calls).toContain("issue edit 123 -R org/repo --title New name");
  });

  it("normalizes canonical types case-insensitively", () => {
    const r = runTool(["123", "--type", "bug"]);
    expect(r.status).toBe(0);
    expect(ghCalls().join("\n")).toContain("--type Bug");
  });

  it("rejects an invalid type naming the allowed set", () => {
    const r = runTool(["123", "--type", "Narrative"]);
    expect(r.status).toBe(1);
    expect(r.output).toContain("Invalid issue type: Narrative");
    expect(r.output).toContain("Bug, Feature, Task, Epic");
    expect(ghCalls().join("\n")).not.toContain("issue edit");
  });
  it("a missing issue is an API failure", () => {
    installGhStub({ missingIssue: true });
    const r = runTool(["123", "--title", "x"]);
    expect(r.status).toBe(4);
    expect(r.output).toContain("Issue #123 not found");
  });

  it("a missing issue number is a usage error", () => {
    const r = runTool(["--title", "x"]);
    expect(r.status).toBe(2);
    expect(r.output).toContain("Issue number is required");
  });

  it("add-label and remove-label ride the same edit", () => {
    const r = runTool(["42", "--add-label", "bug", "--remove-label", "wip"]);
    expect(r.status).toBe(0);
    const calls = ghCalls().join("\n");
    expect(calls).toContain("--add-label bug");
    expect(calls).toContain("--remove-label wip");
  });

  it("state closed closes, state reopen reopens", () => {
    const r = runTool(["42", "--state", "closed"]);
    expect(r.status).toBe(0);
    expect(ghCalls().join("\n")).toContain("issue close 42");
    const r2 = runTool(["42", "--state", "reopen"]);
    expect(r2.status).toBe(0);
    expect(ghCalls().join("\n")).toContain("issue reopen 42");
  });

  it("dry-run shows the plan without mutating", () => {
    const r = runTool(["42", "--title", "x", "--dry-run"]);
    expect(r.status).toBe(0);
    expect(r.output).toContain("[DRY RUN]");
    expect(ghCalls().join("\n")).not.toContain("issue edit");
  });

  it("milestone none clears the milestone", () => {
    const r = runTool(["42", "--milestone", "none"]);
    expect(r.status).toBe(0);
    // gh's clear form: the flag followed by an empty value argument.
    expect(ghCalls().join("\n")).toMatch(/--milestone (\s*$|\n|\s*")/m);
    expect(ghCalls().join("\n")).not.toContain('--milestone none');
  });
});
