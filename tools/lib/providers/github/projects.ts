// github/projects.ts - GitHub implementation of the projects domain facade
// (GitHub Projects V2). Ports the full provider_projects_* verb set:
// list / field-list / item-add / id-by-name / item-id-for-issue /
// field-option-ids / field-set / for-issue. GraphQL pagination loops keep the
// bash line-protocol shape (first line "hasMore CURSOR", following lines are
// matches) — one gh call per page.

import { ProviderError, providerDeclareCapability, providerRequireCapability } from "../provider-core.ts";
import { ghApiSync } from "./transport.ts";
import { logWarn } from "../../core/logging.ts";

providerDeclareCapability("project-boards");

export interface GhResult {
  stdout: string;
  stderr: string;
  status: number;
}


interface GraphqlConnection<N> {
  pageInfo?: { hasNextPage?: boolean; endCursor?: string | null };
  nodes?: Array<N | null>;
}

/** Walk a paginated GraphQL connection one gh call per page and return every
 * node the caller's filter keeps. The response is parsed and filtered here —
 * caller-supplied titles and names never enter a jq program, so no value can
 * alter a program's meaning. `flags` are the query's -f variable flags; the
 * cursor rides as `c`. */
function scanConnection<N>(
  label: string,
  query: string,
  flags: string[],
  connection: (json: unknown) => GraphqlConnection<N> | undefined,
  keep: (node: N) => boolean,
  failure: string,
): N[] {
  const kept: N[] = [];
  let cursor = "";
  let hasMore = true;
  while (hasMore) {
    const args = ["-f", `query=${query}`, ...flags];
    if (cursor !== "") args.push("-f", `c=${cursor}`);
    const page = ghApiSync(["api", "graphql", ...args], { tolerateFailure: true });
    if (page.status !== 0) throw new Error(`${label}: ${failure}`);
    let json: unknown;
    try {
      json = JSON.parse(page.stdout);
    } catch {
      throw new Error(`${label}: invalid GraphQL response (${failure})`);
    }
    const conn = connection(json);
    // GraphQL list items may be null (an inaccessible node).
    kept.push(...(conn?.nodes ?? []).filter((n): n is N => n !== null && n !== undefined).filter(keep));
    hasMore = conn?.pageInfo?.hasNextPage === true;
    cursor = conn?.pageInfo?.endCursor ?? "";
    // A next page without a cursor cannot be followed; stopping here would
    // report a partial scan as a complete one.
    if (hasMore && cursor === "") throw new ProviderError(`${label}: the next page has no cursor (${failure})`);
  }
  return kept;
}

/** List projects. The repo argument is not a gh argument (gh project list is
 * org-scoped); flags forward. */
export function projectsList(_repo: string | undefined, flags: string[] = []): string {
  providerRequireCapability("project-boards");
  void _repo;
  const r = ghApiSync(["project", "list", ...flags], { tolerateFailure: true });
  if (r.status !== 0) throw new Error(`projectsList failed: ${r.stderr.trim()}`);
  return r.stdout;
}

/** List a project's fields. */
export function projectsFieldList(_repo: string | undefined, project: string, flags: string[] = []): string {
  providerRequireCapability("project-boards");
  void _repo;
  const r = ghApiSync(["project", "field-list", project, ...flags], { tolerateFailure: true });
  if (r.status !== 0) throw new Error(`projectsFieldList failed for '${project}': ${r.stderr.trim()}`);
  return r.stdout;
}

/** Resolve a project's numeric number from its title (paginated scan) or
 * pass a numeric input through — the number form `gh project item-add`
 * requires. Mirrors projectsIdByName's resolution rules (same named
 * errors). */
export function projectsNumberByName(owner: string, nameOrNumber: string): string {
  providerRequireCapability("project-boards");
  if (owner === "" || nameOrNumber === "") {
    throw new Error("projectsNumberByName: owner and project required");
  }
  if (/^[0-9]+$/.test(nameOrNumber)) return nameOrNumber;
  const query = 'query($o:String!,$c:String){ organization(login:$o){ projectsV2(first:50, after:$c){ pageInfo{ hasNextPage endCursor } nodes{ number title } } } }';
  const matches = scanConnection<{ number?: number; title?: string }>(
    "projectsNumberByName",
    query,
    ["-f", `o=${owner}`],
    (j) => (j as { data?: { organization?: { projectsV2?: GraphqlConnection<{ number?: number; title?: string }> } } }).data?.organization?.projectsV2,
    (n) => n.title === nameOrNumber,
    `page scan failed for '${nameOrNumber}'`,
  );
  const numbers = matches.map((n) => String(n.number ?? "")).filter((n) => n !== "");
  if (numbers.length === 0) {
    throw new Error(`projectsNumberByName: no project titled '${nameOrNumber}' in org '${owner}'`);
  }
  return numbers[0] ?? "";
}

