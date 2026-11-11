// domain/repos/types on an Azure config: the ruleset and settings appliers go
// through the provider facade, so they become Azure requests (stubbed fetch)
// or a named "not supported on provider 'azure'" failure — never a `gh` call
// (the canary fails the test if one runs, and a recording gh stub must show
// zero invocations).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathWithStubs, rmrf, stubCalls, stubGh, tmpDir } from "./harness/index.ts";

let root = "";
let stubDir = "";
let requests: Array<{ method: string; url: string; body?: string }> = [];
const savedPath = process.env.PATH;

beforeEach(() => {
  root = tmpDir("repos-types-azure");
  stubDir = tmpDir("repos-types-azure-gh");
  requests = [];
  writeFileSync(join(root, "devenv.config"), "[provider]\nname=azure\n\n[organization]\norg=test-org\n");
  mkdirSync(join(root, "tools", "config"), { recursive: true });
  writeFileSync(
    join(root, "tools", "config", "ruleset.json"),
    JSON.stringify({
      name: "rs {{repo_name}}",
      conditions: { ref_name: { include: ["refs/heads/main"] } },
      rules: [{ type: "pull_request", parameters: { required_approving_review_count: 1 } }],
    }),
  );
  stubGh(stubDir);
  process.env.PATH = pathWithStubs(stubDir);
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
    return new Response(JSON.stringify({ id: "repo-guid", value: [], defaultBranch: "refs/heads/main" }), { status: 200 });
  });
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllGlobals();
  process.env.PATH = savedPath;
  rmrf(root);
  rmrf(stubDir);
  for (const k of ["DEVENV_ROOT", "AZURE_DEVOPS_ORG", "AZURE_DEVOPS_PROJECT", "AZURE_PAT", "DEVENV_REPO"]) delete process.env[k];
});

async function load() {
  const m = await import("../../lib/domain/repos/types.ts");
  const config = m.RepoTypesConfigSchema.parse({
    types: {
      service: {
        naming_pattern: ".*",
        naming_example: "x",
        rulesetConfigFile: "ruleset.json",
        access: [{ name: "devs", type: "team", permission: "push" }],
      },
    },
  });
  return { m, config };
}

describe("repo type appliers on azure", () => {
  it("configureRulesetsForType talks to Azure and never runs gh", async () => {
    const { m, config } = await load();
    const res = await m.configureRulesetsForType("test-project/repo", "service", config, join(root, "tools"));
    expect(res.failures).toEqual([]);
    expect(res.applied).toBe(true);
    expect(requests.length).toBeGreaterThan(0);
    expect(requests.every((r) => r.url.startsWith("https://dev.azure.com/"))).toBe(true);
    expect(requests.some((r) => r.method === "POST" && r.url.includes("/policy/configurations"))).toBe(true);
    expect(stubCalls(stubDir, "gh")).toEqual([]);
  });

  it("a settings patch reports the named not-supported failure and never runs gh", async () => {
    const { m, config } = await load();
    const ok = await m.configureMergeTypesForType("test-project/repo", "service", config);
    expect(ok).toBe(false);
    expect(await m.configureRepositoryFeaturesForType("test-project/repo", "service", config)).toBe(false);
    expect(requests).toEqual([]);
    expect(stubCalls(stubDir, "gh")).toEqual([]);
  });

  it("the facade verb names the unsupported provider", async () => {
    const facade = await import("../../lib/providers/facade/repos.ts");
    await expect(facade.reposPatch("test-project/repo", ["-F", "has_wiki=true"])).rejects.toThrow(
      "repos_patch is not supported on provider 'azure'",
    );
  });

  it("team permissions go to Azure requests, not gh", async () => {
    const { m, config } = await load();
    await m.configureRepositoryPermissionsForType("test-project/repo", "service", config);
    expect(requests.length).toBeGreaterThan(0);
    expect(requests.every((r) => new URL(r.url).hostname.endsWith("dev.azure.com"))).toBe(true);
    expect(stubCalls(stubDir, "gh")).toEqual([]);
  });
});
