// pr-facade-parity.test.ts — the neutral PR facade verbs behave the same on
// both providers: thread resolve carries the repo, comment refs survive the
// reply path, merge methods map per provider, the branch is only deleted on
// request, and a merge can be pinned to an expected head commit.
//
// Azure HTTP is mocked by stubbing globalThis.fetch; GitHub by a stub gh on
// PATH. Nothing touches a real backend.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, writeFileSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type * as facadePrs from "../../lib/providers/facade/prs.ts";

const dirs: string[] = [];
const saved = {
  PATH: process.env.PATH,
  DEVENV_ROOT: process.env.DEVENV_ROOT,
  DEVENV_REPO: process.env.DEVENV_REPO,
  AZURE_PAT: process.env.AZURE_PAT,
};

function restoreEnv(): void {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
}

async function loadFacade(provider: "github" | "azure"): Promise<typeof facadePrs> {
  const root = mkdtempSync(join(tmpdir(), "prfacade-cfg-"));
  dirs.push(root);
  writeFileSync(
    join(root, "devenv.config"),
    `[provider]\nname=${provider}\nazure_org=org\nazure_project=proj\n\n[organization]\norg=fixture-org\n`,
  );
  vi.resetModules();
  process.env.DEVENV_ROOT = root;
  return import("../../lib/providers/facade/prs.ts");
}

// ---------------------------------------------------------------------------
// Azure (stubbed fetch)
// ---------------------------------------------------------------------------

interface Req { method: string; url: string; body: unknown }

