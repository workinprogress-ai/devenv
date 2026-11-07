// Port of tools/tests/scripts/test_project_list_for_issue.bats (7) +
// test_project_update_issue.bats (15) + test_pr_thread_reply.bats (5) +
// test_pr_review_flow.bats (6) + test_pr_cleanup_review_branches.bats (10)
// — 43 tests.
//
// Subjects: project-list-for-issue (stubbed-gh TSV read), project-update-issue
// (vocabulary validation + GraphQL --field write path), pr-thread-reply (REST
// reply routing + repo-spec + comment-id validation), the pr-* review-flow
// trio contracts (syntax + --help), and pr-cleanup-review-branches (local
// bare-remote behavioral suite). The bats assertions are the oracle.
// Fixture hygiene per tools/tests/README.md: all scratch paths flow through
// tmpPath(); the gh stubs are per-test bin dirs under the temp root.
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync, chmodSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))));
const TOOLS = join(ROOT, "tools");
const PLFI = join(TOOLS, "project-list-for-issue");
const PUI = join(TOOLS, "project-update-issue");
const PTR = join(TOOLS, "ts", "pr-thread-reply.ts");
const PCR = join(TOOLS, "ts", "pr-cleanup-review-branches.ts");

let TMP = "";

function ensureTmp(): void {
  if (!TMP) {
    TMP = mkdtempSync(join(tmpdir(), `prproj-${Date.now()}-${Math.random().toString(36).slice(2)}`));
  }
}

function tmpPath(...parts: string[]): string {
  ensureTmp();
  const base = tmpdir();
  if (!isAbsolute(TMP) || !TMP.startsWith(base)) {
    throw new Error(`scratch-dir guard: TMP=${JSON.stringify(TMP)} is not under ${base}`);
  }
  return join(TMP, ...parts);
}

afterAll(() => {
  if (TMP) rmSync(TMP, { recursive: true, force: true });
});

const GIT_ENV = (): Record<string, string> => {
  const e: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined) e[k] = v;
  e["GIT_AUTHOR_NAME"] = "t";
  e["GIT_AUTHOR_EMAIL"] = "t@example.invalid";
  e["GIT_COMMITTER_NAME"] = "t";
  e["GIT_COMMITTER_EMAIL"] = "t@example.invalid";
  return e;
};

import { runTool as runHarness } from "./harness/index.ts";
// Run a tool with a gh stub dir PREPENDED to PATH (these suites read gh's
// stdout; they never invoke editors, so prepending is safe here).
function runWithStub(exe: string, args: string[], stubDir: string, env: Record<string, string | undefined> = {}): { status: number; stdout: string; stderr: string; out: string } {
  const e = GIT_ENV();
  e["PATH"] = `${stubDir}:${process.env.PATH ?? ""}`;
  e["DEVENV_REPO"] = "test-org/test-repo";
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) delete e[k];
    else e[k] = v;
  }
  // node invocations ride the harness (exe is "node" with a ts path in
  // args); other executables keep their spawn shape.
  if (exe === "node" && args[0]?.endsWith(".ts")) {
    const name = args[0].replace(/\.ts$/, "").split("/").pop() ?? "unknown";
    const r = runHarness(name, args.slice(1), { env: e });
    return { status: r.status, stdout: r.stdout, stderr: r.stderr, out: r.output };
  }
  const r = spawnSync(exe, args, { encoding: "utf8", env: e });
  return { status: r.status ?? 1, stdout: r.stdout ?? "", stderr: r.stderr ?? "", out: (r.stdout ?? "") + (r.stderr ?? "") };
}

function writeGhStub(dir: string, body: string): string {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "gh"), body);
  chmodSync(join(dir, "gh"), 0o755);
  return dir;
}

function git(cwd: string, args: string[]): { status: number; stdout: string } {
  const r = spawnSync("git", args, { cwd, encoding: "utf8", env: GIT_ENV() });
  return { status: r.status ?? 1, stdout: r.stdout ?? "" };
}

// ── project-list-for-issue ──────────────────────────────────────────────────

const EMPTY_PROJECTS = '{"data":{"resource":{"projectItems":{"nodes":[]}}}}';

