// Work-item semantics verified against live Azure (see MAPPING.md): the batch
// read must ask for relations in a form Azure honors, no-op edits are
// accepted, and markdown descriptions decode like comments.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { azureFixture, azureJson, stubAzureFetch, useAzureEnv } from "./harness/azure-stub.ts";
import { issuesClose, issuesComment, issuesCommentGet, issuesCreate, issuesEdit, issuesLabelList, issuesList } from "../../lib/providers/azure/issues.ts";

const WIT = "https://dev.azure.com/test-org/test-project/_apis/wit";

let restoreEnv: () => void = () => {};

beforeEach(() => {
  restoreEnv = useAzureEnv("test-org", "test-project");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  restoreEnv();
});

function typesRoute() {
  const states = azureFixture<{ value: unknown[] }>("workitemtypes.user-story.states.json").value;
  return {
    method: "GET",
    url: `${WIT}/workitemtypes?api-version=7.1`,
    respond: azureJson({ value: [{ name: "User Story", states }] }),
  };
}

describe("workitemsbatch expansion", () => {
  async function listOnce(): Promise<{ body: Record<string, unknown>; rows: Array<Record<string, unknown>> }> {
    const stub = stubAzureFetch([
      typesRoute(),
      { method: "POST", url: /\/wiql\?/, respond: azureJson({ workItems: [{ id: 101034 }] }) },
      {
        method: "POST",
        url: `${WIT}/workitemsbatch?api-version=7.1`,
        // Like Azure: relations only come back for a plain "relations" expand.
        respond: (req) => {
          const b = azureFixture<{ value: Array<Record<string, unknown>> }>("workitemsbatch.json");
          const expand = (req.body as { $expand?: string }).$expand;
          return azureJson(expand === "relations" ? b : { ...b, value: b.value.map((v) => ({ ...v, relations: undefined })) });
        },
      },
    ]);
    const rows = (await issuesList("")) as Array<Record<string, unknown>>;
    const post = stub.requests.find((r) => r.url.includes("/workitemsbatch"));
    return { body: post?.body as Record<string, unknown>, rows };
  }

  it("asks for relations with a value Azure honors, and without a fields list", async () => {
    const { body } = await listOnce();
    // Azure returns no relations for "fields,relations" and answers 400 when
    // $expand is combined with a fields list.
    expect(body["$expand"]).toBe("relations");
    expect(body["fields"]).toBeUndefined();
  });

  it("maps the parent from the returned relations", async () => {
    const { rows } = await listOnce();
    expect(rows[0]?.["parent"]).toEqual({ number: 101000, title: null });
  });
});

// A PATCH that sets fields to the values they already hold answers 200 and
// creates no revision (rev and ChangedDate stay put), so an unchanged rev is
// only a failed write when the requested values are not already in place.
describe("issuesEdit no-op", () => {
  const DATE = "2026-11-18T20:05:11.43Z";

  function stubEdit(current: { title: string; tags?: string; description?: string }) {
    const item = (extra: Record<string, unknown> = {}) => ({
      id: 5,
      rev: 4,
      fields: { "System.Rev": 4, "System.ChangedDate": DATE, "System.WorkItemType": "User Story", "System.Tags": current.tags ?? "", ...extra },
      multilineFieldsFormat: {},
    });
    return stubAzureFetch([
      typesRoute(),
      {
        method: "GET",
        url: /\/workitems\/5\?/,
        // The no-op comparison read names the edited fields; the baseline and
        // verification reads name only the revision fields.
        respond: (req) =>
          azureJson(
            req.url.includes("System.Title") || req.url.includes("System.Description")
              ? item({ "System.Title": current.title, "System.Description": current.description ?? "" })
              : item(),
          ),
      },
      { method: "PATCH", url: /\/workitems\/5\?/, respond: azureJson(item()) },
    ]);
  }

  it("accepts a title edit that sets the title it already has", async () => {
    stubEdit({ title: "Same title" });
    await expect(issuesEdit("", 5, { title: "Same title" })).resolves.toBeUndefined();
  });

  it("accepts a body edit that sets the body it already has, stored entity-encoded", async () => {
    stubEdit({ title: "t", description: "say &quot;hi&quot; &amp; bye" });
    await expect(issuesEdit("", 5, { body: 'say "hi" & bye' })).resolves.toBeUndefined();
  });

  it("reports a body write that was accepted but left a different body", async () => {
    stubEdit({ title: "t", description: "old text" });
    await expect(issuesEdit("", 5, { body: "new text" })).rejects.toThrow(/not reflected/);
  });

  it("does not let entity look-alikes hide a lost body write", async () => {
    stubEdit({ title: "t", description: "a < b" });
    await expect(issuesEdit("", 5, { body: "a &lt; b" })).rejects.toThrow(/not reflected/);
  });

  it("still reports a write that was accepted but did not change the title", async () => {
    stubEdit({ title: "Old title" });
    await expect(issuesEdit("", 5, { title: "New title" })).rejects.toThrow(/not reflected/);
  });
});

