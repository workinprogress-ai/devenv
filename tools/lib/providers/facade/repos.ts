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
import { errorMessage, logWarn } from "../../core/logging.ts";
import type { GhResult } from "../github/transport.ts";
import { loadProviderModules } from "./provider-loader.ts";
import type * as ghTypes from "../github/repos.ts";
import type * as azTypes from "../azure/repos.ts";

type GithubRepos = typeof ghTypes;
type AzureRepos = typeof azTypes;

export type RepositoryFeature =
  | "wiki"
  | "issues"
  | "discussions"
  | "projects"
  | "autoMerge"
  | "updateBranch"
  | "forking"
  | "squashMergeCommitTitle"
  | "squashMergeCommitMessage";

export type RepositorySetting =
  | "templateFlag"
  | "mergeTypes"
  | "deleteBranchOnMerge"
  | RepositoryFeature;

export type SettingSupport =
  | { supported: true }
  | { supported: false; reason: string };

export interface RepoSettingCapabilities {
  templateFlag: SettingSupport;
  mergeTypes: SettingSupport;
  deleteBranchOnMerge: SettingSupport;
  repositoryFeatures: Record<RepositoryFeature, SettingSupport>;
}

export interface RepoSettingsResult {
  applied: RepositorySetting[];
  skipped: Array<{ setting: RepositorySetting; reason: string }>;
  failed: Array<{ setting: RepositorySetting; message: string }>;
}

export interface RepoSettingsInput {
  templateFlag?: boolean;
  mergeTypes?: { merge: boolean; squash: boolean; rebase: boolean };
  deleteBranchOnMerge?: boolean;
  repositoryFeatures?: Partial<{
    wiki: boolean;
    issues: boolean;
    discussions: boolean;
    projects: boolean;
    autoMerge: boolean;
    updateBranch: boolean;
    forking: boolean;
    squashMergeCommitTitle: string;
    squashMergeCommitMessage: string;
  }>;
}

async function load(): Promise<{ provider: string; gh: GithubRepos | undefined; az: AzureRepos | undefined }> {
  const loaded = await loadProviderModules("repos");
  if (loaded.provider === "azure") {
    return { provider: "azure", gh: undefined, az: loaded.get<AzureRepos>("repos.ts") };
  }
  return { provider: "github", gh: loaded.get<GithubRepos>("repos.ts"), az: undefined };
}

const REPOSITORY_FEATURES: RepositoryFeature[] = [
  "wiki",
  "issues",
  "discussions",
  "projects",
  "autoMerge",
  "updateBranch",
  "forking",
  "squashMergeCommitTitle",
  "squashMergeCommitMessage",
];

/** Provider-owned support decisions for repository settings. */
export async function reposSettingCapabilities(): Promise<RepoSettingCapabilities> {
  const m = await load();
  const supported: SettingSupport = { supported: true };
  const unsupported = (reason: string): SettingSupport => ({ supported: false, reason });
  if (m.provider === "azure") {
    const noRepoSetting = unsupported("Azure exposes this as project policy or does not provide a repository setting");
    return {
      templateFlag: unsupported("Azure repository templates are create-time parent links, not a repository flag"),
      mergeTypes: noRepoSetting,
      deleteBranchOnMerge: noRepoSetting,
      repositoryFeatures: Object.fromEntries(
        REPOSITORY_FEATURES.map((setting) => [setting, noRepoSetting]),
      ) as Record<RepositoryFeature, SettingSupport>,
    };
  }
  return {
    templateFlag: supported,
    mergeTypes: supported,
    deleteBranchOnMerge: supported,
    repositoryFeatures: Object.fromEntries(
      REPOSITORY_FEATURES.map((setting) => [setting, supported]),
    ) as Record<RepositoryFeature, SettingSupport>,
  };
}

