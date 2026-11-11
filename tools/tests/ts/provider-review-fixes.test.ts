// provider-review-fixes.test.ts — provider-layer correctness fixes: Azure edit
// concurrency and tag semantics, scoped not-found detection, refused (never
// dropped) options, thread-ref routing, numeric comment ids, null GraphQL
// nodes, browser build URLs and empty comment bodies. Azure HTTP is the
// stubbed global fetch; GitHub is a stub `gh` on PATH. Nothing reaches a
// backend.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CALLS_LOG_NAME, pathWithStubs, rmrf, stubGh, tmpDir } from "./harness/index.ts";

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
  const root = tmpDir("review-fixes");
  dirs.push(root);
  writeFileSync(
    join(root, "devenv.config"),
    `[provider]\nname=${provider}\nazure_org=org\nazure_project=proj\n\n[organization]\norg=fixture-org\n`,
  );
  process.env.DEVENV_ROOT = root;
  process.env.AZURE_DEVOPS_ORG = "test-org";
  process.env.AZURE_DEVOPS_PROJECT = "test-project";
  process.env.AZURE_PAT = "test-pat";
  vi.resetModules();
  return root;
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
// Azure issuesEdit: revision guard and tag semantics
// ---------------------------------------------------------------------------

/** A work item store that advances rev on PATCH; `patchReply` overrides PATCH. */
function item(tags: string, patchReply?: () => Response): Req[] {
  let rev = 3;
  return stubFetch((r) => {
    if (r.method === "PATCH") {
      if (patchReply !== undefined) return patchReply();
      rev = 4;
      return json({ id: 9, rev });
    }
    return json({
      id: 9,
      rev,
      fields: { "System.WorkItemType": "User Story", "System.Tags": tags, "System.Rev": rev, "System.ChangedDate": `2026-10-30T00:0${rev}:00Z` },
    });
  });
}
const patchOps = (calls: Req[]): Op[] => calls.filter((c) => c.method === "PATCH")[0]?.body as Op[];

describe("azure issuesEdit: concurrency guard", () => {
  it("leads the PATCH with a test op on the revision the tags were read at", async () => {
    useConfig("azure");
    const { issuesEdit } = await import("../../lib/providers/azure/issues.ts");
    const calls = item("old; keep");
    await issuesEdit("", 9, { title: "T", addLabel: "new" });
    expect(patchOps(calls)[0]).toEqual({ op: "test", path: "/rev", value: 3 });
    expect(patchOps(calls).some((o) => o.path === "/fields/System.Tags")).toBe(true);
  });

  it.each([[412, { message: "precondition failed" }], [409, { message: "conflict" }], [400, { message: "VS402625: The test operation on /rev failed" }]])(
    "a stale revision (%i) is a named concurrent-modification error and is not retried",
    async (status, body) => {
      useConfig("azure");
      const { issuesEdit } = await import("../../lib/providers/azure/issues.ts");
      const calls = item("a", () => json(body, status));
      await expect(issuesEdit("", 9, { addLabel: "b" })).rejects.toThrow(/modified concurrently/);
      expect(calls.filter((c) => c.method === "PATCH")).toHaveLength(1);
    },
  );

  it("an unrelated 400 keeps its own message", async () => {
    useConfig("azure");
    const { issuesEdit } = await import("../../lib/providers/azure/issues.ts");
    item("a", () => json({ message: "TF401320: bad field" }, 400));
    const err = await issuesEdit("", 9, { addLabel: "b" }).catch((e: unknown) => e as Error);
    expect((err as Error).message).toMatch(/TF401320/);
    expect((err as Error).message).not.toMatch(/modified concurrently/);
  });
});

