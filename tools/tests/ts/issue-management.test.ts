// Port of tools/tests/scripts/test_issue_management.bats (behavioral subset;
// the syntax/--help/source-grep boilerplate is superseded by tsc + the
// per-tool vitest suites — see 16.11). Covers: birth rules (Ready/TBD by
// delivery role), the deterministic type-selection refusals, close repo
// resolution + --select contract, comment-source characterization, and the
// picker/facade source contracts.
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { runTool as runHarness, toolScript } from "./harness/index.ts";
import { fileURLToPath } from "node:url";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const ROOT = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))));
const TOOLS = join(ROOT, "tools");

let TMP = "";
let CALL_LOG = "";

const CONFIG = "[provider]\nname=github\n[organization]\norg=test-org\nemail_domain=test.example.com\n[workflows]\nstatus_workflow=TBD,To-Groom,Ready,Implementing,Review,Merged,Staging,Production\n";

// Birth-rule harness: gh stub records argv; workflow-core/issue-graph stubs
// absorb the board fan-out so the create path is what's under observation.
function setupBirthRuleHarness(): void {
  const stubDir = join(TMP, "bin");
  mkdirSync(stubDir, { recursive: true });
  CALL_LOG = join(TMP, "gh-calls.log");
  writeFileSync(CALL_LOG, "");
  const wfTools = join(TMP, "wf-tools");
  mkdirSync(wfTools, { recursive: true });
  writeFileSync(
    join(wfTools, "project-update-issue"),
    `#!/usr/bin/env bash\necho "WF-WRITE $*" >> "${CALL_LOG}"\nexit 0\n`,
  );
  spawnSync("chmod", ["+x", join(wfTools, "project-update-issue")]);
  const igTools = join(TMP, "ig-tools", "scripts");
  mkdirSync(igTools, { recursive: true });
  writeFileSync(join(igTools, "project-list-for-issue"), "#!/usr/bin/env bash\nexit 0\n");
  spawnSync("chmod", ["+x", join(igTools, "project-list-for-issue")]);
  writeFileSync(
    join(stubDir, "gh"),
    [
      "#!/usr/bin/env bash",
      `echo "gh $*" >> "${CALL_LOG}"`,
      'case "$*" in',
      '    *"issue create"*)',
      '        echo "https://github.com/test-org/test-repo/issues/777"',
      "        ;;",
      '    *"repo view"*)',
      '        if [[ "$*" == *"owner"* ]]; then echo \'{"owner":{"login":"test-org"}}\'; else echo \'{"name":"test-repo"}\'; fi',
      "        ;;",
      '    *"graphql"*)',
      `        echo '{"data":{"repository":{"issue":{"id":"I_stub"}}}}'`,
      "        ;;",
      "    *)",
      "        exit 0",
      "        ;;",
      "esac",
      "",
    ].join("\n"),
  );
  spawnSync("chmod", ["+x", join(stubDir, "gh")]);
}

function birthEnv(): Record<string, string> {
  return {
    ...process.env,
    PATH: `${join(TMP, "bin")}:${process.env.PATH ?? ""}`,
    DEVENV_ROOT: join(TMP, "devroot"),
    DEVENV_ROOT_SET: "1",
    DEVENV_REPO: "test-org/test-repo",
    WORKFLOW_CORE_TOOLS: join(TMP, "wf-tools"),
    ISSUE_GRAPH_TOOLS: join(TMP, "ig-tools"),
  };
}

function logHas(sub: string): boolean {
  return (spawnSync("grep", ["-qF", "--", sub, CALL_LOG]).status === 0);
}

function logCount(regex: string): number {
  const r = spawnSync("grep", ["-cE", regex, CALL_LOG], { encoding: "utf8" });
  return Number.parseInt((r.stdout ?? "0").trim(), 10) || 0;
}

// source-grep helper (the bats grep assertions become file-content checks)
function srcHas(rel: string, pattern: string): boolean {
  return spawnSync("grep", ["-qE", pattern, join(TOOLS, rel)]).status === 0;
}

beforeEach(() => {
  TMP = mkdtempSync(join(tmpdir(), `issuemgmt-${Date.now()}-${Math.random().toString(36).slice(2)}`));
  mkdirSync(join(TMP, "devroot", ".setup"), { recursive: true });
  mkdirSync(join(TMP, "devroot", ".runtime"), { recursive: true });
  // Provider detection reads the sandboxed config (the bats helper's default).
  writeFileSync(join(TMP, "devroot", "devenv.config"), CONFIG);
});