// Azure stores text exactly as sent and reads it back as stored, entity-encoding
// only `"` and `&`. Writes and reads therefore pass newlines through untouched.
describe("description and comment text round trip", () => {
  const batchWith = (description: string) => {
    const wi = azureFixture<{ value: Array<Record<string, unknown>> }>("workitemsbatch.json").value[0] as {
      fields: Record<string, unknown>;
    } & Record<string, unknown>;
    return {
      count: 1,
      value: [{ ...wi, fields: { ...wi.fields, "System.Description": description }, multilineFieldsFormat: { "System.Description": "markdown" } }],
    };
  };

  it("decodes the entities Azure emits in a markdown-format description", async () => {
    stubAzureFetch([
      typesRoute(),
      { method: "POST", url: /\/wiql\?/, respond: azureJson({ workItems: [{ id: 101034 }] }) },
      { method: "POST", url: `${WIT}/workitemsbatch?api-version=7.1`, respond: azureJson(batchWith("say &quot;hi&quot; &amp; <b>bye</b>")) },
    ]);
    const rows = (await issuesList("")) as Array<Record<string, unknown>>;
    expect(rows[0]?.["body"]).toBe('say "hi" & <b>bye</b>');
  });

  it.each(["x", "x\n", "x\n\n"])("sends a created description with its trailing newlines intact (%j)", async (body) => {
    const stub = stubAzureFetch([
      { method: "GET", url: /\/workitemtypes\/User%20Story\?/, respond: azureJson({ name: "User Story" }) },
      { method: "POST", url: /\/workitems\/\$/, respond: azureJson({ id: 9 }) },
      { method: "GET", url: /\/workitems\/9\?/, respond: azureJson({ id: 9, fields: { "System.Rev": 1, "System.ChangedDate": "2026-11-18T20:05:11.43Z" } }) },
    ]);
    await issuesCreate("", { title: "t", body });
    const post = stub.requests.find((r) => r.method === "POST" && r.url.includes("/workitems/$")) as { body: Array<{ path: string; value?: string }> };
    expect(post.body.find((o) => o.path === "/fields/System.Description")?.value).toBe(body);
  });

  it.each(["x", "x\n", "x\n\n"])("sends a comment with its trailing newlines intact (%j)", async (text) => {
    const stub = stubAzureFetch([{ method: "POST", url: /\/workitems\/5\/comments\?/, respond: azureJson({ id: 3 }) }]);
    await issuesComment("", 5, { body: text });
    expect((stub.requests[0]?.body as { text: string }).text).toBe(text);
  });

  it.each(["x", "x\n", "x\n\n"])("reads a comment back with its trailing newlines intact (%j)", async (text) => {
    stubAzureFetch([{ method: "GET", url: /\/workitems\/5\/comments\/3\?/, respond: azureJson({ id: 3, text, createdBy: { displayName: "A" } }) }]);
    const c = await issuesCommentGet("", "5/3");
    expect(c.body).toBe(text);
  });
});

