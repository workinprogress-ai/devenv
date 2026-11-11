// issue-create in a clean checkout (no generated depth-1 stubs): the birth
// status is written through the in-checkout path, and a failed sub-issue link
// is a visible warning with a non-zero exit instead of a debug-only note.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CALLS_LOG_NAME, pathWithStubs, runTool, stubCli, tmpDir } from "./harness/index.ts";

let stubDir = "";
let repoRoot = "";
let workDir = "";

function installGh(opts: { linkFails?: boolean } = {}): void {
  stubCli(
    stubDir,
    "gh",
    [
      "#!/usr/bin/env bash",
      'if [ "$1 $2" = "auth status" ]; then exit 0; fi',
      `printf '%s\\n' "gh $*" >> "${join(stubDir, CALLS_LOG_NAME)}"`,
      'case "$*" in',
      `  *addSubIssue*) ${opts.linkFails ? 'echo "link boom" >&2; exit 1' : "echo '{}'"} ;;`,
      '  *"issue view"*issueType*) echo "Epic" ;;',
      '  *"issue create"*) echo "https://github.com/org/repo/issues/777" ;;',
      `  *graphql*) echo '{"data":{"repository":{"issue":{"id":"I_stub"}}}}' ;;`,
      "esac",
      "exit 0",
    ].join("\n"),
  );
  stubCli(
    stubDir,
    "git",
    ["#!/usr/bin/env bash", `if [ "$1" = "rev-parse" ]; then printf '%s\\n' "${repoRoot}"; exit 0; fi`, "exit 0"].join("\n"),
  );
}

function ghLog(): string {
  const f = join(stubDir, CALLS_LOG_NAME);
  return existsSync(f) ? readFileSync(f, "utf8") : "";
}

function run(args: string[]): ReturnType<typeof runTool> {
  const cfg = join(workDir, "issues-config.yml");
  writeFileSync(cfg, "types:\n  - name: Task\n    id: IT_t\n  - name: Epic\n    id: IT_e\n");
  return runTool("issue-create", args, {
    cwd: repoRoot,
    env: { PATH: pathWithStubs(stubDir), DEVENV_REPO: "org/repo", ISSUES_CONFIG: cfg },
  });
}

beforeEach(() => {
  stubDir = tmpDir("icnostub-stub");
  repoRoot = tmpDir("icnostub-repo");
  workDir = tmpDir("icnostub-work");
});
afterEach(() => {
  for (const d of [stubDir, repoRoot, workDir]) rmSync(d, { recursive: true, force: true });
});

describe("issue-create without generated stubs", () => {
  it("writes the birth status: the new issue's project cards are queried", () => {
    installGh();
    const r = run(["--title", "T", "--type", "Task", "--no-interactive", "--body", "b"]);
    expect(r.status).toBe(0);
    expect(r.output).not.toContain("skipped: wrapper not found");
    expect(ghLog()).toContain("projectItems");
    expect(ghLog()).toContain("https://github.com/org/repo/issues/777");
  });

  it("a sub-issue link failure is a WARN and a non-zero exit", () => {
    installGh({ linkFails: true });
    const r = run(["--title", "T", "--type", "Task", "--no-interactive", "--body", "b", "--parent", "12"]);
    expect(r.status).not.toBe(0);
    expect(r.output).toMatch(/WARN/);
    expect(r.output).toContain("sub-issue link failed");
    // The issue itself was created, and its URL is still printed.
    expect(r.stdout).toContain("https://github.com/org/repo/issues/777");
  });
});
