// provider-review-round3.test.ts — provider findings of the third review
// round: Azure type+body edits, closed-state derivation, WIQL text, write
// verification across timestamp precisions, dependency-link revision guard,
// comment-count read failures, label joins, GitHub scan cursors, error
// types, facade verbs for repo/project/package/PR-body access, and the
// error text of pr-merge / pr-thread-resolve. Azure HTTP is a stubbed fetch;
// GitHub is a stub `gh` on PATH. Nothing reaches a backend.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { CALLS_LOG_NAME, pathWithStubs, rmrf, runTool, stubCli, stubGh, tmpDir } from "./harness/index.ts";

interface Req {
  method: string;
  url: string;
  body: unknown;
}
type Op = { op: string; path: string; value?: unknown };

const savedEnv = { ...process.env };
const dirs: string[] = [];

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
  const root = tmpDir("round3b");
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

/** A gh stub whose log records argv and whose answers a case statement owns. */
function ghStub(cases: string): { bin: string; calls: () => string[] } {
  const bin = tmpDir("round3b-bin");
  dirs.push(bin);
  stubGh(
    bin,
    [
      "#!/usr/bin/env bash",
      'if [ "$1" = "auth" ] && [ "$2" = "status" ]; then exit 0; fi',
      `printf '%s\\n' "gh $*" >> "${join(bin, CALLS_LOG_NAME)}"`,
      cases,
      "exit 0",
      "",
    ].join("\n"),
  );
  process.env.PATH = pathWithStubs(bin);
  return {
    bin,
    calls: () => {
      try {
        return readFileSync(join(bin, CALLS_LOG_NAME), "utf8").split("\n").filter((l) => l !== "");
      } catch {
        return [];
      }
    },
  };
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

const patchCalls = (calls: Req[]): Req[] => calls.filter((c) => c.method === "PATCH");
const opsOf = (c: Req | undefined): Op[] => (c?.body ?? []) as Op[];

/** The project's type list: states with their categories, one Completed state
 * deliberately not named Closed/Done. */
const TYPE_LIST = {
  value: [
    {
      name: "Task",
      states: [
        { name: "New", category: "Proposed" },
        { name: "Finished", category: "Completed" },
        { name: "Cut", category: "Removed" },
      ],
    },
  ],
};
const isTypeList = (r: Req): boolean => /\/workitemtypes(\?|$)/.test(r.url);

/** A work item store whose rev and ChangedDate advance on every PATCH. */
function advancingItem(tags: string): Req[] {
  let rev = 3;
  return stubFetch((r) => {
    if (r.method === "PATCH") {
      rev += 1;
      return json({ id: 9, rev });
    }
    return json({
      id: 9,
      rev,
      fields: {
        "System.WorkItemType": "User Story",
        "System.Tags": tags,
        "System.Rev": rev,
        "System.ChangedDate": `2026-10-30T00:0${rev}:00Z`,
      },
    });
  });
}

// ---------------------------------------------------------------------------
// P1: type + body on Azure changes the type first, then writes the new type's field
// ---------------------------------------------------------------------------

describe("azure issues edit with --type and --body", () => {
  it("changes the type first, then writes the body to the new type's field", async () => {
    useConfig("azure");
    const calls = advancingItem("");
    const facade = await import("../../lib/providers/facade/issues.ts");
    await facade.issuesEdit("", 9, { type: "Bug", body: "text" });
    const patches = patchCalls(calls);
    expect(opsOf(patches[0])[0]).toMatchObject({ path: "/fields/System.WorkItemType", value: "Bug" });
    const bodyPatch = patches.find((c) => opsOf(c).some((o) => o.path.startsWith("/fields/Microsoft.VSTS.TCM.ReproSteps")));
    expect(bodyPatch).toBeDefined();
    expect(patches.indexOf(bodyPatch as Req)).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// P4: write verification compares instants, not strings
// ---------------------------------------------------------------------------

describe("azure write verification across timestamp precisions", () => {
  it("an edit within the same second (ChangedDate gains a fraction) is not reported lost", async () => {
    useConfig("azure");
    let patched = false;
    stubFetch((r) => {
      if (r.method === "PATCH") {
        patched = true;
        return json({ id: 9, rev: 4 });
      }
      return json({
        id: 9,
        fields: {
          "System.WorkItemType": "User Story",
          "System.Tags": "a",
          "System.Rev": patched ? 4 : 3,
          "System.ChangedDate": patched ? "2026-10-30T00:00:45.5Z" : "2026-10-30T00:00:45Z",
        },
      });
    });
    const { issuesEdit } = await import("../../lib/providers/azure/issues.ts");
    await expect(issuesEdit("", 9, { addLabel: "b" })).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// P5: closed names come from the states API, one source for close/read/WIQL
// ---------------------------------------------------------------------------

describe("azure closed states derive from state categories", () => {
  it("an item in a non-Closed completed state reads CLOSED", async () => {
    useConfig("azure");
    stubFetch((r) => {
      if (isTypeList(r)) return json(TYPE_LIST);
      if (r.url.includes("/comments")) return json({ comments: [], totalCount: 0 });
      return json({ id: 9, fields: { "System.WorkItemType": "Task", "System.State": "Finished" } });
    });
    const { issuesView } = await import("../../lib/providers/azure/issues.ts");
    expect((await issuesView("", 9))["state"]).toBe("CLOSED");
  });

  it("an item in a Removed-category state reads CLOSED, an unlisted state OPEN", async () => {
    useConfig("azure");
    let state = "Cut";
    stubFetch((r) => {
      if (isTypeList(r)) return json(TYPE_LIST);
      if (r.url.includes("/comments")) return json({ comments: [], totalCount: 0 });
      return json({ id: 9, fields: { "System.WorkItemType": "Task", "System.State": state } });
    });
    const { issuesView } = await import("../../lib/providers/azure/issues.ts");
    expect((await issuesView("", 9))["state"]).toBe("CLOSED");
    state = "Active";
    expect((await issuesView("", 9))["state"]).toBe("OPEN");
  });

  it("the open and closed WIQL filters name the derived closed states", async () => {
    useConfig("azure");
    const queries: string[] = [];
    stubFetch((r) => {
      if (isTypeList(r)) return json(TYPE_LIST);
      if (r.url.endsWith("/wiql") || r.url.includes("/wiql?")) {
        queries.push((r.body as { query: string }).query);
        return json({ workItems: [] });
      }
      return json({});
    });
    const { issuesList } = await import("../../lib/providers/azure/issues.ts");
    await issuesList("", { state: "open" });
    await issuesList("", { state: "closed" });
    expect(queries[0]).toContain("[System.State] NOT IN ('Finished','Cut')");
    expect(queries[1]).toContain("[System.State] IN ('Finished','Cut')");
  });

  it("close moves the item to the Completed-category state", async () => {
    useConfig("azure");
    const calls = stubFetch((r) => {
      if (r.url.includes("/workitemtypes/") && r.url.includes("/states")) return json(TYPE_LIST.value[0] && { value: TYPE_LIST.value[0].states });
      if (r.method === "PATCH") return json({ id: 9 });
      return json({ id: 9, fields: { "System.WorkItemType": "Task" } });
    });
    const { issuesClose } = await import("../../lib/providers/azure/issues.ts");
    await issuesClose("", 9);
    expect(opsOf(patchCalls(calls)[0])[0]?.value).toBe("Finished");
  });
});

// ---------------------------------------------------------------------------
// P10 + missing tests: WIQL text, limits, batching
// ---------------------------------------------------------------------------

describe("azure issues list query", () => {
  function listStub(ids: number[] = []): { queries: string[]; calls: Req[] } {
    const queries: string[] = [];
    const calls = stubFetch((r) => {
      if (isTypeList(r)) return json(TYPE_LIST);
      if (r.url.includes("/wiql")) {
        queries.push((r.body as { query: string }).query);
        return json({ workItems: ids.map((id) => ({ id })) });
      }
      if (r.url.includes("/workitemsbatch")) {
        return json({ value: (r.body as { ids: number[] }).ids.map((id) => ({ id, fields: {} })) });
      }
      return json({});
    });
    return { queries, calls };
  }

  it("separates every WIQL clause with whitespace and doubles quotes in literals", async () => {
    useConfig("azure");
    const { queries } = listStub();
    const { issuesList } = await import("../../lib/providers/azure/issues.ts");
    await issuesList("", { state: "open", label: "it's", type: "Bug" });
    const q = queries[0] ?? "";
    expect(q).toContain("CONTAINS 'it''s' AND [System.WorkItemType] = 'Bug' ORDER BY");
    expect(q).not.toMatch(/['\)](AND|ORDER)\b/);
    expect(q).toMatch(/\) AND \[System\.Tags\]/);
  });

  it("refuses a negative or zero --limit instead of dropping the last id", async () => {
    useConfig("azure");
    listStub([1, 2, 3]);
    const { issuesList } = await import("../../lib/providers/azure/issues.ts");
    await expect(issuesList("", { limit: -1 })).rejects.toThrow(/--limit/);
    await expect(issuesList("", { limit: 0 })).rejects.toThrow(/--limit/);
  });

  it("fetches more than 200 ids in batches of at most 200", async () => {
    useConfig("azure");
    const { calls } = listStub(Array.from({ length: 450 }, (_, i) => i + 1));
    const { issuesList } = await import("../../lib/providers/azure/issues.ts");
    const rows = (await issuesList("", { limit: 450 })) as unknown[];
    expect(rows).toHaveLength(450);
    const batches = calls.filter((c) => c.url.includes("/workitemsbatch")).map((c) => (c.body as { ids: number[] }).ids.length);
    expect(batches).toEqual([200, 200, 50]);
  });
});

// ---------------------------------------------------------------------------
// P6: several --add-label / --remove-label on Azure
// ---------------------------------------------------------------------------

describe("facade issues edit on azure: several labels", () => {
  it("adds every --add-label in one guarded patch", async () => {
    useConfig("azure");
    const calls = advancingItem("x");
    const facade = await import("../../lib/providers/facade/issues.ts");
    await facade.issuesEdit("", 9, { addLabel: ["a", "b"], removeLabel: ["x"] });
    const ops = opsOf(patchCalls(calls)[0]);
    expect(ops.find((o) => o.path === "/fields/System.Tags")?.value).toBe("a; b");
  });
});

// ---------------------------------------------------------------------------
// P7: dependency links are revision-guarded and tolerate the satisfied state
// ---------------------------------------------------------------------------

describe("azure dependency links", () => {
  const BLOCKER_URL = "https://dev.azure.com/org/proj/_apis/wit/workItems/7";
  const linked = { id: 9, rev: 5, relations: [{ rel: "System.LinkTypes.Dependency-Forward", url: BLOCKER_URL }] };

  it("unlink leads with a revision test and names a concurrent change", async () => {
    useConfig("azure");
    const calls = stubFetch((r) =>
      r.method === "PATCH" ? json({ message: "VS402625: The test operation on /rev failed" }, 400) : json(linked),
    );
    const { issueDependencyUnlink } = await import("../../lib/providers/azure/issues.ts");
    await expect(issueDependencyUnlink("", 9, 7)).rejects.toThrow(/modified concurrently/);
    expect(opsOf(patchCalls(calls)[0])[0]).toEqual({ op: "test", path: "/rev", value: 5 });
  });

  it("unlink is a success when the concurrent change already removed the link", async () => {
    useConfig("azure");
    let patched = false;
    stubFetch((r) => {
      if (r.method === "PATCH") {
        patched = true;
        return json({ message: "VS402625: The test operation on /rev failed" }, 400);
      }
      return json(patched ? { id: 9, rev: 6, relations: [] } : linked);
    });
    const { issueDependencyUnlink } = await import("../../lib/providers/azure/issues.ts");
    await expect(issueDependencyUnlink("", 9, 7)).resolves.toBeUndefined();
  });

  it("link is a success when the store reports a duplicate relation the item really holds", async () => {
    useConfig("azure");
    let patched = false;
    stubFetch((r) => {
      if (r.method === "PATCH") {
        patched = true;
        return json({ message: "TF201036: relation already exists" }, 400);
      }
      return json(patched ? linked : { id: 9, rev: 5, relations: [] });
    });
    const { issueDependencyLink } = await import("../../lib/providers/azure/issues.ts");
    await expect(issueDependencyLink("", 9, 7)).resolves.toBeUndefined();
  });

  it("link still fails when the relation is not there afterwards", async () => {
    useConfig("azure");
    stubFetch((r) => (r.method === "PATCH" ? json({ message: "boom" }, 400) : json({ id: 9, rev: 5, relations: [] })));
    const { issueDependencyLink } = await import("../../lib/providers/azure/issues.ts");
    await expect(issueDependencyLink("", 9, 7)).rejects.toThrow(/boom/);
  });
});

// ---------------------------------------------------------------------------
// P8: a failed comment-count read is not "no comments"
// ---------------------------------------------------------------------------

describe("azure issue view comment count", () => {
  it("a failed count read fails the view instead of reporting zero comments", async () => {
    useConfig("azure");
    stubFetch((r) => {
      if (isTypeList(r)) return json(TYPE_LIST);
      if (r.url.includes("/comments")) return json({ message: "forbidden" }, 403);
      return json({ id: 9, fields: { "System.WorkItemType": "Task", "System.State": "New" } });
    });
    const { issuesView } = await import("../../lib/providers/azure/issues.ts");
    await expect(issuesView("", 9)).rejects.toThrow(/comment/i);
  });
});

// ---------------------------------------------------------------------------
// P9: a connection scan with a missing cursor is an error
// ---------------------------------------------------------------------------

describe("github project scan", () => {
  it("hasNextPage with a null cursor throws instead of reporting 'no project'", async () => {
    useConfig("github");
    ghStub(
      `if [ "$1 $2" = "api graphql" ]; then echo '{"data":{"organization":{"projectsV2":{"pageInfo":{"hasNextPage":true,"endCursor":null},"nodes":[{"number":3,"title":"other"}]}}}}'; exit 0; fi`,
    );
    const gh = await import("../../lib/providers/github/projects.ts");
    expect(() => gh.projectsNumberByName("org", "Board")).toThrow(/cursor/);
  });
});

// ---------------------------------------------------------------------------
// P11: a swallowed Azure settings failure keeps its reason
// ---------------------------------------------------------------------------

describe("facade repos team/collaborator put on azure", () => {
  it("a provider failure reads false and the reason reaches stderr", async () => {
    useConfig("azure");
    stubFetch(() => json({ message: "TF401027: you need the PermissionX permission" }, 403));
    const written: string[] = [];
    vi.spyOn(process.stderr, "write").mockImplementation(((chunk: string | Uint8Array) => {
      written.push(String(chunk));
      return true;
    }) as typeof process.stderr.write);
    const facade = await import("../../lib/providers/facade/repos.ts");
    expect(await facade.reposTeamPut("org", "Team", "proj/repo", "push")).toBe(false);
    expect(written.join("")).toMatch(/403|PermissionX/);
  });
});

// ---------------------------------------------------------------------------
// P12: GitHub verbs throw ProviderError
// ---------------------------------------------------------------------------

describe("github prsThreadReply", () => {
  it("a non-numeric comment id is a ProviderError", async () => {
    useConfig("github");
    const gh = await import("../../lib/providers/github/prs.ts");
    const { ProviderError } = await import("../../lib/providers/provider-core.ts");
    const err = await gh.prsThreadReply("o/r", 1, "12abc", "hi").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ProviderError);
  });
});

// ---------------------------------------------------------------------------
// P3: facade verbs replace raw gh access
// ---------------------------------------------------------------------------

describe("facade repos exists / squash / name-with-owner", () => {
  it("github: reposExists answers from gh's exit status", async () => {
    useConfig("github");
    const { calls } = ghStub('if [ "$1 $2" = "repo view" ] && [ "$3" = "org/gone" ]; then exit 1; fi');
    const facade = await import("../../lib/providers/facade/repos.ts");
    expect(await facade.reposExists("org/here")).toBe(true);
    expect(await facade.reposExists("org/gone")).toBe(false);
    expect(calls()[0]).toBe("gh repo view org/here --json name -q .name");
  });

  it("azure: reposExists reads the repository over HTTP and never spawns gh", async () => {
    useConfig("azure");
    const gh = ghStub("exit 9");
    stubFetch((r) => (r.url.includes("/repositories/missing") ? json({ message: "not found" }, 404) : json({ id: "g1", name: "repo", project: { name: "proj" } })));
    const facade = await import("../../lib/providers/facade/repos.ts");
    expect(await facade.reposExists("proj/repo")).toBe(true);
    expect(await facade.reposExists("proj/missing")).toBe(false);
    expect(gh.calls()).toEqual([]);
  });

  it("github: reposSquashMergeAllowed reads allowSquashMerge", async () => {
    useConfig("github");
    const { calls } = ghStub('if [ "$1 $2" = "repo view" ]; then echo true; exit 0; fi');
    const facade = await import("../../lib/providers/facade/repos.ts");
    expect(await facade.reposSquashMergeAllowed("org/repo")).toBe(true);
    expect(calls()[0]).toBe("gh repo view org/repo --json allowSquashMerge -q .allowSquashMerge");
  });

  it("azure: reposSquashMergeAllowed is a named unsupported error", async () => {
    useConfig("azure");
    const facade = await import("../../lib/providers/facade/repos.ts");
    await expect(facade.reposSquashMergeAllowed("proj/repo")).rejects.toThrow(/not supported on provider 'azure'/);
  });

  it("github: reposNameWithOwner views the working directory's repository", async () => {
    useConfig("github");
    const { calls } = ghStub('if [ "$1 $2" = "repo view" ]; then echo org/here; exit 0; fi');
    const facade = await import("../../lib/providers/facade/repos.ts");
    expect(await facade.reposNameWithOwner(process.cwd())).toBe("org/here");
    expect(calls()[0]).toBe("gh repo view --json nameWithOwner --jq .nameWithOwner");
  });

  it("azure: reposNameWithOwner is null (the caller falls back to the remote URL)", async () => {
    useConfig("azure");
    const facade = await import("../../lib/providers/facade/repos.ts");
    expect(await facade.reposNameWithOwner(process.cwd())).toBeNull();
  });
});

describe("facade projects add-issue", () => {
  it("github: resolves a title to its number, then adds the issue URL", async () => {
    useConfig("github");
    const { calls } = ghStub(
      [
        `if [ "$1 $2" = "api graphql" ]; then echo '{"data":{"organization":{"projectsV2":{"pageInfo":{"hasNextPage":false,"endCursor":null},"nodes":[{"number":4,"title":"Board"}]}}}}'; exit 0; fi`,
      ].join("\n"),
    );
    const facade = await import("../../lib/providers/facade/projects.ts");
    await facade.projectsAddIssue("org", "Board", "https://github.com/org/r/issues/1");
    expect(calls().some((c) => c.startsWith("gh project item-add 4 --url https://github.com/org/r/issues/1"))).toBe(true);
  });

  it("github: a numeric project skips the title lookup", async () => {
    useConfig("github");
    const { calls } = ghStub("exit 0");
    const facade = await import("../../lib/providers/facade/projects.ts");
    await facade.projectsAddIssue("org", "12", "https://github.com/org/r/issues/1");
    expect(calls().some((c) => c.includes("graphql"))).toBe(false);
    expect(calls().some((c) => c.startsWith("gh project item-add 12"))).toBe(true);
  });

  it("azure: never spawns gh", async () => {
    useConfig("azure");
    const gh = ghStub("exit 9");
    stubFetch(() => json({}));
    const facade = await import("../../lib/providers/facade/projects.ts");
    await facade.projectsAddIssue("org", "Board", "https://dev.azure.com/org/proj/_workitems/edit/5").catch(() => undefined);
    expect(gh.calls()).toEqual([]);
  });
});

describe("facade org package verbs", () => {
  it("github: orgPackagesQuery scopes by owner, repo and type", async () => {
    useConfig("github");
    const { calls } = ghStub("echo '[]'");
    const facade = await import("../../lib/providers/facade/org.ts");
    await facade.orgPackagesQuery("acme", { type: "npm" });
    await facade.orgPackagesQuery("acme", { repo: "lib" });
    await facade.orgPackagesQuery("acme", { type: "npm", paginate: true });
    expect(calls()[0]).toBe("gh api /users/acme/packages --method GET -f package_type=npm");
    expect(calls()[1]).toBe("gh api /repos/acme/lib/packages --method GET");
    expect(calls()[2]).toBe("gh api /users/acme/packages --method GET --paginate --slurp -f package_type=npm");
  });

  it("github: orgPackageVersionsQuery can paginate", async () => {
    useConfig("github");
    const { calls } = ghStub("echo '[]'");
    const facade = await import("../../lib/providers/facade/org.ts");
    await facade.orgPackageVersionsQuery("acme", "npm", "left-pad", { paginate: true });
    await facade.orgPackageVersionsQuery("acme", "npm", "left-pad", { repo: "lib" });
    expect(calls()[0]).toBe("gh api /users/acme/packages/npm/left-pad/versions --paginate --slurp");
    expect(calls()[1]).toBe("gh api /repos/acme/lib/packages/npm/left-pad/versions");
  });

  it("azure: both are named unsupported errors", async () => {
    useConfig("azure");
    const facade = await import("../../lib/providers/facade/org.ts");
    await expect(facade.orgPackagesQuery("acme", {})).rejects.toThrow(/not supported on provider 'azure'/);
    await expect(facade.orgPackageVersionsQuery("acme", "npm", "x", {})).rejects.toThrow(/not supported on provider 'azure'/);
  });
});

describe("events read the PR body through the facade", () => {
  it("github: the body is requested with pr view --json body", async () => {
    useConfig("github");
    const { calls } = ghStub('if [ "$1 $2" = "pr view" ]; then echo \'{"body":"no linked issues"}\'; exit 0; fi');
    const { signalPrEventsForPr } = await import("../../lib/domain/events.ts");
    const r = await signalPrEventsForPr("created", "12", "org/repo");
    expect(r.fired).toEqual([]);
    expect(calls()[0]).toBe("gh pr view 12 --json body -R org/repo");
  });

  it("azure: reads over HTTP and never spawns gh", async () => {
    useConfig("azure");
    const gh = ghStub("exit 9");
    stubFetch(() => json({ pullRequestId: 12, description: "" }));
    const { signalPrEventsForPr } = await import("../../lib/domain/events.ts");
    await signalPrEventsForPr("created", "12", "proj/repo");
    expect(gh.calls()).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// P2: pr-merge / pr-thread-resolve show the provider's reason
// ---------------------------------------------------------------------------

describe("pr-thread-resolve error text", () => {
  it("prints the provider's failure after the generic line", () => {
    const root = tmpDir("round3b-resolve");
    dirs.push(root);
    const bin = join(root, "bin");
    mkdirSync(bin, { recursive: true });
    stubCli(
      bin,
      "gh",
      [
        "#!/usr/bin/env bash",
        'if [ "$1" = "auth" ]; then exit 0; fi',
        'echo "thread-not-resolvable-detail" >&2',
        "exit 1",
        "",
      ].join("\n"),
    );
    const repo = join(root, "repo");
    spawnSync("git", ["init", "-q", repo]);
    const r = runTool("pr-thread-resolve", ["PRRT_abc"], {
      cwd: repo,
      env: { DEVENV_REPO: "org/repo", PATH: pathWithStubs(bin), GIT_TERMINAL_PROMPT: "0" },
    });
    expect(r.status).not.toBe(0);
    expect(r.output).toContain("Failed to resolve thread: PRRT_abc");
    expect(r.output).toContain("thread-not-resolvable-detail");
  });
});
