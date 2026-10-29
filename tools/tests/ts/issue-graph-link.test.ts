// Tests for issue-graph-link.ts (15.21): post-hoc sub-issue linking with
// same-repo and cross-repo references over a stubbed gh.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const TOOL = join(fileURLToPath(new URL(".", import.meta.url)), "../../ts/issue-graph-link.ts");

let stubDir = "";
let repoRoot = "";

function installGhStub(): void {
  writeFileSync(
    join(stubDir, "gh"),
    [
      "#!/usr/bin/env bash",
      'printf \'%s\\n\' "gh $*" >> "__LOG__"',
      'if [ "$1 $2" = "auth status" ]; then exit 0; fi',
      'case "$*" in',
      '  *"repo view"*) echo \'{"name":"repo"}\';;',
      '  *"issue view"*"--json number"*) echo \'{"number":1}\';;',
      `  *"graphql"*"issue(number:"*)`,
      '    repo=$(printf \'%s\\n\' "$*" | sed -n \'s/.*r=\\([A-Za-z0-9._-]*\\).*/\\1/p\')',
      '    echo "NODEID_$repo";;',

      '  *"graphql"*addSubIssue*) echo \'{"data":{"addSubIssue":{"issue":{"number":77}}}}\';;',
      '  *"graphql"*removeSubIssue*) echo \'{"data":{"removeSubIssue":{"issue":{"number":77}}}}\';;',
      "  *) ;;",
      "esac",
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
  return { status: r.status ?? 1, stdout: r.stdout ?? "", stderr: r.stderr ?? "", output: (r.stdout ?? "") + (r.stderr ?? "") };
}

describe("issue-graph-link", () => {
  beforeEach(() => {
    stubDir = mkdtempSync(join(tmpdir(), "igl-stub-"));
    repoRoot = mkdtempSync(join(tmpdir(), "igl-repo-"));
    installGhStub();
  });
  afterEach(() => {
    rmSync(stubDir, { recursive: true, force: true });
    rmSync(repoRoot, { recursive: true, force: true });
  });

  it("same-repo link: both node ids resolve against the target repo", () => {
    const r = runTool(["50", "51"]);
    expect(r.status).toBe(0);
    const calls = ghCalls().join("\n");
    expect(calls).toContain("addSubIssue");
    // exactly two node-id lookups, both against org/repo
    const lookups = ghCalls().filter((c) => c.includes("issue(number:"));
    expect(lookups.length).toBe(2);
    expect(lookups[0]).toContain("o=org");
    expect(lookups[0]).toContain("r=repo");
  });

  it("cross-repo parent: the parent lookup hits the named repo", () => {
    const r = runTool(["org/other#50", "51"]);
    expect(r.status).toBe(0);
    const lookups = ghCalls().filter((c) => c.includes("issue(number:"));
    expect(lookups.length).toBe(2);
    expect(lookups[0]).toContain("r=other");
    expect(lookups[1]).toContain("r=repo");
  });

  it("cross-repo child: the child lookup hits the named repo", () => {
    const r = runTool(["50", "org/other#51"]);
    expect(r.status).toBe(0);
    const lookups = ghCalls().filter((c) => c.includes("issue(number:"));
    expect(lookups.length).toBe(2);
    expect(lookups[0]).toContain("r=repo");
    expect(lookups[1]).toContain("r=other");
  });

  it("--unlink issues removeSubIssue", () => {
    const r = runTool(["50", "51", "--unlink"]);
    expect(r.status).toBe(0);
    expect(ghCalls().join("\n")).toContain("removeSubIssue");
  });

  it("needs exactly two references", () => {
    const r = runTool(["50"]);
    expect(r.status).toBe(2);
    expect(r.output).toContain("Parent and child references are required");
  });

  it("an unparseable reference is a usage error", () => {
    const r = runTool(["bogus", "51"]);
    expect(r.status).toBe(2);
    expect(r.output).toContain("Invalid reference: bogus");
  });
});
