// azure/projects.ts — Azure DevOps boards/projects domain (port of
// azure/projects.bash). Boards are project-wide (the repo argument in verb
// signatures is seam filler); the Status field's options are the boards'
// Kanban columns. Contract: throw ProviderError; never exit.

import { ProviderError } from "../provider-core.ts";
import { azureHttp } from "./http.ts";
import { azureOrgProject, azureUri } from "./urls.ts";

/** The default team's GUID (the boards API's route segment): the configured
 * project (name or GUID) is looked up, then its first team is the default. */
async function defaultTeamId(): Promise<string> {
  const { org, project } = azureOrgProject();
  const proj = await azureHttp<{ id?: string }>(
    "GET",
    `https://dev.azure.com/${azureUri(org)}/_apis/projects/${azureUri(project)}`,
  );
  const guid = proj.id ?? "";
  if (guid === "") throw new ProviderError(`project '${project}' not found`);
  const teams = await azureHttp<{ value?: Array<{ id?: string }> }>(
    "GET",
    `https://dev.azure.com/${azureUri(org)}/_apis/projects/${guid}/teams`,
  );
  return teams.value?.[0]?.id ?? "";
}

/** Map a status_workflow vocabulary word onto a process state via the config
 * alias table. Order: (1) the word already names a process state (pass-
 * through), (2) [azure_status_aliases] maps it, (3) no states known → pass
 * through and let the PATCH validate; with states known and no match, fail
 * defined (vocabulary drift is surfaced, never guessed). */
export function statusAlias(word: string, states: string[]): string {
  if (states.includes(word)) return word;
  // (2) config alias block: [azure_status_aliases] <word>=<state>
  const { configGetRaw } = requireConfig();
  const mapped = configGetRaw(providerConfigPathSafe(), "azure_status_aliases", word) ?? "";
  if (mapped !== "") return mapped;
  if (states.length === 0) return word;
  throw new ProviderError(
    `'${word}' maps onto no process state — add an [azure_status_aliases] entry or use a state name (MAPPING.md Boards section)`,
  );
}

// Late-bound config access (mirrors urls.ts's pattern without a cycle).
import { configGetRaw } from "../../core/config.ts";
import { providerConfigPath } from "../provider-core.ts";
function requireConfig(): { configGetRaw: typeof configGetRaw } {
  return { configGetRaw };
}
function providerConfigPathSafe(): string {
  return providerConfigPath();
}

/** Board name for a work item type: User Story and Bug share the Stories
 * board (whether Bug is on it is a team setting), Feature and Epic have
 * their own. */
export function boardNameForType(type: string): string {
  if (type === "User Story" || type === "Bug") return "Stories";
  if (type === "Feature") return "Features";
  if (type === "Epic") return "Epics";
  return `${type} Board`;
}

/** The Kanban column field of a work item (WEF_<guid>_Kanban.Column) — the
 * reference name carries the board's guid, found on the item itself. */
export function kanbanField(item: { fields?: Record<string, unknown> }): string {
  const keys = Object.keys(item.fields ?? {});
  return keys.find((k) => /^WEF_.*_Kanban\.Column$/.test(k)) ?? "";
}

interface Board {
  name?: string;
  id?: string;
}

export interface ProjectsListOptions {
  owner?: string;
  format?: string;
  jq?: string;
}

/** List boards. Default: one {name, number, id} object per line. With
 * --format json the result is the seam's envelope {projects, totalCount};
 * --jq applies to that envelope. --owner is accepted, not consulted (the
 * owner is the configured organization). */
export async function projectsList(
  repo: string,
  opts: ProjectsListOptions = {},
): Promise<string> {
  void repo;
  if (opts.format !== undefined && opts.format !== "" && opts.format !== "json") {
    throw new ProviderError("projects_list: --format must be json");
  }
  const { org, project } = azureOrgProject();
  const team = await defaultTeamId();
  const r = await azureHttp<{ value?: Board[] }>(
    "GET",
    `https://dev.azure.com/${azureUri(org)}/${azureUri(project)}/${azureUri(team)}/_apis/work/boards`,
  );
  const boards = r.value ?? [];
  const rows = boards.map((b) => ({ name: b.name ?? "", number: b.id ?? "", id: b.id ?? "" }));
  if (opts.format === "json" || opts.jq !== undefined) {
    const envelope = JSON.stringify({ projects: rows, totalCount: rows.length });
    if (opts.jq !== undefined) {
      // The bash side piped the envelope through jq -r "($expr) | select(. != null)";
      // the TS verbs' supported -q programs do not cover envelope navigation —
      // named error, never silent.
      throw new ProviderError(
        `unsupported jq program '${opts.jq}' — azure projects_list supports --format json only`,
      );
    }
    return envelope;
  }
  return rows.map((r2) => JSON.stringify(r2)).join("\n");
}

/** Resolve a board by name (the board id). Numeric input passes through. */
export async function projectsIdByName(owner: string, name: string): Promise<string> {
  void owner;
  if (name === "") throw new ProviderError("projects_id_by_name: project name required");
  if (/^\d+$/.test(name)) return name;
  const { org, project } = azureOrgProject();
  const team = await defaultTeamId();
  const r = await azureHttp<{ value?: Board[] }>(
    "GET",
    `https://dev.azure.com/${azureUri(org)}/${azureUri(project)}/${azureUri(team)}/_apis/work/boards`,
  );
  const hit = (r.value ?? []).find((b) => b.name === name);
  if (hit === undefined || hit.id === undefined) {
    throw new ProviderError(`no board named '${name}'`);
  }
  return hit.id;
}

