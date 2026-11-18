// Azure repo verbs: the seam shape of a view, an exists check that only a
// not-found answer turns false, creation in the project the caller named,
// explicit patch keys, the commits probe, and branch refs that are not
// prefixed twice.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { azureJson, stubAzureFetch, useAzureEnv } from "./harness/azure-stub.ts";
import {
  reposCommitsCount,
  reposCreate,
  reposExists,
  reposPatch,
  reposProtectBranch,
  reposView,
} from "../../lib/providers/azure/repos.ts";
import { azureBranchRef } from "../../lib/providers/azure/urls.ts";

const GIT = "https://dev.azure.com/test-org/test-project/_apis/git/repositories";
const REPO_URL = `${GIT}/widgets?api-version=7.1`;

let restoreEnv: () => void = () => {};

beforeEach(() => {
  restoreEnv = useAzureEnv("test-org", "test-project");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  restoreEnv();
});

describe("azureBranchRef", () => {
  it.each([
    ["main", "refs/heads/main"],
    ["feature/x", "refs/heads/feature/x"],
    ["refs/heads/main", "refs/heads/main"],
    ["refs/tags/v1", "refs/tags/v1"],
  ])("maps %s to %s", (input, expected) => {
    expect(azureBranchRef(input)).toBe(expected);
  });
});

describe("reposView", () => {
  it("reports the default branch without the refs/heads/ prefix", async () => {
    stubAzureFetch([
      {
        method: "GET",
        url: REPO_URL,
        respond: azureJson({ id: "g1", name: "widgets", project: { name: "test-project" }, defaultBranch: "refs/heads/main" }),
      },
    ]);
    const out = JSON.parse(await reposView("widgets")) as { defaultBranchRef: { name: string } };
    expect(out.defaultBranchRef.name).toBe("main");
  });
});

describe("reposExists", () => {
  it("is true for an existing repository", async () => {
    stubAzureFetch([{ method: "GET", url: REPO_URL, respond: azureJson({ id: "g1" }) }]);
    await expect(reposExists("widgets")).resolves.toBe(true);
  });

  it("is false when Azure answers not found", async () => {
    stubAzureFetch([{ method: "GET", url: REPO_URL, respond: azureJson({ message: "TF401019: does not exist" }, 404) }]);
    await expect(reposExists("widgets")).resolves.toBe(false);
  });

  it.each([401, 403, 500])("rethrows an HTTP %s instead of reporting the repository missing", async (status) => {
    stubAzureFetch([{ method: "GET", url: REPO_URL, respond: azureJson({ message: "nope" }, status) }]);
    await expect(reposExists("widgets")).rejects.toThrow();
  });
});

describe("reposCreate", () => {
  const created = (project: string, name: string) => azureJson({ id: "g2", name, project: { name: project } });

  it("creates in the project the name carries", async () => {
    const stub = stubAzureFetch([
      { method: "POST", url: "https://dev.azure.com/test-org/projB/_apis/git/repositories?api-version=7.1", respond: created("projB", "new") },
    ]);
    const out = await reposCreate("projB/new");
    expect(stub.unmatched()).toEqual([]);
    expect(out.repoSpec).toBe("projB/new");
  });

  it("creates in the configured project for a bare name", async () => {
    const stub = stubAzureFetch([{ method: "POST", url: `${GIT}?api-version=7.1`, respond: created("test-project", "new") }]);
    await reposCreate("new");
    expect(stub.unmatched()).toEqual([]);
  });
});

describe("reposPatch", () => {
  it("maps the seam keys to the fields Azure reads", async () => {
    const stub = stubAzureFetch([{ method: "PATCH", url: REPO_URL, respond: azureJson({}) }]);
    await reposPatch("widgets", { default_branch: "main", archived: "true" });
    expect(stub.requests[0]?.body).toEqual({ defaultBranch: "refs/heads/main", isDisabled: true });
  });

  it("refuses a key Azure has no field for, before any request", async () => {
    const stub = stubAzureFetch([]);
    await expect(reposPatch("widgets", { wiki: "true" })).rejects.toThrow(/wiki/);
    expect(stub.requests).toHaveLength(0);
  });

  it("still skips the documented project-policy keys with a warning", async () => {
    const warn = vi.spyOn(console, "error").mockImplementation(() => {});
    const stub = stubAzureFetch([]);
    await reposPatch("widgets", { allow_squash_merge: "false" });
    expect(stub.requests).toHaveLength(0);
    expect(warn.mock.calls.flat().join("\n")).toContain("allow_squash_merge");
  });
});

describe("reposCommitsCount", () => {
  const COMMITS = `${GIT}/widgets/commits?searchCriteria.$top=1&api-version=7.1`;

  it("asks for one commit with the parameter name Azure reads", async () => {
    const stub = stubAzureFetch([{ method: "GET", url: COMMITS, respond: azureJson({ count: 1 }) }]);
    await expect(reposCommitsCount("widgets")).resolves.toBe(1);
    expect(stub.unmatched()).toEqual([]);
  });

  it("reads a not-found probe as no commits yet, so a readiness loop keeps waiting", async () => {
    stubAzureFetch([{ method: "GET", url: COMMITS, respond: azureJson({ message: "not found" }, 404) }]);
    await expect(reposCommitsCount("widgets")).resolves.toBe(0);
  });

  it("rethrows an authentication failure", async () => {
    stubAzureFetch([{ method: "GET", url: COMMITS, respond: azureJson({ message: "denied" }, 401) }]);
    await expect(reposCommitsCount("widgets")).rejects.toThrow();
  });
});

describe("reposProtectBranch", () => {
  it("does not prefix a branch that is already a full ref", async () => {
    const stub = stubAzureFetch([
      { method: "GET", url: REPO_URL, respond: azureJson({ id: "g1" }) },
      { method: "GET", url: /\/_apis\/policy\/configurations/, respond: azureJson({ value: [] }) },
      { method: "POST", url: /\/_apis\/policy\/configurations/, respond: azureJson({ id: 1 }) },
    ]);
    await reposProtectBranch("widgets", "refs/heads/main", {});
    const post = stub.requests.find((r) => r.method === "POST")?.body as { settings: { scope: Array<{ refName: string }> } };
    expect(post.settings.scope[0]?.refName).toBe("refs/heads/main");
  });
});
