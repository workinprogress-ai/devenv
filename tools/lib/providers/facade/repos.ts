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

/** The error for a settings verb azure has no equivalent of. */
function azureUnsupported(verb: string): never {
  throw new ProviderError(`${verb} is not supported on provider 'azure'`);
}

/** Run an Azure write and report success as a boolean (github's contract for
 * the settings verbs). Only a ProviderError (the provider's own failure) is
 * converted; anything else is a defect and propagates. */
async function azureBool(write: () => Promise<unknown>): Promise<boolean> {
  try {
    await write();
    return true;
  } catch (err) {
    if (err instanceof ProviderError) return false;
    throw err;
  }
}

/** Edit repository settings with gh-repo-edit flags (template flip, ...).
 * Azure repos have no post-create settings flags: the edit is refused with a
 * named error rather than reported as done. */
export async function reposEdit(repo: string, flags: string[]): Promise<boolean> {
  const m = await load();
  if (m.provider === "azure") {
    void repo;
    void flags;
    return azureUnsupported("repos_edit");
  }
  return m.gh!.reposEdit(repo, flags);
}

/** Patch repository settings with gh-api `-f/-F key=value` flags. The flag
 * dialect and the settings it names (wiki, discussions, merge buttons, ...)
 * are github's; azure has no equivalent surface. */
export async function reposPatch(repo: string, flags: string[]): Promise<boolean> {
  const m = await load();
  if (m.provider === "azure") {
    void repo;
    void flags;
    return azureUnsupported("repos_patch");
  }
  return m.gh!.reposPatch(repo, flags);
}

/** reposPatch with the API error body surfaced on failure. */
export async function reposPatchWithError(
  repo: string,
  flags: string[],
): Promise<{ ok: boolean; error: string }> {
  const m = await load();
  if (m.provider === "azure") {
    void repo;
    void flags;
    return azureUnsupported("repos_patch_with_error");
  }
  return m.gh!.reposPatchWithError(repo, flags);
}

/** Grant a team access to a repository (idempotent). */
export async function reposTeamPut(org: string, team: string, repo: string, permission?: string): Promise<boolean> {
  const m = await load();
  if (m.provider === "azure") return azureBool(() => m.az!.reposTeamPut(org, team, repo, permission));
  return m.gh!.reposTeamPut(org, team, repo, permission);
}

/** Grant a user collaborator access to a repository (idempotent). */
export async function reposCollaboratorPut(repo: string, user: string, permission?: string): Promise<boolean> {
  const m = await load();
  if (m.provider === "azure") {
    return azureBool(() => m.az!.reposCollaboratorPut(repo, user, permission !== undefined ? { permission } : {}));
  }
  return m.gh!.reposCollaboratorPut(repo, user, permission);
}