/** Add a work item to a board: work items are born on their type's board —
 * a no-op success for interface parity. */
export async function projectsItemAdd(
  repo: string,
  projectNumber: string,
  issueUrlOrId: string,
  opts: { owner?: string } = {},
): Promise<void> {
  void repo;
  void projectNumber;
  void issueUrlOrId;
  void opts.owner;
}

/** The "item id" for a work item is the work item id itself. */
export async function projectsItemIdForIssue(
  projectId: string,
  issue: string,
): Promise<string> {
  void projectId;
  if (issue === "") throw new ProviderError("projects_item_id_for_issue: issue number required");
  return issue;
}

export interface ProjectsFieldListOptions {
  owner?: string;
}

/** List the Status field's options: the column names of the project's boards
 * (in board order, each name once), as seam-shaped field/option JSON per
 * line. */
export async function projectsFieldList(
  repo: string,
  projectNumber: string,
  opts: ProjectsFieldListOptions = {},
): Promise<string> {
  void repo;
  void projectNumber;
  void opts.owner;
  const { org, project } = azureOrgProject();
  const team = await defaultTeamId();
  const boardsUrl = `https://dev.azure.com/${azureUri(org)}/${azureUri(project)}/${azureUri(team)}/_apis/work/boards`;
  const boards = await azureHttp<{ value?: Board[] }>("GET", boardsUrl);
  const names: string[] = [];
  for (const board of boards.value ?? []) {
    if (board.id === undefined) continue;
    const cols = await azureHttp<{ value?: Array<{ name?: string }> }>(
      "GET",
      `${boardsUrl}/${board.id}/columns`,
    );
    for (const c of cols.value ?? []) {
      const n = c.name ?? "";
      if (n !== "" && !names.includes(n)) names.push(n);
    }
  }
  return names.map((n) => JSON.stringify({ name: "Status", option: n, settable: true })).join("\n");
}

/** Resolve a Status word to (field_id, option_id): the literal "Status" and
 * the board column the word names (itself, or its config alias). */
export async function projectsFieldOptionIds(
  projectId: string,
  field: string,
  word: string,
): Promise<{ fieldId: string; optionId: string }> {
  void projectId;
  if (word === "") throw new ProviderError("projects_field_option_ids: option name required");
  const column = statusAlias(word, []);
  return { fieldId: field, optionId: column };
}

/** Set the Status field: write the work item's Kanban column field. Azure
 * moves System.State by the board's column-to-state mapping. A work item
 * with no column field (its type has no board) takes the word as a state. */
export async function projectsFieldSet(
  projectId: string,
  item: string,
  fieldId: string,
  option: string,
): Promise<void> {
  void projectId;
  void fieldId;
  if (item === "" || option === "") {
    throw new ProviderError("projects_field_set: item and option required");
  }
  const { base } = witBase();
  const workItem = await azureHttp<{ fields?: Record<string, unknown> }>(
    "GET",
    `${base}/workitems/${item}`,
  );
  const kanban = kanbanField(workItem);
  if (kanban === "") {
    // The type has no board: the word is a state — the same patch
    // issues.ts's patchState makes (add /fields/System.State).
    await azureHttp("PATCH", `${base}/workitems/${item}`, {
      body: JSON.stringify([
        { op: "add", path: "/fields/System.State", from: null, value: option },
      ]),
      contentType: "application/json-patch+json",
    });
    return;
  }
  await azureHttp("PATCH", `${base}/workitems/${item}`, {
    body: JSON.stringify([{ op: "add", path: `/fields/${kanban}`, value: option }]),
    contentType: "application/json-patch+json",
  });
}

/** Which boards hold a work item: title/number/status rows in the seam's
 * shape. The status is the Kanban column (every workflow word reads back as
 * itself); an item with no column reports System.State. */
export async function projectsForIssue(
  issueUrl: string,
  owner: string,
  issue?: string,
): Promise<string> {
  void owner;
  const number =
    issue ??
    (/\d+/.exec(
      (/(?:\/issues\/|\/_workitems\/edit\/)\d+/.exec(issueUrl) ?? [""])[0] ?? "",
    )?.[0] ?? "");
  if (number === "") {
    throw new ProviderError(`projects_for_issue: issue number unresolvable from '${issueUrl}'`);
  }
  const { base } = witBase();
  const workItem = await azureHttp<{ fields?: Record<string, unknown> }>(
    "GET",
    `${base}/workitems/${number}`,
  );
  const kanban = kanbanField(workItem);
  const fields = workItem.fields ?? {};
  const status =
    kanban !== ""
      ? String(fields[kanban] ?? "-")
      : String(fields["System.State"] ?? "-");
  const type = String(fields["System.WorkItemType"] ?? "Issue");
  return `${boardNameForType(type)}\t${number}\t${status}`;
}

// local import to avoid a cycle through issues.ts's witBase (identical logic)
function witBase(): { base: string } {
  const { org, project } = azureOrgProject();
  return { base: `https://dev.azure.com/${azureUri(org)}/${azureUri(project)}/_apis/wit` };
}
