// The Azure review-thread page must have the shape pr-threads-get reads from
// the GitHub GraphQL page: `comments.nodes` per thread, and a comment
// `databaseId` carrying the token pr-thread-reply accepts as --comment-id
// ('<thread>/<comment>' on Azure). Azure HTTP is the stubbed fetch.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { drainCanary } from "./harness/canary.ts";
import { rmrf, runTool, tmpDir } from "./harness/index.ts";
import { azureFixture, azureJson, stubAzureFetch, useAzureEnv } from "./harness/azure-stub.ts";
import { prsThreadResolve, prsThreadsPage } from "../../lib/providers/azure/prs.ts";

const THREADS_URL = "https://dev.azure.com/test-org/test-project/_apis/git/repositories/widgets/pullrequests/11913/threads?api-version=7.1";

interface Page {
  data: {
    repository: {
      pullRequest: {
        reviewThreads: {
          pageInfo: { hasNextPage: boolean; endCursor: string | null };
          nodes: Array<{
            id: string;
            isResolved: boolean;
            comments: { nodes: Array<{ id: string; databaseId: string; body: string; author: { login: string } }> };
          }>;
        };
      };
    };
  };
}

let restoreEnv: () => void = () => {};

beforeEach(() => {
  restoreEnv = useAzureEnv("test-org", "test-project");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  restoreEnv();
});

describe("azure prsThreadsPage seam shape", () => {
  it("nests comments under comments.nodes with the reply token as databaseId", async () => {
    stubAzureFetch([{ method: "GET", url: THREADS_URL, respond: azureJson(azureFixture("pullrequest.threads.json")) }]);
    const page = (await prsThreadsPage("widgets", 11913)) as unknown as Page;
    const rt = page.data.repository.pullRequest.reviewThreads;
    expect(rt.pageInfo).toEqual({ hasNextPage: false, endCursor: null });
    expect(rt.nodes.map((t) => t.id)).toEqual(["11913/62644", "11913/62645"]);
    const first = rt.nodes[0]?.comments.nodes ?? [];
    expect(Array.isArray(first)).toBe(true);
    expect(first).toHaveLength(1);
    expect(first[0]).toMatchObject({ databaseId: "62644/1", body: "smoke thread" });
  });

  it("emits a databaseId pr-thread-reply accepts as --comment-id", async () => {
    stubAzureFetch([{ method: "GET", url: THREADS_URL, respond: azureJson(azureFixture("pullrequest.threads.json")) }]);
    const page = (await prsThreadsPage("widgets", 11913)) as unknown as Page;
    for (const t of page.data.repository.pullRequest.reviewThreads.nodes) {
      for (const c of t.comments.nodes) {
        expect(c.databaseId).toMatch(/^[0-9]+(\/[0-9]+)?$/);
      }
    }
  });

  it("returns an empty comments.nodes page for a continuation cursor", async () => {
    stubAzureFetch([]);
    const page = (await prsThreadsPage("widgets", 11913, "next")) as unknown as Page;
    expect(page.data.repository.pullRequest.reviewThreads.nodes).toEqual([]);
  });
});

describe("azure prsThreadsPage comment filtering", () => {
  it("drops individually deleted comments and keeps the rest of the thread", async () => {
    const thread = {
      id: 7,
      status: "active",
      comments: [
        { id: 1, content: "kept", commentType: "text", author: { displayName: "A" } },
        { id: 2, content: "", commentType: "text", isDeleted: true, author: { displayName: "B" } },
        { id: 3, content: "also kept", commentType: "text", parentCommentId: 1, author: { displayName: "C" } },
      ],
    };
    stubAzureFetch([{ method: "GET", url: THREADS_URL, respond: azureJson({ value: [thread] }) }]);
    const page = (await prsThreadsPage("widgets", 11913)) as unknown as Page;
    const nodes = page.data.repository.pullRequest.reviewThreads.nodes;
    expect(nodes[0]?.comments.nodes.map((c) => c.databaseId)).toEqual(["7/1", "7/3"]);
  });

  it("omits a thread whose only comments are deleted", async () => {
    const thread = {
      id: 8,
      status: "active",
      comments: [{ id: 1, content: "", commentType: "text", isDeleted: true }],
    };
    stubAzureFetch([{ method: "GET", url: THREADS_URL, respond: azureJson({ value: [thread] }) }]);
    const page = (await prsThreadsPage("widgets", 11913)) as unknown as Page;
    expect(page.data.repository.pullRequest.reviewThreads.nodes).toEqual([]);
  });
});