/** Add an item (issue URL or id) to a project. */
export function projectsItemAdd(_repo: string | undefined, project: string, item: string, flags: string[] = []): void {
  providerRequireCapability("project-boards");
  void _repo;
  const r = ghApiSync(["project", "item-add", project, "--url", item, ...flags], { tolerateFailure: true });
  if (r.status !== 0) throw new Error(`projectsItemAdd failed for '${project}' '${item}': ${r.stderr.trim()}`);
}

/** Resolve a project's GraphQL node ID from its numeric number (direct
 * projectV2(number:) lookup) or title (paginated scan). */
export function projectsIdByName(owner: string, nameOrNumber: string): string {
  providerRequireCapability("project-boards");
  if (owner === "" || nameOrNumber === "") {
    throw new Error("projectsIdByName: owner and project required");
  }

  // Numeric input maps directly to projectV2(number:) — no list scan needed.
  if (/^[0-9]+$/.test(nameOrNumber)) {
    const query = "query($o:String!,$n:Int!){ organization(login:$o){ projectV2(number:$n){ id } } }";
    const r = ghApiSync(
      ["api", "graphql", "-f", `query=${query}`, "-f", `o=${owner}`, "-F", `n=${nameOrNumber}`,
       "--jq", ".data.organization.projectV2.id"],
      { tolerateFailure: true },
    );
    const id = r.stdout.trim();
    if (r.status === 0 && id !== "" && id !== "null") return id;
    throw new Error(`projectsIdByName: no project number ${nameOrNumber} for org '${owner}'`);
  }

  // Title match: paginated scan (a >50-project org must not silently lose
  // tail projects); the title is compared in code, never interpolated.
  const query = 'query($o:String!,$c:String){ organization(login:$o){ projectsV2(first:50, after:$c){ pageInfo{ hasNextPage endCursor } nodes{ id title } } } }';
  const matches = scanConnection<{ id?: string; title?: string }>(
    "projectsIdByName",
    query,
    ["-f", `o=${owner}`],
    (j) => (j as { data?: { organization?: { projectsV2?: GraphqlConnection<{ id?: string; title?: string }> } } }).data?.organization?.projectsV2,
    (n) => n.title === nameOrNumber,
    `page scan failed for '${nameOrNumber}'`,
  );
  const ids = matches.map((n) => n.id ?? "").filter((n) => n !== "");
  if (ids.length === 0) {
    throw new Error(`projectsIdByName: no project titled '${nameOrNumber}' in org '${owner}'`);
  }
  return ids[0] ?? "";
}

/** Resolve the project item ID for an issue inside a project. Repo-strict:
 * issue numbers are only unique per repository, so owner/name must match
 * exactly; zero matches = not in project, more than one = refused ambiguity. */
export function projectsItemIdForIssue(projectId: string, issueNumber: string, owner: string, repo: string): string {
  providerRequireCapability("project-boards");
  if (projectId === "" || issueNumber === "" || owner === "" || repo === "") {
    throw new Error("projectsItemIdForIssue: project-id, issue-number, owner and repo required");
  }
  if (!/^[0-9]+$/.test(issueNumber)) {
    throw new Error(`projectsItemIdForIssue: issue number must be numeric ('${issueNumber}')`);
  }
  const fullName = `${owner}/${repo}`;
  const query = 'query($p:ID!,$c:String){ node(id:$p){ ... on ProjectV2 { items(first:100, after:$c){ pageInfo{ hasNextPage endCursor } nodes{ id content{ ... on Issue{ number repository{ nameWithOwner } } } } } } } }';
  type Item = { id?: string; content?: { number?: number; repository?: { nameWithOwner?: string } } };
  const matches = scanConnection<Item>(
    "projectsItemIdForIssue",
    query,
    ["-f", `p=${projectId}`],
    (j) => (j as { data?: { node?: { items?: GraphqlConnection<Item> } } }).data?.node?.items,
    (n) => n.content?.number === Number(issueNumber) && n.content?.repository?.nameWithOwner === fullName,
    `page scan failed for ${fullName}#${issueNumber}`,
  );
  const ids = matches.map((n) => n.id ?? "").filter((n) => n !== "");
  if (ids.length === 0) {
    throw new Error(`projectsItemIdForIssue: ${fullName}#${issueNumber} is not in project ${projectId}`);
  }
  if (ids.length !== 1) {
    throw new Error(`projectsItemIdForIssue: expected exactly 1 card for ${fullName}#${issueNumber}, got ${ids.length}`);
  }
  return ids[0] ?? "";
}

/** Resolve the single-select field ID and option ID for a field/value pair.
 * Option match is case-insensitive (config vocabulary vs real-project drift). */
