// Provider-facade parity for the issue verbs: Azure write atomicity and error
// fidelity, GitHub existence/endpoint/paging correctness, the shared
// body-source rules, and the ruleset error contract. Azure HTTP is mocked by
// stubbing globalThis.fetch in-process; GitHub by a stub `gh` on PATH. No test
// reaches a backend.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, writeFileSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stubGh, pathWithStubs, tmpDir, rmrf } from "./harness/index.ts";
import {
  issuesCreate,
  issuesEdit,
  issuesExists,
  issuesComment,
  issuesList,
  issueGraphLink,
  issueGraphUnlink,
  issueDependencyLink,
  issueDependencyUnlink,
} from "../../lib/providers/azure/issues.ts";
import * as ghIssues from "../../lib/providers/github/issues.ts";

interface Req {
  method: string;
  url: string;
  body: unknown;
}

const AZ_ENV = ["AZURE_DEVOPS_ORG", "AZURE_DEVOPS_PROJECT", "AZURE_PAT", "DEVENV_ROOT", "PATH"] as const;
let savedEnv: Record<string, string | undefined> = {};
const cleanups: string[] = [];

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

/** Stub fetch; `handler` may return undefined for the default `{}` 200. */
function stubFetch(handler: (r: Req) => Response | undefined): Req[] {
  const calls: Req[] = [];
  vi.stubGlobal("fetch", (async (url: string | URL | Request, init?: RequestInit) => {
    const raw = init?.body === undefined ? undefined : String(init.body);
    const req: Req = {
      method: init?.method ?? "GET",
      url: String(url),
      body: raw === undefined ? undefined : (JSON.parse(raw) as unknown),
    };
    calls.push(req);
    return handler(req) ?? json({});
  }) as unknown as typeof fetch);
  return calls;
}

beforeEach(() => {
  savedEnv = {};
  for (const k of AZ_ENV) savedEnv[k] = process.env[k];
  process.env["AZURE_DEVOPS_ORG"] = "test-org";
  process.env["AZURE_DEVOPS_PROJECT"] = "test-project";
  process.env["AZURE_PAT"] = "test-pat";
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  for (const k of AZ_ENV) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k] as string;
  }
  for (const d of cleanups.splice(0)) rmSync(d, { recursive: true, force: true });
});

function bugBodyConfig(): void {
  const root = mkdtempSync(join(tmpdir(), "pip-cfg-"));
  cleanups.push(root);
  writeFileSync(join(root, "devenv.config"), "[azure_body_fields]\nBug=Microsoft.VSTS.TCM.ReproSteps\n");
  process.env["DEVENV_ROOT"] = root;
}

/** A work item store that advances rev on PATCH and records requests. */
function editableItem(fields: Record<string, unknown>): { calls: Req[] } {
  let rev = 1;
  const calls = stubFetch((r) => {
    if (r.method === "PATCH") {
      rev = 2;
      return json({ id: 9, rev });
    }
    return json({
      id: 9,
      rev,
      fields: { ...fields, "System.Rev": rev, "System.ChangedDate": `2026-10-30T00:0${rev}:00Z` },
    });
  });
  return { calls };
}

const patches = (calls: Req[]): Req[] => calls.filter((c) => c.method === "PATCH");
type Op = { op: string; path: string; value?: unknown };

describe("azure issuesEdit: type and body field", () => {
  it("--type without a body is a named error and sends nothing", async () => {
    const calls = stubFetch(() => undefined);
    await expect(issuesEdit("", 9, { type: "bug", title: "t" })).rejects.toThrow(/--type on edit is not supported/);
    expect(calls).toHaveLength(0);
  });

  it("without a type, the item's current type picks the body field", async () => {
    bugBodyConfig();
    const { calls } = editableItem({ "System.WorkItemType": "Bug", "System.Tags": "" });
    await issuesEdit("", 9, { body: "new text" });
    const ops = patches(calls)[0]?.body as Op[];
    expect(ops.some((o) => o.path === "/fields/Microsoft.VSTS.TCM.ReproSteps")).toBe(true);
    expect(ops.some((o) => o.path === "/fields/System.Description")).toBe(false);
  });
});

