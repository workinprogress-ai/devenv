// azure.test.ts — the azure provider's portable surface: URL seam, remote
// parsing, text round-trip, tag handling, marker transform, build/status
// mappings, SDDL identity decode, grant bits, and the threads-page seam
// projection (cursor contract). The transport (fetch) is exercised live in
// the azure smoke harness, not here.

import { describe, it, expect, vi } from "vitest";
import {
  azureRedact,
  azureUrlIsProviderHost,
  AZURE_API_VERSION,
} from "../../lib/providers/azure/http.ts";
import {
  webHost,
  azureUri,
  azureUriDecode,
  azureParseRemote,
  remoteToWeb,
  remoteToSpec,
  gitTransportUrl,
  gitRemoteBase,
  webUrl,
  extractUrl,
  issueWebUrl,
  prWebUrl,
  azureOrgProject,
  azureRepoParts,
} from "../../lib/providers/azure/urls.ts";
import {
  azureTextDecode,
  azureTextNormalize,
  azureTagsSplit,
  azureTagsJoin,
  splitCommentRef,
  azureMarkerTransform,
  workItemTypeFor,
  issuesCreate,
} from "../../lib/providers/azure/issues.ts";
import {
  identitySddl,
  grantBits,
  applyListFlags,
} from "../../lib/providers/azure/repos.ts";
import {
  boardNameForType,
  kanbanField,
  statusAlias,
} from "../../lib/providers/azure/projects.ts";
import {
  buildStatusToSeam,
  buildResultToSeam,
  mapBuild,
  AZURE_BUILD_FIELDS,
} from "../../lib/providers/azure/pipelines.ts";
import { rulesetBranches, translateRuleset } from "../../lib/providers/azure/policies.ts";

// ---------------------------------------------------------------------------
// http.ts (pure parts)
// ---------------------------------------------------------------------------

