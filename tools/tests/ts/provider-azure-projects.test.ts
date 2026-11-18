// Azure board writes: the column field is the default team's board's when an
// item sits on several boards, an item that is on no board is moved by a real
// process state (never an unchecked column word), and a status word that names
// no column is refused when the columns are known.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { azureJson, stubAzureFetch, useAzureEnv } from "./harness/azure-stub.ts";
import { projectsFieldOptionIds, projectsFieldSet, projectsForIssue } from "../../lib/providers/azure/projects.ts";

const WI = /\/_apis\/wit\/workitems\/7\?/;
const PROJECT = /\/_apis\/projects\/test-project\?includeCapabilities=true/;

let restoreEnv: () => void = () => {};

beforeEach(() => {
  restoreEnv = useAzureEnv("test-org", "test-project");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  restoreEnv();
});

const item = (fields: Record<string, unknown>) => azureJson({ id: 7, fields: { "System.WorkItemType": "User Story", ...fields } });
const teamRoute = { method: "GET", url: PROJECT, respond: azureJson({ id: "p1", defaultTeam: { id: "team-1" } }) };
const patchRoute = { method: "PATCH", url: WI, respond: azureJson({ id: 7 }) };

function patchedOps(stub: { requests: Array<{ method: string; body: unknown }> }): Array<{ path: string; value: unknown }> {
  return stub.requests.find((r) => r.method === "PATCH")?.body as Array<{ path: string; value: unknown }>;
}

describe("projectsFieldSet on an item with several board columns", () => {
  const twoBoards = { "WEF_AAA_Kanban.Column": "New", "WEF_BBB_Kanban.Column": "Active" };

  it("writes the column field of the default team's board", async () => {
    const stub = stubAzureFetch([
      { method: "GET", url: WI, respond: item(twoBoards) },
      teamRoute,
      {
        method: "GET",
        url: /\/team-1\/_apis\/work\/boards\/Stories\?/,
        respond: azureJson({ id: "b1", name: "Stories", fields: { columnField: { referenceName: "WEF_BBB_Kanban.Column" } } }),
      },
      patchRoute,
    ]);
    await projectsFieldSet("", "7", "Status", "Done");
    expect(patchedOps(stub)[0]).toMatchObject({ path: "/fields/WEF_BBB_Kanban.Column", value: "Done" });
  });

  it("refuses, naming the candidates, when the default board's field cannot be resolved", async () => {
    const stub = stubAzureFetch([
      { method: "GET", url: WI, respond: item(twoBoards) },
      teamRoute,
      { method: "GET", url: /\/team-1\/_apis\/work\/boards\/Stories\?/, respond: azureJson({ id: "b1", name: "Stories" }) },
    ]);
    await expect(projectsFieldSet("", "7", "Status", "Done")).rejects.toThrow(/WEF_AAA_Kanban\.Column.*WEF_BBB_Kanban\.Column/s);
    expect(stub.requests.some((r) => r.method === "PATCH")).toBe(false);
  });

  it("uses the only column field without asking for the board", async () => {
    const stub = stubAzureFetch([{ method: "GET", url: WI, respond: item({ "WEF_AAA_Kanban.Column": "New" }) }, patchRoute]);
    await projectsFieldSet("", "7", "Done", "Done");
    expect(patchedOps(stub)[0]).toMatchObject({ path: "/fields/WEF_AAA_Kanban.Column" });
    expect(stub.requests.filter((r) => r.method === "GET")).toHaveLength(1);
  });
});

describe("projectsFieldSet on an item that is on no board", () => {
  const statesRoute = {
    method: "GET",
    url: /\/workitemtypes\/User%20Story\/states/,
    respond: azureJson({ value: [{ name: "New" }, { name: "Active" }, { name: "Closed" }] }),
  };

  it("moves it by a process state the word names", async () => {
    const stub = stubAzureFetch([{ method: "GET", url: WI, respond: item({}) }, statesRoute, patchRoute]);
    await projectsFieldSet("", "7", "Status", "Active");
    expect(patchedOps(stub)[0]).toMatchObject({ path: "/fields/System.State", value: "Active" });
  });

  it("refuses a column word that is no state of the type, before any PATCH", async () => {
    const stub = stubAzureFetch([{ method: "GET", url: WI, respond: item({}) }, statesRoute]);
    await expect(projectsFieldSet("", "7", "Status", "Done")).rejects.toThrow(/Done.*no process state/s);
    expect(stub.requests.some((r) => r.method === "PATCH")).toBe(false);
  });
});

describe("projectsFieldOptionIds", () => {
  it("passes a word through, leaving its validation to the write", async () => {
    // A process state that is no board column must still reach projectsFieldSet.
    await expect(projectsFieldOptionIds("", "Status", "Closed")).resolves.toEqual({ fieldId: "Status", optionId: "Closed" });
  });
});

describe("projectsForIssue on an item with several board columns", () => {
  it("reads the first column when the default team's board cannot be resolved", async () => {
    stubAzureFetch([
      { method: "GET", url: /\/_apis\/wit\/workitems\/7(\?|$)/, respond: item({ "WEF_AAA_Kanban.Column": "New", "WEF_BBB_Kanban.Column": "Active" }) },
      teamRoute,
      { method: "GET", url: /\/team-1\/_apis\/work\/boards\/Stories\?/, respond: azureJson({ message: "no" }, 404) },
    ]);
    const row = await projectsForIssue("https://dev.azure.com/org/proj/_workitems/edit/7", "o");
    expect(row.split("\t")[2]).toBe("New");
  });
});
