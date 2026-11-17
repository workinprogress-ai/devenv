// provider-round3.test.ts — second adversarial-review fixes: azure run-list jq
// parity (pipelines-watch/-run drive the real programs), watch failure output,
// issue-update --type without a body, revision-conflict detection, artifact
// download confinement, success filter, tag semantics, close/reopen ordering
// and empty comment files. Azure HTTP is a stubbed fetch (in-process) or a
// preloaded fetch stub (black-box tools); GitHub is a stub `gh` on PATH.
// Nothing reaches a backend.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { CALLS_LOG_NAME, pathWithStubs, rmrf, runTool, stubGh, tmpDir } from "./harness/index.ts";

interface Req {
  method: string;
  url: string;
  body: unknown;
}
type Op = { op: string; path: string; value?: unknown };
type Route = { m?: string; u: string; s?: number; b?: unknown };

const savedEnv = { ...process.env };
const dirs: string[] = [];
const PRELOAD = pathToFileURL(fileURLToPath(new URL("./provider-round3-fetch-stub.mjs", import.meta.url))).href;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

function stubFetch(handler: (r: Req) => Response | undefined): Req[] {
  const calls: Req[] = [];
  vi.stubGlobal("fetch", (async (url: string | URL | Request, init?: RequestInit) => {
    const raw = init?.body === undefined ? undefined : String(init.body);
    const req: Req = { method: init?.method ?? "GET", url: String(url), body: raw === undefined ? undefined : (JSON.parse(raw) as unknown) };
    calls.push(req);
    return handler(req) ?? json({});
  }) as unknown as typeof fetch);
  return calls;
}

function useConfig(provider: "github" | "azure"): string {
  const root = tmpDir("round3");
  dirs.push(root);
  writeFileSync(
    join(root, "devenv.config"),
    `[provider]\nname=${provider}\nazure_org=org\nazure_project=proj\n\n[organization]\norg=fixture-org\n\n[azure_body_fields]\nBug=Microsoft.VSTS.TCM.ReproSteps\n`,
  );
  process.env.DEVENV_ROOT = root;
  process.env.AZURE_DEVOPS_ORG = "test-org";
  process.env.AZURE_DEVOPS_PROJECT = "test-project";
  process.env.AZURE_PAT = "test-pat";
  vi.resetModules();
  return root;
}

