// Tests for domain/issues/graph.ts — native sub-issue reads, the 'Part of #N'
// body-text fallback, and the project-card status read with its vocabulary
// filter. gh is stubbed with a call log; the project wrapper is a stub script.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync, existsSync, readFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// The module is imported directly (headless D3: no TTY needed).
const GRAPH = join(fileURLToPath(new URL(".", import.meta.url)), "../../lib/domain/issues/graph.ts");

let stubDir = "";
let repoRoot = "";
let workDir = "";

function installGhStub(opts: { parentNative?: number | null; body?: string } = {}): void {
  const parentVal = opts.parentNative === null || opts.parentNative === undefined ? "null" : String(opts.parentNative);
  const bodyOut = (opts.body ?? "").replace(/'/g, "'\\''");
  writeFileSync(
    join(stubDir, "gh"),
    [
      "#!/usr/bin/env bash",
      'printf \'%s\\n\' "gh $*" >> "__LOG__"',
      'case "$*" in',
      '  *"parent{number}"*) echo "' + parentVal + '" ;;',
      '  *"{id}}}"*) echo "I_stub" ;;',
      '  *"subIssues"*) echo 11; echo 12 ;;',
      '  *".body"*) echo \'' + bodyOut + '\';;',
      '  *) echo "{}" ;;',
      'esac',
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

interface Opts {
  parentNative?: number | null;
  body?: string;
  projectRows?: string;
  keepStub?: boolean;
}

/** Run a snippet inside a node child with the stubs on PATH. */
function runNode(snippet: string, opts: Opts = {}): { status: number; stdout: string } {
  if (!opts.keepStub) {
    installGhStub({ parentNative: opts.parentNative ?? null, ...(opts.body !== undefined ? { body: opts.body } : {}) });
  }
  const script = [
    `const g = await import(${JSON.stringify(GRAPH)});`,
    snippet,
  ].join("\n");
  const scriptFile = join(workDir, "snippet.mjs");
  writeFileSync(scriptFile, script);
  const r = spawnSync("node", [scriptFile], {
    encoding: "utf8",
    cwd: repoRoot,
    env: {
      ...process.env,
      PATH: `${stubDir}:${process.env.PATH ?? ""}`,
      DEVENV_REPO: "org/repo",
      ISSUE_GRAPH_TOOLS: join(workDir, "ig-tools"),
      DEVENV_ROOT: workDir,
      ...(opts.projectRows !== undefined ? {} : {}),
    },
  });
  return { status: r.status ?? 1, stdout: (r.stdout ?? "") + (r.stderr ?? "") };
}

describe("domain/issues/graph", () => {
  beforeEach(() => {
    stubDir = mkdtempSync(join(tmpdir(), "grx-stub-"));
    repoRoot = mkdtempSync(join(tmpdir(), "grx-repo-"));
    workDir = mkdtempSync(join(tmpdir(), "grx-work-"));
    mkdirSync(join(workDir, "ig-tools", "scripts"), { recursive: true });
    writeFileSync(
      join(workDir, "ig-tools", "scripts", "project-list-for-issue.sh"),
      "#!/usr/bin/env bash\nprintf 'proj1\\t1\\tReady\\nproj2\\t2\\t-\\n'\n",
      { mode: 0o755 },
    );
    writeFileSync(
      join(workDir, "devenv.config"),
      "[workflows]\nstatus_workflow=TBD,To-Groom,Ready,Implementing,Review,Merged,Staging,Production\n",
    );
  });

  afterEach(() => {
    rmSync(stubDir, { recursive: true, force: true });
    rmSync(repoRoot, { recursive: true, force: true });
    rmSync(workDir, { recursive: true, force: true });
  });

  it("children lists the native sub-issue numbers", async () => {
    const r = runNode(`console.log(JSON.stringify(await g.children("org/repo", 7)));`);
    expect(r.status).toBe(0);
    expect(JSON.parse(r.stdout)).toEqual([11, 12]);
    expect(ghCalls().join("\n")).toContain("subIssues");
  });

  it("parent prefers the native sub-issue linkage", async () => {
    const r = runNode(`console.log(await g.parent("org/repo", 7));`, { parentNative: 42 });
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toBe("42");
  });

  it("parent falls back to the 'Part of #N' body line", async () => {
    const r = runNode(`console.log(await g.parent("org/repo", 7));`, {
      parentNative: null,
      body: "Some intro\n\nPart of #99\n",
    });
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toBe("99");
  });

  it("parent returns null when neither source records one", async () => {
    const r = runNode(`console.log(await g.parent("org/repo", 7));`, {
      parentNative: null,
      body: "no references here",
    });
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toBe("null");
  });

  it("readStatus takes the first in-vocabulary card value", async () => {
    const r = runNode(`console.log(await g.readStatus(7));`);
    expect(r.status).toBe(0);
    // proj1 says Ready (in vocabulary); proj2's dash must not shadow it.
    expect(r.stdout.trim()).toBe("Ready");
  });

  it("readStatus ignores values outside the configured vocabulary", async () => {
    writeFileSync(
      join(workDir, "ig-tools", "scripts", "project-list-for-issue.sh"),
      "#!/usr/bin/env bash\nprintf 'proj1\\t1\\tOn Deck\\n'\n",
      { mode: 0o755 },
    );
    const r = runNode(`console.log(await g.readStatus(7));`);
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toBe("null");
  });

  it("workflowOrder reads the devenv.config vocabulary", async () => {
    const r = runNode(`console.log(g.workflowOrder().join(","));`);
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toBe("TBD,To-Groom,Ready,Implementing,Review,Merged,Staging,Production");
  });

  it("workflowOrder resolves the devenv root from the module location when DEVENV_ROOT is unset", async () => {
    // The default leg: no DEVENV_ROOT in the child env. URL resolution pops
    // the module filename first, so the repo root (which holds devenv.config)
    // is exactly four ../ segments up from tools/lib/domain/issues/.
    const r = spawnSync("node", ["-e",
      `const g = await import(${JSON.stringify(GRAPH)}); console.log(g.workflowOrder().join(","));`,
    ], {
      encoding: "utf8",
      cwd: repoRoot,
      env: { ...process.env, DEVENV_ROOT: "" },
    });
    expect(r.status).toBe(0);
    expect((r.stdout ?? "").trim()).toBe("TBD,To-Groom,Ready,Implementing,Review,Merged,Staging,Production");
  });

  it("linkSubissue issues the addSubIssue mutation with resolved node ids", async () => {
    const r = runNode(`await g.linkSubissue("org/repo", 42, 77); console.log("done");`);
    expect(r.status).toBe(0);
    const calls = ghCalls().join("\n");
    expect(calls).toContain("addSubIssue");
    expect(calls).toContain("p=I_stub");
    expect(calls).toContain("c=I_stub");
  });

  it("unlinkSubissue issues the removeSubIssue mutation", async () => {
    const r = runNode(`await g.unlinkSubissue("org/repo", 42, 77); console.log("done");`);
    expect(r.status).toBe(0);
    expect(ghCalls().join("\n")).toContain("removeSubIssue");
  });

  it("a failing gh makes the link fail and say why", async () => {
    writeFileSync(
      join(stubDir, "gh"),
      [
        "#!/usr/bin/env bash",
        'case "$*" in',
        '  *"graphql"*) echo "boom: rate limited" >&2; exit 1 ;;',
        '  *) exit 0 ;;',
        'esac',
        "",
      ].join("\n"),
      { mode: 0o755 },
    );
    writeFileSync(
      join(stubDir, "gh"),
      [
        "#!/usr/bin/env bash",
        'case "$*" in',
        '  *"graphql"*) echo "boom: rate limited" >&2; exit 1 ;;',
        '  *) exit 0 ;;',
        'esac',
        "",
      ].join("\n"),
      { mode: 0o755 },
    );
    const r = runNode(
      `
      try { await g.linkSubissue("org/repo", 42, 77); console.log("no-throw"); }
      catch (e) { console.log("threw:", e.message); }
    `,
      { keepStub: true },
    );
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("threw:");
    expect(r.stdout).toContain("graphql");
  });

  it("the sub-issue verbs follow DEVENV_REPO, not whatever gh would pick", async () => {
    const r = runNode(`await g.children("org/repo", 7); console.log("done");`);
    expect(r.status).toBe(0);
    expect(ghCalls().join("\n")).toContain("-f o=org -f r=repo");
  });
});
