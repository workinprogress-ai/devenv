// provider-repo-spec-for.test.ts — tools that address many repositories by
// name (pipelines-status, pipelines-list, the global dependency wizard) build
// each repo spec through repoSpecFor. The spec must be the host's canonical
// form: an "org/name" join reads on Azure as project "org", which does not
// exist, so every call fails with TF200016.
import { afterEach, describe, expect, it, vi } from "vitest";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { repoSpecFor as githubRepoSpecFor } from "../../lib/providers/github/urls.ts";
import type * as facadeTypes from "../../lib/providers/facade/urls.ts";
import { rmrf, tmpDir } from "./harness/index.ts";

const FACADE = "../../lib/providers/facade/urls.ts";
const savedEnv = { ...process.env };
const dirs: string[] = [];

async function useProvider(provider: "github" | "azure", azureProject = "proj"): Promise<typeof facadeTypes> {
  const root = tmpDir("repospec");
  dirs.push(root);
  writeFileSync(
    join(root, "devenv.config"),
    `[provider]\nname=${provider}\nazure_org=org\nazure_project=${azureProject}\n\n[organization]\norg=fixture-org\n`,
  );
  process.env.DEVENV_ROOT = root;
  delete process.env.AZURE_DEVOPS_PROJECT;
  vi.resetModules();
  return (await import(FACADE)) as typeof facadeTypes;
}

afterEach(() => {
  process.env = { ...savedEnv };
  for (const d of dirs.splice(0)) rmrf(d);
});

describe("repoSpecFor", () => {
  it("GitHub joins owner and name", () => {
    expect(githubRepoSpecFor("fixture-org", "widgets")).toBe("fixture-org/widgets");
  });

  it("the facade on GitHub returns owner/name", async () => {
    const facade = await useProvider("github");
    expect(await facade.repoSpecFor("fixture-org", "widgets")).toBe("fixture-org/widgets");
  });

  it("the facade on Azure returns the configured project, never the organization", async () => {
    const facade = await useProvider("azure");
    expect(await facade.repoSpecFor("fixture-org", "widgets")).toBe("proj/widgets");
  });

  it("an AZURE_DEVOPS_PROJECT override wins over the configured project", async () => {
    const facade = await useProvider("azure");
    process.env.AZURE_DEVOPS_PROJECT = "session-proj";
    expect(await facade.repoSpecFor("fixture-org", "widgets")).toBe("session-proj/widgets");
  });

  it("Azure without a configured project is a named error, not a guessed spec", async () => {
    const facade = await useProvider("azure", "");
    await expect(facade.repoSpecFor("fixture-org", "widgets")).rejects.toThrow(/azure project unresolved/);
  });
});
