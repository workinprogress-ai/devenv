// Tests for issue-list.ts — filter pass-through over a stubbed gh with a
// call log: repo passed exactly once, filters after the repo, format paths.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const TOOL = join(fileURLToPath(new URL(".", import.meta.url)), "../../ts/issue-list.ts");

let stubDir = "";
let repoRoot = "";

function installGhStub(listOut = "[]"): void {
  writeFileSync(
    join(stubDir, "gh"),
    [
      "#!/usr/bin/env bash",
      'printf \'%s\\n\' "gh $*" >> "__LOG__"',
      `case "$*" in`,
      `  "issue list"*) echo '${listOut.replace(/'/g, "'\\''")}' ;;`,
      `  *) echo '{}' ;;`,
      `esac`,
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

describe("issue-list", () => {
  beforeEach(() => {
    stubDir = mkdtempSync(join(tmpdir(), "ilx-stub-"));
    repoRoot = mkdtempSync(join(tmpdir(), "ilx-repo-"));
    installGhStub();
  });

  afterEach(() => {
    rmSync(stubDir, { recursive: true, force: true });
    rmSync(repoRoot, { recursive: true, force: true });
  });

  it("passes the repo to the list verb exactly once, first", () => {
    const r = runTool(["--state", "all", "--limit", "30"]);
    expect(r.status).toBe(0);
    const calls = ghCalls().join("\n");
    expect(calls).toContain("issue list -R org/repo --state all --limit 30");
    expect(calls.split("-R org/repo").length - 1).toBe(1);
  });

  it("keeps its filter flags after the repo", () => {
    const r = runTool(["--state", "all", "--limit", "30"]);
    expect(r.status).toBe(0);
    const idxRepo = ghCalls().join("\n").indexOf("-R org/repo");
    const idxState = ghCalls().join("\n").indexOf("--state");
    expect(idxState).toBeGreaterThan(idxRepo);
  });

  it("forwards label, assignee, milestone, author filters", () => {
    const r = runTool(["--label", "bug", "--assignee", "octocat", "--milestone", "M1", "--author", "alice"]);
    expect(r.status).toBe(0);
    const calls = ghCalls().join("\n");
    expect(calls).toContain("--label bug");
    expect(calls).toContain("--assignee octocat");
    expect(calls).toContain("--milestone M1");
    expect(calls).toContain("--author alice");
  });

  it("simple format renders number - title lines", () => {
    installGhStub('[{"number":7,"title":"Widget broke"},{"number":9,"title":"Other"}]');
    const r = runTool(["--format", "simple"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("#7 - Widget broke");
    expect(r.stdout).toContain("#9 - Other");
  });

  it("an invalid format is a named usage error", () => {
    const r = runTool(["--format", "yaml"]);
    expect(r.status).toBe(2);
    expect(r.output).toContain("Invalid format: yaml");
  });
});