describe("azure issuesEdit: one atomic PATCH", () => {
  it("tags, title and body travel in a single PATCH", async () => {
    const { calls } = editableItem({ "System.WorkItemType": "User Story", "System.Tags": "old; keep" });
    await issuesEdit("", 9, { title: "T", body: "B", addLabel: "new", removeLabel: "old" });
    expect(patches(calls)).toHaveLength(1);
    const ops = patches(calls)[0]?.body as Op[];
    expect(ops.find((o) => o.path === "/fields/System.Title")?.value).toBe("T");
    expect(ops.some((o) => o.path === "/fields/System.Description")).toBe(true);
    const tags = ops.find((o) => o.path === "/fields/System.Tags");
    expect(tags?.op).toBe("replace");
    expect(tags?.value).toBe("keep; new");
  });

  it("removing the last tag drops the field in the same PATCH", async () => {
    const { calls } = editableItem({ "System.WorkItemType": "User Story", "System.Tags": "only" });
    await issuesEdit("", 9, { removeLabel: "only" });
    expect(patches(calls)).toHaveLength(1);
    // The edit is led by a revision guard (the item was read at rev 1).
    expect(patches(calls)[0]?.body).toEqual([
      { op: "test", path: "/rev", value: 1 },
      { op: "remove", path: "/fields/System.Tags" },
    ]);
  });

  it("an already-present tag sends no PATCH", async () => {
    const { calls } = editableItem({ "System.WorkItemType": "User Story", "System.Tags": "a" });
    await issuesEdit("", 9, { addLabel: "a" });
    expect(patches(calls)).toHaveLength(0);
  });
});

describe("azure issuesCreate: post-create verification", () => {
  it("returns the id with a warning when the verification read fails", async () => {
    const writes: string[] = [];
    vi.spyOn(process.stderr, "write").mockImplementation(((chunk: string | Uint8Array) => {
      writes.push(String(chunk));
      return true;
    }) as typeof process.stderr.write);
    stubFetch((r) => {
      if (r.method === "POST" && r.url.includes("/workitems/$")) return json({ id: 77 });
      if (r.url.includes("/workitemtypes/")) return json({ value: [] });
      return json({ message: "TF401232: unavailable" }, 404);
    });
    await expect(issuesCreate("", { title: "t" })).resolves.toBe(77);
    expect(writes.join("")).toMatch(/77/);
    expect(writes.join("")).toMatch(/WARN/);
  });
});

describe("azure sub-issue links", () => {
  it("a link failure surfaces the real cause, not a generic message", async () => {
    stubFetch((r) => (r.method === "PATCH" ? json({}, 401) : undefined));
    const err = await issueGraphLink("", 1, 2).catch((e: unknown) => e as Error);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toMatch(/did not accept the stored credential/);
    expect((err as Error).message).not.toMatch(/failed linking/);
  });

  it("the real error survives a failing confirmation read", async () => {
    stubFetch((r) => (r.method === "PATCH" ? json({ message: "TF400898: boom" }, 400) : json({ message: "read down" }, 403)));
    await expect(issueGraphLink("", 1, 2)).rejects.toThrow(/TF400898: boom/);
  });

  it("a duplicate relation is success only when the parent lists the child", async () => {
    stubFetch((r) =>
      r.method === "PATCH"
        ? json({ message: "already exists" }, 400)
        : json({
            id: 1,
            relations: [{ rel: "System.LinkTypes.Hierarchy-Forward", url: "https://x/_apis/wit/workItems/2" }],
          }),
    );
    await expect(issueGraphLink("", 1, 2)).resolves.toBeUndefined();
  });

  it("unlink guards the index with a test op on /rev", async () => {
    const calls = stubFetch((r) =>
      r.method === "GET"
        ? json({
            id: 1,
            rev: 7,
            relations: [{ rel: "System.LinkTypes.Hierarchy-Forward", url: "https://x/_apis/wit/workItems/2" }],
          })
        : json({}),
    );
    await issueGraphUnlink("", 1, 2);
    expect(patches(calls)[0]?.body).toEqual([
      { op: "test", path: "/rev", value: 7 },
      { op: "remove", path: "/relations/0" },
    ]);
  });

  it("blocked-by unlink guards the index with a test op on /rev", async () => {
    const calls = stubFetch((r) =>
      r.method === "GET"
        ? json({
            id: 1,
            rev: 4,
            relations: [{ rel: "System.LinkTypes.Dependency-Forward", url: "https://x/_apis/wit/workItems/3" }],
          })
        : json({}),
    );
    await issueDependencyUnlink("", 1, 3);
    expect((patches(calls)[0]?.body as Op[])[0]).toEqual({ op: "test", path: "/rev", value: 4 });
  });

  // PIN: the link type the blocked-by verbs use TODAY. The direction is
  // awaiting a live check against Azure; when that verdict flips it, change
  // this expectation and the DEPENDENCY_FORWARD constant together.
  it("PIN current blocked-by link type: Dependency-Forward on the blocked issue", async () => {
    const calls = stubFetch((r) => (r.method === "GET" ? json({ id: 1, rev: 1, relations: [] }) : json({})));
    await issueDependencyLink("", 1, 3);
    const op = (patches(calls)[0]?.body as Array<{ value: { rel: string; url: string } }>)[0];
    expect(patches(calls)[0]?.url).toContain("/workitems/1");
    expect(op?.value.rel).toBe("System.LinkTypes.Dependency-Forward");
    expect(op?.value.url.endsWith("/workItems/3")).toBe(true);
  });
});

