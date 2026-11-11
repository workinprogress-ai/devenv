// providers/facade/projects.ts — the provider-neutral projects family.
//
// The only import surface tools use for project-board verbs. The 15.14
// ops-object dispatch that lived in project-update-issue.ts is hoisted
// here: the facade owns the per-provider shape differences and exposes one
// async-neutral verb set.
//
// Normalizations owned here (never visible to tools):
//   - Async-neutral: github's verbs are sync (they shell gh via ghApiSync);
//     every facade verb is async so call sites await uniformly.
//   - forIssue: github returns row objects, azure returns tab-separated
//     lines (board\tWORK-ITEM-ID\tstatus) — the facade parses to the row
//     shape both fan-outs iterate.
//   - fieldSet: azure's verb returns void (the PATCH either threw or
//     worked); the facade reports true on return, keeping github's boolean
//     contract (a false means the graphql mutation reported not-updated).
//   - fieldList: github takes flags (["--owner", owner]); azure takes the
//     project name positionally.
//   - body-field resolution ([azure_body_fields]) is provider-side
//     (azure/issues.ts bodyFieldFor) — inherited, no work here.
//
// The module never exits; failures throw ProviderError and callers decide.

import { ProviderError } from "../provider-core.ts";
import { loadProviderModules } from "./provider-loader.ts";
import type * as ghTypes from "../github/projects.ts";
import type * as azTypes from "../azure/projects.ts";

type GithubProjects = typeof ghTypes;
type AzureProjects = typeof azTypes;

/** One project holding an issue, as the fan-out tools iterate. */
export interface IssueProjectRow {
  title: string;
  number: string;
  status: string;
}

/** The neutral projects verb set (the hoisted 15.14 ProjectsOps). */
export interface ProjectsOps {
  idByName(owner: string, name: string): Promise<string>;
  itemIdForIssue(projectId: string, issueNumber: string, owner: string, repo: string): Promise<string>;
  fieldOptionIds(projectId: string, field: string, word: string): Promise<{ fieldId: string; optionId: string }>;
  fieldSet(projectId: string, item: string, fieldId: string, optionId: string): Promise<boolean>;
  forIssue(issueUrl: string, owner: string): Promise<IssueProjectRow[]>;
  fieldList(projectName: string, owner: string): Promise<string>;
  /** Add an issue's URL to a project (project-add-issue's core write).
   * github takes the project NUMBER (gh project item-add's key); azure's
   * idByName accepts numbers and names alike. */
  itemAdd(projectNumber: string, issueUrl: string, owner: string): Promise<void>;
}

/** Resolve a project NAME to gh's item-add project NUMBER (github-native:
 * `gh project item-add` keys on the number, not the title — the tool
 * resolves once so both title and number inputs behave the same). Azure
 * boards have no number namespace; its verb set has no counterpart, so
 * this is a named github-native verb, not a normalized one. */
export async function projectsNumberByName(owner: string, nameOrNumber: string): Promise<string> {
  const m = await load();
  if (m.provider !== "github" || m.gh === undefined) {
    throw new ProviderError("projects_number_by_name is a github-native verb (azure boards address by name)");
  }
  return m.gh.projectsNumberByName(owner, nameOrNumber);
}

/** Add an issue (by URL) to a project given by title or number. GitHub keys
 * the add on the project number, so a title is resolved first; Azure boards
 * resolve names and numbers alike. Failures throw with the provider's reason. */
export async function projectsAddIssue(owner: string, project: string, issueUrl: string): Promise<void> {
  const m = await load();
  if (m.provider === "azure") {
    await (m.az as AzureProjects).projectsItemAdd("", project, issueUrl);
    return;
  }
  const gh = m.gh as GithubProjects;
  gh.projectsItemAdd(undefined, gh.projectsNumberByName(owner, project), issueUrl, ["--owner", owner]);
}

async function load(): Promise<{ provider: string; gh: GithubProjects | undefined; az: AzureProjects | undefined }> {
  const loaded = await loadProviderModules("projects");
  if (loaded.provider === "azure") {
    return { provider: "azure", gh: undefined, az: loaded.get<AzureProjects>("projects.ts") };
  }
  return { provider: "github", gh: loaded.get<GithubProjects>("projects.ts"), az: undefined };
}

/** The active provider's neutral projects verb set. github's sync verbs are
 * wrapped async so every call site awaits uniformly (the 15.14 contract). */
export async function projectsOps(): Promise<ProjectsOps> {
  const m = await load();
  if (m.provider === "azure") {
    const az = m.az as AzureProjects;
    return {
      async idByName(owner, name) {
        return az.projectsIdByName(owner, name);
      },
      async itemIdForIssue(projectId, issueNumber) {
        return az.projectsItemIdForIssue(projectId, issueNumber);
      },
      async fieldOptionIds(projectId, field, word) {
        return az.projectsFieldOptionIds(projectId, field, word);
      },
      async fieldSet(projectId, item, fieldId, optionId) {
        await az.projectsFieldSet(projectId, item, fieldId, optionId);
        return true;
      },
      async forIssue(issueUrl, owner) {
        const raw = await az.projectsForIssue(issueUrl, owner);
        // Azure's verb returns one tab-separated line per project:
        // boardName\tWORK-ITEM-ID\tstatus (column 2 is the work-item id —
        // the value the Status write feeds to idByName's numeric
        // pass-through). Parse to the shared row shape.
        return String(raw)
          .split("\n")
          .filter((l) => l.trim() !== "")
          .map((l) => {
            const [title, number, status] = l.split("\t");
            return { title: title ?? "", number: number ?? "", status: status ?? "" };
          });
      },
      async fieldList(projectName, _owner) {
        void _owner;
        return az.projectsFieldList("", projectName);
      },
      async itemAdd(projectNumber, issueUrl, owner) {
        void owner;
        await az.projectsItemAdd("", projectNumber, issueUrl);
      },
    };
  }
  const gh = m.gh as GithubProjects;
  return {
    async idByName(owner, name) {
      return gh.projectsIdByName(owner, name);
    },
    async itemIdForIssue(projectId, issueNumber, owner, repo) {
      return gh.projectsItemIdForIssue(projectId, issueNumber, owner, repo);
    },
    async fieldOptionIds(projectId, field, word) {
      return gh.projectsFieldOptionIds(projectId, field, word);
    },
    async fieldSet(projectId, item, fieldId, optionId) {
      return gh.projectsFieldSet(projectId, item, fieldId, optionId);
    },
    async forIssue(issueUrl, owner) {
      return gh.projectsForIssue(issueUrl, owner) as unknown as Promise<IssueProjectRow[]>;
    },
    async fieldList(projectName, owner) {
      return gh.projectsFieldList(undefined, projectName, ["--owner", owner]);
    },
    async itemAdd(projectNumber, issueUrl, owner) {
      return gh.projectsItemAdd(undefined, projectNumber, issueUrl, ["--owner", owner]);
    },
  };
}