describe("project-list-for-issue (bats port)", () => {
  let STUB = "";

  beforeEach(() => {
    STUB = writeGhStub(tmpPath(`plfi-bin-${Math.random().toString(36).slice(2)}`), "#!/usr/bin/env bash\nexit 0\n");
  });

  it("usage error when no arguments given", () => {
    const r = runWithStub(PLFI, [], STUB);
    expect(r.status).not.toBe(0);
    expect(r.out.includes("ISSUE_NUMBER is required") || r.out.includes("A numeric ISSUE_NUMBER is required")).toBe(true);
  });

  it("usage error when issue number is not numeric", () => {
    expect(runWithStub(PLFI, ["notanumber"], STUB).status).not.toBe(0);
  });

  it("help exits 0 and shows usage", () => {
    const r = runWithStub(PLFI, ["--help"], STUB);
    expect(r.status).toBe(0);
    expect(r.out.includes("project-list-for-issue") || r.out.includes("ISSUE_NUMBER")).toBe(true);
  });

  it("issue in no projects: empty output, exit 0 (AC-2)", () => {
    writeGhStub(STUB, `#!/usr/bin/env bash\necho '${EMPTY_PROJECTS}'\n`);
    const r = runWithStub(PLFI, ["42"], STUB);
    expect(r.status).toBe(0);
    expect(r.out.trim()).toBe("");
  });

  it("issue in projects: one TSV line per project with status (AC-1)", () => {
    writeGhStub(
      STUB,
      `#!/usr/bin/env bash\ncat <<'JSON'\n{"data":{"resource":{"projectItems":{"nodes":[\n  {"project":{"title":"Alpha","number":1,"owner":{"login":"test-org"}},\n   "fieldValues":{"nodes":[\n     {"__typename":"ProjectV2ItemFieldTextValue"},\n     {"__typename":"ProjectV2ItemFieldSingleSelectValue","name":"To-Groom","field":{"name":"Status"}}\n   ]}}\n]}}}}\nJSON\n`,
    );
    const r = runWithStub(PLFI, ["42"], STUB);
    expect(r.status).toBe(0);
    const lines = r.stdout.split("\n").filter((l) => l.trim() !== "");
    expect(lines).toHaveLength(1);
    expect(lines[0]).toBe("Alpha\t1\tTo-Groom");
  });

  it("project without Status field reports dash (AC-1 partial)", () => {
    writeGhStub(
      STUB,
      `#!/usr/bin/env bash\ncat <<'JSON'\n{"data":{"resource":{"projectItems":{"nodes":[\n  {"project":{"title":"Beta","number":2,"owner":{"login":"test-org"}},\n   "fieldValues":{"nodes":[\n     {"__typename":"ProjectV2ItemFieldSingleSelectValue","name":"Ready","field":{"name":"Priority"}}\n   ]}}\n]}}}}\nJSON\n`,
    );
    const r = runWithStub(PLFI, ["42"], STUB);
    expect(r.status).toBe(0);
    expect(r.out).toContain("Beta");
    expect(r.out).toContain("\t2\t-");
  });

  it("graph api failure: error on stderr, non-zero exit (query failure ≠ empty)", () => {
    // A query failure must be distinguishable from "issue in no projects".
    writeGhStub(STUB, '#!/usr/bin/env bash\ncase "$1" in\n    auth) exit 0 ;;\n    *)    exit 1 ;;\nesac\n');
    const r = runWithStub(PLFI, ["42"], STUB);
    expect(r.status).not.toBe(0);
    expect(r.out).toContain("GraphQL query failed");
  });
});

// ── project-update-issue ────────────────────────────────────────────────────

// jq-applying gh stub: the wrapper's field/option resolution filters inside
// the jq program, so a bare exit-0 gh cannot satisfy the real write path.
const JQ_GH_STUB = `#!/usr/bin/env bash
prog=""
prev=""
for a in "$@"; do
    if [ "$prev" = "--jq" ]; then prog="$a"; fi
    prev="$a"
done
payload=""
case "$*" in
    *"items(first"*)
        payload='{"data":{"node":{"items":{"pageInfo":{"hasNextPage":false,"endCursor":""},"nodes":[{"id":"PVTI_item1","content":{"number":123,"repository":{"nameWithOwner":"test-org/test-repo"}}}]}}}}'
        ;;
    *"projectsV2(first"*)
        payload='{"data":{"organization":{"projectsV2":{"pageInfo":{"hasNextPage":false,"endCursor":""},"nodes":[{"id":"PVT_test1","number":9,"title":"someproject"}]}}}}'
        ;;
    *"ProjectV2SingleSelectField"*)
        payload='{"data":{"node":{"field":{"id":"PVTVF_f1","options":[{"id":"PVTFO_o1","name":"High"}]}}}}'
        ;;
    *updateProjectV2ItemFieldValue*)
        payload='{"data":{"updateProjectV2ItemFieldValue":{"projectV2Item":{"id":"PVTI_item1"}}}}'
        ;;
    *"projectV2(number"*)
        payload='{"data":{"organization":{"projectV2":{"id":"PVT_test1"}}}}'
        ;;
    *)
        payload='{"data":{}}'
        ;;
esac
if [ -n "$prog" ]; then
    printf '%s' "$payload" | jq -r "$prog"
else
    echo "$payload"
fi
`;