describe("azure issuesExists", () => {
  it("not found is false", async () => {
    stubFetch(() => json({ message: "TF401232: Work item 9 does not exist, or you do not have permissions to read it." }, 404));
    await expect(issuesExists("", 9)).resolves.toBe(false);
  });

  it("an auth failure is rethrown", async () => {
    stubFetch(() => json({}, 401));
    await expect(issuesExists("", 9)).rejects.toThrow(/did not accept the stored credential/);
  });

  it("a non-404 client error is rethrown", async () => {
    stubFetch(() => json({ message: "VS403403: forbidden" }, 403));
    await expect(issuesExists("", 9)).rejects.toThrow(/VS403403/);
  });
});

describe("azure list and comment shapes", () => {
  const batchItem = {
    id: 12,
    url: "https://dev.azure.com/test-org/_apis/wit/workItems/12",
    fields: { "System.Title": "x", "System.State": "New", "System.WorkItemType": "User Story", "System.CommentCount": 3 },
  };
  const listHandler = (r: Req): Response | undefined => {
    if (r.url.includes("/wiql")) return json({ workItems: [{ id: 12 }] });
    if (r.url.includes("/workitemsbatch")) return json({ value: [batchItem] });
    if (/\/workitemtypes(\?|$)/.test(r.url)) {
      return json({ value: [{ name: "User Story", states: [{ name: "New", category: "Proposed" }, { name: "Closed", category: "Completed" }] }] });
    }
    return undefined;
  };

  it("list records carry the browser url, not the API address", async () => {
    stubFetch(listHandler);
    const rows = (await issuesList("", { state: "all" })) as Array<Record<string, unknown>>;
    expect(rows[0]?.["url"]).toBe("https://dev.azure.com/test-org/test-project/_workitems/edit/12");
  });

  it("--json comments projects the comment count", async () => {
    stubFetch(listHandler);
    const out = await issuesList("", { state: "all", json: "number,comments" });
    expect(JSON.parse(out as string)).toEqual([{ number: 12, comments: 3 }]);
  });

  it("a comment needs exactly one body source", async () => {
    const calls = stubFetch(() => undefined);
    await expect(issuesComment("", 5, { body: "a", bodyFile: "/nope" })).rejects.toThrow(/mutually exclusive/);
    await expect(issuesComment("", 5, {})).rejects.toThrow(/requires --body/);
    expect(calls).toHaveLength(0);
  });
});

