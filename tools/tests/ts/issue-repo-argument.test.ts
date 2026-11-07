// Port of tools/tests/scripts/test_issue_repo_argument.bats (3 tests).
// issue-list.ts and issue-search.ts must hand the repo to the provider list
// verb exactly once, as the leading positional argument. The Azure provider
// consumes only that first positional, so a second copy reaches its flag loop
// and fails as an unknown option.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runTool as runHarness } from "./harness/index.ts";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const ROOT = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))));
const TOOLS = join(ROOT, "tools");
const REPO = "Devenv-test/service.atlantis.claims";

let TMP = "";
let ARGS_LOG = "";

beforeEach(() => {
  TMP = mkdtempSync(join(tmpdir(), `irepoarg-${Date.now()}-${Math.random().toString(36).slice(2)}`));
  ARGS_LOG = join(TMP, "provider-args.log");
  writeFileSync(ARGS_LOG, "");
  const bin = join(TMP, "bin");
  mkdirSync(bin, { recursive: true });
  writeFileSync(
    join(bin, "gh"),
    [
      "#!/usr/bin/env bash",
      '{ printf \'%s|\' "$@"; printf \'\\n\'; } >> "$ARGS_LOG"',
      'case "$*" in',
      '  "issue list"*) echo "[]" ;;',
      '  *) echo "{}" ;;',
      "esac",
      "",
    ].join("\n"),
  );
  spawnSync("chmod", ["+x", join(bin, "gh")]);
  // The helper's sandboxed config: github provider.
  const root = join(TMP, "devenv-root");
  mkdirSync(root, { recursive: true });
  writeFileSync(
    join(root, "devenv.config"),
    "[provider]\nname=github\n\n[organization]\nname=Test Organization\norg=test-org\nemail_domain=test.example.com\n\n[workflows]\nstatus_workflow=TBD,To-Groom,Ready,Implementing,Review,Merged,Staging,Production\n",
  );
});

const { DEVENV_REPO: _dr, ...procEnv } = process.env;

function runTool(toolPath: string, args: string[]): { status: number; out: string } {
  // Callers pass a ts path; the harness takes the bare tool name.
  const name = toolPath.replace(/\.ts$/, "").split("/").pop() ?? toolPath;
  const r = runHarness(name, args, {
    env: {
      ...procEnv,
      ARGS_LOG,
      DEVENV_REPO: REPO,
      DEVENV_ROOT: join(TMP, "devenv-root"),
      DEVENV_ROOT_SET: "1",
      PATH: `${join(TMP, "bin")}:${procEnv.PATH ?? ""}`,
    },
  });
  return { status: r.status, out: r.output };
}

describe("scripts/issue-repo-argument", () => {
  it("issue-list passes the repo to the provider list verb exactly once, first", () => {
    const r = runTool(join(TOOLS, "ts", "issue-list.ts"), ["--state", "all", "--limit", "30"]);
    expect(r.status).toBe(0);
    const log = spawnSync("cat", [ARGS_LOG], { encoding: "utf8" }).stdout ?? "";
    expect(log).toContain(`issue|list|-R|${REPO}|`);
    expect(log.split(`-R|${REPO}`).length - 1).toBe(1);
  });

  it("issue-search passes the repo to the provider list verb exactly once, first", () => {
    const r = runTool(join(TOOLS, "ts", "issue-search.ts"), ["term"]);
    expect(r.status).toBe(0);
    const log = spawnSync("cat", [ARGS_LOG], { encoding: "utf8" }).stdout ?? "";
    expect(log).toContain(`issue|list|-R|${REPO}|`);
    expect(log.split(`-R|${REPO}`).length - 1).toBe(1);
  });

  it("issue-list keeps its filter flags after the repo", () => {
    const r = runTool(join(TOOLS, "ts", "issue-list.ts"), ["--state", "all", "--limit", "30"]);
    expect(r.status).toBe(0);
    const log = spawnSync("cat", [ARGS_LOG], { encoding: "utf8" }).stdout ?? "";
    expect(log).toContain("--state|all");
    expect(log).toContain("--limit|30");
  });
});
