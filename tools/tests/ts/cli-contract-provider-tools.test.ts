// CLI contract for the provider-facing tools (pipelines-*, project-*, release-list,
// artifacts-list, policy-export and the issue family):
//   - `--help` / `--version` exit 0 on stdout and never contact the provider;
//   - an unknown flag is misuse (exit 2) with a "Use --help" hint, before any
//     provider call;
//   - invalid argument values exit 2 and never reach the provider;
//   - API failures use the API-failure code.
// Every provider binary is a stub that records each invocation and fails, so a
// regression that touches gh or az shows up as a recorded call.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { pathWithStubs, rmrf, runTool, stubCalls, stubCli, tmpToolboxRoot, tmpDir, CALLS_LOG_NAME } from "./harness/index.ts";
import { EXIT_API_FAILURE, EXIT_MISUSE, EXIT_SUCCESS } from "../../lib/core/exit-codes.ts";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const TOOLS = [
  "artifacts-list",
  "policy-export",
  "project-add-issue",
  "project-list-for-issue",
  "project-update-issue",
  "release-list",
  "pipelines-artifacts",
  "pipelines-list",
  "pipelines-status",
  "pipelines-run",
  "pipelines-rerun",
  "pipelines-watch",
  "issue-artifact-select",
  "issue-create",
  "issue-create-batch",
  "issue-update",
  "issue-list",
  "issue-search",
  "issue-select",
  "issue-types",
  "issue-comment-update",
];

let stubDir = "";
let root = "";

/** Provider stubs: record every call to <stubDir>/calls.log. In "deny" mode
 * every call fails (so any contact is both visible and harmless); in "ok" mode
 * calls succeed with empty JSON-ish output. */
function installProviders(mode: "deny" | "ok", extra = ""): void {
  const log = join(stubDir, CALLS_LOG_NAME);
  for (const name of ["gh", "az"]) {
    stubCli(
      stubDir,
      name,
      [
        "#!/usr/bin/env bash",
        `printf '%s\\n' "${name} $*" >> "${log}"`,
        extra,
        mode === "deny" ? "exit 1" : '[ "$1" = "auth" ] && exit 0; echo "[]"; exit 0',
        "",
      ].join("\n"),
    );
  }
}

function run(tool: string, args: string[], env: Record<string, string> = {}): { status: number; stdout: string; stderr: string; output: string } {
  return runTool(tool, args, {
    env: {
      PATH: pathWithStubs(stubDir),
      DEVENV_ROOT: root,
      DEVENV_ROOT_SET: "1",
      DEVENV_REPO: "acme/widgets",
      ...env,
    },
    cwd: root,
  });
}

beforeEach(() => {
  stubDir = tmpDir("cli-contract-provider-bin");
  root = tmpToolboxRoot("cli-contract-provider-root");
  // A throwaway repo: tools resolve the working repo from the cwd.
  spawnSync("git", ["init", "-q"], { cwd: root });
  installProviders("deny");
});

afterEach(() => {
  rmrf(stubDir);
  rmrf(root);
});

describe.each(TOOLS)("%s house flags", (tool) => {
  it("--help exits 0 with usage on stdout and never contacts the provider", () => {
    const r = run(tool, ["--help"]);
    expect(r.status).toBe(EXIT_SUCCESS);
    expect(r.stdout).toContain("Usage:");
    expect(stubCalls(stubDir)).toEqual([]);
  });

  it("--version exits 0 on stdout and never contacts the provider", () => {
    const r = run(tool, ["--version"]);
    expect(r.status).toBe(EXIT_SUCCESS);
    expect(r.stdout.trim().length).toBeGreaterThan(0);
    expect(stubCalls(stubDir)).toEqual([]);
  });

  it("an unknown flag is misuse with a --help hint and no provider call", () => {
    const r = run(tool, ["--no-such-flag"]);
    expect(r.status).toBe(EXIT_MISUSE);
    expect(r.output).toContain("Use --help");
    expect(stubCalls(stubDir)).toEqual([]);
  });
});

describe("invalid arguments exit 2 before any provider call", () => {
  const cases: Array<[string, string[]]> = [
    ["artifacts-list", ["--owner", "acme", "--sort", "bogus"]],
    ["artifacts-list", ["--owner", "acme", "--format", "bogus"]],
    ["policy-export", ["abc"]],
    ["policy-export", ["1", "2"]],
    ["project-add-issue", []],
    ["project-add-issue", ["Board", "abc"]],
    ["project-add-issue", ["Board"]],
    ["project-add-issue", ["Board", "1", "--field", "NoEquals"]],
    ["project-list-for-issue", []],
    ["project-list-for-issue", ["abc"]],
    ["project-update-issue", ["Board", "1"]],
    ["project-update-issue", ["Board", "--status", "Ready"]],
    ["project-update-issue", ["Board", "1", "--status", "NotAStatus"]],
    ["project-update-issue", ["Board", "1", "--field", "NoEquals"]],
    ["project-update-issue", ["--all-projects", "1", "--status", "Ready", "--field", "A=B"]],
    ["release-list", ["--limit", "abc"]],
    ["release-list", ["--format", "bogus"]],
    ["pipelines-run", ["--repo", "acme/widgets"]],
    ["pipelines-run", ["ci.yml"]],
    ["pipelines-run", ["ci.yml", "--repo", "acme/widgets", "--input", "NoEquals"]],
    ["pipelines-rerun", ["abc", "--repo", "acme/widgets"]],
    ["pipelines-rerun", ["--repo", "acme/widgets"]],
    ["pipelines-watch", ["1", "2", "--repo", "acme/widgets"]],
    ["pipelines-watch", ["1"]],
    ["pipelines-status", ["--limit", "abc"]],
    ["pipelines-artifacts", ["abc", "--repo", "acme/widgets"]],
    ["pipelines-artifacts", ["1", "--repo", "not-a-repo-spec"]],
    ["issue-create-batch", []],
    ["issue-create-batch", ["--file", "a.yml", "--issue", "title=x"]],
    ["issue-list", ["--type", "Narrative"]],
    ["issue-search", ["--type", "Narrative", "term"]],
    ["issue-select", ["--type", "Narrative"]],
    ["issue-search", ["--limit", "abc", "term"]],
    ["issue-types", ["--format", "bogus"]],
  ];
  it.each(cases)("%s %j", (tool, args) => {
    const r = run(tool, args);
    expect(r.status, r.output).toBe(EXIT_MISUSE);
    expect(stubCalls(stubDir)).toEqual([]);
  });
});

