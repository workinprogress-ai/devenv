// Tests for issue-triage.ts — the scripted bundle-apply surface over a
// stubbed gh: bundle options, per-edit failure accounting, and wizard
// refusal without a TTY.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const TOOL = join(fileURLToPath(new URL(".", import.meta.url)), "../../ts/issue-triage.ts");

let stubDir = "";
let repoRoot = "";

function installGhStub(opts: { failEdits?: boolean } = {}): void {
  const lines = [
    "#!/usr/bin/env bash",
    'printf \'%s\\n\' "gh $*" >> "__LOG__"',
    `if [ "${opts.failEdits ? "1" : "0"}" = "1" ] && [ "$1 $2" = "issue edit" ]; then echo "boom" >&2; exit 1; fi`,
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
    // The dispatcher makes its own gh calls; the bundle itself must not edit.
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
    expect(r.status).toBe(1);
    expect(r.output).toContain("no bundle options given");
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