// The no-matching-option variant (for the never-lies failure contract).
const JQ_GH_STUB_NO_OPTION = `#!/usr/bin/env bash
prog=""
prev=""
for a in "$@"; do
    if [ "$prev" = "--jq" ]; then prog="$a"; fi
    prev="$a"
done
payload='{"data":{}}'
case "$*" in
    *"items(first"*)
        payload='{"data":{"node":{"items":{"pageInfo":{"hasNextPage":false,"endCursor":""},"nodes":[{"id":"PVTI_item1","content":{"number":123,"repository":{"nameWithOwner":"test-org/test-repo"}}}]}}}}'
        ;;
    *"projectsV2(first"*)
        payload='{"data":{"organization":{"projectsV2":{"pageInfo":{"hasNextPage":false,"endCursor":""},"nodes":[{"id":"PVT_test1","number":9,"title":"someproject"}]}}}}'
        ;;
esac
printf '%s' "$payload" | jq -r "$prog"
`;

describe("project-update-issue (bats port)", () => {
  let STUB = "";

  beforeEach(() => {
    STUB = writeGhStub(tmpPath(`pui-bin-${Math.random().toString(36).slice(2)}`), "#!/usr/bin/env bash\nexit 0\n");
  });

  it("usage error when no arguments given", () => {
    expect(runWithStub(PUI, [], STUB).status).not.toBe(0);
  });

  it("usage error when only a status is given", () => {
    expect(runWithStub(PUI, ["someproject", "--status", "Ready"], STUB).status).not.toBe(0);
  });

  it("invalid status is rejected against configured workflow", () => {
    const r = runWithStub(PUI, ["someproject", "123", "--status", "Bogus"], STUB);
    expect(r.status).not.toBe(0);
    expect(r.out).toContain("Invalid status");
  });

  it("single-project write: not-in-project reports a clean error (write path)", () => {
    // The bare exit-0 stub cannot satisfy the real path; the wrapper must
    // fail cleanly rather than print manual instructions.
    const r = runWithStub(PUI, ["someproject", "123", "--status", "Ready"], STUB);
    expect(r.status).not.toBe(0);
    expect(r.out.includes("not found") || r.out.includes("not in project") || r.out.includes("Failed to set")).toBe(true);
  });

  it("dry-run reports intent without contacting GitHub", () => {
    const r = runWithStub(PUI, ["someproject", "123", "--status", "To-Groom", "--dry-run"], STUB);
    expect(r.status).toBe(0);
    expect(r.out).toContain("[DRY RUN]");
  });

  it("rejects status values not in the configured workflow", () => {
    // The hyphenated 8-state kanban is canonical; other values must fail.
    const r = runWithStub(PUI, ["someproject", "123", "--status", "Done", "--dry-run"], STUB);
    expect(r.status).not.toBe(0);
    expect(r.out).toContain("Invalid status");
  });

  it("hyphenated multi-word status validates (comma-normalized config reader)", () => {
    // Guards the comma-split fix: hyphenated tokens must validate intact.
    const r = runWithStub(PUI, ["someproject", "123", "--status", "To-Groom", "--dry-run"], STUB);
    expect(r.status).toBe(0);
    expect(r.out).toContain("[DRY RUN]");
    expect(r.out).toContain("To-Groom");
  });

  it("spaced status strings are rejected by vocabulary validation", () => {
    // Vocabulary is hyphenated single tokens; spaced form must not validate.
    expect(runWithStub(PUI, ["someproject", "123", "--status", "To Groom", "--dry-run"], STUB).status).not.toBe(0);
  });

  it("list-fields surfaces gh project field-list output", () => {
    writeGhStub(STUB, '#!/usr/bin/env bash\necho "gh-project-field-list-called: $*"\n');
    const r = runWithStub(PUI, ["someproject", "123", "--list-fields"], STUB);
    expect(r.status).toBe(0);
    expect(r.out).toContain("gh-project-field-list-called");
  });

  it("--field performs a real single-select write (mutation issued)", () => {
    writeGhStub(STUB, JQ_GH_STUB);
    const r = runWithStub(PUI, ["someproject", "123", "--field", "Priority=High"], STUB);
    expect(r.status).toBe(0);
    expect(r.out).toContain("Set Priority='High'");
  });

  it("--field with unresolvable option fails with named error (never lies)", () => {
    writeGhStub(STUB, JQ_GH_STUB_NO_OPTION);
    const r = runWithStub(PUI, ["someproject", "123", "--field", "Priority=Nope"], STUB);
    expect(r.status).not.toBe(0);
    expect(r.out).toContain("not found");
  });

  it("--field with invalid NAME=VALUE format fails", () => {
    writeGhStub(STUB, JQ_GH_STUB);
    const r = runWithStub(PUI, ["someproject", "123", "--field", "NoEqualsSign"], STUB);
    expect(r.status).not.toBe(0);
    expect(r.out).toContain("expected NAME=VALUE");
  });

  it("--field combined with --all-projects is rejected", () => {
    const r = runWithStub(PUI, ["123", "--all-projects", "--field", "Priority=High"], STUB);
    expect(r.status).not.toBe(0);
    expect(r.out).toContain("fan-out is Status-only");
  });

  it("failed --status exits non-zero even with a --field queued", () => {
    // gh stub that fails the project lookup: the status update fails, and
    // the wrapper must exit 1, not paper over it.
    writeGhStub(STUB, "#!/usr/bin/env bash\nexit 1\n");
    const r = runWithStub(PUI, ["someproject", "123", "--status", "Ready", "--field", "Priority=High"], STUB);
    expect(r.status).not.toBe(0);
  });

  it("--help documents hyphenated To-Groom vocabulary", () => {
    const r = runWithStub(PUI, ["--help"], STUB);
    expect(r.status).toBe(0);
    expect(r.out).toContain("To-Groom");
    expect(r.out).not.toContain("To Groom");
  });
});