describe("azure http (pure surface)", () => {
  it("api-version constant pins 7.1", () => {
    expect(AZURE_API_VERSION).toBe("7.1");
  });

  it("redaction strips an env PAT and Basic headers", () => {
    process.env.AZURE_PAT = "SECRETPAT123";
    try {
      expect(azureRedact("call SECRETPAT123 now")).toBe("call ***REDACTED*** now");
    } finally {
      delete process.env.AZURE_PAT;
    }
    expect(azureRedact("Authorization: Basic abc123+/=")).toBe(
      "Authorization: Basic ***REDACTED***",
    );
  });

  it("provider-host allowlist: azure hosts pass, others refuse", () => {
    expect(azureUrlIsProviderHost("https://dev.azure.com/org/proj")).toBe(true);
    expect(azureUrlIsProviderHost("https://org.visualstudio.com/proj")).toBe(true);
    expect(azureUrlIsProviderHost("http://dev.azure.com/org/proj")).toBe(false);
    expect(azureUrlIsProviderHost("https://evil.example/x")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// urls.ts
// ---------------------------------------------------------------------------

describe("azure urls", () => {
  it("host literal is dev.azure.com", () => {
    expect(webHost()).toBe("dev.azure.com");
  });

  it("uri encoding percent-encodes spaces", () => {
    expect(azureUri("My Project")).toBe("My%20Project");
    expect(azureUriDecode("My%20Project")).toBe("My Project");
  });

  it("remote parsing: https, visualstudio and ssh-v3 forms", () => {
    expect(azureParseRemote("https://dev.azure.com/org/My%20Proj/_git/widgets")).toEqual({
      org: "org",
      project: "My Proj",
      repo: "widgets",
    });
    expect(azureParseRemote("https://org.visualstudio.com/proj/_git/repo")).toEqual({
      org: "org",
      project: "proj",
      repo: "repo",
    });
    expect(azureParseRemote("git@ssh.dev.azure.com:v3/o/p/r.git")).toEqual({
      org: "o",
      project: "p",
      repo: "r",
    });
    expect(azureParseRemote("https://github.com/o/r")).toBeNull();
  });

  it("remoteToWeb collapses all forms to the clean https shape", () => {
    expect(remoteToWeb("git@ssh.dev.azure.com:v3/o/p/r")).toBe(
      "https://dev.azure.com/o/p/_git/r",
    );
    expect(remoteToWeb("https://github.com/o/r")).toBeNull();
  });

  it("remoteToSpec strips the org (org always from config)", () => {
    expect(remoteToSpec("https://dev.azure.com/o/p/_git/r")).toBe("p/r");
  });

  it("web-url builders carry the azure path shapes", () => {
    expect(issueWebUrl("org/proj/widgets", 7)).toBe(
      "https://dev.azure.com/org/proj/_workitems/edit/7",
    );
    expect(prWebUrl("org/proj/widgets", 12)).toBe(
      "https://dev.azure.com/org/proj/_git/widgets/pullrequest/12",
    );
  });

  it("extractUrl finds dev.azure.com URLs (and none elsewhere)", () => {
    expect(extractUrl("see https://dev.azure.com/o/p/_git/r/pullrequest/3 done")).toBe(
      "https://dev.azure.com/o/p/_git/r/pullrequest/3",
    );
    expect(extractUrl("nothing here")).toBeNull();
  });

  it("repo parts: bare repo fills org/project from config; missing config throws", () => {
    process.env.AZURE_DEVOPS_ORG = "org";
    process.env.AZURE_DEVOPS_PROJECT = "proj";
    try {
      expect(azureRepoParts("widgets")).toEqual({ org: "org", project: "proj", repo: "widgets" });
      expect(azureRepoParts("proj/widgets")).toEqual({ org: "org", project: "proj", repo: "widgets" });
      expect(azureOrgProject()).toEqual({ org: "org", project: "proj" });
    } finally {
      delete process.env.AZURE_DEVOPS_ORG;
      delete process.env.AZURE_DEVOPS_PROJECT;
    }
  });

  it("git transport urls are clean (no embedded credentials)", () => {
    expect(gitTransportUrl("org", "proj", "repo")).toBe(
      "https://dev.azure.com/org/proj/_git/repo",
    );
    expect(gitRemoteBase("org")).toBe("https://dev.azure.com/org");
    expect(webUrl("org/proj/repo", "pullrequest/1")).toBe(
      "https://dev.azure.com/org/proj/repo/pullrequest/1",
    );
  });
});

// ---------------------------------------------------------------------------
// issues.ts (pure parts)
// ---------------------------------------------------------------------------

describe("azure issues text round-trip", () => {
  it("entity decode covers the Azure set with &amp; last", () => {
    expect(azureTextDecode("a &quot;b&quot; &amp; c &lt;d&gt;")).toBe('a "b" & c <d>');
    expect(azureTextDecode("&amp;quot;")).toBe("&quot;");
  });

  it("newline pairing: one trailing newline dropped on write", () => {
    expect(azureTextNormalize("x\n")).toBe("x");
    expect(azureTextNormalize("x\n\n")).toBe("x\n");
  });

  it("tags split/join round-trip", () => {
    expect(azureTagsSplit("a; b;  c ")).toEqual(["a", "b", "c"]);
    expect(azureTagsJoin(["a", "b"])).toBe("a; b");
  });

  it("comment refs are strictly <issue>/<comment>", () => {
    expect(splitCommentRef("42/7")).toEqual({ workItem: "42", commentId: "7" });
    expect(() => splitCommentRef("42")).toThrow();
    expect(() => splitCommentRef("a/b")).toThrow();
    expect(() => splitCommentRef("1/2/3")).toThrow();
  });

  it("marker transform surfaces doc_id outside stripped comment blocks", () => {
    const body = "<!-- DEVENV_ARTIFACT_V1\ndoc_id: X-1\n-->\ncontent";
    const t = azureMarkerTransform(body);
    expect(t).toBe("doc_id: X-1\ncontent");
    expect(azureMarkerTransform(t)).toBe(t); // idempotent
    expect(azureMarkerTransform("plain body")).toBe("plain body");
  });

  it("work-item type map: built-ins pass, unknown throws", async () => {
    // The mapped-type availability check rides azureHttp; these stub the
    // transport and the org/project env so the map semantics stay testable
    // without a live org or a devenv.config.
    process.env.AZURE_DEVOPS_ORG = "test-org";
    process.env.AZURE_DEVOPS_PROJECT = "test-project";
    process.env.AZURE_PAT = "test-pat";
    const fetchMock = ((): typeof fetch => {
      const fn = (async () =>
        new Response(JSON.stringify({ value: [{ name: "Proposed" }], count: 1 }), {
          status: 200,
        })) as unknown as typeof fetch;
      return fn;
    })();
    vi.stubGlobal("fetch", fetchMock);
    try {
      await expect(workItemTypeFor("Bug")).resolves.toBe("Bug");
      await expect(workItemTypeFor("")).resolves.toBe("User Story");
      await expect(workItemTypeFor("task")).resolves.toBe("User Story");
      await expect(workItemTypeFor("EPIC")).resolves.toBe("Epic");
      await expect(workItemTypeFor("mystery")).rejects.toThrow(/azure_issue_types/);
    } finally {
      vi.unstubAllGlobals();
      delete process.env.AZURE_DEVOPS_ORG;
      delete process.env.AZURE_DEVOPS_PROJECT;
      delete process.env.AZURE_PAT;
    }
  });

  it("a mapped type the project does not offer fails naming the config key", async () => {
    process.env.AZURE_DEVOPS_ORG = "test-org";
    process.env.AZURE_DEVOPS_PROJECT = "test-project";
    process.env.AZURE_PAT = "test-pat";
    const fetchMock = ((): typeof fetch => {
      const fn = (async () =>
        // The availability probe: the type is absent from this project (404
        // with Azure's message shape).
        new Response(JSON.stringify({ message: "type absent" }), { status: 404 })) as unknown as typeof fetch;
      return fn;
    })();
    vi.stubGlobal("fetch", fetchMock);
    try {
      // User Story disabled in this project (the fork's exact state): the
      // untyped create fails early naming the [azure_issue_types] remediation.
      await expect(workItemTypeFor("")).rejects.toThrow(/azure_issue_types/);
      await expect(workItemTypeFor("")).rejects.toThrow(/User Story/);
    } finally {
      vi.unstubAllGlobals();
      delete process.env.AZURE_DEVOPS_ORG;
      delete process.env.AZURE_DEVOPS_PROJECT;
      delete process.env.AZURE_PAT;
    }
  });

  it("issuesCreate carries the mapped type on the create URL", async () => {
    process.env.AZURE_DEVOPS_ORG = "test-org";
    process.env.AZURE_DEVOPS_PROJECT = "test-project";
    process.env.AZURE_PAT = "test-pat";
    const urls: string[] = [];
    const fetchMock = ((): typeof fetch => {
      const fn = (async (url: string | URL | Request) => {
        urls.push(String(url));
        return new Response(JSON.stringify({ id: 42 }), { status: 200 });
      }) as unknown as typeof fetch;
      return fn;
    })();
    vi.stubGlobal("fetch", fetchMock);
    try {
      const id = await issuesCreate("", {
        title: "t",
        type: "task",
      });
      expect(id).toBe(42);
      expect(urls.some((u) => u.includes("/workitems/$User%20Story"))).toBe(true);
    } finally {
      vi.unstubAllGlobals();
      delete process.env.AZURE_DEVOPS_ORG;
      delete process.env.AZURE_DEVOPS_PROJECT;
      delete process.env.AZURE_PAT;
    }
  });

  it("a 5xx after retries surfaces Azure's message (redacted)", async () => {
    process.env.AZURE_DEVOPS_ORG = "test-org";
    process.env.AZURE_DEVOPS_PROJECT = "test-project";
    process.env.AZURE_PAT = "test-pat";
    const fetchMock = ((): typeof fetch => {
      const fn = (async () =>
        new Response(
          JSON.stringify({ message: "TF400000: server-side boom secret=AzurePat" }),
          { status: 500 },
        )) as unknown as typeof fetch;
      return fn;
    })();
    vi.stubGlobal("fetch", fetchMock);
    try {
      await expect(issuesCreate("", { title: "t" })).rejects.toThrow(/server-side boom/);
    } finally {
      vi.unstubAllGlobals();
      delete process.env.AZURE_DEVOPS_ORG;
      delete process.env.AZURE_DEVOPS_PROJECT;
      delete process.env.AZURE_PAT;
    }
  });
});

// ---------------------------------------------------------------------------
// repos.ts (pure parts)
// ---------------------------------------------------------------------------

describe("azure repos grants + list flags", () => {
  it("grant bits map (live-verified values)", () => {
    expect(grantBits("pull")).toBe(2);
    expect(grantBits("triage")).toBe(2);
    expect(grantBits("push")).toBe(54);
    expect(grantBits("maintain")).toBe(2230);
    expect(grantBits("admin")).toBe(3967);
    expect(() => grantBits("bogus")).toThrow();
  });

  it("SDDL decode: url-safe base64 payload with the identity prefix", () => {
    const payload = Buffer.from("identity-bytes", "utf8")
      .toString("base64")
      .replaceAll("+", "-")
      .replaceAll("/", "_")
      .replaceAll("=", "");
    const sddl = identitySddl(`vssgp.${payload}`);
    expect(sddl.startsWith("Microsoft.TeamFoundation.Identity;")).toBe(true);
    expect(sddl.includes("identity-bytes")).toBe(true);
  });

  it("applyListFlags projects --json fields and rejects unknown ones", () => {
    const rows = [{ name: "a", repoSpec: "p/a" }];
    expect(applyListFlags(rows, { json: "name" })).toBe('[{"name":"a"}]');
    expect(() => applyListFlags(rows, { json: "nope" })).toThrow(/unsupported --json field/);
  });
});

// ---------------------------------------------------------------------------
// projects.ts (pure parts)
// ---------------------------------------------------------------------------

describe("azure projects boards", () => {
  it("board name for type: Stories/Features/Epics, else '<type> Board'", () => {
    expect(boardNameForType("User Story")).toBe("Stories");
    expect(boardNameForType("Bug")).toBe("Stories");
    expect(boardNameForType("Feature")).toBe("Features");
    expect(boardNameForType("Epic")).toBe("Epics");
    expect(boardNameForType("Task")).toBe("Task Board");
  });

  it("kanban column field detected by the WEF_*_Kanban.Column pattern", () => {
    expect(
      kanbanField({ fields: { "System.Title": "t", "WEF_ABC_Kanban.Column": "New" } }),
    ).toBe("WEF_ABC_Kanban.Column");
    expect(kanbanField({ fields: { "System.Title": "t" } })).toBe("");
  });

  it("status alias: exact state passes through; unknown with states fails", () => {
    expect(statusAlias("New", ["New", "Closed"])).toBe("New");
    expect(() => statusAlias("To Do", ["New", "Closed"])).toThrow(/azure_status_aliases/);
  });
});

// ---------------------------------------------------------------------------
// pipelines.ts (pure parts)
// ---------------------------------------------------------------------------

describe("azure pipelines mappings", () => {
  it("build status maps to the seam dialect", () => {
    expect(buildStatusToSeam("inProgress")).toBe("in_progress");
    expect(buildStatusToSeam("cancelling")).toBe("in_progress");
    expect(buildStatusToSeam("notStarted")).toBe("queued");
    expect(buildStatusToSeam("completed")).toBe("completed");
    expect(buildStatusToSeam("weird")).toBe("unknown");
  });

  it("build result maps to the seam conclusion", () => {
    expect(buildResultToSeam("succeeded")).toBe("success");
    expect(buildResultToSeam("partiallySucceeded")).toBe("success");
    expect(buildResultToSeam("failed")).toBe("failure");
    expect(buildResultToSeam("canceled")).toBe("cancelled");
    expect(buildResultToSeam("none")).toBeNull();
  });

  it("mapBuild projects the seam run shape (and --json subsets)", () => {
    const build = {
      id: 5,
      buildNumber: "20261024.1",
      reason: "manual",
      status: "completed",
      result: "succeeded",
      sourceBranch: "refs/heads/feature",
      sourceVersion: "abc",
      queueTime: "q",
      finishTime: "f",
      definition: { name: "CI" },
      url: "https://dev.azure.com/x",
    };
    const rec = mapBuild(build) as Record<string, unknown>;
    expect(rec.status).toBe("completed");
    expect(rec.conclusion).toBe("success");
    expect(rec.headBranch).toBe("feature");
    expect(rec.workflowName).toBe("CI");
    const subset = mapBuild(build, "id,status") as Record<string, unknown>;
    expect(Object.keys(subset)).toEqual(["id", "status"]);
  });

  it("AZURE_BUILD_FIELDS is the documented run dialect", () => {
    expect(AZURE_BUILD_FIELDS).toContain("headBranch");
    expect(AZURE_BUILD_FIELDS).not.toContain("bogus");
  });
});

// ---------------------------------------------------------------------------
// policies.ts (pure parts)
// ---------------------------------------------------------------------------

describe("azure policies ruleset translation", () => {
  it("branches: no condition = default branch; wildcards skipped with a warning", () => {
    expect(rulesetBranches({}, "main")).toEqual(["main"]);
    expect(
      rulesetBranches(
        { conditions: { ref_name: { include: ["refs/heads/dev", "~DEFAULT_BRANCH"] } } },
        "main",
      ),
    ).toEqual(["dev", "main"]);
    const wc = { conditions: { ref_name: { include: ["refs/heads/release/*"] } } };
    expect(rulesetBranches(wc, "main")).toEqual([]);
  });

  it("translate: pull_request maps to the minimum-reviewers policy", () => {
    const docs = translateRuleset(
      { rules: [{ type: "pull_request", parameters: { required_approving_review_count: 2 } }] },
      "guid-1",
      "main",
    );
    expect(docs).toHaveLength(1);
    const settings = (docs[0] as { settings: { minimumApproverCount: number; scope: Array<{ refName: string }> } })
      .settings;
    expect(settings.minimumApproverCount).toBe(2);
    expect(settings.scope[0]?.refName).toBe("refs/heads/main");
  });

  it("translate: no translatable rules emits nothing", () => {
    expect(translateRuleset({ rules: [{ type: "unknown_kind" }] }, "g", "main")).toEqual([]);
  });
});