describe("github issue verbs (stub gh)", () => {
  let dir = "";
  const calls = (): string[] => {
    const log = join(dir, "calls.log");
    return existsSync(log) ? readFileSync(log, "utf8").split("\n").filter((l) => l !== "") : [];
  };
  const stub = (body: string): void => {
    stubGh(dir, `#!/usr/bin/env bash\nprintf '%s\\n' "gh $*" >> "${join(dir, "calls.log")}"\n${body}\n`);
    process.env["PATH"] = pathWithStubs(dir);
  };
  beforeEach(() => {
    dir = tmpDir("pip-gh-");
  });
  afterEach(() => rmrf(dir));

  it("exists: a not-found reply is false", async () => {
    stub('echo "GraphQL: Could not resolve to an Issue with the number of 9." >&2; exit 1');
    await expect(ghIssues.issuesExists("o/r", 9)).resolves.toBe(false);
  });

  it("exists: an HTTP 404 reply is false", async () => {
    stub('echo "HTTP 404: Not Found" >&2; exit 1');
    await expect(ghIssues.issuesExists("o/r", 9)).resolves.toBe(false);
  });

  it("exists: auth, network and 5xx failures are rethrown", async () => {
    stub('echo "HTTP 502: Bad Gateway" >&2; exit 1');
    await expect(ghIssues.issuesExists("o/r", 9)).rejects.toThrow(/502/);
    stub('echo "error connecting to api.github.com" >&2; exit 1');
    await expect(ghIssues.issuesExists("o/r", 9)).rejects.toThrow(/connecting/);
    stub('echo "HTTP 401: Bad credentials" >&2; exit 1');
    await expect(ghIssues.issuesExists("o/r", 9)).rejects.toThrow(/401/);
  });

  it("an empty spec resolves to the gh placeholder, never repos//", async () => {
    stub("echo '[]'");
    await ghIssues.issuesComments("", 5);
    await ghIssues.issuesMilestones("");
    await ghIssues.issuesCommentGet("", "123").catch(() => undefined);
    const log = calls().join("\n");
    expect(log).not.toContain("repos//");
    expect(log).toContain("repos/{owner}/{repo}/issues/5/comments");
    expect(log).toContain("repos/{owner}/{repo}/milestones");
    expect(log).toContain("repos/{owner}/{repo}/issues/comments/123");
  });

  it("a comment ref that is not a number is refused before any request", async () => {
    stub("echo '{}'");
    await expect(ghIssues.issuesCommentGet("o/r", "1/../x")).rejects.toThrow(/comment ref/);
    await expect(ghIssues.issuesCommentEdit("o/r", "1/../x", { body: "b" })).rejects.toThrow(/comment ref/);
    expect(calls()).toHaveLength(0);
  });

  it("children follows hasNextPage to the last page", async () => {
    const page = (nums: number[], next: string | null): string =>
      JSON.stringify({
        data: {
          repository: {
            issue: {
              subIssues: {
                pageInfo: { hasNextPage: next !== null, endCursor: next },
                nodes: nums.map((number) => ({ number })),
              },
            },
          },
        },
      });
    stub(
      `case "$*" in\n  *after=CUR1*) echo '${page([13], null)}' ;;\n  *) echo '${page([11, 12], "CUR1")}' ;;\nesac`,
    );
    await expect(ghIssues.issueGraphChildren("o/r", 7)).resolves.toEqual([11, 12, 13]);
    expect(calls().filter((c) => c.includes("subIssues"))).toHaveLength(2);
  });
});

describe("ruleset error contract (facade)", () => {
  it("an azure create failure becomes {ok:false, stderr} like github's", async () => {
    const root = mkdtempSync(join(tmpdir(), "pip-org-"));
    cleanups.push(root);
    writeFileSync(
      join(root, "devenv.config"),
      "[provider]\nname=azure\nazure_org=test-org\nazure_project=test-project\n",
    );
    process.env["DEVENV_ROOT"] = root;
    const payload = join(root, "ruleset.json");
    // Names no branch a policy can hold: the translation refuses it.
    writeFileSync(payload, JSON.stringify({ name: "r", conditions: { ref_name: { include: ["refs/tags/*"] } }, rules: [] }));
    stubFetch(() => undefined);
    vi.resetModules();
    const org = await import("../../lib/providers/facade/org.ts");
    const created = await org.orgRulesetCreate("test-project/repo", payload);
    expect(created.ok).toBe(false);
    expect(created.stderr).not.toBe("");
    const updated = await org.orgRulesetUpdate("test-project/repo", "1", payload);
    expect(updated.ok).toBe(false);
  });

  it("azure facade edit routes --type without a body to the set-type verb", async () => {
    const root = mkdtempSync(join(tmpdir(), "pip-fac-"));
    cleanups.push(root);
    writeFileSync(join(root, "devenv.config"), "[provider]\nname=azure\nazure_org=test-org\nazure_project=test-project\n");
    process.env["DEVENV_ROOT"] = root;
    const calls = stubFetch(() => undefined);
    vi.resetModules();
    const facade = await import("../../lib/providers/facade/issues.ts");
    await facade.issuesEdit("", 9, { type: "Bug" });
    const patched = calls.filter((c) => c.method === "PATCH");
    expect(patched).toHaveLength(1);
    expect(JSON.stringify(patched[0]?.body)).toContain("System.WorkItemType");
  });
});