/** Apply provider-neutral repository settings and report each outcome. */
export async function reposApplySettings(repo: string, input: RepoSettingsInput): Promise<RepoSettingsResult> {
  const capabilities = await reposSettingCapabilities();
  const result: RepoSettingsResult = { applied: [], skipped: [], failed: [] };
  const apply = async (
    setting: RepositorySetting,
    support: SettingSupport,
    call: () => Promise<boolean>,
  ): Promise<void> => {
    if (!support.supported) {
      result.skipped.push({ setting, reason: support.reason });
      return;
    }
    if (await call()) result.applied.push(setting);
    else result.failed.push({ setting, message: `${setting} was rejected by the provider` });
  };

  if (input.templateFlag === true) {
    await apply("templateFlag", capabilities.templateFlag, () => reposEdit(repo, ["--template"]));
  }
  if (input.mergeTypes !== undefined) {
    const merges = input.mergeTypes;
    await apply("mergeTypes", capabilities.mergeTypes, () => reposPatch(repo, [
      "-F", `allow_merge_commit=${merges.merge}`,
      "-F", `allow_squash_merge=${merges.squash}`,
      "-F", `allow_rebase_merge=${merges.rebase}`,
    ]));
  }
  if (input.deleteBranchOnMerge !== undefined) {
    await apply(
      "deleteBranchOnMerge",
      capabilities.deleteBranchOnMerge,
      () => reposPatch(repo, ["-F", `delete_branch_on_merge=${input.deleteBranchOnMerge}`]),
    );
  }

  const features = input.repositoryFeatures;
  if (features === undefined) return result;
  const names: Array<[RepositoryFeature, string]> = [
    ["wiki", "has_wiki"],
    ["issues", "has_issues"],
    ["discussions", "has_discussions"],
    ["projects", "has_projects"],
    ["autoMerge", "allow_auto_merge"],
    ["updateBranch", "allow_update_branch"],
    ["forking", "allow_forking"],
    ["squashMergeCommitTitle", "squash_merge_commit_title"],
    ["squashMergeCommitMessage", "squash_merge_commit_message"],
  ];
  const supported: Array<{ setting: RepositoryFeature; flag: "-f" | "-F"; value: string }> = [];
  for (const [setting, key] of names) {
    const value = features[setting];
    if (value === undefined) continue;
    const support = capabilities.repositoryFeatures[setting];
    if (!support.supported) {
      result.skipped.push({ setting, reason: support.reason });
      continue;
    }
    supported.push({
      setting,
      flag: typeof value === "string" ? "-f" : "-F",
      value: `${key}=${value}`,
    });
  }
  if (supported.length === 0) return result;

  const flags = supported.flatMap(({ flag, value }) => [flag, value]);
  let patch = await reposPatchWithError(repo, flags);
  if (!patch.ok && supported.some(({ setting }) => setting === "forking")) {
    const withoutFork = supported.filter(({ setting }) => setting !== "forking");
    const retry = await reposPatchWithError(
      repo,
      withoutFork.flatMap(({ flag, value }) => [flag, value]),
    );
    if (retry.ok) {
      result.failed.push({ setting: "forking", message: patch.error });
      patch = retry;
      for (const { setting } of withoutFork) result.applied.push(setting);
      return result;
    }
    patch = retry.error !== "" ? retry : patch;
  }
  if (patch.ok) {
    for (const { setting } of supported) result.applied.push(setting);
  } else {
    for (const { setting } of supported) result.failed.push({ setting, message: patch.error });
  }
  return result;
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

/** Whether the repository exists and is reachable with the current
 * credentials (a missing and an inaccessible repository both read `false`). */
export async function reposExists(spec: string): Promise<boolean> {
  const m = await load();
  return m.provider === "azure" ? m.az!.reposExists(spec) : m.gh!.reposExists(spec);
}

/** Whether the repository allows squash merges. GitHub-native: Azure's merge
 * strategies are branch-policy settings with no repository-level flag. */
export async function reposSquashMergeAllowed(spec: string): Promise<boolean> {
  const m = await load();
  if (m.provider === "azure") {
    void spec;
    return azureUnsupported("repos_squash_merge_allowed");
  }
  return m.gh!.reposSquashMergeAllowed(spec);
}

/** The `owner/name` of the repository the directory belongs to, as the
 * provider reports it, or null when it cannot say. Azure has no
 * directory-inferred repository view: it answers null and the caller falls
 * back to the git remote URL. */
export async function reposNameWithOwner(cwd: string): Promise<string | null> {
  const m = await load();
  if (m.provider === "azure") return null;
  return m.gh!.reposNameWithOwner(cwd);
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
 * converted; anything else is a defect and propagates. The boolean carries no
 * reason, so the failure is logged: a 403 and a 404 stay distinguishable. */
async function azureBool(verb: string, write: () => Promise<unknown>): Promise<boolean> {
  try {
    await write();
    return true;
  } catch (err) {
    if (err instanceof ProviderError) {
      logWarn(`${verb} failed: ${errorMessage(err)}`);
      return false;
    }
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
  if (m.provider === "azure") return azureBool("repos_team_put", () => m.az!.reposTeamPut(org, team, repo, permission));
  return m.gh!.reposTeamPut(org, team, repo, permission);
}

/** Grant a user collaborator access to a repository (idempotent). */
export async function reposCollaboratorPut(repo: string, user: string, permission?: string): Promise<boolean> {
  const m = await load();
  if (m.provider === "azure") {
    return azureBool("repos_collaborator_put", () => m.az!.reposCollaboratorPut(repo, user, permission !== undefined ? { permission } : {}));
  }
  return m.gh!.reposCollaboratorPut(repo, user, permission);
}
