// domain/cs/default-branch.ts — a repository's default branch as the provider
// facade reports it (the Repository record's `defaultBranchRef {name}`).

import { reposView } from "../../providers/facade/repos.ts";

/** Default branch name of `repoFull` (owner/repo). Throws when the provider
 * cannot answer or the repository has no default branch (for example an
 * empty one): callers must not guess a branch name. */
export async function repoDefaultBranch(repoFull: string): Promise<string> {
  const out = await reposView(repoFull, { json: "defaultBranchRef" });
  const parsed = JSON.parse(out) as { defaultBranchRef?: { name?: string } | null };
  const name = (parsed.defaultBranchRef?.name ?? "").replace(/^refs\/heads\//, "");
  if (name === "") throw new Error(`${repoFull} reports no default branch`);
  return name;
}