describe("azure prsThreadResolve result", () => {
  const PATCH_URL = "https://dev.azure.com/test-org/test-project/_apis/git/repositories/widgets/pullrequests/11913/threads/62644?api-version=7.1";

  it.each([
    ["fixed", "true"],
    ["active", "unknown"],
    ["pending", "unknown"],
    ["unknown", "unknown"],
  ])("reports a PATCH response status of '%s' as %s", async (status, expected) => {
    stubAzureFetch([{ method: "PATCH", url: PATCH_URL, respond: azureJson({ status }) }]);
    expect(await prsThreadResolve("widgets", "11913/62644")).toBe(expected);
  });
});

// The tool runs as a child process; the fetch canary records the URL it was
// refused, which is the observable route (see pr-thread-reply-azure-route).
describe("pr-threads-get repository targeting on Azure", () => {
  let root = "";
  let repoDir = "";

  function threadsUrls(): string[] {
    return drainCanary()
      .filter((l) => l.startsWith("fetch "))
      .map((l) => l.slice("fetch ".length))
      .filter((u) => u.includes("/threads"));
  }

  function setupRepo(origin: string): void {
    repoDir = join(root, "clone");
    mkdirSync(repoDir, { recursive: true });
    for (const args of [["init", "-q"], ["remote", "add", "origin", origin]]) {
      spawnSync("git", args, { cwd: repoDir });
    }
  }

  beforeEach(() => {
    root = tmpDir("threads-get-target");
    mkdirSync(root, { recursive: true });
    writeFileSync(
      join(root, "devenv.config"),
      ["[provider]", "name=azure", "azure_org=acme", "azure_project=proj", "", "[organization]", "org=acme", ""].join("\n"),
    );
    drainCanary();
  });

  afterEach(() => {
    rmrf(root);
  });

  it("keeps the project of a full org/project/repo spec", () => {
    runTool("pr-threads-get", ["12"], {
      env: { DEVENV_ROOT: root, DEVENV_REPO: "acme/proj/widgets", AZURE_PAT: "fake-pat" },
    });
    const urls = threadsUrls();
    expect(urls.length).toBeGreaterThan(0);
    for (const u of urls) expect(u).toContain("/proj/_apis/git/repositories/widgets/pullrequests/12/threads");
  });

  it("falls back to the Azure origin remote when the target has no owner", () => {
    setupRepo("https://acme@dev.azure.com/acme/proj/_git/widgets");
    runTool("pr-threads-get", ["12"], {
      cwd: repoDir,
      env: { DEVENV_ROOT: root, DEVENV_REPO: "widgets", AZURE_PAT: "fake-pat" },
    });
    const urls = threadsUrls();
    expect(urls.length).toBeGreaterThan(0);
    for (const u of urls) expect(u).toContain("/proj/_apis/git/repositories/widgets/pullrequests/12/threads");
  });

  it("fails with a provider-neutral message when no remote can be resolved", () => {
    setupRepo("https://example.com/not/azure.git");
    const r = runTool("pr-threads-get", ["12"], {
      cwd: repoDir,
      env: { DEVENV_ROOT: root, DEVENV_REPO: "widgets", AZURE_PAT: "fake-pat" },
    });
    expect(r.status).not.toBe(0);
    expect(r.output).toContain("Cannot determine repository");
    expect(r.output).not.toContain("owner/name");
    expect(threadsUrls()).toHaveLength(0);
  });
});