/** Run a tool as a child on the azure provider with the scripted fetch. */
function runAzureTool(tool: string, args: string[], routes: Route[]): { status: number; output: string; log: string[] } {
  const root = useConfig("azure");
  const log = join(root, "fetch.log");
  writeFileSync(log, "");
  const r = runTool(tool, args, {
    env: {
      DEVENV_ROOT: root,
      AZURE_PAT: "test-pat",
      AZ_STUB_ROUTES: JSON.stringify(routes),
      AZ_STUB_LOG: log,
      NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ""} --import=${PRELOAD}`.trim(),
    },
  });
  return { status: r.status, output: r.output, log: readFileSync(log, "utf8").split("\n").filter((l) => l !== "") };
}

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  for (const k of Object.keys(process.env)) if (!(k in savedEnv)) delete process.env[k];
  Object.assign(process.env, savedEnv);
  for (const d of dirs.splice(0)) rmrf(d);
});

// ---------------------------------------------------------------------------
// Pipelines: run list jq subset, watch, run
// ---------------------------------------------------------------------------

const REPO_ROUTE: Route = { u: "/git/repositories/", b: { id: "guid-1" } };
const builds = (rows: unknown[]): Route => ({ u: "/_apis/build/builds?", b: { value: rows } });

describe("azure run list jq subset", () => {
  it("supports .[0].field, .[N].field and a trailing // empty", async () => {
    useConfig("azure");
    stubFetch((r) =>
      r.url.includes("/git/repositories/")
        ? json({ id: "guid-1" })
        : json({ value: [{ id: 11, status: "inProgress" }, { id: 12, status: "inProgress" }] }),
    );
    const az = await import("../../lib/providers/azure/pipelines.ts");
    expect(await az.pipelinesRunList("org/proj/repo", { json: "id", jq: ".[0].id // empty" })).toBe("11");
    expect(await az.pipelinesRunList("org/proj/repo", { json: "id", jq: ".[1].id" })).toBe("12");
    expect(await az.pipelinesRunList("org/proj/repo", { json: "id", jq: ".[5].id // empty" })).toBe("");
    expect(await az.pipelinesRunList("org/proj/repo", { json: "id", jq: ".[].id // empty" })).toBe("11\n12");
  });

  it("a // default string substitutes for an absent element", async () => {
    useConfig("azure");
    stubFetch((r) => (r.url.includes("/git/repositories/") ? json({ id: "g" }) : json({ value: [] })));
    const az = await import("../../lib/providers/azure/pipelines.ts");
    expect(await az.pipelinesRunList("org/proj/repo", { json: "id", jq: '.[0].id // "none"' })).toBe("none");
  });

  it("still refuses a program outside the subset by name", async () => {
    useConfig("azure");
    stubFetch(() => json({ id: "g", value: [] }));
    const az = await import("../../lib/providers/azure/pipelines.ts");
    await expect(az.pipelinesRunList("org/proj/repo", { jq: "map(.id)" })).rejects.toThrow(/unsupported jq program/);
  });
});

describe("pipelines-watch on azure", () => {
  it("auto-detects the in-progress run through its real jq program", () => {
    const r = runAzureTool("pipelines-watch", ["--repo", "org/proj/repo"], [
      REPO_ROUTE,
      builds([{ id: 41, status: "inProgress" }]),
      { u: "/builds/41", b: { id: 41, status: "completed", result: "succeeded", definition: { name: "ci" } } },
    ]);
    expect(r.output).not.toMatch(/No in-progress runs found/);
    expect(r.output).toMatch(/Found in-progress run: 41/);
    expect(r.status).toBe(0);
  });

  it("reports no run when none is in progress", () => {
    const r = runAzureTool("pipelines-watch", ["--repo", "org/proj/repo"], [REPO_ROUTE, builds([])]);
    expect(r.output).toMatch(/No in-progress runs found/);
    expect(r.status).not.toBe(0);
  });

  it("prints the failure reason and exits non-zero for a failed run", () => {
    const r = runAzureTool("pipelines-watch", ["7", "--repo", "org/proj/repo", "--exit-status"], [
      { u: "/builds/7", b: { id: 7, status: "completed", result: "failed", definition: { name: "ci" } } },
    ]);
    expect(r.status).not.toBe(0);
    expect(r.output).toMatch(/run 7 concluded failure/);
  });
});

describe("pipelines-run on azure", () => {
  it("reports the URL of the build it queued, not a list lookup", () => {
    const r = runAzureTool("pipelines-run", ["3", "--repo", "org/proj/repo", "--ref", "main"], [
      { m: "POST", u: "/_apis/build/builds", b: { id: 77 } },
      { m: "GET", u: "/_apis/build/builds/77", b: { id: 77, status: "notStarted", definition: { name: "ci" } } },
      REPO_ROUTE,
      builds([{ id: 76, status: "completed" }]),
    ]);
    expect(r.status).toBe(0);
    expect(r.output).toMatch(/Run URL: .*buildId=77/);
    expect(r.output).not.toMatch(/URL not yet available/);
  });
});

describe("azure run list success filter", () => {
  it("--status success matches partiallySucceeded as well (mapBuild reports both as success)", async () => {
    useConfig("azure");
    const calls = stubFetch((r) => (r.url.includes("/git/repositories/") ? json({ id: "g" }) : json({ value: [] })));
    const az = await import("../../lib/providers/azure/pipelines.ts");
    await az.pipelinesRunList("org/proj/repo", { status: "success" });
    const list = calls.find((c) => c.url.includes("/builds?"));
    expect(decodeURIComponent(list?.url ?? "")).toContain("resultFilter=succeeded,partiallySucceeded");
  });
});

describe("azure run download confinement", () => {
  async function download(names: string[], opts: { name?: string }): Promise<{ calls: Req[]; dest: string; error?: unknown }> {
    useConfig("azure");
    const dest = tmpDir("round3-dl");
    dirs.push(dest);
    const calls = stubFetch((r) =>
      r.url.includes("/artifacts") && !r.url.includes("download=true")
        ? json({ value: names.map((n) => ({ name: n, resource: { downloadUrl: `https://dev.azure.com/org/proj/_apis/build/builds/7/artifacts?artifactName=x&download=true` } })) })
        : new Response(new Uint8Array([1, 2]), { status: 200 }),
    );
    const az = await import("../../lib/providers/azure/pipelines.ts");
    try {
      await az.pipelinesRunDownload("org/proj/repo", 7, { ...opts, destDir: dest });
    } catch (error) {
      return { calls, dest, error };
    }
    return { calls, dest };
  }

  it("a requested name that matches no artifact is a named error", async () => {
    const r = await download(["drop"], { name: "nope" });
    expect(String(r.error)).toMatch(/artifact 'nope' not found/);
  });

  it("refuses a name that would escape the destination", async () => {
    for (const bad of ["../evil", "a/b", "a\\b", ".."]) {
      const r = await download([bad], {});
      expect(String(r.error)).toMatch(/unsafe artifact name/);
      expect(r.calls.some((c) => c.url.includes("download=true"))).toBe(false);
    }
  });

  it("downloads a plain name into the destination", async () => {
    const r = await download(["drop"], { name: "drop" });
    expect(r.error).toBeUndefined();
    expect(existsSync(join(r.dest, "drop.zip"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Azure issues: --type without a body, revision-conflict detection
// ---------------------------------------------------------------------------

/** A work item store that advances rev on PATCH; `patchReply` overrides PATCH. */
function item(tags: string, patchReply?: () => Response, top: { rev?: number | null } = {}): Req[] {
  let rev = 3;
  return stubFetch((r) => {
    if (r.method === "PATCH") {
      if (patchReply !== undefined) return patchReply();
      rev += 1;
      return json({ id: 9, rev });
    }
    const fields: Record<string, unknown> = { "System.WorkItemType": "User Story", "System.Tags": tags, "System.ChangedDate": `2026-10-30T00:0${rev}:00Z` };
    // Some answers carry the revision only at the top level.
    if (top.rev === undefined) fields["System.Rev"] = rev;
    return json({ id: 9, rev: top.rev === null ? undefined : (top.rev ?? rev), fields });
  });
}
const patchCalls = (calls: Req[]): Req[] => calls.filter((c) => c.method === "PATCH");
const opsOf = (c: Req | undefined): Op[] => (c?.body ?? []) as Op[];

describe("facade issues edit on azure: --type without a body", () => {
  it("sets the type and still applies title and labels", async () => {
    useConfig("azure");
    const calls = item("a");
    const facade = await import("../../lib/providers/facade/issues.ts");
    await facade.issuesEdit("", 9, { type: "Bug", title: "T", addLabel: ["x"] });
    const patches = patchCalls(calls);
    const edit = patches.find((c) => opsOf(c).some((o) => o.path === "/fields/System.Title"));
    expect(opsOf(edit).some((o) => o.path === "/fields/System.Tags")).toBe(true);
    const typed = patches.find((c) => opsOf(c).some((o) => o.path === "/fields/System.WorkItemType"));
    expect(opsOf(typed)[0]?.value).toBe("Bug");
  });

  it("a type alone just sets the type", async () => {
    useConfig("azure");
    const calls = item("a");
    const facade = await import("../../lib/providers/facade/issues.ts");
    await facade.issuesEdit("", 9, { type: "Bug" });
    const patches = patchCalls(calls);
    expect(patches).toHaveLength(1);
    expect(opsOf(patches[0])[0]?.path).toBe("/fields/System.WorkItemType");
  });

  it("with a body the type is changed first and the body is written to the new type's field", async () => {
    useConfig("azure");
    const calls = item("a");
    const facade = await import("../../lib/providers/facade/issues.ts");
    await facade.issuesEdit("", 9, { type: "Bug", body: "text" });
    const patches = patchCalls(calls);
    expect(opsOf(patches[0])[0]?.path).toBe("/fields/System.WorkItemType");
    expect(patches.slice(1).some((c) => opsOf(c).some((o) => o.path === "/fields/Microsoft.VSTS.TCM.ReproSteps"))).toBe(true);
  });
});

describe("azure revision-conflict detection is tight", () => {
  it.each([
    "TF401320: Rule Error for field Status. The field cannot be modified in state Closed",
    "Rule error: the revision of the rule set is invalid",
    "VS403000: field 'System.Title' was modified by a rule",
  ])("a 400 saying '%s' is not mislabeled a concurrent modification", async (message) => {
    useConfig("azure");
    const { issuesEdit } = await import("../../lib/providers/azure/issues.ts");
    item("a", () => json({ message }, 400));
    const err = (await issuesEdit("", 9, { addLabel: "b" }).catch((e: unknown) => e)) as Error;
    expect(err.message).toContain(message);
    expect(err.message).not.toMatch(/modified concurrently/);
  });

  it("a revision known only at the top level of the answer still guards the edit", async () => {
    useConfig("azure");
    const { issuesEdit } = await import("../../lib/providers/azure/issues.ts");
    const calls = item("a", () => json({ message: "VS402625: The test operation on /rev failed" }, 400), { rev: 5 });
    // Strip the nested revision: only the top-level one remains.
    await expect(issuesEdit("", 9, { addLabel: "b" })).rejects.toThrow(/modified concurrently/);
    expect(opsOf(patchCalls(calls)[0])[0]).toEqual({ op: "test", path: "/rev", value: 5 });
  });
});

describe("azure add/remove tag share the edit semantics", () => {
  it("adding 'Bug' to an item tagged 'bug' sends nothing", async () => {
    useConfig("azure");
    const { issuesAddTag } = await import("../../lib/providers/azure/issues.ts");
    const calls = item("bug; other");
    await issuesAddTag(9, "Bug");
    expect(patchCalls(calls)).toHaveLength(0);
  });

  it("adding 'b;c' adds each tag once and guards on the revision", async () => {
    useConfig("azure");
    const { issuesAddTag } = await import("../../lib/providers/azure/issues.ts");
    const calls = item("a; B");
    await issuesAddTag(9, "b; c");
    const ops = opsOf(patchCalls(calls)[0]);
    expect(ops[0]).toEqual({ op: "test", path: "/rev", value: 3 });
    expect(ops.find((o) => o.path === "/fields/System.Tags")?.value).toBe("a; B; c");
  });

  it("removing 'A;C' removes each tag whatever its case", async () => {
    useConfig("azure");
    const { issuesRemoveTag } = await import("../../lib/providers/azure/issues.ts");
    const calls = item("a; b; c");
    await issuesRemoveTag(9, "A;C");
    expect(opsOf(patchCalls(calls)[0]).find((o) => o.path === "/fields/System.Tags")?.value).toBe("b");
  });

  it("a stale revision on add is a named concurrent-modification error", async () => {
    useConfig("azure");
    const { issuesAddTag } = await import("../../lib/providers/azure/issues.ts");
    item("a", () => json({ message: "precondition failed" }, 412));
    await expect(issuesAddTag(9, "z")).rejects.toThrow(/modified concurrently/);
  });

  it("issuesLabelCreate still tags the item", async () => {
    useConfig("azure");
    const { issuesLabelCreate } = await import("../../lib/providers/azure/issues.ts");
    const calls = item("a");
    await issuesLabelCreate("", "new", { issue: 9 });
    expect(opsOf(patchCalls(calls)[0]).find((o) => o.path === "/fields/System.Tags")?.value).toBe("a; new");
  });
});

// ---------------------------------------------------------------------------
// Azure close/reopen: comment after the state change
// ---------------------------------------------------------------------------

describe("azure close/reopen comment handling", () => {
  function closeStub(opts: { failState?: boolean } = {}): Req[] {
    return stubFetch((r) => {
      if (r.url.includes("/comments") && r.method === "POST") return json({ id: 5 });
      if (r.url.includes("/workitemtypes/") && r.url.includes("/states")) {
        return json({ value: [{ name: "New", category: "Proposed" }, { name: "Closed", category: "Completed" }] });
      }
      if (r.method === "PATCH") return opts.failState === true ? json({ message: "boom" }, 400) : json({ id: 9 });
      return json({ id: 9, rev: 3, fields: { "System.WorkItemType": "User Story" } });
    });
  }
  const idx = (calls: Req[], pred: (r: Req) => boolean): number => calls.findIndex(pred);

  it("posts the comment only after the state change succeeded", async () => {
    useConfig("azure");
    const { issuesClose } = await import("../../lib/providers/azure/issues.ts");
    const calls = closeStub();
    await issuesClose("", 9, { comment: "done" });
    const state = idx(calls, (r) => r.method === "PATCH");
    const comment = idx(calls, (r) => r.method === "POST" && r.url.includes("/comments"));
    expect(state).toBeGreaterThanOrEqual(0);
    expect(comment).toBeGreaterThan(state);
  });

  it("a failed state change leaves no comment behind", async () => {
    useConfig("azure");
    const { issuesClose, issuesReopen } = await import("../../lib/providers/azure/issues.ts");
    const calls = closeStub({ failState: true });
    await expect(issuesClose("", 9, { comment: "done" })).rejects.toThrow();
    await expect(issuesReopen("", 9, { comment: "again" })).rejects.toThrow();
    expect(calls.some((r) => r.url.includes("/comments") && r.method === "POST")).toBe(false);
  });

  it("a whitespace-only comment is no comment: the close still happens", async () => {
    useConfig("azure");
    const { issuesClose, issuesReopen } = await import("../../lib/providers/azure/issues.ts");
    const calls = closeStub();
    await issuesClose("", 9, { comment: "  \n " });
    await issuesReopen("", 9, { comment: "\t" });
    expect(calls.filter((r) => r.method === "PATCH")).toHaveLength(2);
    expect(calls.some((r) => r.url.includes("/comments") && r.method === "POST")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// GitHub comment: an empty body file is as empty as an empty body
// ---------------------------------------------------------------------------

describe("github issuesComment: empty body file", () => {
  it("rejects whitespace-only file content with the empty-body error and never calls gh", async () => {
    useConfig("github");
    const bin = tmpDir("round3-bin");
    dirs.push(bin);
    stubGh(bin);
    process.env.PATH = pathWithStubs(bin);
    const file = join(bin, "empty.md");
    writeFileSync(file, " \n\t\n");
    const gh = await import("../../lib/providers/github/issues.ts");
    await expect(gh.issuesComment("o/r", 5, { bodyFile: file })).rejects.toThrow(/the comment body is empty/);
    const log = join(bin, CALLS_LOG_NAME);
    expect(existsSync(log) ? readFileSync(log, "utf8") : "").not.toMatch(/issue comment/);
  });

  it("a non-empty body file is still handed to gh by path", async () => {
    useConfig("github");
    const bin = tmpDir("round3-bin");
    dirs.push(bin);
    stubGh(bin);
    process.env.PATH = pathWithStubs(bin);
    const file = join(bin, "note.md");
    writeFileSync(file, "hello\n");
    const gh = await import("../../lib/providers/github/issues.ts");
    await gh.issuesComment("o/r", 5, { bodyFile: file });
    expect(readFileSync(join(bin, CALLS_LOG_NAME), "utf8")).toContain(`--body-file ${file}`);
  });
});

// ---------------------------------------------------------------------------
// reposEdit on azure
// ---------------------------------------------------------------------------

describe("azure reposEdit", () => {
  it("is a named refusal, never a reported success", async () => {
    useConfig("azure");
    const az = await import("../../lib/providers/azure/repos.ts");
    await expect(az.reposEdit("org/proj/repo", { template: "x" })).rejects.toThrow(/repos_edit is not supported on provider 'azure'/);
  });
});
