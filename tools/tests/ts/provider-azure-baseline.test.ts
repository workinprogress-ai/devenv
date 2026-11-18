// Baseline for the Azure provider through the shared stub: the behavior that
// already works and later fixes must preserve (PR view mapping, work-item view
// mapping, the supported remote forms), plus the harness's own contract
// (exact-URL matching, loud failure on an unrouted request). Azure HTTP is the
// stubbed global fetch from harness/azure-stub.ts; nothing leaves the process.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { azureFixture, azureJson, stubAzureFetch, useAzureEnv } from "./harness/azure-stub.ts";
import { prsView } from "../../lib/providers/azure/prs.ts";
import { issuesView } from "../../lib/providers/azure/issues.ts";
import { azureParseRemote } from "../../lib/providers/azure/urls.ts";

const WIT = "https://dev.azure.com/test-org/test-project/_apis/wit";
const GIT = "https://dev.azure.com/test-org/test-project/_apis/git";

interface PrFixture {
  lastMergeSourceCommit: { commitId: string };
  createdBy: { displayName: string };
  repository: { webUrl: string };
  creationDate: string;
  closedDate: string;
}

interface WorkItemFixture {
  fields: {
    "System.WorkItemType": string;
    "System.Title": string;
    "System.AssignedTo": { displayName: string };
    "System.CreatedBy": { displayName: string };
    "System.CreatedDate": string;
    "System.ChangedDate": string;
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

describe("azure stub harness contract", () => {
  it("matches a string route by exact URL only", async () => {
    const stub = stubAzureFetch([{ url: "https://dev.azure.com/o/p/_apis/x", respond: azureJson({ ok: true }) }], {
      allowUnmatched: true,
    });
    const hit = await fetch("https://dev.azure.com/o/p/_apis/x");
    const near = await fetch("https://dev.azure.com/o/p/_apis/x/extra");
    expect(hit.status).toBe(200);
    expect(near.status).toBe(418);
    expect(stub.unmatched().map((r) => r.url)).toEqual(["https://dev.azure.com/o/p/_apis/x/extra"]);
  });

  it("records method, URL and the parsed JSON body", async () => {
    const stub = stubAzureFetch([{ method: "POST", url: /\/_apis\/y$/, respond: azureJson({}) }]);
    await fetch("https://dev.azure.com/o/p/_apis/y", { method: "POST", body: JSON.stringify({ a: 1 }) });
    expect(stub.requests).toEqual([{ method: "POST", url: "https://dev.azure.com/o/p/_apis/y", body: { a: 1 } }]);
  });

  it("builds a bodyless response for statuses that forbid a body", () => {
    expect(azureJson({ ignored: true }, 204).status).toBe(204);
    expect(azureJson({ ignored: true }, 304).status).toBe(304);
  });

  it("serves recorded fixtures", () => {
    const pr = azureFixture<{ pullRequestId: number }>("pullrequest.completed.json");
    expect(pr.pullRequestId).toBe(11912);
  });
});

describe("azure prsView baseline", () => {
  const pr = azureFixture<PrFixture>("pullrequest.completed.json");

  const expected = {
    number: 11912,
    id: 11912,
    title: "chore: smoke destructive probe",
    body: "smoke",
    state: "MERGED",
    isDraft: false,
    headRefName: "smoke-1685774",
    baseRefName: "main",
    headRefOid: pr.lastMergeSourceCommit.commitId,
    author: { login: pr.createdBy.displayName },
    labels: [],
    assignees: [],
    reviewRequests: [],
    milestone: "",
    mergeable: "MERGEABLE",
    mergeStateStatus: "CLEAN",
    url: `${pr.repository.webUrl}/pullrequest/11912`,
    createdAt: pr.creationDate,
    updatedAt: pr.closedDate,
    closedAt: pr.closedDate,
    mergedAt: pr.closedDate,
    comments: [],
    reviews: [],
  };

  it("maps a recorded PR to the full seam record (org/project scoped route)", async () => {
    const stub = stubAzureFetch([
      { method: "GET", url: `${GIT}/pullrequests/11912?api-version=7.1`, respond: azureJson(pr) },
    ]);
    const view = await prsView("", 11912);
    expect(view).toEqual(expected);
    expect(stub.requests.map((r) => r.url)).toEqual([`${GIT}/pullrequests/11912?api-version=7.1`]);
  });

  it("requests the repository-scoped route when a repo is named", async () => {
    const stub = stubAzureFetch([
      { method: "GET", url: `${GIT}/repositories/widgets/pullrequests/11912?api-version=7.1`, respond: azureJson(pr) },
    ]);
    const view = await prsView("widgets", 11912);
    expect(view).toEqual(expected);
    expect(stub.requests.map((r) => r.url)).toEqual([`${GIT}/repositories/widgets/pullrequests/11912?api-version=7.1`]);
  });
});

describe("azure issuesView baseline", () => {
  it("maps a recorded work item and counts its comments", async () => {
    const item = azureFixture<WorkItemFixture>("workitem.get.json");
    const fields = item.fields;
    const stub = stubAzureFetch([
      {
        method: "GET",
        url: `${WIT}/workitems/101034/comments?$top=1&api-version=7.2-preview.4`,
        respond: azureJson({ totalCount: 3, comments: [] }),
      },
      {
        method: "GET",
        url: `${WIT}/workitems/101034?$expand=relations&api-version=7.1`,
        respond: azureJson(item),
      },
      {
        method: "GET",
        url: `${WIT}/workitemtypes?api-version=7.1`,
        respond: azureJson({
          value: [{ name: "User Story", states: azureFixture<{ value: unknown[] }>("workitemtypes.user-story.states.json").value }],
        }),
      },
    ]);
    const view = await issuesView("", 101034);
    expect(view).toEqual({
      number: 101034,
      type: fields["System.WorkItemType"],
      parent: null,
      title: fields["System.Title"],
      state: "OPEN",
      body: "",
      labels: [{ name: "smoke-tag" }, { name: "smoke-tag-2" }],
      assignees: [{ login: fields["System.AssignedTo"].displayName }],
      milestone: "",
      author: { login: fields["System.CreatedBy"].displayName },
      createdAt: fields["System.CreatedDate"],
      updatedAt: fields["System.ChangedDate"],
      closedAt: "",
      url: "https://dev.azure.com/test-org/test-project/_workitems/edit/101034",
      comments: 3,
    });
    expect(stub.requests.map((r) => r.url).sort()).toEqual(
      [
        `${WIT}/workitems/101034?$expand=relations&api-version=7.1`,
        `${WIT}/workitemtypes?api-version=7.1`,
        `${WIT}/workitems/101034/comments?$top=1&api-version=7.2-preview.4`,
      ].sort(),
    );
  });
});

describe("azureParseRemote baseline", () => {
  it.each([
    ["https://dev.azure.com/acme/proj/_git/widgets", { org: "acme", project: "proj", repo: "widgets" }],
    ["https://dev.azure.com/acme/proj/_git/widgets.git", { org: "acme", project: "proj", repo: "widgets" }],
    ["https://acme.visualstudio.com/proj/_git/widgets", { org: "acme", project: "proj", repo: "widgets" }],
    ["https://user@acme.visualstudio.com/proj/_git/widgets", { org: "acme", project: "proj", repo: "widgets" }],
    ["git@ssh.dev.azure.com:v3/acme/proj/widgets", { org: "acme", project: "proj", repo: "widgets" }],
    ["https://dev.azure.com/acme/My%20Project/_git/widgets", { org: "acme", project: "My Project", repo: "widgets" }],
  ])("parses %s", (url, expected) => {
    expect(azureParseRemote(url)).toEqual(expected);
  });

  it("returns null for a non-Azure remote", () => {
    expect(azureParseRemote("https://example.com/acme/widgets.git")).toBeNull();
  });
});
