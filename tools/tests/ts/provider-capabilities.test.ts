// provider-capabilities.test.ts — every facade family loads under every
// provider and the provider declares the capabilities its verbs implement.
//
// The provider and the capability registry are cached per process, so each
// (provider, family) pair runs in a fresh node child that loads the family
// through requireFamilyCapability — the gate the tools run at module load.
import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { canaryEnv } from "./harness/canary.ts";
import { REPO_ROOT, rmrf, tmpDir } from "./harness/index.ts";

type Family = "issues" | "projects" | "org" | "pipelines";

/** The capability each family's tools gate on (null: no tool gates on one). */
const FAMILY_GATE: Record<Family, string | null> = {
  issues: null,
  projects: "project-boards",
  org: "rulesets",
  pipelines: "pipelines",
};

/** Capabilities each provider declares after loading each family. Azure
 * declares no native-issue-types: the org-level issue-type verbs are
 * GitHub-only. */
const EXPECTED: Record<"github" | "azure", Record<Family, string[]>> = {
  github: {
    issues: ["native-issue-types"],
    projects: ["project-boards"],
    org: ["rulesets"],
    pipelines: ["pipelines"],
  },
  azure: {
    issues: [],
    projects: ["project-boards"],
    org: ["rulesets"],
    pipelines: ["pipelines"],
  },
};

const CORE = pathToFileURL(join(REPO_ROOT, "tools/lib/providers/provider-core.ts")).href;
const LOADER = pathToFileURL(join(REPO_ROOT, "tools/lib/providers/facade/provider-loader.ts")).href;
const REPOS_FACADE = pathToFileURL(join(REPO_ROOT, "tools/lib/providers/facade/repos.ts")).href;
const ORG_FACADE = pathToFileURL(join(REPO_ROOT, "tools/lib/providers/facade/org.ts")).href;
const PIPELINES_FACADE = pathToFileURL(join(REPO_ROOT, "tools/lib/providers/facade/pipelines.ts")).href;
const PROVIDER_SEAM = pathToFileURL(join(REPO_ROOT, "tools/ts/setup-steps/provider-seam.ts")).href;

function declaredAfterLoading(provider: "github" | "azure", family: Family): { declared: string[]; gate: string } {
  const root = tmpDir("provcap-");
  try {
    mkdirSync(root, { recursive: true });
    writeFileSync(
      join(root, "devenv.config"),
      `[provider]\nname=${provider}\nazure_org=org\nazure_project=proj\n\n[organization]\norg=fixture-org\n`,
    );
    const gate = FAMILY_GATE[family];
    const code = `
      const core = await import(${JSON.stringify(CORE)});
      const loader = await import(${JSON.stringify(LOADER)});
      let gate = "ok";
      try {
        if (${JSON.stringify(gate)} === null) await loader.loadProviderModules(${JSON.stringify(family)});
        else await loader.requireFamilyCapability(${JSON.stringify(family)}, ${JSON.stringify(gate)});
      } catch (e) { gate = String(e.message ?? e); }
      const declared = core.PROVIDER_CAPABILITY_CANONICAL.filter((c) => core.providerHasCapability(c));
      process.stdout.write(JSON.stringify({ declared, gate }));
    `;
    const r = spawnSync("node", ["--input-type=module", "-e", code], {
      encoding: "utf8",
      env: { ...canaryEnv(), DEVENV_ROOT: root, HOME: root, AZURE_PAT: "fake-pat-for-test" },
    });
    expect(r.status, r.stderr).toBe(0);
    return JSON.parse(r.stdout) as { declared: string[]; gate: string };
  } finally {
    rmrf(root);
  }
}

describe("provider capability declarations", () => {
  for (const provider of ["github", "azure"] as const) {
    for (const family of Object.keys(FAMILY_GATE) as Family[]) {
      it(`${provider}: loading '${family}' declares exactly ${JSON.stringify(EXPECTED[provider][family])}`, () => {
        const r = declaredAfterLoading(provider, family);
        expect(r.gate).toBe("ok");
        expect([...r.declared].sort()).toEqual([...EXPECTED[provider][family]].sort());
      });
    }
  }
});

function behavioralCapabilities(
  provider: "github" | "azure",
  extraConfig = "",
): Record<string, unknown> {
  const root = tmpDir("provbehavior-");
  try {
    mkdirSync(root, { recursive: true });
    writeFileSync(
      join(root, "devenv.config"),
      `[provider]\nname=${provider}\nazure_org=org\nazure_project=proj\n\n[organization]\norg=fixture-org\n${extraConfig}`,
    );
    const code = `
      const repos = await import(${JSON.stringify(REPOS_FACADE)});
      const org = await import(${JSON.stringify(ORG_FACADE)});
      const pipelines = await import(${JSON.stringify(PIPELINES_FACADE)});
      const setup = await import(${JSON.stringify(PROVIDER_SEAM)});
      process.stdout.write(JSON.stringify({
        repos: await repos.reposSettingCapabilities(),
        pipeline: await pipelines.pipelinesQueuedRunStrategy(),
        npm: setup.packageFeedConfig("npm"),
        nuget: setup.packageFeedConfig("nuget"),
        githubPlanFailure: org.classifyRulesetMutationFailure(
          "github",
          "403 upgrade to github pro required",
        ),
        azurePermissionFailure: org.classifyRulesetMutationFailure(
          "azure",
          "403 permission denied",
        ),
      }));
    `;
    const r = spawnSync("node", ["--input-type=module", "-e", code], {
      encoding: "utf8",
      env: { ...canaryEnv(), DEVENV_ROOT: root, HOME: root, AZURE_PAT: "fake-pat-for-test" },
    });
    expect(r.status, r.stderr).toBe(0);
    return JSON.parse(r.stdout) as Record<string, unknown>;
  } finally {
    rmrf(root);
  }
}