// ── pr-thread-reply ─────────────────────────────────────────────────────────

describe("pr-thread-reply (bats port)", () => {
  let STUB = "";
  let GH_LOG = "";

  beforeEach(() => {
    const dir = tmpPath(`ptr-bin-${Math.random().toString(36).slice(2)}`);
    mkdirSync(dir, { recursive: true });
    GH_LOG = join(dir, "gh.log");
    writeFileSync(GH_LOG, "");
    STUB = writeGhStub(
      dir,
      `#!/usr/bin/env bash\nprintf 'gh %s\\n' "$*" >> "${GH_LOG}"\n[ "$1" = auth ] && exit 0\necho '{"html_url":"https://example.invalid/reply/1"}'\n`,
    );
  });

  function replyApiPath(): string {
    const log = readFileSync(GH_LOG, "utf8");
    const line = log.split("\n").find((l) => l.includes("api -X POST"));
    return (line ?? "").match(/\/repos\/[^ ]+/)?.[0] ?? "";
  }

  function reply(args: string[], repo = "acme/widgets"): { status: number; stdout: string; stderr: string; out: string } {
    return runWithStub("node", [PTR, ...args], STUB, { DEVENV_REPO: repo });
  }

  it("pr-thread-reply routes replies through the REST seams", () => {
    expect(readFileSync(PTR, "utf8")).toContain("prsThreadReply");
  });

  it("a two-part owner/repo spec posts to that repo", () => {
    const r = reply(["7", "--comment-id", "99", "--body", "hi"]);
    expect(r.status).toBe(0);
    expect(replyApiPath()).toBe("/repos/acme/widgets/pulls/7/comments/99/replies");
  });

  it("a three-part org/project/repo spec keeps the repo component (not org/project)", () => {
    // The old capture regex took the first TWO components and dropped the
    // repo, so the reply went to the project name as if it were the repo.
    const r = reply(["7", "--comment-id", "99", "--body", "hi"], "acme/proj/widgets");
    expect(r.status).toBe(0);
    const path = replyApiPath();
    expect(path.startsWith("/repos/acme/widgets/")).toBe(true);
    expect(path.startsWith("/repos/acme/proj/")).toBe(false);
  });

  it("the numeric comment-id and the <thread>/<comment> token are accepted; nothing else", () => {
    for (const c of ["456", "62644/2"]) {
      expect(reply(["7", "--comment-id", c, "--body", "hi"]).status, `rejected: ${c}`).toBe(0);
    }
    for (const c of ["abc", "12/", "/3", "12/3/4"]) {
      expect(reply(["7", "--comment-id", c, "--body", "hi"]).status, `accepted: [${c}]`).not.toBe(0);
    }
  });
});

