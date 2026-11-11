// domain/issues/graph on an Azure config: the sub-issue graph reads and writes
// go through the provider facade, so they become Azure work-item requests
// (stubbed fetch) and never a `gh` GraphQL call (the canary fails the test if
// one runs).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { rmrf, tmpDir } from "./harness/index.ts";

let root = "";
let requests: Array<{ method: string; url: string; body?: string }> = [];
let items: Record<string, unknown> = {};

beforeEach(() => {
  root = tmpDir("graph-azure");
  requests = [];
  items = {};
  writeFileSync(join(root, "devenv.config"), "[provider]\nname=azure\n\n[organization]\norg=test-org\n");
  process.env.DEVENV_ROOT = root;
  process.env.AZURE_DEVOPS_ORG = "test-org";
  process.env.AZURE_DEVOPS_PROJECT = "test-project";
  process.env.AZURE_PAT = "SECRETPAT123";
  process.env.DEVENV_REPO = "test-project/repo";
  vi.stubGlobal("fetch", async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    requests.push({
      method: String(init?.method ?? "GET"),
      url: u,
      ...(typeof init?.body === "string" ? { body: init.body } : {}),
    });
    if (/\/workitemtypes(\?|$)/.test(u)) {
      return new Response(JSON.stringify({ value: [{ name: "Task", states: [{ name: "Done", category: "Completed" }] }] }), { status: 200 });
    }
    const id = /\/workitems\/(\d+)/i.exec(u)?.[1] ?? "";
    return new Response(JSON.stringify(items[id] ?? { id: Number(id), fields: {}, relations: [] }), { status: 200 });
  });
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllGlobals();
  rmrf(root);
  for (const k of ["DEVENV_ROOT", "AZURE_DEVOPS_ORG", "AZURE_DEVOPS_PROJECT", "AZURE_PAT", "DEVENV_REPO"]) delete process.env[k];
});

const wit = (id: number): string => `https://dev.azure.com/test-org/test-project/_apis/wit/workItems/${id}`;

describe("issue graph on azure", () => {
  it("children come from the parent's Hierarchy-Forward relations", async () => {
    items["5"] = {
      id: 5,
      relations: [
        { rel: "System.LinkTypes.Hierarchy-Forward", url: wit(6) },
        { rel: "System.LinkTypes.Hierarchy-Forward", url: wit(7) },
        { rel: "System.LinkTypes.Related", url: wit(9) },
      ],
    };
    const graph = await import("../../lib/domain/issues/graph.ts");
    expect(await graph.children("test-project/repo", 5)).toEqual([6, 7]);
    expect(requests.every((r) => r.url.startsWith("https://dev.azure.com/"))).toBe(true);
  });

  it("parent resolves natively through the Hierarchy-Reverse relation", async () => {
    items["6"] = { id: 6, relations: [{ rel: "System.LinkTypes.Hierarchy-Reverse", url: wit(5) }] };
    const graph = await import("../../lib/domain/issues/graph.ts");
    expect(await graph.parent("test-project/repo", 6)).toBe(5);
  });

  it("parent falls back to the body's 'Part of #N' line via the JSON body field (no jq program)", async () => {
    items["8"] = { id: 8, fields: { "System.Description": "intro\n\nPart of #3\n" }, relations: [] };
    const graph = await import("../../lib/domain/issues/graph.ts");
    expect(await graph.parent("test-project/repo", 8)).toBe(3);
    expect(requests.some((r) => r.method === "GET" && /\/workitems\/8/i.test(r.url))).toBe(true);
  });

  it("an issue with neither relation nor body line has no parent", async () => {
    items["9"] = { id: 9, fields: { "System.Description": "nothing here" }, relations: [] };
    const graph = await import("../../lib/domain/issues/graph.ts");
    expect(await graph.parent("test-project/repo", 9)).toBeNull();
  });

  it("link and unlink are work-item PATCH requests", async () => {
    items["5"] = {
      id: 5,
      relations: [{ rel: "System.LinkTypes.Hierarchy-Forward", url: wit(6) }],
    };
    const graph = await import("../../lib/domain/issues/graph.ts");
    await graph.linkSubissue("test-project/repo", 5, 7);
    await graph.unlinkSubissue("test-project/repo", 5, 6);
    const patches = requests.filter((r) => r.method === "PATCH");
    expect(patches).toHaveLength(2);
    expect(patches[0]?.body).toContain("/relations/-");
    expect(patches[1]?.body).toContain('"op":"remove"');
  });
});