describe("azure issuesEdit: tags are case-insensitive and ';' splits", () => {
  it("adding 'Bug' to an item tagged 'bug' sends no PATCH", async () => {
    useConfig("azure");
    const { issuesEdit } = await import("../../lib/providers/azure/issues.ts");
    const calls = item("bug; other");
    await issuesEdit("", 9, { addLabel: "Bug" });
    expect(calls.filter((c) => c.method === "PATCH")).toHaveLength(0);
  });

  it("removing 'Bug' removes the stored 'bug'", async () => {
    useConfig("azure");
    const { issuesEdit } = await import("../../lib/providers/azure/issues.ts");
    const calls = item("bug; other");
    await issuesEdit("", 9, { removeLabel: "Bug" });
    expect(patchOps(calls).find((o) => o.path === "/fields/System.Tags")).toEqual({ op: "replace", path: "/fields/System.Tags", value: "other" });
  });

  it("a label with ';' is the several tags Azure makes of it, each added once", async () => {
    useConfig("azure");
    const { issuesEdit } = await import("../../lib/providers/azure/issues.ts");
    const calls = item("a; B");
    await issuesEdit("", 9, { addLabel: "b; c" });
    expect(patchOps(calls).find((o) => o.path === "/fields/System.Tags")?.value).toBe("a; B; c");
    // Re-adding the same label is then a no-op, not a re-add on every edit.
    const again = item("a; B; c");
    await issuesEdit("", 9, { addLabel: "b; c" });
    expect(again.filter((c) => c.method === "PATCH")).toHaveLength(0);
  });

  it("a label with ';' on remove removes each tag", async () => {
    useConfig("azure");
    const { issuesEdit } = await import("../../lib/providers/azure/issues.ts");
    const calls = item("a; b; c");
    await issuesEdit("", 9, { removeLabel: "A;c" });
    expect(patchOps(calls).find((o) => o.path === "/fields/System.Tags")?.value).toBe("b");
  });

  it("a label that spells no tag is a named error and sends nothing", async () => {
    useConfig("azure");
    const { issuesEdit } = await import("../../lib/providers/azure/issues.ts");
    const calls = item("a");
    await expect(issuesEdit("", 9, { addLabel: " ; " })).rejects.toThrow(/at least one non-empty tag/);
    expect(calls).toHaveLength(0);
  });
});

