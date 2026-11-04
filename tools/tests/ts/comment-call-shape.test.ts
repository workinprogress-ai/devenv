// Port of tools/tests/scripts/test_comment_call_shape.bats (4 tests).
// Call-shape lock for the comment wrappers: issue-comment and pr-comment must
// hand the facade verbs repo-positionally (or empty for cwd resolution),
// number second, body flags after.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const ROOT = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))));
const TOOLS = join(ROOT, "tools");

let TMP = "";
let CALL_LOG = "";

beforeEach(() => {
  TMP = mkdtempSync(join(tmpdir(), `ccshape-${Date.now()}-${Math.random().toString(36).slice(2)}`));
  CALL_LOG = join(TMP, "gh-calls.log");
  writeFileSync(CALL_LOG, "");
  const bin = join(TMP, "stub-bin");
  mkdirSync(bin, { recursive: true });
  writeFileSync(
    join(bin, "gh"),
    [
      "#!/usr/bin/env bash",
      'echo "gh $*" >> "${STUB_CALL_LOG:?}"',
      "exit 0",
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

function runCore(setup: string, call: string): { status: number; out: string } {
  const script =
    `${setup}\n` +
    `run_issue_comment_core() {\n` +
    `  local repo_spec_str="$1"\n` +
    `  read -ra repo_spec <<< "$repo_spec_str"\n` +
    `  local comment_args=(--body "hello world")\n` +
    `  local repo="\${repo_spec[1]:-}"\n` +
    `  if [ "\${repo_spec[0]:-}" != "-R" ]; then repo=""; fi\n` +
    `  provider_issues_comment "$repo" 123 "\${comment_args[@]}"\n` +
    `}\n` +
    `${call}\n`;
  const r = spawnSync("bash", ["-c", script], {
    input: "",
    encoding: "utf8",
    env: {
      ...procEnv,
      STUB_CALL_LOG: CALL_LOG,
      DEVENV_TOOLS: TOOLS,
      DEVENV_ROOT: join(TMP, "devenv-root"),
      DEVENV_ROOT_SET: "1",
      PATH: `${join(TMP, "stub-bin")}:${procEnv.PATH ?? ""}`,
    },
  });
  return { status: r.status ?? 1, out: (r.stdout ?? "") + (r.stderr ?? "") };
}

function lastGhCall(): string {
  const out = spawnSync("grep", ["^gh ", CALL_LOG], { encoding: "utf8" }).stdout ?? "";
  const lines = out.trim().split("\n").filter(Boolean);
  return lines[lines.length - 1] ?? "";
}

const LIBS =
  `source '${TOOLS}/lib/providers/provider-core.bash'\n` +
  `provider_detect '${join(TMP, "absent.config")}'\n` +
  `source '${TOOLS}/lib/providers/github/issues.bash'\n` +
  `source '${TOOLS}/lib/providers/github/prs.bash'\n`;

describe("scripts/comment-call-shape", () => {
  it("issue comment shape: repo present yields single -R with owner/repo", () => {
    writeFileSync(CALL_LOG, "");
    const r = runCore(LIBS, `run_issue_comment_core '-R org/repo'`);
    expect(r.status).toBe(0);
    expect(lastGhCall()).toBe("gh issue comment 123 -R org/repo --body hello world");
  });

  it("issue comment shape: no repo yields no -R at all", () => {
    writeFileSync(CALL_LOG, "");
    const r = runCore(LIBS, `run_issue_comment_core ''`);
    expect(r.status).toBe(0);
    expect(lastGhCall()).toBe("gh issue comment 123 --body hello world");
  });

  it("pr comment shape: repo present yields single -R with owner/repo (verb contract)", () => {
    writeFileSync(CALL_LOG, "");
    const r = runCore(LIBS, `provider_prs_comment 'org/repo' 9 --body 'hello world'`);
    expect(r.status).toBe(0);
    expect(lastGhCall()).toBe("gh pr comment 9 -R org/repo --body hello world");
  });

  it("pr comment shape: no repo yields no -R at all (verb contract)", () => {
    writeFileSync(CALL_LOG, "");
    const r = runCore(LIBS, `provider_prs_comment '' 9 --body 'hello world'`);
    expect(r.status).toBe(0);
    expect(lastGhCall()).toBe("gh pr comment 9 --body hello world");
  });
});