describe("issuesClose partial failure and revision guard", () => {
  function closeRoutes(commentStatus: number) {
    return [
      { method: "GET", url: /\/workitemtypes\/User%20Story\/states/, respond: azureJson({ value: [{ name: "Closed", category: "Completed" }] }) },
      { method: "GET", url: /\/workitems\/9\?/, respond: azureJson({ id: 9, rev: 3, fields: { "System.WorkItemType": "User Story", "System.Rev": 3 } }) },
      { method: "PATCH", url: /\/workitems\/9\?/, respond: azureJson({ id: 9 }) },
      { method: "POST", url: /\/workitems\/9\/comments\?/, respond: azureJson({ message: "no" }, commentStatus) },
    ];
  }

  it("guards the state change with the revision it was read at", async () => {
    const stub = stubAzureFetch(closeRoutes(200));
    await issuesClose("", 9, {});
    const patch = stub.requests.find((r) => r.method === "PATCH")?.body as Array<{ op: string; path: string; value?: unknown }>;
    expect(patch[0]).toEqual({ op: "test", path: "/rev", value: 3 });
    expect(patch[1]).toMatchObject({ op: "add", path: "/fields/System.State", value: "Closed" });
  });

  it("warns, naming both outcomes, when the comment fails after the close succeeded", async () => {
    let out = "";
    vi.spyOn(process.stderr, "write").mockImplementation(((chunk: string | Uint8Array) => {
      out += String(chunk);
      return true;
    }) as typeof process.stderr.write);
    stubAzureFetch(closeRoutes(400));
    await expect(issuesClose("", 9, { comment: "why" })).resolves.toBeUndefined();
    expect(out).toMatch(/'Closed'/);
    expect(out).toMatch(/comment/i);
  });

  it("names a concurrent modification when the revision guard refuses", async () => {
    stubAzureFetch([
      closeRoutes(200)[0] as never,
      closeRoutes(200)[1] as never,
      { method: "PATCH", url: /\/workitems\/9\?/, respond: azureJson({ message: "The test operation on /rev failed" }, 400) },
    ]);
    await expect(issuesClose("", 9, {})).rejects.toThrow(/modified concurrently/);
  });
});

// Projection details: milestone leaf, unique logins, per-type closed states,
// tag handling on create, label-list limit and batch ordering.
describe("work item projection", () => {
  const base = () => azureFixture<{ value: Array<{ fields: Record<string, unknown> } & Record<string, unknown>> }>("workitemsbatch.json").value[0]!;

  function item(id: number, fields: Record<string, unknown>) {
    const b = base();
    return { ...b, id, fields: { ...b.fields, ...fields } };
  }

  function listWith(items: unknown[], ids: number[], types?: unknown) {
    return stubAzureFetch([
      types !== undefined
        ? { method: "GET", url: `${WIT}/workitemtypes?api-version=7.1`, respond: azureJson(types) }
        : typesRoute(),
      { method: "POST", url: /\/wiql\?/, respond: azureJson({ workItems: ids.map((id) => ({ id })) }) },
      { method: "POST", url: `${WIT}/workitemsbatch?api-version=7.1`, respond: azureJson({ count: items.length, value: items }) },
    ]);
  }

  it.each([
    ["Proj\\Sprint 4\\Week 2", "Week 2"],
    ["Proj\\Sprint 4", "Sprint 4"],
  ])("derives the milestone from the iteration path leaf (%s)", async (path, leaf) => {
    listWith([item(1, { "System.IterationPath": path })], [1]);
    const rows = (await issuesList("")) as Array<Record<string, unknown>>;
    expect(rows[0]?.["milestone"]).toEqual({ title: leaf });
  });

  it("has no milestone for an item at the project root", async () => {
    listWith([item(1, { "System.IterationPath": "Proj" })], [1]);
    const rows = (await issuesList("")) as Array<Record<string, unknown>>;
    expect(rows[0]?.["milestone"]).toBe("");
  });

  it("uses the unique name, not the display name, as the login", async () => {
    const who = { displayName: "Ann Lee", uniqueName: "ann@example.test" };
    listWith([item(1, { "System.AssignedTo": who, "System.CreatedBy": who })], [1]);
    const rows = (await issuesList("")) as Array<Record<string, unknown>>;
    expect(rows[0]?.["assignees"]).toEqual([{ login: "ann@example.test" }]);
    expect(rows[0]?.["author"]).toEqual({ login: "ann@example.test" });
  });

  it("returns items in the query's id order, whatever order the batch answers in", async () => {
    listWith([item(1, { "System.Title": "one" }), item(2, { "System.Title": "two" })], [2, 1]);
    const rows = (await issuesList("")) as Array<Record<string, unknown>>;
    expect(rows.map((r) => r["number"])).toEqual([2, 1]);
  });

  it("decides closed per work item type, not by state name across all types", async () => {
    const types = {
      value: [
        { name: "Bug", states: [{ name: "Resolved", category: "Completed" }] },
        { name: "Task", states: [{ name: "Resolved", category: "InProgress" }] },
      ],
    };
    const stub = listWith([item(1, { "System.WorkItemType": "Task", "System.State": "Resolved" })], [1], types);
    const rows = (await issuesList("", { state: "open" })) as Array<Record<string, unknown>>;
    expect(rows[0]?.["state"]).toBe("OPEN");
    const wiql = (stub.requests.find((r) => r.url.includes("/wiql"))?.body as { query: string }).query;
    expect(wiql).toContain("[System.WorkItemType] = 'Bug' AND [System.State] NOT IN ('Resolved')");
  });
});

