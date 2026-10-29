// explain.ts — GitHub's calling requirements, stated by the provider
// itself (provider-explain prints this; 15.7). Adding a verb and updating
// its family's requirements here stay one change.

import type { ProviderExplain } from "../explain.ts";

export function githubExplain(): ProviderExplain {
  return {
    provider: "github",
    families: [
      {
        family: "issues",
        wrappers: ["issue-"],
        identifierScoping:
          "Issue numbers are per-repository — the same number names different issues in different repos. Always know which repo a number belongs to before calling.",
        repoTarget: { reads: "required", writes: "required" },
        resolution:
          "DEVENV_REPO env, else the git remote of the current directory, else the --repo/devenv argument the wrapper accepts.",
        credentials: "gh authenticated (key-update-git); the wrapper probes auth and names key-update-git on failure.",
        wrapperGates: [
          "checkTargetRepo: must run inside a git repository; refuses to target the devenv repo itself unless --devenv/DEVENV_REPO exempts it.",
        ],
        notes: [
          "Labels take repeated --label flags; issue numbers from other providers do not translate.",
        ],
      },
      {
        family: "pr",
        wrappers: ["pr-"],
        identifierScoping:
          "PR numbers are per-repository, like issues.",
        repoTarget: { reads: "required", writes: "required" },
        resolution:
          "DEVENV_REPO env, else the current repo's remote; thread tools also accept owner/repo#number specs.",
        credentials: "gh authenticated (key-update-git).",
        wrapperGates: [
          "checkTargetRepo (repo targeting + devenv refusal) on every repo-targeted verb.",
        ],
        notes: [
          "Branch-scoped verbs (pr-create) read the current branch's push remote.",
        ],
      },
      {
        family: "project",
        wrappers: ["project-"],
        identifierScoping:
          "Projects are org-scoped by number or title; issues linked into them are repo-scoped.",
        repoTarget: { reads: "optional", writes: "optional" },
        resolution:
          "Org from devenv.config [organization] org / DEVENV_REPO owner; the project itself by number or exact title.",
        credentials: "gh authenticated (key-update-git).",
        wrapperGates: ["checkTargetRepo where the call touches a repo's issue."],
        notes: [
          "item-add requires the project NUMBER; both name and number are accepted and resolved.",
        ],
      },
      {
        family: "pipelines",
        wrappers: ["pipelines-"],
        identifierScoping:
          "Pipeline/run ids are repo-scoped.",
        repoTarget: { reads: "required", writes: "required" },
        resolution: "DEVENV_REPO env, else the current repo's remote.",
        credentials: "gh authenticated (key-update-git).",
        wrapperGates: ["checkTargetRepo."],
        notes: [],
      },
      {
        family: "repos",
        wrappers: ["repo-"],
        identifierScoping:
          "Repositories are org-scoped by owner/name.",
        repoTarget: { reads: "optional", writes: "optional" },
        resolution:
          "Explicit argument first; create/config verbs resolve org from devenv.config [organization] org.",
        credentials: "gh authenticated (key-update-git); repo creation and ruleset writes need sufficient org role.",
        wrapperGates: [
          "isDevenvRepoGated/refusals on devenv-repo targeting for mutating verbs.",
        ],
        notes: [
          "rulesets on org-owned PUBLIC repositories reject allow_forking (GitHub restriction).",
        ],
      },
      {
        family: "artifact",
        wrappers: ["artifact-", "issue-artifact-"],
        identifierScoping:
          "Artifacts are issue-scoped comment markers; issues are per-repository.",
        repoTarget: { reads: "required", writes: "required" },
        resolution: "Same chain as the issues family.",
        credentials: "gh authenticated (key-update-git).",
        wrapperGates: ["checkTargetRepo."],
        notes: [],
      },
    ],
  };
}
