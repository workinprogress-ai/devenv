// pipelines-status: results of the repositories that worked are printed, each
// failing repository is named on stderr, and any failure exits with the
// API-failure code. The gh stub answers per repository through -R.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { spawnSync } from "node:child_process";
import { pathWithStubs, rmrf, runTool, stubCli, tmpDir, tmpToolboxRoot } from "./harness/index.ts";
import { EXIT_API_FAILURE, EXIT_SUCCESS } from "../../lib/core/exit-codes.ts";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

let stubDir = "";
let root = "";

const GOOD_RUN = {
  workflowName: "CI",
  status: "completed",
  conclusion: "success",
  headBranch: "main",
  updatedAt: "2026-01-02T03:04:05Z",
  url: "https://example.invalid/run/1",
  databaseId: 1,
};

/** Install a gh stub: `repo list` names the given repositories; `run list -R
 * test-org/<name>` behaves per the repository's behaviour (ok, bad, junk, null). */
function installGh(repos: Record<string, "ok" | "bad" | "junk" | "null">): void {
  const names = Object.keys(repos);
  const listJson = JSON.stringify(names.map((name) => ({ name })));
  const cases = names
    .map((name) => {
      switch (repos[name]) {
        case "ok":
          return `  *"-R test-org/${name} "*|*"-R test-org/${name}") echo '${JSON.stringify([GOOD_RUN])}' ;;`;
        case "bad":
          return `  *"-R test-org/${name} "*|*"-R test-org/${name}") echo "boom for ${name}" >&2; exit 1 ;;`;
        case "junk":
          return `  *"-R test-org/${name} "*|*"-R test-org/${name}") echo "not json at all" ;;`;
        default:
          return `  *"-R test-org/${name} "*|*"-R test-org/${name}") echo "null" ;;`;
      }
    })
    .join("\n");
  stubCli(
    stubDir,
    "gh",
    [
      "#!/usr/bin/env bash",
      'if [ "$1" = "auth" ]; then exit 0; fi',
      'if [ "$1" = "repo" ] && [ "$2" = "list" ]; then',
      `  echo '${listJson}'`,
      "  exit 0",
      "fi",
      'if [ "$1" = "run" ] && [ "$2" = "list" ]; then',
      '  case "$*" in',
      cases,
      "  esac",
      "  exit 0",
      "fi",
      "exit 0",
      "",
    ].join("\n"),
  );
}

function run(args: string[] = []): { status: number; stdout: string; stderr: string; output: string } {
  return runTool("pipelines-status", args, {
    env: {
      PATH: pathWithStubs(stubDir),
      DEVENV_ROOT: root,
      DEVENV_ROOT_SET: "1",
      DEVENV_REPO: undefined,
    },
    cwd: root,
  });
}

beforeEach(() => {
  stubDir = tmpDir("pipelines-status-bin");
  root = tmpToolboxRoot("pipelines-status-root");
  spawnSync("git", ["init", "-q"], { cwd: root });
});

afterEach(() => {
  rmrf(stubDir);
  rmrf(root);
});

describe("pipelines-status per-repository failures", () => {
  it("exits 0 and prints every repository when all succeed", () => {
    installGh({ alpha: "ok", beta: "ok" });
    const r = run(["--json"]);
    expect(r.status).toBe(EXIT_SUCCESS);
    const rows = JSON.parse(r.stdout) as Array<{ repo: string }>;
    expect(rows.map((x) => x.repo)).toEqual(["alpha", "beta"]);
    expect(r.stderr).toBe("");
  });

  it("prints the table for the good repository, names the failing one on stderr and exits 4", () => {
    installGh({ alpha: "ok", beta: "bad" });
    const r = run();
    expect(r.status).toBe(EXIT_API_FAILURE);
    expect(r.stdout).toContain("alpha");
    expect(r.stdout).not.toContain("beta");
    expect(r.stderr).toContain("beta");
    expect(r.stderr).toContain("1 of 2 repositories failed");
  });

  it("counts unparsable output as a failure", () => {
    installGh({ alpha: "ok", beta: "junk" });
    const r = run(["--json"]);
    expect(r.status).toBe(EXIT_API_FAILURE);
    expect(r.stderr).toContain("beta");
    expect(r.stderr).toContain("not valid JSON");
    expect((JSON.parse(r.stdout) as unknown[]).length).toBe(1);
  });

  it("counts JSON that is not a list as a failure", () => {
    installGh({ alpha: "ok", beta: "null" });
    const r = run(["--json"]);
    expect(r.status).toBe(EXIT_API_FAILURE);
    expect(r.stderr).toContain("beta");
    expect(r.stderr).toContain("not a JSON list");
    expect((JSON.parse(r.stdout) as unknown[]).length).toBe(1);
  });

  it("exits 4 with no rows when every repository fails", () => {
    installGh({ alpha: "bad", beta: "junk", gamma: "null" });
    const r = run(["--json"]);
    expect(r.status).toBe(EXIT_API_FAILURE);
    expect(JSON.parse(r.stdout)).toEqual([]);
    expect(r.stderr).toContain("alpha");
    expect(r.stderr).toContain("beta");
    expect(r.stderr).toContain("gamma");
    expect(r.stderr).toContain("3 of 3 repositories failed");
  });

  it("leaves the JSON of the good repositories unchanged when another fails", () => {
    installGh({ alpha: "ok", beta: "ok" });
    const clean = run(["--json"]).stdout;
    installGh({ alpha: "ok", beta: "bad", gamma: "ok" });
    const partial = run(["--json", "--repo", "alpha"]);
    expect(partial.status).toBe(EXIT_SUCCESS);
    const alphaRows = (JSON.parse(clean) as Array<{ repo: string }>).filter((x) => x.repo === "alpha");
    expect(JSON.parse(partial.stdout)).toEqual(alphaRows);
    const withFailure = run(["--json"]);
    expect(withFailure.status).toBe(EXIT_API_FAILURE);
    const goodRows = (JSON.parse(withFailure.stdout) as Array<{ repo: string }>).map((x) => x.repo);
    expect(goodRows).toEqual(["alpha", "gamma"]);
    expect((JSON.parse(withFailure.stdout) as unknown[])[0]).toEqual(alphaRows[0]);
  });
});