export function projectsFieldOptionIds(projectId: string, fieldName: string, optionName: string): { fieldId: string; optionId: string } {
  providerRequireCapability("project-boards");
  if (projectId === "" || fieldName === "" || optionName === "") {
    throw new Error("projectsFieldOptionIds: project-id, field, option required");
  }
  const query = 'query($p:ID!,$f:String!){ node(id:$p){ ... on ProjectV2 { field(name:$f){ ... on ProjectV2SingleSelectField{ id options{ id name } } } } } }';
  const r = ghApiSync(["api", "graphql", "-f", `query=${query}`, "-f", `p=${projectId}`, "-f", `f=${fieldName}`], {
    tolerateFailure: true,
  });
  if (r.status !== 0) throw new Error(`projectsFieldOptionIds: lookup failed for field '${fieldName}'`);
  let parsed: unknown;
  try {
    parsed = JSON.parse(r.stdout);
  } catch {
    throw new Error(`projectsFieldOptionIds: invalid GraphQL response for field '${fieldName}'`);
  }
  const node = (parsed as { data?: { node?: { field?: { id?: string; options?: Array<{ id: string; name: string }> } } } }).data?.node?.field;
  const fieldId = node?.id;
  const matches = (node?.options ?? []).filter((o) => o.name.toLowerCase() === optionName.toLowerCase());
  if (fieldId === undefined || matches.length !== 1 || matches[0] === undefined) {
    throw new Error(`projectsFieldOptionIds: option '${optionName}' not found for field '${fieldName}'`);
  }
  return { fieldId, optionId: matches[0].id };
}

/** Set a single-select field value on a project item (idempotent same-value
 * writes succeed silently). */
export function projectsFieldSet(projectId: string, itemId: string, fieldId: string, optionId: string): boolean {
  providerRequireCapability("project-boards");
  if (projectId === "" || itemId === "" || fieldId === "" || optionId === "") {
    throw new Error("projectsFieldSet: all four IDs required");
  }
  const query = 'mutation($p:ID!,$i:ID!,$f:ID!,$o:String!){ updateProjectV2ItemFieldValue(input:{ projectId:$p, itemId:$i, fieldId:$f, value:{ singleSelectOptionId:$o } }){ projectV2Item{ id } } }';
  const r = ghApiSync(
    ["api", "graphql", "-f", `query=${query}`, "-f", `p=${projectId}`, "-f", `i=${itemId}`, "-f", `f=${fieldId}`, "-f", `o=${optionId}`],
    { tolerateFailure: true },
  );
  return r.status === 0;
}

export interface IssueProjectRow {
  title: string;
  number: string;
  /** Status single-select value, or "-" when the project has none. */
  status: string;
}

/** List projects containing an issue, with the issue's current Status in each
 * (reverse lookup via the issue's own projectItems; owner-filtered). */
export function projectsForIssue(issueUrl: string, owner: string): IssueProjectRow[] {
  providerRequireCapability("project-boards");
  if (issueUrl === "" || owner === "") {
    throw new Error("projectsForIssue: issue-url and owner required");
  }
  const query = 'query($u:URI!){ resource(url:$u){ ... on Issue { projectItems(first:20){ pageInfo{ hasNextPage } nodes{ project{ id number title owner{ ... on Organization{ login } ... on User{ login } } } fieldValues(first:20){ pageInfo{ hasNextPage } nodes{ __typename ... on ProjectV2ItemFieldSingleSelectValue{ name field{ ... on ProjectV2FieldCommon{ name } } } } } } } } } }';
  const r = ghApiSync(["api", "graphql", "-f", `query=${query}`, "-f", `u=${issueUrl}`], { tolerateFailure: true });
  if (r.status !== 0) {
    throw new Error(`projectsForIssue: GraphQL query failed for ${issueUrl}: ${r.stderr.trim()}`);
  }
  let json: {
    errors?: Array<{ message?: string }>;
    data?: {
      resource?: {
        projectItems?: {
          pageInfo?: { hasNextPage?: boolean };
          nodes?: Array<{
            project?: { title?: string; number?: number; owner?: { login?: string } };
            fieldValues?: {
              pageInfo?: { hasNextPage?: boolean };
              nodes?: Array<{ __typename?: string; name?: string; field?: { name?: string } }>;
            };
          }>;
        };
      };
    };
  };
  try {
    json = JSON.parse(r.stdout);
  } catch {
    throw new Error(`projectsForIssue: invalid GraphQL response for ${issueUrl}`);
  }
  if (json.errors !== undefined && json.errors.length > 0) {
    throw new Error(`projectsForIssue: GraphQL error for ${issueUrl}: ${json.errors[0]?.message ?? "unknown"}`);
  }
  const items = json.data?.resource?.projectItems;
  if (items?.pageInfo?.hasNextPage === true) {
    logWarn(`projectsForIssue: ${issueUrl} is on more projects than the query returns (20); the list is incomplete`);
  }
  if ((items?.nodes ?? []).some((n) => n.fieldValues?.pageInfo?.hasNextPage === true)) {
    logWarn(`projectsForIssue: a project item of ${issueUrl} has more field values than the query returns (20); its Status may be missing`);
  }
  const rows: IssueProjectRow[] = [];
  for (const node of items?.nodes ?? []) {
    const project = node.project;
    if (project?.owner?.login !== owner) continue;
    const statusNode = (node.fieldValues?.nodes ?? []).find(
      (fv) => fv.__typename === "ProjectV2ItemFieldSingleSelectValue" && fv.field?.name === "Status",
    );
    rows.push({
      title: project.title ?? "",
      number: String(project.number ?? ""),
      status: statusNode?.name ?? "-",
    });
  }
  return rows;
}
