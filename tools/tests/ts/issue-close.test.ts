// Tests for issue-close.ts — the close/reopen contract over a stubbed gh
// with a call log: action parsing, existence verification, reason/comment
// pass-through, dry-run, multi-issue failure accumulation, and refusals.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const TOOL = join(fileURLToPath(new URL(".", import.meta.url)), "../../ts/issue-close.ts");

let stubDir = "";
let repoRoot = "";

function installGhStub(opts: { failClose?: boolean; missingIssue?: boolean } = {}): void {
  const lines = [
    "#!/usr/bin/env bash",
    'printf \'%s\\n\' "gh $*" >> "__LOG__"',
    `if [ "${opts.missingIssue ? "1" : "0"}" = "1" ] && [ "$1 $2" = "issue view" ]; then exit 1; fi`,
    `if [ "${opts.failClose ? "1" : "0"}" = "1" ] && [ "$1 $2" = "issue close" ]; then echo "boom" >&2; exit 1; fi`,
    "exit 0",
    "",
  ];
  writeFileSync(join(stubDir, "gh"), lines.join("\n").replaceAll("__LOG__", join(stubDir, "calls.log")), { mode: 0o755 });
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

describe("issue-close", () => {
  beforeEach(() => {
    stubDir = mkdtempSync(join(tmpdir(), "icx-stub-"));
    repoRoot = mkdtempSync(join(tmpdir(), "icx-repo-"));
    installGhStub();
    process.env.PATH = `${stubDir}:${process.env.PATH ?? ""}`;
  });

  afterEach(() => {
    rmSync(stubDir, { recursive: true, force: true });
    rmSync(repoRoot, { recursive: true, force: true });
  });

  it("default action closes the issue after verifying it exists", () => {
    const r = runTool(["123"]);
    expect(r.status).toBe(0);
    const calls = ghCalls().join("\n");
    expect(calls).toContain("issue view 123 -R org/repo --json number");
    expect(calls).toContain("issue close 123 -R org/repo");
  });

  it("a leading reopen word switches the action", () => {
    const r = runTool(["reopen", "123", "--comment", "back"]);
    expect(r.status).toBe(0);
    const calls = ghCalls().join("\n");
    expect(calls).toContain("issue reopen 123 -R org/repo --comment back");
  });

  it("--reason and --comment pass through to the close call", () => {
    const r = runTool(["123", "--reason", "completed", "--comment", "done"]);
    expect(r.status).toBe(0);
    const calls = ghCalls().join("\n");
    expect(calls).toContain("--reason completed");
    expect(calls).toContain("--comment done");
  });

  it("dry-run makes no mutating call", () => {
    const r = runTool(["123", "--dry-run"]);
    expect(r.status).toBe(0);
    expect(r.output).toContain("[DRY RUN] Would close issue #123");
    expect(ghCalls().some((c) => c.includes("issue close"))).toBe(false);
  });

  it("a missing issue is reported and the tool exits 1", () => {
    installGhStub({ missingIssue: true });
    const r = runTool(["123"]);
    expect(r.status).toBe(1);
    expect(r.output).toContain("Issue #123 not found");
  });

  it("failures accumulate across multiple issues", () => {
    installGhStub({ missingIssue: true });
    const r = runTool(["1", "2"]);
    expect(r.status).toBe(1);
    expect(r.output).toContain("Issue #1 not found");
    expect(r.output).toContain("Issue #2 not found");
  });

  it("--reason with reopen is refused (close-only flag)", () => {
    const r = runTool(["reopen", "123", "--reason", "completed"]);
    expect(r.status).toBe(1);
    expect(r.output).toContain("--reason can only be used with close action");
  });

  it("no issue numbers is a misuse failure", () => {
    expect(runTool([]).status).toBe(2);
  });

  it("a non-numeric issue token is a misuse failure", () => {
    const r = runTool(["abc"]);
    expect(r.status).toBe(2);
    expect(r.output).toContain("Unknown option or invalid issue number");
  });

  it("--select refuses cleanly without a TTY (picker deferred to the ui layer)", () => {
    const r = runTool(["--select"]);
    expect(r.status).toBe(2);
    expect(r.output).toContain("interactive terminal");
  });

  it("an unknown flag exits 2", () => {
    expect(runTool(["123", "--bogus"]).status).toBe(2);
  });
});