describe("provider behavioral capabilities", () => {
  it("github exposes neutral strategies for its supported surfaces", () => {
    const capabilities = behavioralCapabilities(
      "github",
      "\n[nuget]\nfeed_url=https://nuget.pkg.github.com/fixture-org/index.json\n",
    );
    expect(capabilities.repos).toMatchObject({
      templateFlag: { supported: true },
      mergeTypes: { supported: true },
      deleteBranchOnMerge: { supported: true },
    });
    expect((capabilities.repos as { repositoryFeatures: Record<string, unknown> }).repositoryFeatures)
      .toEqual({
        wiki: { supported: true },
        issues: { supported: true },
        discussions: { supported: true },
        projects: { supported: true },
        autoMerge: { supported: true },
        updateBranch: { supported: true },
        forking: { supported: true },
        squashMergeCommitTitle: { supported: true },
        squashMergeCommitMessage: { supported: true },
      });
    expect(capabilities.pipeline).toEqual({
      kind: "search",
      workflowMatch: "required",
      dispatchEvent: "required",
    });
    expect(capabilities.npm).toMatchObject({
      configured: true,
      sourceName: "github",
      authHost: "npm.pkg.github.com",
    });
    expect(capabilities.githubPlanFailure).toMatchObject({
      ok: false,
      kind: "plan-limit",
    });
  });

  it("azure reports unsupported settings and uses the response run id", () => {
    const capabilities = behavioralCapabilities(
      "azure",
      "\n[nuget]\nfeed_url=https://pkgs.dev.azure.com/fixture/_packaging/feed/nuget/v3/index.json\n",
    );
    expect(capabilities.repos).toMatchObject({
      templateFlag: { supported: false },
      mergeTypes: { supported: false },
      deleteBranchOnMerge: { supported: false },
    });
    expect((capabilities.repos as { repositoryFeatures: Record<string, unknown> }).repositoryFeatures)
      .toEqual({
        wiki: {
          supported: false,
          reason: "Azure exposes this as project policy or does not provide a repository setting",
        },
        issues: {
          supported: false,
          reason: "Azure exposes this as project policy or does not provide a repository setting",
        },
        discussions: {
          supported: false,
          reason: "Azure exposes this as project policy or does not provide a repository setting",
        },
        projects: {
          supported: false,
          reason: "Azure exposes this as project policy or does not provide a repository setting",
        },
        autoMerge: {
          supported: false,
          reason: "Azure exposes this as project policy or does not provide a repository setting",
        },
        updateBranch: {
          supported: false,
          reason: "Azure exposes this as project policy or does not provide a repository setting",
        },
        forking: {
          supported: false,
          reason: "Azure exposes this as project policy or does not provide a repository setting",
        },
        squashMergeCommitTitle: {
          supported: false,
          reason: "Azure exposes this as project policy or does not provide a repository setting",
        },
        squashMergeCommitMessage: {
          supported: false,
          reason: "Azure exposes this as project policy or does not provide a repository setting",
        },
      });
    expect(capabilities.pipeline).toEqual({ kind: "response-id" });
    expect(capabilities.nuget).toMatchObject({
      configured: true,
      sourceName: "azure",
      username: "azure",
      authHost: "pkgs.dev.azure.com",
    });
    expect(capabilities.azurePermissionFailure).toMatchObject({
      ok: false,
      kind: "permission",
      hint: "Ensure the Azure credentials can manage repository policies",
    });
  });

  it("azure fails closed for a non-Azure feed URL", () => {
    const capabilities = behavioralCapabilities(
      "azure",
      "\n[npm]\nfeed_url=https://registry.npmjs.org/\n",
    );
    expect(capabilities.npm).toEqual({
      configured: false,
      kind: "npm",
      reason: "[npm] feed_url is not an Azure Artifacts URL",
    });
  });

  it("github fails closed for a non-GitHub Packages npm host", () => {
    const capabilities = behavioralCapabilities(
      "github",
      "\n[npm]\nfeed_url=https://registry.example.invalid/\n",
    );
    expect(capabilities.npm).toEqual({
      configured: false,
      kind: "npm",
      reason: "[npm] feed_url is outside GitHub Packages",
    });
  });
});