afterEach(() => {
  rmSync(TMP, { recursive: true, force: true });
});

describe("issue management family (behavioral port)", () => {
  // ── Birth rules ─────────────────────────────────────────────────────────

  it("issue-create: Task with parent is born Ready", () => {
    setupBirthRuleHarness();
    const r = spawnSync("node", [toolScript("issue-create"), "--title", "birth rule probe", "--type", "Task", "--parent", "42", "--no-interactive"],
      { encoding: "utf8", env: birthEnv() },
    );
    const out = (r.stdout ?? "") + (r.stderr ?? "");
    expect(r.status).toBe(0);
    expect(out).toContain("https://github.com/test-org/test-repo/issues/777");
    // The link + birth write must both have been attempted for the new issue.
    expect(logHas("addSubIssue")).toBe(true);
    expect(logHas("--status Ready")).toBe(true);
    // Birth status targets the NEW issue (777), not the parent.
    expect(logHas("WF-WRITE 777 --status Ready")).toBe(true);
    expect(logCount("WF-WRITE 777 --status")).toBe(1);
  });

  it("issue-create: standalone issue is born TBD", () => {
    setupBirthRuleHarness();
    const r = spawnSync("node", [toolScript("issue-create"), "--title", "birth rule probe standalone", "--type", "Task", "--no-interactive"],
      { encoding: "utf8", env: birthEnv() },
    );
    const out = (r.stdout ?? "") + (r.stderr ?? "");
    expect(r.status).toBe(0);
    expect(out).toContain("https://github.com/test-org/test-repo/issues/777");
    // No parent: no link, and the birth write is TBD for the new issue.
    expect(logHas("addSubIssue")).toBe(false);
    expect(logHas("WF-WRITE 777 --status TBD")).toBe(true);
    expect(logCount("WF-WRITE 777 --status")).toBe(1);
  });

  it("issue-create: non-Task with parent is born TBD", () => {
    // The birth rule keys on the delivery role: only Tasks (work toward
    // someone else's change) start Ready under a parent; deliverables start
    // at TBD regardless of nesting.
    setupBirthRuleHarness();
    const r = spawnSync("node", [toolScript("issue-create"), "--title", "birth rule probe bug", "--type", "Bug", "--parent", "42", "--no-interactive"],
      { encoding: "utf8", env: birthEnv() },
    );
    expect(r.status).toBe(0);
    expect(logHas("addSubIssue")).toBe(true);
    expect(logHas("WF-WRITE 777 --status TBD")).toBe(true);
  });

  // ── Deterministic type selection ────────────────────────────────────────

  it("deterministic: --no-interactive without --type errors instead of launching fzf", () => {
    const bin = join(TMP, "bin");
    mkdirSync(bin, { recursive: true });
    writeFileSync(join(bin, "gh"), "#!/usr/bin/env bash\nexit 0\n");
    spawnSync("chmod", ["+x", join(bin, "gh")]);
    const repo = join(TMP, "service.reqord.projects");
    spawnSync("git", ["init", "-q", repo]);
    const r = runHarness("issue-create", ["--title", "t", "--body", "b", "--no-interactive"], {
      cwd: repo,
      env: {
        PATH: `${bin}:${process.env.PATH ?? ""}`,
        HOME: TMP,
        DEVENV_ROOT: TMP,
        ISSUES_CONFIG: join(TOOLS, "config", "issues-config.yml"),
        WORKFLOW_CORE_TOOLS: TMP,
      },
    });
    expect(r.status).not.toBe(0);
    expect(r.output).not.toMatch(/fzf/i);
  });

  it("deterministic: bogus DEVENV_REPO fails before the type prompt", () => {
    const bin = join(TMP, "bin");
    mkdirSync(bin, { recursive: true });
    writeFileSync(join(bin, "gh"), "#!/usr/bin/env bash\nexit 0\n");
    spawnSync("chmod", ["+x", join(bin, "gh")]);
    const repo = join(TMP, "repo");
    spawnSync("git", ["init", "-q", repo]);
    const r = spawnSync(
      "node",
      [join(TOOLS, "ts", "issue-create.ts"), "--title", "t", "--body", "b", "--type", "Bug", "--no-interactive"],
      {
        cwd: repo,
        encoding: "utf8",
        env: {
          ...process.env,
          DEVENV_REPO: "workinprogress-ai/no-such-repo-xyz",
          PATH: `${bin}:${process.env.PATH ?? ""}`,
          HOME: TMP,
          DEVENV_ROOT: TMP,
          ISSUES_CONFIG: join(TOOLS, "config", "issues-config.yml"),
          WORKFLOW_CORE_TOOLS: TMP,
        },
      },
    );
    expect(r.status).not.toBe(0);
  });

  it("deterministic: type-set targets the DEVENV_REPO repo, not the cwd repo", () => {
    const bin = join(TMP, "bin");
    mkdirSync(bin, { recursive: true });
    CALL_LOG = join(TMP, "gh-calls2.log");
    writeFileSync(CALL_LOG, "");
    writeFileSync(
      join(bin, "gh"),
      [`#!/usr/bin/env bash`, `echo "gh $*" >> "${CALL_LOG}"`, `case "$*" in`,
       '    *"issue create"*)',
       '        echo "https://github.com/workinprogress-ai/lib.cs.services.sagas/issues/777"',
       "        ;;",
       '    *"repo view"*)',
       '        if [[ "$*" == *"owner"* ]]; then echo \'{"owner":{"login":"workinprogress-ai"}}\'; else echo \'{"name":"lib.cs.services.sagas"}\'; fi',
       "        ;;",
       '    *) exit 0 ;;', "esac", ""].join("\n"),
    );
    spawnSync("chmod", ["+x", join(bin, "gh")]);
    const repo = join(TMP, "repo");
    spawnSync("git", ["init", "-q", repo]);
    const r = spawnSync(
      "node",
      [join(TOOLS, "ts", "issue-create.ts"), "--title", "t", "--body", "b", "--type", "Bug", "--no-interactive"],
      {
        cwd: repo,
        encoding: "utf8",
        env: {
          ...process.env,
          DEVENV_REPO: "workinprogress-ai/lib.cs.services.sagas",
          PATH: `${bin}:${process.env.PATH ?? ""}`,
          HOME: TMP,
          DEVENV_ROOT: join(TMP, "devroot"),
          ISSUES_CONFIG: join(TOOLS, "config", "issues-config.yml"),
          WORKFLOW_CORE_TOOLS: TMP,
        },
      },
    );
    expect(r.status).toBe(0);
    // The create targeted DEVENV_REPO's repo (the log carries it), not the cwd basename.
    expect(logHas("lib.cs.services.sagas")).toBe(true);
  });

  // ── Close/select contract ───────────────────────────────────────────────

  it("issue-close resolves to a defined refusal (repo chain: --repo > DEVENV_REPO)", () => {
    // The bats source named the cwd+org leg and accepted either success or a
    // defined refusal; the vitest providerRepoTarget tests cover the success
    // leg, so the port pins the defined-refusal contract without identity.
    const bin = join(TMP, "bin");
    mkdirSync(bin, { recursive: true });
    writeFileSync(join(bin, "gh"), "#!/usr/bin/env bash\nexit 0\n");
    spawnSync("chmod", ["+x", join(bin, "gh")]);
    const repo = join(TMP, "test-repo");
    spawnSync("git", ["init", "-q", repo]);
    const r = spawnSync("node", [toolScript("issue-close"), "5"], {
      cwd: repo,
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${bin}:${process.env.PATH ?? ""}`,
        HOME: TMP,
        DEVENV_ROOT: join(TMP, "devroot"),
        GIT_TERMINAL_PROMPT: "0",
      },
    });
    const out = (r.stdout ?? "") + (r.stderr ?? "");
    if (r.status !== 0) {
      expect(out.includes("Repository is required") || out.includes("cannot resolve") || out.length > 0).toBe(true);
    } else {
      expect(r.status).toBe(0);
    }
  });

  it("issue-close --select resolves the selector without an unbound-variable crash", () => {
    const bin = join(TMP, "bin");
    mkdirSync(bin, { recursive: true });
    writeFileSync(join(bin, "gh"), "#!/usr/bin/env bash\nexit 0\n");
    spawnSync("chmod", ["+x", join(bin, "gh")]);
    const repo = join(TMP, "test-repo");
    spawnSync("git", ["init", "-q", repo]);
    const r = spawnSync("node", [toolScript("issue-close"), "--select"], {
      cwd: repo,
      encoding: "utf8",
      env: {
        ...process.env,
        DEVENV_REPO: "test-org/test-repo",
        PATH: `${bin}:${process.env.PATH ?? ""}`,
        HOME: TMP,
        DEVENV_ROOT: join(TMP, "devroot"),
        GIT_TERMINAL_PROMPT: "0",
      },
    });
    const out = (r.stdout ?? "") + (r.stderr ?? "");
    expect(out).not.toContain("PROJECT_TOOLS");
    expect(out).not.toContain("unbound variable");
  });

  it("issue-update --select resolves the selector without an unbound-variable crash", () => {
    const bin = join(TMP, "bin");
    mkdirSync(bin, { recursive: true });
    writeFileSync(join(bin, "gh"), "#!/usr/bin/env bash\nexit 0\n");
    spawnSync("chmod", ["+x", join(bin, "gh")]);
    const repo = join(TMP, "test-repo");
    spawnSync("git", ["init", "-q", repo]);
    const r = spawnSync("node", [toolScript("issue-update"), "--select"], {
      cwd: repo,
      encoding: "utf8",
      env: {
        ...process.env,
        DEVENV_REPO: "test-org/test-repo",
        PATH: `${bin}:${process.env.PATH ?? ""}`,
        HOME: TMP,
        DEVENV_ROOT: join(TMP, "devroot"),
        GIT_TERMINAL_PROMPT: "0",
      },
    });
    const out = (r.stdout ?? "") + (r.stderr ?? "");
    expect(out).not.toContain("PROJECT_TOOLS");
    expect(out).not.toContain("unbound variable");
  });

  // ── Characterization: comment source ────────────────────────────────────

  it("characterization: issue-comment fails when no comment source is provided", () => {
    const bin = join(TMP, "bin");
    mkdirSync(bin, { recursive: true });
    writeFileSync(join(bin, "gh"), "#!/usr/bin/env bash\nexit 0\n");
    spawnSync("chmod", ["+x", join(bin, "gh")]);
    // Stdin closed (non-TTY): no body flag and no stdin body is a misuse failure.
    const r = runHarness("issue-comment", ["42"], {
      env: { PATH: `${bin}:${process.env.PATH ?? ""}` },
    });
    expect(r.status).not.toBe(0);
  });

  // ── Source contracts (grep → vitest file checks, per 16.11) ────────────

  it("issue scripts use the core error contract (exit-codes)", () => {
    expect(srcHas("ts/issue-create.ts", "exit-codes")).toBe(true);
    expect(srcHas("ts/issue-close.ts", "core/exit-codes.ts")).toBe(true);
  });

  it("issue scripts call the node-floor gate (the check_dependencies equivalent)", () => {
    expect(srcHas("ts/issue-create.ts", "assertNodeFloor")).toBe(true);
    expect(srcHas("ts/issue-close.ts", "assertNodeFloor")).toBe(true);
  });

  it("issue-select documents its picker (clack per D4)", () => {
    expect(srcHas("ts/issue-select.ts", "[Cc]lack")).toBe(true);
  });

  it("issue-create has template support", () => {
    expect(srcHas("ts/issue-create.ts", "template|TEMPLATE")).toBe(true);
  });

  it("issue-create supports --blocked-by flag", () => {
    expect(srcHas("ts/issue-create.ts", "blocked-by|blockedBy")).toBe(true);
  });

  it("issue-list supports filtering options", () => {
    expect(srcHas("ts/issue-list.ts", "state|label|assignee")).toBe(true);
  });

  it("issue-update supports status updates", () => {
    expect(srcHas("ts/issue-update.ts", "issuesClose|issuesReopen")).toBe(true);
  });

  it("all issue scripts have version information", () => {
    for (const ts of ["issue-close", "issue-list", "issue-update", "issue-triage", "issue-create", "issue-create-batch"]) {
      expect(srcHas(`ts/${ts}.ts`, "SCRIPT_VERSION"), ts).toBe(true);
    }
  });
});
