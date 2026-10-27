// github/projects.ts - GitHub implementation of the projects domain facade
// (GitHub Projects V2). Ports the full provider_projects_* verb set:
// list / field-list / item-add / id-by-name / item-id-for-issue /
// field-option-ids / field-set / for-issue. GraphQL pagination loops keep the
// bash line-protocol shape (first line "hasMore CURSOR", following lines are
// matches) — one gh call per page.

import { ghApiSync, providerDeclareCapability, providerRequireCapability } from "../provider-core.ts";
import { logWarn } from "../../core/logging.ts";

providerDeclareCapability("project-boards");

export interface GhResult {
  stdout: string;
  stderr: string;
  status: number;
}


/** Parse a pagination page: line 1 = "hasMore CURSOR", the rest are matches. */
function parsePage(output: string): { hasMore: boolean; cursor: string; ids: string[] } {
  const lines = output.split("\n").filter((l) => l !== "");
  const first = lines[0] ?? "false ";
  const spaceIdx = first.indexOf(" ");
  const hasMore = spaceIdx === -1 ? first === "true" : first.slice(0, spaceIdx) === "true";
  const cursor = spaceIdx === -1 ? "" : first.slice(spaceIdx + 1);
  return { hasMore, cursor, ids: lines.slice(1).filter((l) => l !== "") };
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
  if (nameOrNumber.includes('"')) {
    throw new Error(`projectsNumberByName: project title must not contain double quotes ('${nameOrNumber}')`);
  }
  const query = 'query($o:String!,$c:String){ organization(login:$o){ projectsV2(first:50, after:$c){ pageInfo{ hasNextPage endCursor } nodes{ number title } } } }';
  const jqProgram =
    '.data.organization.projectsV2 as $p ' +
    '| "\\($p.pageInfo.hasNextPage) \\($p.pageInfo.endCursor // \"\")", ' +
    `($p.nodes[] | select(.title == "${nameOrNumber}") | .number)`;
  const numbers: string[] = [];
  let cursor = "";
  let hasMore = true;
  while (hasMore) {
    const args = ["-f", `query=${query}`, "-f", `o=${owner}`];
    if (cursor !== "") args.push("-f", `c=${cursor}`);
    const page = ghApiSync(["api", "graphql", ...args, "--jq", jqProgram], { tolerateFailure: true });
    if (page.status !== 0) throw new Error(`projectsNumberByName: page scan failed for '${nameOrNumber}'`);
    const parsed = parsePage(page.stdout);
    hasMore = parsed.hasMore;
    cursor = parsed.cursor;
    numbers.push(...parsed.ids);
  }
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
  // tail projects). A title containing a double quote cannot be safely
  // interpolated into gh's --jq program — rejected, named.
  if (nameOrNumber.includes('"')) {
    throw new Error(`projectsIdByName: project title must not contain double quotes ('${nameOrNumber}')`);
  }
  const query = 'query($o:String!,$c:String){ organization(login:$o){ projectsV2(first:50, after:$c){ pageInfo{ hasNextPage endCursor } nodes{ id title } } } }';
  const jqProgram =
    '.data.organization.projectsV2 as $p ' +
    '| "\\($p.pageInfo.hasNextPage) \\($p.pageInfo.endCursor // \"\")", ' +
    `($p.nodes[] | select(.title == "${nameOrNumber}") | .id)`;
  const ids: string[] = [];
  let cursor = "";
  let hasMore = true;
  while (hasMore) {
    const args = ["-f", `query=${query}`, "-f", `o=${owner}`];
    if (cursor !== "") args.push("-f", `c=${cursor}`);
    const page = ghApiSync(["api", "graphql", ...args, "--jq", jqProgram], { tolerateFailure: true });
    if (page.status !== 0) throw new Error(`projectsIdByName: page scan failed for '${nameOrNumber}'`);
    const parsed = parsePage(page.stdout);
    hasMore = parsed.hasMore;
    cursor = parsed.cursor;
    ids.push(...parsed.ids);
  }
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
  if ((owner + repo).includes('"')) {
    throw new Error("projectsItemIdForIssue: owner/repo must not contain double quotes");
  }
  const fullName = `${owner}/${repo}`;
  const query = 'query($p:ID!,$c:String){ node(id:$p){ ... on ProjectV2 { items(first:100, after:$c){ pageInfo{ hasNextPage endCursor } nodes{ id content{ ... on Issue{ number repository{ nameWithOwner } } } } } } } }';
  const jqProgram =
    '.data.node.items as $items ' +
    '| "\\($items.pageInfo.hasNextPage) \\($items.pageInfo.endCursor // \"\")", ' +
    `($items.nodes[] | select(.content.number == ${issueNumber} and .content.repository.nameWithOwner == "${fullName}") | .id)`;
  const ids: string[] = [];
  let cursor = "";
  let hasMore = true;
  while (hasMore) {
    const args = ["-f", `query=${query}`, "-f", `p=${projectId}`];
    if (cursor !== "") args.push("-f", `c=${cursor}`);
    const page = ghApiSync(["api", "graphql", ...args, "--jq", jqProgram], { tolerateFailure: true });
    if (page.status !== 0) throw new Error(`projectsItemIdForIssue: page scan failed for ${fullName}#${issueNumber}`);
    const parsed = parsePage(page.stdout);
    hasMore = parsed.hasMore;
    cursor = parsed.cursor;
    ids.push(...parsed.ids);
  }
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
