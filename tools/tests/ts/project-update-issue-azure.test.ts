// 15.14: the projects-family provider dispatch in project-update-issue —
// under [provider] name=azure the tool's ops route to the azure verbs
// (end-to-end through a stubbed fetch): the fan-out's tab-separated row
// parses with column 2 = the work-item id, and the Status write lands as
// a Kanban-column patch (no github project GraphQL anywhere).
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let root: string;
let calls: string[];
let fetchMock: (url: string | URL | Request, init?: RequestInit) => Promise<Response>;

function respond(url: string, method: string): Response {
  calls.push(`${method} ${String(url)}`);
  if (url.includes("/_apis/projects/")) {
    return new Response(JSON.stringify({ value: [{ id: "b1", name: "Stories" }] }), { status: 200 });
  }
  if (url.includes("/_apis/work/boards")) {
    return new Response(JSON.stringify({ value: [{ id: "board-1", name: "Stories" }] }), { status: 200 });
  }
  if (url.includes("/_apis/wit/workitems/101383")) {
    return new Response(
      JSON.stringify({ fields: { "System.WorkItemType": "Task", "WEF_9C4B649F_Kanban.Column": "New" } }),
      { status: 200 },
    );
  }
  if (url.includes("/_apis/wit/workitems/")) {
    return new Response(JSON.stringify({ id: 101383 }), { status: 200 });
  }
  return new Response(JSON.stringify({}), { status: 200 });
}

beforeEach(() => {
  calls = [];
  root = mkdtempSync(join(tmpdir(), "puiss-azure-"));
  writeFileSync(join(root, "devenv.config"), "[provider]\nname=azure\n");
  process.env.DEVENV_ROOT = root;
  process.env.AZURE_DEVOPS_ORG = "test-org";
  process.env.AZURE_DEVOPS_PROJECT = "test-project";
  process.env.AZURE_PAT = "SECRETPAT123";
  fetchMock = (async (url, init) => respond(String(url), String(init?.method ?? "GET"))) as typeof fetch;
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  rmSync(root, { recursive: true, force: true });
  delete process.env.DEVENV_ROOT;
  delete process.env.AZURE_DEVOPS_ORG;
  delete process.env.AZURE_DEVOPS_PROJECT;
  delete process.env.AZURE_PAT;
});

describe("projects-family provider dispatch (azure)", () => {
  it("idByName passes a numeric work-item id straight through (no board lookup)", async () => {
    vi.resetModules();
    const az = await import("../../lib/providers/azure/projects.ts");
    const id = await az.projectsIdByName("ignored", "101383");
    expect(id).toBe("101383");
    expect(calls.every((c) => !c.includes("/_apis/work/boards?"))).toBe(true);
  });

  it("the fan-out row parses tab-separated with column 2 = work-item id", async () => {
    vi.resetModules();
    const az = await import("../../lib/providers/azure/projects.ts");
    const raw = await az.projectsForIssue("https://dev.azure.com/org/proj/_workitems/edit/101383", "ignored");
    // the tool's azure adapter splits this line on tabs; column 2 feeds
    // the Status write — pin the exact seam the report described.
    const [board, number, status] = raw.split("\t");
    expect(board).toBe("Task Board"); // Task items land on the Task board (boardNameForType)
    expect(number).toBe("101383");
    expect(status).toBe("New");
  });

  it("fieldSet patches the Kanban column through the azure transport", async () => {
    vi.resetModules();
    const az = await import("../../lib/providers/azure/projects.ts");
    await az.projectsFieldSet("", "101383", "Status", "Done");
    const patch = calls.find((c) => c.startsWith("PATCH"));
    expect(patch).toBeDefined();
    expect(calls.some((c) => c.includes("graphql") || c.includes("projectV2"))).toBe(false);
  });
});
