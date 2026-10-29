// explain.ts — Azure DevOps' calling requirements, stated by the provider
// itself (provider-explain prints this; 15.7). Adding a verb and updating
// its family's requirements here stay one change.

import type { ProviderExplain } from "../explain.ts";

export function azureExplain(): ProviderExplain {
  return {
    provider: "azure",
    families: [
      {
        family: "issues",
        wrappers: ["issue-"],
        identifierScoping:
          "Work-item ids are org/project-global — no repo scoping at all. The same id namespace covers every repo in the project.",
        repoTarget: { reads: "never", writes: "never" },
        resolution:
          "Org + project from AZURE_DEVOPS_ORG/AZURE_DEVOPS_PROJECT env, else devenv.config [provider] azure_org/azure_project. The repo argument wrappers accept is voided by the verbs.",
        credentials: "Azure PAT stored via key-update-azure (0600 credential file; AZURE_PAT env overrides).",
        wrapperGates: [
          "checkTargetRepo: must run inside a git repository; refuses to target the devenv repo itself (the wrapper gate — not the provider API, which never sees a repo for issues).",
        ],
        notes: [
          "A create fails early naming the [azure_issue_types] key when the mapped work-item type is disabled in the project.",
        ],
      },
      {
        family: "pr",
        wrappers: ["pr-"],
        identifierScoping:
          "PR ids are project-global; branches are repo-scoped.",
        repoTarget: { reads: "required", writes: "required" },
        resolution:
          "Org + project from env/config; the repo by its project-relative name.",
        credentials: "Azure PAT (key-update-azure).",
        wrapperGates: ["checkTargetRepo (repo targeting + devenv refusal)."],
        notes: [
          "Completion is async — poll before assuming the merge landed.",
        ],
      },
      {
        family: "project",
        wrappers: ["project-"],
        identifierScoping:
          "Boards are project-scoped by name.",
        repoTarget: { reads: "optional", writes: "optional" },
        resolution: "Org + project from env/config.",
        credentials: "Azure PAT (key-update-azure).",
        wrapperGates: ["checkTargetRepo where the call touches a repo's work item."],
        notes: [],
      },
      {
        family: "pipelines",
        wrappers: ["pipelines-"],
        identifierScoping:
          "Pipeline/run ids are project-scoped.",
        repoTarget: { reads: "optional", writes: "optional" },
        resolution: "Org + project from env/config; definitions by name or id.",
        credentials: "Azure PAT (key-update-azure).",
        wrapperGates: [],
        notes: [],
      },
      {
        family: "repos",
        wrappers: ["repo-"],
        identifierScoping:
          "Repositories are project-scoped by name.",
        repoTarget: { reads: "optional", writes: "optional" },
        resolution: "Org + project from env/config.",
        credentials: "Azure PAT (key-update-azure); policy/ACL writes need project admin.",
        wrapperGates: [],
        notes: [],
      },
      {
        family: "artifact",
        wrappers: ["artifact-", "issue-artifact-"],
        identifierScoping:
          "Artifacts are work-item-scoped comment markers; work items are project-global.",
        repoTarget: { reads: "never", writes: "never" },
        resolution: "Org + project from env/config.",
        credentials: "Azure PAT (key-update-azure).",
        wrapperGates: ["checkTargetRepo (the wrapper gate)."],
        notes: [],
      },
    ],
  };
}
