// The Azure review-thread page must have the shape pr-threads-get reads from
// the GitHub GraphQL page: `comments.nodes` per thread, and a comment
// `databaseId` carrying the token pr-thread-reply accepts as --comment-id
// ('<thread>/<comment>' on Azure). Azure HTTP is the stubbed fetch.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
