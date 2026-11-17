// Tests for issue-triage.ts — the scripted bundle-apply surface over a
// stubbed gh: bundle options, per-edit failure accounting, and wizard
// refusal without a TTY.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runTool as runHarness, pathWithStubs } from "./harness/index.ts";

const TOOL = "issue-triage";

let stubDir = "";
let repoRoot = "";

function installGhStub(opts: { failEdits?: boolean } = {}): void {
  const lines = [
    "#!/usr/bin/env bash",
    'printf \'%s\\n\' "gh $*" >> "__LOG__"',
    `if [ "${opts.failEdits ? "1" : "0"}" = "1" ] && [ "$1 $2" = "issue edit" ]; then echo "boom" >&2; exit 1; fi`,
    // The --triage-complete status write queries the issue's project cards.
    `case "$*" in *projectItems*) echo '{"data":{"resource":{"projectItems":{"nodes":[]}}}}' ;; esac`,
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
  // Thin wrapper over the shared harness: the suite keeps its name and
  // env shape; the spawn boilerplate lives in one place.
  return runHarness(TOOL, args, { env: { PATH: pathWithStubs(stubDir), DEVENV_REPO: "org/repo" }, cwd: repoRoot });
}

describe("issue-triage", () => {
  beforeEach(() => {
    stubDir = mkdtempSync(join(tmpdir(), "itx-stub-"));
    repoRoot = mkdtempSync(join(tmpdir(), "itx-repo-"));
    installGhStub();
  });

  afterEach(() => {
    rmSync(stubDir, { recursive: true, force: true });
    rmSync(repoRoot, { recursive: true, force: true });
  });

  it("applies a title bundle to one issue", () => {
    const r = runTool(["123", "--title", "New name"]);
    expect(r.status).toBe(0);
    const calls = ghCalls().join("\n");
    expect(calls).toContain("issue edit 123 -R org/repo");
    expect(calls).toContain("--title New name");
  });

  it("applies milestone and assignee", () => {
    const r = runTool(["7", "--milestone", "Sprint 9", "--assignee", "octocat"]);
    expect(r.status).toBe(0);
    const calls = ghCalls().join("\n");
    expect(calls).toContain("--milestone Sprint 9");
    expect(calls).toContain("--add-assignee octocat");
  });

  it("applies repeatable labels", () => {
    const r = runTool(["5", "--label", "bug", "--label", "p1"]);
    expect(r.status).toBe(0);
    const calls = ghCalls().join("\n");
    expect(calls).toContain("--add-label bug");
    expect(calls).toContain("--add-label p1");
  });

  it("applies a body from --body-file", () => {
    const body = join(stubDir, "body.md");
    writeFileSync(body, "Full body text");
    const r = runTool(["5", "--body-file", body]);
    expect(r.status).toBe(0);
    expect(ghCalls().join("\n")).toContain("--body-file");
  });

  it("fires --triage-complete against the dispatcher", () => {
    const r = runTool(["9", "--triage-complete"]);
    expect(r.status).toBe(0);
    expect(r.output).not.toContain("not found");
    expect(r.output).not.toContain("signal failed");
    // The event write makes its own gh calls; the bundle itself must not edit.
    expect(ghCalls().some((c) => c.includes("issue edit"))).toBe(false);
  });

  it("reports a per-edit failure and exits non-zero", () => {
    installGhStub({ failEdits: true });
    const r = runTool(["123", "--title", "x"]);
    expect(r.status).toBe(1);
    expect(r.output).toContain("title update failed");
  });

  it("refuses with no bundle options", () => {
    const r = runTool(["123"]);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("no bundle options given");
    expect(ghCalls()).toEqual([]);
  });

  it("accepts the --name=value form for bundle options", () => {
    const r = runTool(["123", "--title=New name", "--milestone=Sprint 9"]);
    expect(r.status).toBe(0);
    const calls = ghCalls().join("\n");
    expect(calls).toContain("--title New name");
    expect(calls).toContain("--milestone Sprint 9");
  });

  it("a missing --body-file is refused before any issue is edited", () => {
    const r = runTool(["5", "6", "--title", "x", "--body-file", join(stubDir, "nope.md")]);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("nope.md");
    expect(ghCalls()).toEqual([]);
  });

  it("fails without issue numbers or wizard TTY", () => {
    const r = runTool([]);
    expect(r.status).toBe(2);
    expect(r.output).toContain("interactive terminal");
  });

  it("rejects unknown positional tokens as named errors", () => {
    const r = runTool(["--wat"]);
    expect(r.status).toBe(2);
    expect(r.output).toContain("Unknown option: --wat");
  });
});
