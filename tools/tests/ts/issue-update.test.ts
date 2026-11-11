// Tests for issue-update.ts — the single-edit contract over a stubbed gh:
// existence verification, type normalization, add/remove filters, state
// transitions, and refusal paths.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runTool as runHarness, pathWithStubs } from "./harness/index.ts";

const TOOL = "issue-update";

let stubDir = "";
let repoRoot = "";

function installGhStub(opts: { missingIssue?: boolean } = {}): void {
  writeFileSync(
    join(stubDir, "gh"),
    [
      "#!/usr/bin/env bash",
      'printf \'%s\\n\' "gh $*" >> "__LOG__"',
      `if [ "${opts.missingIssue ? "1" : "0"}" = "1" ] && [ "$1 $2" = "issue view" ]; then echo "GraphQL: Could not resolve to an Issue with the number of $3." >&2; exit 1; fi`,
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
  // Thin wrapper over the shared harness: the suite keeps its name and
  // env shape; the spawn boilerplate lives in one place.
  return runHarness(TOOL, args, { env: { PATH: pathWithStubs(stubDir), DEVENV_REPO: "org/repo" }, cwd: repoRoot });
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
    expect(r.status).toBe(2);
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

  it("every value of each repeatable edit flag reaches gh", () => {
    const r = runTool([
      "42",
      "--add-label", "a1", "--add-label", "a2",
      "--remove-label", "r1", "--remove-label", "r2",
      "--add-assignee", "u1", "--add-assignee", "u2",
      "--remove-assignee", "v1", "--remove-assignee", "v2",
    ]);
    expect(r.status).toBe(0);
    const edit = ghCalls().find((c) => c.startsWith("gh issue edit 42")) ?? "";
    for (const v of ["a1", "a2"]) expect(edit).toContain(`--add-label ${v}`);
    for (const v of ["r1", "r2"]) expect(edit).toContain(`--remove-label ${v}`);
    for (const v of ["u1", "u2"]) expect(edit).toContain(`--add-assignee ${v}`);
    for (const v of ["v1", "v2"]) expect(edit).toContain(`--remove-assignee ${v}`);
  });

  it("every value of the repeatable blocked-by flags is honored", () => {
    const r = runTool([
      "42", "--dry-run",
      "--add-blocked-by", "7", "--add-blocked-by", "9",
      "--remove-blocked-by", "11", "--remove-blocked-by", "13",
    ]);
    expect(r.status).toBe(0);
    for (const n of ["7", "9"]) expect(r.output).toContain(`blocked by #${n}`);
    for (const n of ["11", "13"]) expect(r.output).toContain(`un-record #42 blocked by #${n}`);
    const viewed = ghCalls().filter((c) => c.startsWith("gh issue view"));
    for (const n of ["7", "9", "11", "13"]) expect(viewed.join("\n")).toContain(`issue view ${n}`);
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