function stubAzure(pr: Record<string, unknown> = {}): Req[] {
  const reqs: Req[] = [];
  vi.stubGlobal("fetch", (async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    const method = init?.method ?? "GET";
    reqs.push({ method, url: u, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    if (method === "GET") {
      return new Response(JSON.stringify({ lastMergeSourceCommit: { commitId: "abc123" }, ...pr }), { status: 200 });
    }
    return new Response(JSON.stringify({ id: 5, status: "completed" }), { status: 200 });
  }) as unknown as typeof fetch);
  return reqs;
}

describe("azure PR facade verbs", () => {
  beforeEach(() => {
    process.env.AZURE_PAT = "fake-pat";
    delete process.env.DEVENV_REPO;
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    restoreEnv();
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  it("prsThreadResolve with a repo-less ref resolves the repo from DEVENV_REPO", async () => {
    const facade = await loadFacade("azure");
    const reqs = stubAzure();
    process.env.DEVENV_REPO = "org/proj/widgets";
    const r = await facade.prsThreadResolve(undefined, "12/34");
    expect(r.stdout.trim()).not.toBe("");
    expect(reqs).toHaveLength(1);
    expect(reqs[0]?.method).toBe("PATCH");
    expect(reqs[0]?.url).toContain("/repositories/widgets/pullrequests/12/threads/34");
  });

  it("prsThreadResolve prefers an explicit spec over DEVENV_REPO", async () => {
    const facade = await loadFacade("azure");
    const reqs = stubAzure();
    process.env.DEVENV_REPO = "org/proj/other";
    await facade.prsThreadResolve("org/proj/widgets", "12/34");
    expect(reqs[0]?.url).toContain("/repositories/widgets/pullrequests/12/threads/34");
  });

  it("prsThreadResolve with no repo anywhere is a named error", async () => {
    const facade = await loadFacade("azure");
    stubAzure();
    // Outside a git tree the cwd leg cannot resolve a repo either.
    const cwd = process.cwd();
    const bare = mkdtempSync(join(tmpdir(), "prfacade-nogit-"));
    dirs.push(bare);
    process.chdir(bare);
    try {
      await expect(facade.prsThreadResolve(undefined, "12/34")).rejects.toThrow(/no repository could be resolved/);
    } finally {
      process.chdir(cwd);
    }
  });

  it("prsThreadReply forwards an Azure <thread>/<comment> ref so the reply nests under that comment", async () => {
    const facade = await loadFacade("azure");
    const reqs = stubAzure();
    await facade.prsThreadReply("org/proj/widgets", 12, "34/7", "ok");
    expect(reqs).toHaveLength(1);
    expect(reqs[0]?.url).toContain("/pullrequests/12/threads/34/comments");
    expect((reqs[0]?.body as { parentCommentId: number }).parentCommentId).toBe(7);
  });

  it("prsMerge maps the neutral methods to Azure merge strategies", async () => {
    const facade = await loadFacade("azure");
    for (const [method, strategy] of [["merge", "noFastForward"], ["squash", "squash"], ["rebase", "rebase"]] as const) {
      const reqs = stubAzure();
      await facade.prsMerge("org/proj/widgets", 12, { method });
      const patch = reqs.find((r) => r.method === "PATCH");
      expect((patch?.body as { completionOptions: { mergeStrategy: string } }).completionOptions.mergeStrategy).toBe(strategy);
    }
  });

  it("prsMerge rejects an unsupported method by name, before any request", async () => {
    const facade = await loadFacade("azure");
    const reqs = stubAzure();
    await expect(facade.prsMerge("org/proj/widgets", 12, { method: "fast-forward" })).rejects.toThrow(
      /unsupported merge method 'fast-forward'/,
    );
    expect(reqs).toHaveLength(0);
  });

  it("prsMerge keeps the source branch unless deleteBranch is true", async () => {
    const facade = await loadFacade("azure");
    let reqs = stubAzure();
    await facade.prsMerge("org/proj/widgets", 12, { method: "rebase" });
    const del = (rs: Req[]): unknown =>
      (rs.find((r) => r.method === "PATCH")?.body as { completionOptions: { deleteSourceBranch: boolean } }).completionOptions.deleteSourceBranch;
    expect(del(reqs)).toBe(false);
    reqs = stubAzure();
    await facade.prsMerge("org/proj/widgets", 12, { method: "rebase", deleteBranch: true });
    expect(del(reqs)).toBe(true);
  });

  it("prsMerge refuses when the PR head differs from matchHeadCommit, and proceeds when it matches", async () => {
    const facade = await loadFacade("azure");
    let reqs = stubAzure();
    await expect(facade.prsMerge("org/proj/widgets", 12, { matchHeadCommit: "deadbeef" })).rejects.toThrow(
      /does not match the expected head deadbeef/,
    );
    expect(reqs.some((r) => r.method === "PATCH")).toBe(false);
    reqs = stubAzure();
    await facade.prsMerge("org/proj/widgets", 12, { matchHeadCommit: "abc123" });
    expect(reqs.some((r) => r.method === "PATCH")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// GitHub (stub gh)
// ---------------------------------------------------------------------------

describe("github PR facade verbs", () => {
  let stubDir = "";
  let log = "";

  beforeEach(() => {
    stubDir = mkdtempSync(join(tmpdir(), "prfacade-gh-"));
    dirs.push(stubDir);
    log = join(stubDir, "calls.log");
    writeFileSync(
      join(stubDir, "gh"),
      `#!/usr/bin/env bash\nprintf '%s\\n' "$*" >> "${log}"\necho '{}'\n`,
      { mode: 0o755 },
    );
    process.env.PATH = `${stubDir}:${process.env.PATH ?? ""}`;
    delete process.env.DEVENV_REPO;
  });
  afterEach(() => {
    restoreEnv();
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  const calls = (): string[] => (existsSync(log) ? readFileSync(log, "utf8").split("\n").filter(Boolean) : []);

  it("prsMerge does not delete the branch by default and deletes it on request", async () => {
    const facade = await loadFacade("github");
    await facade.prsMerge("o/r", 5, { method: "rebase" });
    await facade.prsMerge("o/r", 6, { method: "rebase", deleteBranch: true });
    const [first, second] = calls();
    expect(first).not.toContain("--delete-branch");
    expect(second).toContain("--delete-branch");
  });

  it("prsMerge passes --match-head-commit <sha> to gh pr merge", async () => {
    const facade = await loadFacade("github");
    await facade.prsMerge("o/r", 5, { method: "rebase", matchHeadCommit: "abc123" });
    const args = (calls()[0] ?? "").split(" ");
    const i = args.indexOf("--match-head-commit");
    expect(i).toBeGreaterThan(-1);
    expect(args[i + 1]).toBe("abc123");
  });

  it("prsMerge rejects an unsupported method by name, without calling gh", async () => {
    const facade = await loadFacade("github");
    await expect(facade.prsMerge("o/r", 5, { method: "noFastForward" })).rejects.toThrow(/unsupported merge method/);
    expect(calls()).toHaveLength(0);
  });

  it("prsThreadReply parses a numeric comment id from the string ref", async () => {
    const facade = await loadFacade("github");
    await facade.prsThreadReply("o/r", 3, "456", "hi");
    expect(calls()[0]).toContain("/repos/o/r/pulls/3/comments/456/replies");
  });

  it("prsThreadResolve ignores the spec and sends the node id", async () => {
    const facade = await loadFacade("github");
    await facade.prsThreadResolve("o/r", "T1").catch(() => undefined);
    expect(calls().join("\n")).toContain("threadId=T1");
  });
});
