// providers/facade/repos.ts — the provider-neutral repositories family.
//
// The only import surface tools use for repo verbs. Normalizations owned
// here:
//   - reposList/reposView are JSON text on both providers — pass-through.
//   - reposCommitsCount: github answers boolean ("has commits"), azure a
//     number — the neutral verb keeps github's boolean contract (the
//     repo-create guard asks "does the template have commits?").
//   - reposCreate returns the {stdout, status} shape on github; azure's
//     record stringifies into stdout with status 0.
//   - The treeCount verb is github-native (template instantiation checks
//     gh's tree API); on azure it is a named github-native error.
//
// The module never exits; failures throw ProviderError and callers decide.

import { ProviderError } from "../provider-core.ts";
import type { GhResult } from "../github/transport.ts";
import { loadProviderModules } from "./provider-loader.ts";
import type * as ghTypes from "../github/repos.ts";
import type * as azTypes from "../azure/repos.ts";

type GithubRepos = typeof ghTypes;
type AzureRepos = typeof azTypes;

async function load(): Promise<{ provider: string; gh: GithubRepos | undefined; az: AzureRepos | undefined }> {
  const loaded = await loadProviderModules("repos");
  if (loaded.provider === "azure") {
    return { provider: "azure", gh: undefined, az: loaded.get<AzureRepos>("repos.ts") };
  }
  return { provider: "github", gh: loaded.get<GithubRepos>("repos.ts"), az: undefined };
}

/** List the org's repositories (JSON text). */
export async function reposList(
  org: string,
  opts: { limit?: number; json?: string; jq?: string } = {},
): Promise<string> {
  const m = await load();
  if (m.provider === "azure") {
    const out = await m.az!.reposList(org, opts);
    return typeof out === "string" ? out : JSON.stringify(out);
  }
  return m.gh!.reposList(org, opts);
}

/** View a repository (JSON text). */
export async function reposView(spec: string | undefined, opts: { json?: string; jq?: string } = {}): Promise<string> {
  const m = await load();
  return m.provider === "azure" ? m.az!.reposView(spec ?? "", opts) : m.gh!.reposView(spec, opts);
}

/** Whether the repository has any commits (the repo-create guard). */
export async function reposCommitsCount(repo: string): Promise<boolean> {
  const m = await load();
  if (m.provider === "azure") {
    const n = await m.az!.reposCommitsCount(repo);
    return n > 0;
  }
  return m.gh!.reposCommitsCount(repo);
}

/** Create a repository; {stdout, status} with gh's stdout on github. */
export async function reposCreate(
  name: string,
  opts: Record<string, unknown> = {},
): Promise<GhResult> {
  const m = await load();
  if (m.provider === "azure") {
    const out = await m.az!.reposCreate(name, opts as Parameters<AzureRepos["reposCreate"]>[1]);
    return { stdout: JSON.stringify(out), stderr: "", status: 0 };
  }
  return m.gh!.reposCreate(name, opts as Parameters<GithubRepos["reposCreate"]>[1]);
}

/** Count entries in the repo tree (github-native: the template
 * instantiation check reads gh's tree API). */
export async function reposTreeCount(repo: string): Promise<number | null> {
  const m = await load();
  if (m.provider === "azure") {
    void repo;
    throw new ProviderError("repos_tree_count is a github-native verb (azure template checks use the repos seam)");
  }
  return m.gh!.reposTreeCount(repo);
}