describe("azure unlink verbs: stale revision", () => {
  it("issueGraphUnlink against a stale revision surfaces a clear error", async () => {
    useConfig("azure");
    const { issueGraphUnlink } = await import("../../lib/providers/azure/issues.ts");
    const calls = stubFetch((r) =>
      r.method === "PATCH"
        ? json({ message: "precondition failed" }, 412)
        : json({ id: 1, rev: 7, relations: [{ rel: "System.LinkTypes.Hierarchy-Forward", url: "https://x/_apis/wit/workItems/2" }] }),
    );
    await expect(issueGraphUnlink("", 1, 2)).rejects.toThrow(/modified concurrently/);
    expect(calls.filter((c) => c.method === "PATCH")).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Not-found detection
// ---------------------------------------------------------------------------

describe("issuesExists: only the item's absence is false", () => {
  it("azure: a 404 and TF401232 are false", async () => {
    useConfig("azure");
    const { issuesExists } = await import("../../lib/providers/azure/issues.ts");
    stubFetch(() => json({}, 404));
    await expect(issuesExists("", 9)).resolves.toBe(false);
    stubFetch(() => json({ message: "TF401232: Work item 9 does not exist" }, 400));
    await expect(issuesExists("", 9)).resolves.toBe(false);
  });

  it.each([404, 400])("azure: a 'project does not exist' answer (%i) is an error", async (status) => {
    useConfig("azure");
    const { issuesExists } = await import("../../lib/providers/azure/issues.ts");
    stubFetch(() => json({ message: "TF200016: The following project does not exist: nope" }, status));
    await expect(issuesExists("", 9)).rejects.toThrow(/project does not exist/);
  });

  it("azure: ProviderError carries the HTTP status", async () => {
    useConfig("azure");
    const { azureHttp } = await import("../../lib/providers/azure/http.ts");
    stubFetch(() => json({ message: "nope" }, 404));
    const err = (await azureHttp("GET", "https://dev.azure.com/o/p/_apis/x").catch((e: unknown) => e)) as { status?: number };
    expect(err.status).toBe(404);
  });

  describe("github", () => {
    let dir = "";
    beforeEach(() => {
      dir = tmpDir("review-gh");
      dirs.push(dir);
    });
    const stub = (body: string): void => {
      stubGh(dir, `#!/usr/bin/env bash\nprintf '%s\\n' "gh $*" >> "${join(dir, CALLS_LOG_NAME)}"\n${body}\n`);
      process.env.PATH = pathWithStubs(dir);
    };
    const log = (): string => (existsSync(join(dir, CALLS_LOG_NAME)) ? readFileSync(join(dir, CALLS_LOG_NAME), "utf8") : "");

    it("'Could not resolve to a Repository' is an error, not 'absent'", async () => {
      useConfig("github");
      const gh = await import("../../lib/providers/github/issues.ts");
      stub('echo "GraphQL: Could not resolve to a Repository with the name \'o/r\'." >&2; exit 1');
      await expect(gh.issuesExists("o/r", 9)).rejects.toThrow(/Could not resolve to a Repository/);
    });

    it("'Could not resolve to an Issue' is false", async () => {
      useConfig("github");
      const gh = await import("../../lib/providers/github/issues.ts");
      stub('echo "GraphQL: Could not resolve to an Issue with the number of 9." >&2; exit 1');
      await expect(gh.issuesExists("o/r", 9)).resolves.toBe(false);
    });

    it("an empty or whitespace comment body is refused before gh runs", async () => {
      useConfig("github");
      const gh = await import("../../lib/providers/github/issues.ts");
      stub("echo https://x");
      await expect(gh.issuesComment("o/r", 5, { body: "" })).rejects.toThrow(/comment body is empty/);
      await expect(gh.issuesComment("o/r", 5, { body: " \n\t" })).rejects.toThrow(/comment body is empty/);
      expect(log()).not.toContain("issue comment");
    });

    it("prsThreadReply: '12abc' and Azure-shaped '5/9' are named errors", async () => {
      useConfig("github");
      const prs = await import("../../lib/providers/github/prs.ts");
      stub("echo '{}'");
      await expect(prs.prsThreadReply("o/r", 3, "12abc", "hi")).rejects.toThrow(/comment id must be numeric/);
      await expect(prs.prsThreadReply("o/r", 3, "5/9", "hi")).rejects.toThrow(/comment id must be numeric/);
      expect(log()).not.toContain("replies");
      await prs.prsThreadReply("o/r", 3, "12", "hi");
      expect(log()).toContain("/repos/o/r/pulls/3/comments/12/replies");
    });

    it("scanConnection skips null nodes", async () => {
      useConfig("github");
      const gh = await import("../../lib/providers/github/projects.ts");
      const page = { data: { organization: { projectsV2: { pageInfo: { hasNextPage: false, endCursor: "" }, nodes: [null, { id: "PVT_1", number: 4, title: "Board" }] } } } };
      writeFileSync(join(dir, "page.json"), JSON.stringify(page));
      stub(`cat "${join(dir, "page.json")}"`);
      expect(gh.projectsNumberByName("org", "Board")).toBe("4");
    });
  });
});

describe("azure comment body", () => {
  it("an empty or whitespace-only body is refused before any request", async () => {
    useConfig("azure");
    const { issuesComment } = await import("../../lib/providers/azure/issues.ts");
    const calls = stubFetch(() => undefined);
    await expect(issuesComment("", 5, { body: "" })).rejects.toThrow(/comment body is empty/);
    await expect(issuesComment("", 5, { body: "  \n" })).rejects.toThrow(/comment body is empty/);
    expect(calls).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Pipelines: refused options, browser url
// ---------------------------------------------------------------------------

describe("azure pipelines facade: options are refused, never dropped", () => {
  async function facade() {
    useConfig("azure");
    const calls = stubFetch((r) => {
      if (r.url.includes("/definitions")) return json({ value: [{ id: 3, name: "ci" }] });
      if (r.method === "GET" && r.url.includes("/repositories/")) return json({ id: "g", defaultBranch: "refs/heads/main" });
      return json({ id: 7, status: "completed", result: "succeeded", definition: { name: "ci" } });
    });
    return { f: await import("../../lib/providers/facade/pipelines.ts"), calls };
  }

  it.each([["--failed"], ["-d"], ["--debug"]])("rerun %s is a named error and no request is made", async (flag) => {
    const { f, calls } = await facade();
    await expect(f.pipelinesRunRerun("org/proj/repo", "7", [flag])).rejects.toThrow(/pipelinesRunRerun: unknown or unsupported option/);
    expect(calls).toHaveLength(0);
  });

  it("rerun without flags still retries the build", async () => {
    const { f, calls } = await facade();
    await f.pipelinesRunRerun("org/proj/repo", "7", []);
    expect(calls.some((c) => c.method === "PATCH" && c.url.includes("retry=true"))).toBe(true);
  });

  it("watch rejects flags other than --exit-status", async () => {
    const { f } = await facade();
    await expect(f.pipelinesRunWatch("org/proj/repo", "7", ["--interval", "5"])).rejects.toThrow(/pipelinesRunWatch: unknown or unsupported option '--interval'/);
    const ok = await f.pipelinesRunWatch("org/proj/repo", "7", ["--exit-status"]);
    expect(ok.status).toBe(0);
  });

  it("workflow run rejects an unknown flag, a '-f' without '=', and a missing value", async () => {
    const { f, calls } = await facade();
    await expect(f.pipelinesWorkflowRun("org/proj/repo", "ci", ["--bogus"])).rejects.toThrow(/pipelinesWorkflowRun: unknown or unsupported option '--bogus'/);
    await expect(f.pipelinesWorkflowRun("org/proj/repo", "ci", ["-f", "k"])).rejects.toThrow(/expects KEY=VALUE, got 'k'/);
    await expect(f.pipelinesWorkflowRun("org/proj/repo", "ci", ["--ref"])).rejects.toThrow(/requires a value/);
    await expect(f.pipelinesWorkflowRun("org/proj/repo", "ci", ["-f"])).rejects.toThrow(/requires a value/);
    expect(calls).toHaveLength(0);
  });

  it("workflow run still maps --ref and -f K=V", async () => {
    const { f, calls } = await facade();
    await f.pipelinesWorkflowRun("org/proj/repo", "ci", ["--ref", "dev", "-f", "a=b=c"]);
    const post = calls.find((c) => c.method === "POST") as Req;
    const body = post.body as { sourceBranch: string; parameters: string };
    expect(body.sourceBranch).toBe("refs/heads/dev");
    expect(JSON.parse(body.parameters)).toEqual({ a: "b=c" });
  });

  it("run view maps url to the build's browser page, not the REST address", async () => {
    const { f } = await facade();
    stubFetch(() => json({ id: 7, status: "completed", result: "succeeded", url: "https://dev.azure.com/org/guid/_apis/build/Builds/7" }));
    const out = await f.pipelinesRunView("org/proj/repo", "7", { json: "url", jq: ".url" });
    expect(out.trim()).toBe("https://dev.azure.com/org/proj/_build/results?buildId=7");
  });
});

// ---------------------------------------------------------------------------
// Template setting honesty, thread resolve routing, Retry-After
// ---------------------------------------------------------------------------

describe("repos edit on azure", () => {
  it("the facade refuses with a named error instead of reporting success", async () => {
    useConfig("azure");
    const repos = await import("../../lib/providers/facade/repos.ts");
    await expect(repos.reposEdit("org/proj/repo", ["--template"])).rejects.toThrow("repos_edit is not supported on provider 'azure'");
  });

  it("configureTemplateSettingForType logs a skip, never 'marked as template'", async () => {
    useConfig("azure");
    const calls = stubFetch(() => undefined);
    const logged: string[] = [];
    const spy = (c: string | Uint8Array): boolean => (logged.push(String(c)), true);
    vi.spyOn(process.stdout, "write").mockImplementation(spy as typeof process.stdout.write);
    vi.spyOn(process.stderr, "write").mockImplementation(spy as typeof process.stderr.write);
    vi.spyOn(console, "error").mockImplementation((...a: unknown[]) => void logged.push(a.join(" ")));
    const m = await import("../../lib/domain/repos/types.ts");
    const config = m.RepoTypesConfigSchema.parse({
      types: { tpl: { naming_pattern: ".*", naming_example: "x", isTemplate: true } },
    });
    const ok = await m.configureTemplateSettingForType("org/proj/repo", "tpl", config);
    const text = logged.join("\n");
    expect(text).not.toContain("marked as template");
    expect(text).toMatch(/Template setting skipped/);
    expect(ok).toBe(true);
    expect(calls).toHaveLength(0);
  });
});

describe("prsThreadResolve routing on azure", () => {
  async function run(spec: string | undefined, ref: string): Promise<Req[]> {
    useConfig("azure");
    const calls = stubFetch(() => json({ id: 5, status: "fixed" }));
    process.env.DEVENV_REPO = "org/proj/origin-repo";
    const prs = await import("../../lib/providers/facade/prs.ts");
    await prs.prsThreadResolve(spec, ref);
    return calls;
  }

  it("a fully prefixed ref wins over the resolved repo", async () => {
    const calls = await run("org/proj/other", "org/proj/widgets/12/34");
    expect(calls[0]?.url).toContain("/repositories/widgets/pullrequests/12/threads/34");
  });

  it("a fully prefixed ref works with the repo resolved from DEVENV_REPO", async () => {
    const calls = await run(undefined, "org/proj/widgets/12/34");
    expect(calls[0]?.url).toContain("/repositories/widgets/pullrequests/12/threads/34");
  });

  it("'<pr>/<thread>' still uses the resolved repo", async () => {
    const calls = await run("org/proj/widgets", "12/34");
    expect(calls[0]?.url).toContain("/repositories/widgets/pullrequests/12/threads/34");
  });
});

describe("retryAfterMs", () => {
  it("an HTTP-date is not a delay (null: the caller backs off itself); '0' is zero", async () => {
    useConfig("azure");
    const { retryAfterMs } = await import("../../lib/providers/azure/http.ts");
    expect(retryAfterMs("Wed, 21 Oct 2026 07:28:00 GMT")).toBeNull();
    expect(retryAfterMs("0")).toBe(0);
  });
});
