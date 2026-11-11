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
