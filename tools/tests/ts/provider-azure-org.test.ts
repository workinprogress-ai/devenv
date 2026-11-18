// Azure org surface: releases ordered by version (numeric prerelease
// identifiers), release dates that do not hide an authentication failure,
// project and org feeds together, and a live-guard that does not read a wrong
// project as "already gone".
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { azureJson, stubAzureFetch, useAzureEnv } from "./harness/azure-stub.ts";
import { orgFeedsList, orgReleasesList } from "../../lib/providers/azure/org.ts";
import { isNotFound } from "../../lib/providers/azure/live-guards.ts";
import { ProviderError } from "../../lib/providers/provider-core.ts";

const TAGS = /\/repositories\/widgets\/refs\?filter=tags\//;

let restoreEnv: () => void = () => {};

beforeEach(() => {
  restoreEnv = useAzureEnv("test-org", "test-project");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  restoreEnv();
});

const refs = (...names: string[]) => azureJson({ value: names.map((n, i) => ({ name: `refs/tags/${n}`, objectId: `oid${i}` })) });

describe("orgReleasesList ordering", () => {
  it("orders prerelease identifiers numerically and a release above its prereleases", async () => {
    stubAzureFetch([{ method: "GET", url: TAGS, respond: refs("v1.0.0-rc.2", "v1.0.0-rc.10", "v1.0.0", "v0.9.0", "v1.0.0-alpha", "v1.0.0-rc.1") }]);
    const out = JSON.parse(await orgReleasesList("widgets", { json: "tagName" })) as Array<{ tagName: string }>;
    expect(out.map((r) => r.tagName)).toEqual(["v1.0.0", "v1.0.0-rc.10", "v1.0.0-rc.2", "v1.0.0-rc.1", "v1.0.0-alpha", "v0.9.0"]);
  });
});

describe("orgReleasesList dates", () => {
  const datesRoutes = (annotated: Response) => [
    { method: "GET", url: TAGS, respond: refs("v1.0.0") },
    { method: "GET", url: /annotatedtags\/oid0/, respond: annotated },
    { method: "GET", url: /commits\/oid0/, respond: azureJson({ committer: { date: "2026-01-02T00:00:00Z" } }) },
  ];

  it("falls back to the commit date for a lightweight tag (not-found annotated tag)", async () => {
    stubAzureFetch(datesRoutes(azureJson({ message: "not found" }, 404)));
    const out = JSON.parse(await orgReleasesList("widgets")) as Array<{ publishedAt: string }>;
    expect(out[0]?.publishedAt).toBe("2026-01-02T00:00:00Z");
  });

  it.each([401, 403, 203])("does not hide an HTTP %s behind an empty date", async (status) => {
    stubAzureFetch(datesRoutes(azureJson({ message: "denied" }, status)));
    await expect(orgReleasesList("widgets")).rejects.toThrow();
  });
});

describe("orgReleasesList build metadata", () => {
  it("ignores +build metadata when ordering, and still counts a release that carries it", async () => {
    stubAzureFetch([{ method: "GET", url: TAGS, respond: refs("v1.0.0-rc.1+a", "v1.0.0-rc.1+b", "v1.0.0+build", "v0.9.0") }]);
    const out = JSON.parse(await orgReleasesList("widgets", { json: "tagName" })) as Array<{ tagName: string }>;
    expect(out[0]?.tagName).toBe("v1.0.0+build");
    expect(out.at(-1)?.tagName).toBe("v0.9.0");
  });
});

describe("orgFeedsList", () => {
  it("still lists the org feeds when the project endpoint is refused", async () => {
    stubAzureFetch([
      { method: "GET", url: /feeds\.dev\.azure\.com\/test-org\/_apis\/packaging\/feeds/, respond: azureJson({ value: [{ id: "f1", name: "org-feed" }] }) },
      { method: "GET", url: /feeds\.dev\.azure\.com\/test-org\/test-project\/_apis/, respond: azureJson({ message: "denied" }, 403) },
    ]);
    const out = JSON.parse(await orgFeedsList()) as Array<{ name: string }>;
    expect(out.map((f) => f.name)).toEqual(["org-feed"]);
  });

  it("returns org-scoped and project-scoped feeds once each", async () => {
    stubAzureFetch([
      {
        method: "GET",
        url: /feeds\.dev\.azure\.com\/test-org\/_apis\/packaging\/feeds/,
        respond: azureJson({ value: [{ id: "f1", name: "org-feed", url: "u1" }] }),
      },
      {
        method: "GET",
        url: /feeds\.dev\.azure\.com\/test-org\/test-project\/_apis\/packaging\/feeds/,
        respond: azureJson({ value: [{ id: "f2", name: "proj-feed", url: "u2" }, { id: "f1", name: "org-feed", url: "u1" }] }),
      },
    ]);
    const out = JSON.parse(await orgFeedsList()) as Array<{ name: string }>;
    expect(out.map((f) => f.name).sort()).toEqual(["org-feed", "proj-feed"]);
  });
});

describe("live-guards isNotFound", () => {
  it("is true for a plain not-found", () => {
    expect(isNotFound(new ProviderError("TF401232: Work item 5 does not exist", 404))).toBe(true);
  });

  it("is false when the 404 says the project does not exist", () => {
    expect(isNotFound(new ProviderError("TF200016: The following project does not exist: nope", 404))).toBe(false);
  });

  it("stays true for a work item message that merely mentions a project that does not exist", () => {
    expect(
      isNotFound(new ProviderError("TF401232: Work item 5 does not exist, or it is in a project that does not exist, or you do not have permissions", 404)),
    ).toBe(true);
  });

  it("is false for other statuses and other errors", () => {
    expect(isNotFound(new ProviderError("denied", 401))).toBe(false);
    expect(isNotFound(new Error("boom"))).toBe(false);
  });
});
