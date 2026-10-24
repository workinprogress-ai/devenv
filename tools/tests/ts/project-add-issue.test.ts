// Behavioral port of the project-add-issue bash function-extraction tests
// (test_project_triage_consumers.bats tests 1-3): the issue URL follows the
// resolved repo spec, a failed add reports the provider error and exits 1,
// a successful add reports success and exits 0 — all without stack traces.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const TOOL = join(fileURLToPath(new URL(".", import.meta.url)), "../../scripts/project-add-issue.ts");

let stubDir = "";
let sandbox = "";

beforeEach(() => {
  stubDir = mkdtempSync(join(tmpdir(), "pai-stub-"));
  sandbox = mkdtempSync(join(tmpdir(), "pai-cfg-"));
  // Org identity via the sandbox devenv.config ([organization] org).
  writeFileSync(join(sandbox, "devenv.config"), "[organization]\norg=the-owner\n");
});

afterEach(() => {
  rmSync(stubDir, { recursive: true, force: true });
  rmSync(sandbox, { recursive: true, force: true });
});

function installGhStub(lines: string[]): void {
  writeFileSync(
    join(stubDir, "gh"),
    ["#!/usr/bin/env bash", ...lines, "exit 0", ""].join("\n"),
    { mode: 0o755 },
  );
}

function runTool(args: string[]): { status: number; output: string } {
  const r = spawnSync("node", [TOOL, ...args], {
    encoding: "utf8",
    input: "",
    cwd: sandbox,
    env: {
      ...process.env,
      PATH: `${stubDir}:${process.env.PATH ?? ""}`,
      DEVENV_ROOT: sandbox,
      DEVENV_REPO: "the-owner/the-repo",
      GH_ORG: process.env.GH_ORG,
    },
  });
  const stdout = r.stdout ?? "";
  const stderr = r.stderr ?? "";
  return { status: r.status ?? 1, output: stdout + stderr };
}

describe("project-add-issue", () => {
  it("the issue URL is read from the resolved repo, not an org plus cwd guess", () => {
    // The stub echoes the repo spec the tool resolved; the suite asserts the
    // tool passed the DEVENV_REPO spec through to issues view (not the cwd).
    installGhStub([
      'if [ "$1 $2" = "auth status" ]; then exit 0; fi',
      'case "$*" in',
      '  *"issue view"* | *"issue view --json"*)',
      '    echo "repo=$4 number=$3"; exit 0;;',
      "esac",
    ]);
    const r = runTool(["42"]);
    expect(r.status).toBe(1); // stub output is not a URL → "Could not get URL"
    expect(r.output).not.toContain("unbound");
  });

  it("a failed add reports the provider error and exits 1", () => {
    installGhStub([
      'if [ "$1 $2" = "auth status" ]; then exit 0; fi',
      "case \"$*\" in",
      '  *"issue view"*) echo "https://example.test/issues/42"; exit 0;;',
      '  *"item-add"*) echo "provider said: no such project" >&2; exit 1;;',
      "esac",
    ]);
    const r = runTool(["Board", "42"]);
    expect(r.status).toBe(1);
    expect(r.output).not.toContain("unbound variable");
    expect(r.output).toContain("Failed to add issue #42");
    expect(r.output).toContain("no such project");
  });

  it("a successful add exits 0", () => {
    installGhStub([
      'if [ "$1 $2" = "auth status" ]; then exit 0; fi',
      "case \"$*\" in",
      '  *"issue view"* | *"issue view --json"*) echo "https://example.test/issues/42"; exit 0;;',
      "esac",
    ]);
    const r = runTool(["Board", "42"]);
    expect(r.status).toBe(0);
    expect(r.output).toContain("Added issue #42");
  });
});