describe("pipelines tools no longer advertise flags they ignore", () => {
  it.each(["pipelines-list", "pipelines-status"])("%s --help advertises neither --dry-run nor --devenv, and rejects --dry-run", (tool) => {
    const help = run(tool, ["--help"]);
    expect(help.stdout).not.toContain("--dry-run");
    expect(help.stdout).not.toContain("--devenv");
    expect(run(tool, ["--dry-run"]).status).toBe(EXIT_MISUSE);
  });

  it.each(["pipelines-run", "pipelines-rerun", "pipelines-watch"])("%s --help does not advertise --devenv", (tool) => {
    expect(run(tool, ["--help"]).stdout).not.toContain("--devenv");
  });
});

describe("advertised short flags work", () => {
  beforeEach(() => installProviders("ok"));

  it("pipelines-status accepts -r, -s and -w", () => {
    const r = run("pipelines-status", ["-r", "x", "-s", "failure", "-w", "CI"]);
    expect(r.output).not.toMatch(/Unknown option/i);
    expect(r.status).toBe(EXIT_SUCCESS);
  });

  it("pipelines-list accepts -r", () => {
    const r = run("pipelines-list", ["-r", "x"]);
    expect(r.output).not.toMatch(/Unknown option/i);
    expect(r.status).toBe(EXIT_SUCCESS);
  });
});

describe("pipelines-artifacts --download --dry-run", () => {
  it("does not download", () => {
    installProviders("ok");
    const r = run("pipelines-artifacts", ["123", "--repo", "acme/widgets", "--download", "--name", "cov", "--dry-run"]);
    expect(r.status).toBe(EXIT_SUCCESS);
    expect(r.output).toContain("DRY RUN");
    expect(stubCalls(stubDir).filter((l) => l.includes("download"))).toEqual([]);
  });
});

describe("pipelines-run --input", () => {
  it("passes the value as a raw field so @file is never read from disk", () => {
    installProviders("ok");
    const r = run("pipelines-run", ["ci.yml", "--repo", "acme/widgets", "--input", "NOTE=@/etc/passwd"]);
    expect(r.status).toBe(EXIT_SUCCESS);
    const call = stubCalls(stubDir).find((l) => l.includes("workflow run")) ?? "";
    expect(call).toContain("-f NOTE=@/etc/passwd");
    expect(call).not.toMatch(/ -F | --field /);
  });
});

describe("failures use the API-failure code", () => {
  it("issue-comment-update: a missing comment exits 4", () => {
    installProviders("deny", '[ "$1" = "auth" ] && [ "$2" = "status" ] && exit 0');
    const r = run("issue-comment-update", ["777", "--body", "x"]);
    expect(r.status, r.output).toBe(EXIT_API_FAILURE);
  });

  it("issue-comment-update: a failed PATCH exits 4", () => {
    installProviders(
      "ok",
      'case "$*" in *PATCH*) exit 1;; *comments/777*) echo \'{"id": 777}\'; exit 0;; esac',
    );
    const r = run("issue-comment-update", ["777", "--body", "x"]);
    expect(r.status, r.output).toBe(EXIT_API_FAILURE);
  });

  it("issue-artifact-select: an unexpected crash exits 4, not the ambiguity code", () => {
    // A non-array comments payload makes the enumeration throw.
    installProviders("ok", '[ "$1" = "auth" ] || { echo "{}"; exit 0; }');
    const r = run("issue-artifact-select", ["--issue", "42"]);
    expect(r.status, r.output).toBe(EXIT_API_FAILURE);
  });

  it("issue-types: a failed query exits 4", () => {
    installProviders("deny", '[ "$1" = "auth" ] && [ "$2" = "status" ] && exit 0');
    const r = run("issue-types", []);
    expect(r.status, r.output).toBe(EXIT_API_FAILURE);
  });
});

describe("issue-create / issue-create-batch bad flag", () => {
  it.each(["issue-create", "issue-create-batch"])("%s --help does not wait on stdin", (tool) => {
    const r = run(tool, ["--help"]);
    expect(r.status).toBe(EXIT_SUCCESS);
    expect(stubCalls(stubDir)).toEqual([]);
  });
});