// ── pr-* review-flow trio contracts ─────────────────────────────────────────

describe("pr review-flow trio contracts (bats port)", () => {
  for (const tool of ["pr-create-for-review", "pr-get-review-link", "pr-cleanup-review-branches"]) {
    it(`${tool} stub is valid bash and has --help`, () => {
      const path = join(TOOLS, tool);
      expect(spawnSync("bash", ["-n", path]).status).toBe(0);
      const r = spawnSync(path, ["--help"], { encoding: "utf8", env: GIT_ENV() });
      expect(r.status).toBe(0);
      expect(r.stdout ?? "").toMatch(/Usage:/);
    });
  }
});

// ── pr-cleanup-review-branches (local bare remote) ──────────────────────────

describe("pr-cleanup-review-branches (bats port)", () => {
  let REMOTE = "";
  let WORK = "";
  let TODAY = "";

  function setup(): void {
    REMOTE = tmpPath(`remote-${Math.random().toString(36).slice(2)}.git`);
    WORK = tmpPath(`work-${Math.random().toString(36).slice(2)}`);
    git(ROOT, ["init", "-q", "--bare", REMOTE]);
    spawnSync("git", ["clone", "-q", REMOTE, WORK], { env: GIT_ENV() });
    git(WORK, ["checkout", "-q", "-B", "master"]);
    git(WORK, ["commit", "-q", "--allow-empty", "-m", "base"]);
    git(WORK, ["push", "-q", "origin", "master"]);
    TODAY = new Date().toISOString().slice(0, 10);
  }

  function makeBranch(name: string): void {
    git(WORK, ["push", "-q", "origin", `master:refs/heads/${name}`]);
  }

  function remoteHas(name: string): boolean {
    return git(REMOTE, ["show-ref", "--verify", "--quiet", `refs/heads/${name}`]).status === 0;
  }

  function cleanup(args: string[]): { status: number; out: string } {
    const e = GIT_ENV();
    const r = spawnSync("node", [PCR, ...args], { encoding: "utf8", env: e });
    return { status: r.status ?? 1, out: (r.stdout ?? "") + (r.stderr ?? "") };
  }

  beforeEach(() => {
    setup();
  });

  it("deletes old review branches in the real naming format and keeps recent ones", () => {
    makeBranch("review/a1b2c3d4-2020-01-15-target");
    makeBranch("review/a1b2c3d4-2020-01-15-source");
    makeBranch(`review/e5f6a7b8-${TODAY}-target`);
    expect(cleanup([WORK, "30"]).status).toBe(0);
    expect(remoteHas("review/a1b2c3d4-2020-01-15-target")).toBe(false);
    expect(remoteHas("review/a1b2c3d4-2020-01-15-source")).toBe(false);
    expect(remoteHas(`review/e5f6a7b8-${TODAY}-target`)).toBe(true);
  });

  it("a branch whose name only looks date-like is never deleted, and the run fails loudly", () => {
    // The date used to be pulled out with an unanchored grep, so the issue
    // number and day in this name read as the date 2024-11-30.
    makeBranch("review/issue-24-11-30");
    const r = cleanup([WORK, "30"]);
    expect(r.status).not.toBe(0);
    expect(remoteHas("review/issue-24-11-30")).toBe(true);
    expect(r.out).toContain("review/issue-24-11-30");
    expect(r.out).toContain("not a recognized review branch name");
  });

  it("a name with two date-like parts is refused, not guessed at", () => {
    makeBranch("review/a1b2c3d4-2020-01-15-2024-11-30-target");
    const r = cleanup([WORK, "30"]);
    expect(r.status).not.toBe(0);
    expect(remoteHas("review/a1b2c3d4-2020-01-15-2024-11-30-target")).toBe(true);
    expect(r.out).toContain("not a recognized review branch name");
  });

  it("an impossible date is refused without aborting the rest of the cleanup", () => {
    makeBranch("review/a1b2c3d4-2020-13-45-target");
    makeBranch("review/b2c3d4e5-2020-01-15-target");
    const r = cleanup([WORK, "30"]);
    expect(r.status).not.toBe(0);
    expect(r.out).toContain("review/a1b2c3d4-2020-13-45-target carries an invalid date");
    expect(remoteHas("review/a1b2c3d4-2020-13-45-target")).toBe(true);
    // The valid old branch is still cleaned up (a bad date must not abort).
    expect(remoteHas("review/b2c3d4e5-2020-01-15-target")).toBe(false);
  });

  it("--dry-run prints the deletion plan and deletes nothing", () => {
    makeBranch("review/a1b2c3d4-2020-01-15-target");
    makeBranch(`review/e5f6a7b8-${TODAY}-target`);
    const r = cleanup(["--dry-run", WORK, "30"]);
    expect(r.status).toBe(0);
    expect(r.out).toContain("Would delete remote branch review/a1b2c3d4-2020-01-15-target");
    expect(r.out).not.toContain(`Would delete remote branch review/e5f6a7b8-${TODAY}-target`);
    expect(remoteHas("review/a1b2c3d4-2020-01-15-target")).toBe(true);
    expect(remoteHas(`review/e5f6a7b8-${TODAY}-target`)).toBe(true);
  });

  it("--dry-run is accepted after the positional arguments too", () => {
    makeBranch("review/a1b2c3d4-2020-01-15-target");
    expect(cleanup([WORK, "30", "--dry-run"]).status).toBe(0);
    expect(remoteHas("review/a1b2c3d4-2020-01-15-target")).toBe(true);
  });

  it("an unknown option is an error, not a repository path", () => {
    const r = cleanup(["--dry-rn", WORK]);
    expect(r.status).toBe(2);
    expect(r.out).toContain("Unknown option");
    expect(r.out).toContain("--dry-rn");
  });

  it("a non-numeric day count is rejected before anything is touched", () => {
    makeBranch("review/a1b2c3d4-2020-01-15-target");
    const r = cleanup([WORK, "thirty"]);
    expect(r.status).toBe(2);
    expect(remoteHas("review/a1b2c3d4-2020-01-15-target")).toBe(true);
  });

  it("a review branch deleted on the remote is pruned from the local tracking refs", () => {
    makeBranch("review/a1b2c3d4-2020-01-15-target");
    git(WORK, ["fetch", "-q", "origin"]);
    git(REMOTE, ["branch", "-q", "-D", "review/a1b2c3d4-2020-01-15-target"]);
    const r = cleanup(["--dry-run", WORK, "30"]);
    expect(r.status).toBe(0);
    expect(r.out).toContain("No review branches found.");
  });

  it("a branch that cannot be deleted does not stop the others; the run fails at the end", () => {
    makeBranch("review/a1b2c3d4-2020-01-15-source");
    makeBranch("review/b1b2c3d4-2020-01-15-source");
    makeBranch("review/c1b2c3d4-2020-01-15-source");
    // the remote refuses to delete the middle branch
    mkdirSync(join(REMOTE, "hooks"), { recursive: true });
    writeFileSync(
      join(REMOTE, "hooks", "pre-receive"),
      '#!/bin/sh\nwhile read old new ref; do [ "$ref" = "refs/heads/review/b1b2c3d4-2020-01-15-source" ] && [ "$new" = "0000000000000000000000000000000000000000" ] && exit 1; done; exit 0\n',
    );
    chmodSync(join(REMOTE, "hooks", "pre-receive"), 0o755);
    const r = cleanup([WORK, "30"]);
    expect(r.status).not.toBe(0);
    expect(remoteHas("review/a1b2c3d4-2020-01-15-source")).toBe(false);
    expect(remoteHas("review/c1b2c3d4-2020-01-15-source")).toBe(false);
    expect(remoteHas("review/b1b2c3d4-2020-01-15-source")).toBe(true);
    expect(r.out).toContain("b1b2c3d4-2020-01-15-source");
  });
});