describe("issuesCreate tags", () => {
  it("splits on ';' and drops case-insensitive duplicates", async () => {
    const stub = stubAzureFetch([
      { method: "GET", url: /\/workitemtypes\/User%20Story\?/, respond: azureJson({ name: "User Story" }) },
      { method: "POST", url: /\/workitems\/\$/, respond: azureJson({ id: 9 }) },
      { method: "GET", url: /\/workitems\/9\?/, respond: azureJson({ id: 9, fields: { "System.Rev": 1, "System.ChangedDate": "2026-11-18T20:05:11.43Z" } }) },
    ]);
    await issuesCreate("", { title: "t", labels: ["a;b", "A", "c"] });
    const post = stub.requests.find((r) => r.method === "POST" && r.url.includes("/workitems/$")) as { body: Array<{ path: string; value?: string }> };
    expect(post.body.find((o) => o.path === "/fields/System.Tags")?.value).toBe("a; b; c");
  });
});

describe("issuesLabelList limit", () => {
  it.each([0, -1, 1.5, Number.NaN])("rejects the limit %s", async (limit) => {
    stubAzureFetch([]);
    await expect(issuesLabelList("", { limit })).rejects.toThrow(/--limit must be a positive integer/);
  });
});

describe("issuesList filters", () => {
  const wiqlFor = async (opts: Record<string, unknown>): Promise<string> => {
    const stub = stubAzureFetch([
      typesRoute(),
      { method: "GET", url: `${WIT}/workitemtypes/Bug?api-version=7.1`, respond: azureJson({ name: "Bug" }) },
      { method: "POST", url: /\/wiql\?/, respond: azureJson({ workItems: [] }) },
    ]);
    await issuesList("", opts);
    return (stub.requests.find((r) => r.url.includes("/wiql"))?.body as { query: string }).query;
  };

  it("builds a per-type group for state=closed", async () => {
    expect(await wiqlFor({ state: "closed" })).toMatch(/\(\(\[System\.WorkItemType\] = 'User Story' AND \[System\.State\] IN \('[^)]+'\)\)\)/);
  });

  it("ANDs label and type with the state group", async () => {
    const q = await wiqlFor({ state: "open", label: "x", type: "bug" });
    expect(q).toContain("[System.Tags] CONTAINS 'x'");
    expect(q).toContain("[System.WorkItemType] = 'Bug'");
    expect(q).toMatch(/AND \(\(\[System\.WorkItemType\] = 'User Story' AND \[System\.State\] NOT IN/);
  });
});
