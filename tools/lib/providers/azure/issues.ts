// azure/issues.ts — Azure DevOps implementation of the issues domain facade
// (port of azure/issues.bash over the http.ts transport).
//
// Implements the CONTRACT.md Issues verbs: list / view / exists / create /
// edit / close / reopen / comment / comments / comment_add / comment_get /
// comment_edit / set_type / milestones, the label verbs, add_tag (azure-only),
// and the sub-issue graph verbs. One verb per contract row; options are
// validated strictly (an unlisted option is a named error, never dropped
// silently).
//
// Shape contract: neutral field names; state is OPEN/CLOSED; work items are
// project-scoped — the repo argument in verb signatures is seam filler
// (CONTRACT.md: a work item belongs to a project, not a repository).
// Long-text fields: the store entity-encodes HTML and appends one trailing
// newline; writes carry the markdown multiline format, reads un-escape over
// the entity set Azure emits (&amp; last). Command-substitution newline
// pairing from bash becomes explicit trim here, keeping round trips
// byte-stable. Contract: throw ProviderError on failure; never process.exit.

import { ProviderError, unknownOption, needValue } from "../provider-core.ts";
import { azureHttp } from "./http.ts";
import { witBase, webItemsBase } from "./wit-urls.ts";
import { azureUri } from "./urls.ts";
import {
  azureTextDecode,
  azureTextNormalize,
  azureTagsSplit,
  azureTagsJoin,
  bodyFieldFor,
  splitCommentRef,
  issuesArtifactBodyTransform,
  issueTypesConfig,
  DEFAULT_BODY_FIELD,
} from "./entity-roundtrip.ts";
import { errorMessage, logWarn } from "../../core/logging.ts";

// Re-exported for the split surface's existing consumers (facade type
// imports, smoke.ts, azure.test.ts) — one import site, unchanged names.
export {
  azureTextDecode,
  azureTextNormalize,
  azureTagsSplit,
  azureTagsJoin,
  bodyFieldFor,
  splitCommentRef,
  azureMarkerTransform,
  issuesArtifactBodyTransform,
} from "./entity-roundtrip.ts";


/** Work-item comments are a preview resource: the API rejects stable 7.1 and
 * requires a pinned -preview api-version. 7.2-preview.4 is required for the
 * comment `format` attribute (?format=markdown as a QUERY parameter — a body
 * format field is silently ignored). */
const AZURE_COMMENTS_API_VERSION = "7.2-preview.4";
/** workitemsbatch accepts at most 200 ids per request. */
const AZURE_BATCH_MAX = 200;

// ---------------------------------------------------------------------------
// Field mapping
// ---------------------------------------------------------------------------

/** Raw Azure work-item shape (the fields we consume). */
interface AzureWorkItem {
  id?: number;
  rev?: number;
  url?: string;
  fields?: Record<string, unknown>;
  multilineFieldsFormat?: Record<string, string>;
  relations?: Array<{ rel?: string; url?: string }>;
}

function field(item: AzureWorkItem, key: string): unknown {
  return item.fields?.[key];
}

function strField(item: AzureWorkItem, key: string): string {
  const v = field(item, key);
  return typeof v === "string" ? v : "";
}

/** State categories whose states count as closed: the one source for the
 * close target, the seam state projection and the WIQL state filters. */
const CLOSED_CATEGORIES = ["Completed", "Removed"];

/** The seam state projection: CLOSED for a state in a closed category (see
 * closedStateNames), else OPEN. */
function seamState(item: AzureWorkItem, closed: ReadonlySet<string>): "OPEN" | "CLOSED" {
  return closed.has(strField(item, "System.State")) ? "CLOSED" : "OPEN";
}

/** The names of every state, across the project's work item types, whose
 * category is closed. Process templates name their final states differently
 * (Closed, Done, Resolved, custom names), so the category is the truth. */
async function closedStateNames(): Promise<Set<string>> {
  const { base } = witBase();
  const r = await azureHttp<{ value?: Array<{ states?: Array<{ name?: string; category?: string }> }> }>(
    "GET",
    `${base}/workitemtypes`,
  );
  const closed = new Set<string>();
  for (const type of r.value ?? []) {
    for (const s of type.states ?? []) {
      if (s.name !== undefined && CLOSED_CATEGORIES.some((c) => c.toLowerCase() === (s.category ?? "").toLowerCase())) {
        closed.add(s.name);
      }
    }
  }
  if (closed.size === 0) {
    throw new ProviderError(`the project's work item types list no state in category ${CLOSED_CATEGORIES.join(" or ")}`);
  }
  return closed;
}

function seamTags(item: AzureWorkItem): Array<{ name: string }> {
  return azureTagsSplit(strField(item, "System.Tags")).map((name) => ({ name }));
}

function seamMilestone(item: AzureWorkItem): { title: string } | "" {
  const it = strField(item, "System.IterationLevel2");
  return it === "" ? "" : { title: it };
}

function seamAssignees(item: AzureWorkItem): Array<{ login: string }> {
  const a = field(item, "System.AssignedTo") as { displayName?: string } | null | undefined;
  return a == null ? [] : [{ login: a.displayName ?? "unknown" }];
}

/** Decode a description per its storage format: markdown-held text is raw;
 * HTML-held text is entity-decoded. */
/** Decode one long-text field honoring its multilineFieldsFormat entry. */
function decodeLongText(item: AzureWorkItem, field: string): string {
  const raw = strField(item, field);
  const isMarkdown =
    (item.multilineFieldsFormat?.[field] ?? "") === "markdown";
  return isMarkdown ? raw : azureTextDecode(raw);
}

/** The body for a work item whose devenv type maps to CONFIGURED_FIELD:
 * read the configured field first; when empty, fall back to the other
 * candidate (System.Description) so items written before the field was
 * configured stay readable (a Bug whose body lives in Description while its
 * form shows ReproSteps). */
function decodeConfiguredBody(
  item: AzureWorkItem,
  configuredField: string,
): string {
  const primary = decodeLongText(item, configuredField);
  if (primary.trim() !== "" || configuredField === DEFAULT_BODY_FIELD) {
    return primary;
  }
  return decodeLongText(item, DEFAULT_BODY_FIELD);
}

/** The full seam record for one work item (view's projection contract: every
 * field present and non-null — absent Azure data maps to typed empties). */
/** The {number, title} of the work item's parent (the Hierarchy-Reverse
 * relation), or null. The parent's title needs a second fetch, so only the
 * number is surfaced inline; the record carries `{number, title: null}` and
 * callers wanting the title resolve it themselves. */
function seamParent(item: AzureWorkItem): Record<string, unknown> | null {
  const rel = (item.relations ?? []).find(
    (r) => r.rel === "System.LinkTypes.Hierarchy-Reverse",
  );
  if (rel === undefined) return null;
  const n = Number((rel.url ?? "").split("/").pop());
  return Number.isFinite(n) ? { number: n, title: null } : null;
}

/** The devenv issue type for a work item's Azure WIT: [azure_issue_types]
 * overrides first (a configured value equal to this WIT maps to the devenv
 * type), then the built-in map inverted. Unmapped WITs surface verbatim
 * (issue-get's type field is diagnostic, not a write input). */
function seamTypeFor(item: AzureWorkItem): string {
  const wit = strField(item, "System.WorkItemType");
  if (wit === "") return "";
  for (const key of ["epic", "feature", "bug", "task"]) {
    if (issueTypesConfig(key) === wit) return key.charAt(0).toUpperCase() + key.slice(1);
  }
  const builtinInverse: Record<string, string> = {
    Epic: "Epic", Feature: "Feature", Bug: "Bug", "User Story": "Task",
  };
  return builtinInverse[wit] ?? wit;
}

function mapItem(item: AzureWorkItem, closed: ReadonlySet<string>, comments?: Array<{ id: string; url: string; body: string; created_at: string; updated_at: string }>): Record<string, unknown> {
  const number = item.id ?? 0;
  const devenvType = seamTypeFor(item);
  return {
    number,
    type: devenvType,
    parent: seamParent(item),
    title: strField(item, "System.Title"),
    state: seamState(item, closed),
    body: decodeConfiguredBody(item, bodyFieldFor(devenvType)),
    labels: seamTags(item),
    assignees: seamAssignees(item),
    milestone: seamMilestone(item),
    author: {
      login:
        (field(item, "System.CreatedBy") as { displayName?: string } | undefined)
          ?.displayName ?? "unknown",
    },
    createdAt: strField(item, "System.CreatedDate"),
    updatedAt: strField(item, "System.ChangedDate"),
    closedAt: strField(item, "Microsoft.VSTS.Common.ClosedDate"),
    url: `${webItemsBase()}${number}`,
    comments: comments ?? [],
  };
}

// ---------------------------------------------------------------------------
// Type mapping + states
// ---------------------------------------------------------------------------

/** The mapped Azure work item type for a devenv issue type, resolving
 * [azure_issue_types] overrides first (bash azure_work_item_type_for
 * parity), then the built-in map. */
function mappedWorkItemType(type: string): string {
  const key = type.toLowerCase();
  const override = key === "" ? "" : issueTypesConfig(key);
  if (override !== "") return override;
  const builtin: Record<string, string> = {
    epic: "Epic",
    feature: "Feature",
    bug: "Bug",
    task: "User Story",
    "": "User Story",
  };
  const mapped = builtin[key];
  if (mapped !== undefined) return mapped;
  throw new ProviderError(
    `no Azure work item type is mapped for '${type}' — add '${key}=<Azure type>' under [azure_issue_types] in devenv.config`,
  );
}

/** Map a devenv issue type onto the Azure work item type, then verify the
 * project actually offers that type — a create against a disabled type
 * (forks routinely disable User Story) fails server-side with a message
 * that never reaches the caller. Failing here names the mapped type and
 * the [azure_issue_types] key to adjust instead. */
export async function workItemTypeFor(type: string): Promise<string> {
  const mapped = mappedWorkItemType(type);
  const { base } = witBase();
  try {
    await azureHttp<{ value?: unknown[] }>(
      "GET",
      `${base}/_apis/wit/workitemtypes/${azureUri(mapped)}`,
    );
  } catch (err) {
    // The probe names one type; a failure there means the project does not
    // offer it (absent or disabled — the create would die server-side with
    // a message callers could not act on). Fail here with the remediation.
    const detail = errorMessage(err);
    throw new ProviderError(
      `work item type '${mapped}' (mapped from '${type || "untyped"}') is not available in this project (${detail}) — ` +
        `set '${type.toLowerCase() || "untyped"}=<enabled Azure type>' under [azure_issue_types] in devenv.config`,
    );
  }
  return mapped;
}

/** The first state of a work item type whose category matches (tried in
 * order, case-insensitive — Azure names Proposed/InProgress/Resolved/
 * Completed/Removed). */
async function stateByCategory(type: string, categories: string[]): Promise<string> {
  const { base, org, project } = witBase();
  const r = await azureHttp<{ value?: Array<{ name: string; category: string }> }>(
    "GET",
    `https://dev.azure.com/${azureUri(org)}/${azureUri(project)}/_apis/wit/workitemtypes/${azureUri(type)}/states`,
  );
  for (const cat of categories) {
    const hit = (r.value ?? []).find(
      (s) => (s.category ?? "").toLowerCase() === cat.toLowerCase(),
    );
    if (hit !== undefined) return hit.name;
  }
  throw new ProviderError(`type '${type}' has no state in category ${categories.join(", ")}`);
  void base;
}

/** All comments of a work item, following the continuation token. */
async function workItemCommentsAll(number: number): Promise<Array<Record<string, unknown>>> {
  const { base } = witBase();
  const out: Array<Record<string, unknown>> = [];
  let token = "";
  for (;;) {
    let url = `${base}/workitems/${number}/comments?$top=200&api-version=${AZURE_COMMENTS_API_VERSION}`;
    if (token !== "") url += `&continuationToken=${encodeURIComponent(token)}`;
    const r = await azureHttp<{ comments?: Array<Record<string, unknown>>; continuationToken?: string }>("GET", url);
    out.push(...(r.comments ?? []));
    token = r.continuationToken ?? "";
    if (token === "") break;
  }
  return out;
}

/** Project the raw REST comment shape into the seam record. The id is the
 * opaque comment ref (<issue>/<comment>) — the token the get/edit verbs
 * accept. Azure comment objects carry no html link (verified live): the web
 * URL is constructed. Bodies decode per the comment newline contract. */
function mapComment(web: string, c: Record<string, unknown>): {
  id: string;
  url: string;
  user: { login: string };
  body: string;
  created_at: string;
  updated_at: string;
} {
  const wi = String(c.workItemId ?? "");
  const cid = String(c.id ?? "");
  const body = typeof c.text === "string" ? c.text : "";
  const createdBy = c.createdBy as { displayName?: string } | undefined;
  return {
    id: `${wi}/${cid}`,
    url: `${web}${wi}?_a=comments`,
    user: { login: createdBy?.displayName ?? "unknown" },
    body: azureTextDecode(body.endsWith("\n") ? body.slice(0, -1) : body),
    created_at: String(c.createdDate ?? ""),
    updated_at: String(c.modifiedDate ?? c.createdDate ?? ""),
  };
}

/** Fetch one work-item comment as seam-shaped JSON. */
async function commentGetRaw(number: number, commentId: string): Promise<Record<string, unknown>> {
  const { base } = witBase();
  return azureHttp<Record<string, unknown>>(
    "GET",
    `${base}/workitems/${number}/comments/${commentId}?api-version=${AZURE_COMMENTS_API_VERSION}`,
  );
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export interface IssuesListOptions {
  state?: "open" | "closed" | "all";
  label?: string;
  type?: string;
  limit?: number;
  json?: string;
  jq?: string;
}

/** Fetch work items by id, 200 per request, in id-list order. */
async function workItemsBatch(base: string, ids: number[]): Promise<AzureWorkItem[]> {
  const pages: AzureWorkItem[][] = [];
  for (let offset = 0; offset < ids.length; offset += AZURE_BATCH_MAX) {
    const chunk = {
      ids: ids.slice(offset, offset + AZURE_BATCH_MAX),
      $expand: "fields,relations",
    };
    const r = await azureHttp<{ value?: AzureWorkItem[] }>("POST", `${base}/workitemsbatch`, {
      body: JSON.stringify(chunk),
      idempotent: true,
    });
    pages.push(r.value ?? []);
  }
  return pages.flat();
}

/** Project batch details to seam records with decoded bodies. */
function mapBatch(items: AzureWorkItem[], closed: ReadonlySet<string>): Array<Record<string, unknown>> {
  const web = webItemsBase();
  return items.map((item) => {
    const devenvType = seamTypeFor(item);
    // One bodyFieldFor resolution per item (each call costs up to three
    // config file scans — a batch of hundreds would multiply that).
    const bodyField = bodyFieldFor(devenvType);
    return {
      number: item.id ?? 0,
      type: devenvType,
      parent: seamParent(item),
      title: strField(item, "System.Title"),
      state: seamState(item, closed),
      labels: seamTags(item),
      body: decodeConfiguredBody(item, bodyField),
      markdown: (item.multilineFieldsFormat?.[bodyField] ?? "") === "markdown",
      url: `${web}${item.id ?? 0}`,
      comments: typeof field(item, "System.CommentCount") === "number" ? (field(item, "System.CommentCount") as number) : 0,
      createdAt: strField(item, "System.CreatedDate"),
      updatedAt: strField(item, "System.ChangedDate"),
      closedAt: strField(item, "Microsoft.VSTS.Common.ClosedDate"),
      author: {
        login:
          (field(item, "System.CreatedBy") as { displayName?: string } | undefined)
            ?.displayName ?? "unknown",
      },
      assignees: seamAssignees(item),
      milestone: seamMilestone(item),
    };
  });
}

/** List issues (work items) via WIQL. State filter maps open/closed/all onto
 * the state IN/NOT-IN clause; label is a tag CONTAINS; type maps through
 * workItemTypeFor. Milestone is a documented degrade (accepted, not
 * filterable — not offered here either). */
export async function issuesList(
  repo: string,
  opts: IssuesListOptions = {},
): Promise<Array<Record<string, unknown>> | string> {
  void repo; // work items are project-wide: the repo is not a filter
  const state = opts.state ?? "open";
  if (!["open", "closed", "all"].includes(state)) {
    throw new ProviderError(`--state must be open, closed or all, got '${state}'`);
  }
  if (opts.limit !== undefined && (!Number.isInteger(opts.limit) || opts.limit < 1)) {
    throw new ProviderError(`--limit must be a positive integer, got '${opts.limit}'`);
  }
  let type = "";
  if (opts.type !== undefined && opts.type !== "") type = await workItemTypeFor(opts.type);
  const closed = await closedStateNames();
  // WIQL single quotes are doubled per the WIQL escape rule: a label
  // containing a quote cannot break out of the literal.
  const wiqlStr = (v: string) => v.replaceAll("'", "''");
  const closedList = [...closed].map((n) => `'${wiqlStr(n)}'`).join(",");
  const clauses = ["[System.TeamProject] = @project"];
  if (state === "open") clauses.push(`[System.State] NOT IN (${closedList})`);
  if (state === "closed") clauses.push(`[System.State] IN (${closedList})`);
  if (opts.label !== undefined && opts.label !== "") {
    clauses.push(`[System.Tags] CONTAINS '${wiqlStr(opts.label)}'`);
  }
  if (type !== "") clauses.push(`[System.WorkItemType] = '${wiqlStr(type)}'`);
  const query = `SELECT [System.Id] FROM WorkItems WHERE ${clauses.join(" AND ")} ORDER BY [System.Id] DESC`;

  const { base } = witBase();
  const idsResponse = await azureHttp<{ workItems?: Array<{ id: number }> }>(
    "POST",
    `${base}/wiql`,
    { body: JSON.stringify({ query }), idempotent: true },
  );
  const limit = opts.limit ?? 200;
  const ids = (idsResponse.workItems ?? []).map((w) => w.id).slice(0, limit);
  if (ids.length === 0) {
    const empty: Array<Record<string, unknown>> = [];
    if (opts.json !== undefined || opts.jq !== undefined) {
      return renderListFlags(empty, opts);
    }
    return empty;
  }
  const details = await workItemsBatch(base, ids);
  const mapped = mapBatch(details, closed);
  if (opts.json !== undefined || opts.jq !== undefined) {
    return renderListFlags(mapped, opts);
  }
  return mapped;
}

/** Seam list-flag application for issues: --json projects per record
 * (unknown fields are named errors), -q applies .field / .[].field /
 * .[0].field. */
function renderListFlags(
  rows: Array<Record<string, unknown>>,
  opts: { json?: string; jq?: string },
): string {
  let out = rows;
  if (opts.json !== undefined) {
    const fields = opts.json.split(",").map((f) => f.trim());
    out = rows.map((rec) => {
      const proj: Record<string, unknown> = {};
      for (const f of fields) {
        if (!(f in rec)) throw new ProviderError(`unsupported --json field '${f}'`);
        proj[f] = rec[f] ?? null;
      }
      return proj;
    });
  }
  if (opts.jq !== undefined) {
    const each = /^\.\[\]\.([A-Za-z_][A-Za-z0-9_]*)$/.exec(opts.jq.trim());
    const idx = /^\.\[(\d+)\]\.([A-Za-z_][A-Za-z0-9_]*)$/.exec(opts.jq.trim());
    if (each?.[1] !== undefined) {
      return out
        .map((r) => {
          const v = r[each[1] as string];
          return v === undefined || v === null ? null : typeof v === "string" ? v : JSON.stringify(v);
        })
        .filter((v) => v !== null)
        .join("\n");
    }
    if (idx?.[1] !== undefined && idx[2] !== undefined) {
      const rec = out[Number(idx[1])];
      const v = rec?.[idx[2] as string];
      return v === undefined || v === null ? "" : typeof v === "string" ? v : JSON.stringify(v);
    }
    throw new ProviderError(
      `unsupported jq program '${opts.jq}' — azure issues list supports '.[N].field' and '.[].field'`,
    );
  }
  return JSON.stringify(out);
}

/** View a single issue as the full mapped record. comments carries the
 * comment COUNT (the seam's number form — github --json comments returns a
 * count): a work item with comments must not project an empty/missing value
 * there (downstream identity reads the field to decide "no discussion"), so
 * a failed count read fails the view rather than reading as zero. */
export async function issuesView(
  repo: string,
  number: number,
): Promise<Record<string, unknown>> {
  void repo;
  if (!Number.isFinite(number)) {
    throw new ProviderError("issues_view requires an issue number");
  }
  const { base } = witBase();
  const raw = await azureHttp<AzureWorkItem>(
    "GET",
    `${base}/workitems/${number}?$expand=relations`,
  );
  const record = mapItem(raw, await closedStateNames());
  let commentCount: number;
  try {
    const page = await azureHttp<{ comments?: unknown[] }>(
      "GET",
      `${base}/workitems/${number}/comments?$top=1&api-version=${AZURE_COMMENTS_API_VERSION}`,
    );
    const total = (page as { totalCount?: unknown }).totalCount;
    commentCount = typeof total === "number" ? total : (page.comments ?? []).length;
  } catch (err) {
    throw new ProviderError(`could not read the comments of work item ${number}: ${errorMessage(err)}`);
  }
  record["comments"] = commentCount;
  return record;
}

/** Whether a transport error means the work item is absent: HTTP 404, or
 * Azure's TF401232 work-item-not-found code. A wrong project or organization
 * ("the project does not exist"), auth, network and server failures do not
 * match: those are configuration or outage errors, not an absent item. */
function isNotFound(err: unknown): boolean {
  if (!(err instanceof ProviderError)) return false;
  if (/TF401232/.test(err.message)) return true;
  // A 404 that names a missing project or organization is a wrong scope.
  if (/TF200016|\b(project|organization)\b[^.]*does not exist/i.test(err.message)) return false;
  return err.status === 404;
}

/** Check an issue exists. Only a not-found answer is `false`; any other
 * failure (credential, network, server) is rethrown so a caller never reads
 * an outage as "absent". */
export async function issuesExists(repo: string, number: number): Promise<boolean> {
  void repo;
  const { base } = witBase();
  try {
    await azureHttp("GET", `${base}/workitems/${number}`);
    return true;
  } catch (err) {
    if (isNotFound(err)) return false;
    throw err;
  }
}

/** List issue comments as seam-shaped records. */
export async function issuesComments(
  repo: string,
  number: number,
): Promise<Array<{ id: string; url: string; user: { login: string }; body: string; created_at: string; updated_at: string }>> {
  void repo;
  const web = webItemsBase();
  const all = await workItemCommentsAll(number);
  return all.map((c) => mapComment(web, c));
}

/** Fetch one work-item comment as seam-shaped JSON ({id, url, body, ...}). */
export async function issuesCommentGet(
  repo: string,
  commentRef: string,
): Promise<Record<string, unknown>> {
  void repo;
  const { workItem, commentId } = splitCommentRef(commentRef);
  const web = webItemsBase();
  const raw = await commentGetRaw(Number(workItem), commentId);
  return mapComment(web, { ...raw, workItemId: workItem, id: commentId });
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

export interface IssuesCreateOptions {
  title: string;
  body?: string;
  labels?: string[];
  /** devenv issue type (maps through workItemTypeFor). */
  type?: string;
}

interface PatchOp {
  op: string;
  path: string;
  from?: null;
  value?: unknown;
}

/** Write verification: read back rev + System.ChangedDate after a PATCH and
 * confirm the server reflects the write (rev advanced past PRIOR_REV when
 * known, ChangedDate advanced). A successful mutation exit must imply
 * persistence, not just an accepted request. ChangedDate is compared as an
 * instant: its fraction digits vary in length, so a string comparison
 * misorders `…:45Z` and `…:45.5Z`. */
async function verifyWriteReflected(
  number: number,
  prior: { rev?: number | undefined; changedDate?: string | undefined } = {},
): Promise<void> {
  const { base } = witBase();
  const r = await azureHttp<AzureWorkItem>(
    "GET",
    `${base}/workitems/${number}?$fields=System.Rev,System.ChangedDate`,
  );
  const rev = typeof r.fields?.["System.Rev"] === "number" ? (r.fields["System.Rev"] as number) : 0;
  const changedDate = strField(r, "System.ChangedDate");
  const revOk = prior.rev === undefined ? rev > 0 : rev > prior.rev;
  const dateOk = prior.changedDate === undefined || prior.changedDate === "" ? changedDate !== "" : Date.parse(changedDate) > Date.parse(prior.changedDate);
  if (!revOk || !dateOk) {
    throw new ProviderError(
      `write to work item ${number} not reflected after PATCH ` +
        `(rev ${prior.rev ?? "?"}->${rev}, ChangedDate '${prior.changedDate ?? "?"}'->'${changedDate}')`,
    );
  }
}

/** Create a work item. Returns the new work item's id. */
export async function issuesCreate(
  repo: string,
  opts: IssuesCreateOptions,
): Promise<number> {
  void repo;
  if (opts.title === "") throw new ProviderError("issues_create requires --title");
  const witType = await workItemTypeFor(opts.type ?? "");
  const bodyField = bodyFieldFor(opts.type ?? "");
  const ops: PatchOp[] = [
    { op: "add", path: "/fields/System.Title", from: null, value: opts.title },
  ];
  if (opts.body !== undefined && opts.body !== "") {
    ops.push({
      op: "add",
      path: `/fields/${bodyField}`,
      from: null,
      value: azureTextNormalize(issuesArtifactBodyTransform(opts.body)),
    });
    ops.push({
      op: "add",
      path: `/multilineFieldsFormat/${bodyField}`,
      value: "markdown",
    });
  }
  if (opts.labels !== undefined && opts.labels.length > 0) {
    ops.push({
      op: "add",
      path: "/fields/System.Tags",
      from: null,
      value: azureTagsJoin(opts.labels.filter((l) => l !== "")),
    });
  }
  const { base } = witBase();
  // Work-item APIs require the JSON-Patch content type; the type rides the
  // URL path ($ prefixed, percent-encoded: "User Story").
  const r = await azureHttp<{ id?: number }>(
    "POST",
    `${base}/workitems/$${azureUri(witType)}`,
    { body: JSON.stringify(ops), contentType: "application/json-patch+json" },
  );
  const id = r.id ?? 0;
  if (id !== 0) {
    try {
      await verifyWriteReflected(id);
    } catch (err) {
      // The work item exists: never lose its id to a failed read-back, or a
      // retry creates a duplicate.
      logWarn(
        `work item ${id} was created but the write could not be verified (${errorMessage(err)}); ` +
          `do not retry the create`,
      );
    }
  }
  return id;
}

export interface IssuesCommentOptions {
  body?: string;
  bodyFile?: string;
  commentBody?: string;
}

/** Comment on an issue (work-item comment). Returns the composite ref. */
export async function issuesComment(
  repo: string,
  number: number,
  opts: IssuesCommentOptions,
): Promise<string> {
  void repo;
  // Exactly one body source, the same rule the GitHub comment verbs apply.
  const given = opts.body ?? opts.commentBody;
  if (given !== undefined && opts.bodyFile !== undefined) {
    throw new ProviderError("provider_issues_comment: --body and --body-file are mutually exclusive");
  }
  if (given === undefined && opts.bodyFile === undefined) {
    throw new ProviderError("provider_issues_comment requires --body");
  }
  let text = given ?? "";
  if (opts.bodyFile !== undefined) {
    const { readFileSync } = await import("node:fs");
    text = opts.bodyFile === "-" ? readFileSync(0, "utf8") : readFileSync(opts.bodyFile, "utf8");
  }
  if (text.trim() === "") {
    throw new ProviderError("provider_issues_comment: the comment body is empty");
  }
  const { base } = witBase();
  const r = await azureHttp<{ id?: number | string }>(
    "POST",
    `${base}/workitems/${number}/comments?format=markdown&api-version=${AZURE_COMMENTS_API_VERSION}`,
    {
      body: JSON.stringify({ text: azureTextNormalize(issuesArtifactBodyTransform(text)) }),
    },
  );
  return `${number}/${String(r.id ?? "")}`;
}

export interface IssuesCloseOptions {
  reason?: string;
  comment?: string;
}

/** Close a work item: state moves to the type's first Completed-category
 * state (a closed category, so the item then reads CLOSED). */
export async function issuesClose(
  repo: string,
  number: number,
  opts: IssuesCloseOptions = {},
): Promise<void> {
  void repo;
  void opts.reason;
  const type = await workItemType(number);
  const state = await stateByCategory(type, [CLOSED_CATEGORIES[0] as string]);
  await patchState(number, state);
  // After the state change: a failed change leaves no orphan comment, and a
  // retry does not duplicate one. A whitespace-only comment is no comment.
  if (opts.comment !== undefined && opts.comment.trim() !== "") {
    await issuesComment(repo, number, { body: opts.comment });
  }
}

/** Reopen: state moves to the type's first Proposed-category state. */
export async function issuesReopen(
  repo: string,
  number: number,
  opts: { comment?: string } = {},
): Promise<void> {
  void repo;
  const type = await workItemType(number);
  const state = await stateByCategory(type, ["Proposed", "InProgress"]);
  await patchState(number, state);
  if (opts.comment !== undefined && opts.comment.trim() !== "") {
    await issuesComment(repo, number, { body: opts.comment });
  }
}

export interface IssuesEditOptions {
  title?: string;
  body?: string;
  addLabel?: string;
  removeLabel?: string;
  /** The devenv issue type. It selects the body field the given body is
   * written to; this verb never changes the work item's own type (the facade
   * does that first), so a type without a body is refused. Absent, the item's
   * current type picks the field. */
  type?: string;
}

/** Edit a work item: title, body and labels travel in ONE JSON-patch, so a
 * failure leaves the item untouched rather than half edited. */
export async function issuesEdit(
  repo: string,
  number: number,
  opts: IssuesEditOptions,
): Promise<void> {
  void repo;
  if (opts.type !== undefined && opts.body === undefined) {
    throw new ProviderError(
      "--type on edit is not supported for provider 'azure': an edit never changes the work item type " +
        "(--type only selects the body field when a --body is given)",
    );
  }
  if (opts.addLabel === "") throw new ProviderError("issues_add_tag: work item id and tag required");
  // Azure itself splits a tag on ';', so a label holding one is the several
  // tags it spells; a label that spells none is refused.
  const addTags = opts.addLabel === undefined ? [] : azureTagsSplit(opts.addLabel);
  const removeTags = opts.removeLabel === undefined ? [] : azureTagsSplit(opts.removeLabel);
  if ((opts.addLabel !== undefined && addTags.length === 0) || (opts.removeLabel !== undefined && removeTags.length === 0)) {
    throw new ProviderError("issues edit: a label must contain at least one non-empty tag (';' separates tags)");
  }
  const labelsGiven = opts.addLabel !== undefined || opts.removeLabel !== undefined;
  if (opts.title === undefined && opts.body === undefined && !labelsGiven) return;

  const { base } = witBase();
  // One read serves the write verification baseline, the item's current
  // type (its body field) and its current tags.
  const prior = await azureHttp<AzureWorkItem>(
    "GET",
    `${base}/workitems/${number}?$fields=System.Rev,System.ChangedDate,System.WorkItemType,System.Tags`,
  );
  const priorRev = revOf(prior);
  const priorDate = strField(prior, "System.ChangedDate");

  const ops: PatchOp[] = [];
  if (labelsGiven) ops.push(...tagOps(azureTagsSplit(strField(prior, "System.Tags")), addTags, removeTags));
  if (opts.title !== undefined) {
    ops.push({ op: "add", path: "/fields/System.Title", from: null, value: opts.title });
  }
  if (opts.body !== undefined) {
    const bodyField = bodyFieldFor(opts.type ?? seamTypeFor(prior));
    ops.push({
      op: "add",
      path: `/fields/${bodyField}`,
      from: null,
      value: azureTextNormalize(issuesArtifactBodyTransform(opts.body)),
    });
    ops.push({
      op: "add",
      path: `/multilineFieldsFormat/${bodyField}`,
      value: "markdown",
    });
  }
  if (ops.length === 0) return;
  // The whole edit is conditional on the revision the tags were read at: a
  // concurrent change fails the PATCH instead of being silently overwritten.
  const guard: PatchOp[] = priorRev === undefined ? [] : [{ op: "test", path: "/rev", value: priorRev }];
  await patchRevGuarded(`${base}/workitems/${number}`, [...guard, ...ops], guard.length > 0, number);
  await verifyWriteReflected(number, { rev: priorRev, changedDate: priorDate });
}

/** The revision a work item answer carries: the System.Rev field, else the
 * top-level rev. */
function revOf(item: AzureWorkItem): number | undefined {
  const nested = item.fields?.["System.Rev"];
  if (typeof nested === "number") return nested;
  return typeof item.rev === "number" ? item.rev : undefined;
}

/** The JSON-patch op that turns `existing` into the tag set after adding and
 * removing (none when nothing changes). Azure tags are case-insensitive: add
 * skips a tag present in any case, remove drops the stored tag whatever the
 * case of the request. 'add' on System.Tags appends and can never remove, so
 * a change to an existing set is a 'replace', and an emptied set drops the
 * field. */
function tagOps(existing: string[], addTags: string[], removeTags: string[]): PatchOp[] {
  let final = existing;
  for (const tag of addTags) {
    if (!final.some((t) => t.toLowerCase() === tag.toLowerCase())) final = [...final, tag];
  }
  const drop = new Set(removeTags.map((t) => t.toLowerCase()));
  final = final.filter((t) => !drop.has(t.toLowerCase()));
  if (final.join(";") === existing.join(";")) return [];
  return [
    final.length === 0
      ? { op: "remove", path: "/fields/System.Tags" }
      : existing.length === 0
        ? { op: "add", path: "/fields/System.Tags", from: null, value: azureTagsJoin(final) }
        : { op: "replace", path: "/fields/System.Tags", value: azureTagsJoin(final) },
  ];
}

/** Read a work item's tags and revision, apply an add/remove, and PATCH the
 * change guarded by the revision it was read at (no PATCH when nothing
 * changes). */
async function editTags(number: number, addTags: string[], removeTags: string[]): Promise<void> {
  const { base } = witBase();
  const view = await azureHttp<AzureWorkItem>(
    "GET",
    `${base}/workitems/${number}?$fields=System.Rev,System.Tags`,
  );
  const ops = tagOps(azureTagsSplit(strField(view, "System.Tags")), addTags, removeTags);
  if (ops.length === 0) return;
  const rev = revOf(view);
  const guard: PatchOp[] = rev === undefined ? [] : [{ op: "test", path: "/rev", value: rev }];
  await patchRevGuarded(`${base}/workitems/${number}`, [...guard, ...ops], guard.length > 0, number);
}

/** Whether a failed revision-guarded PATCH was the guard refusing: the
 * precondition statuses, or a 400 whose text names the failed test operation. */
function isRevConflict(err: unknown): boolean {
  if (!(err instanceof ProviderError)) return false;
  if (err.status === 409 || err.status === 412) return true;
  // Only a message naming the failed test operation (on /rev) counts: other
  // 400s mention "revision" or "modified" for unrelated rule failures.
  return err.status === 400 && /\btest\W+operation\b|\boperation\W+test\b|\btest\b.*\/rev\b|\/rev\b.*\btest\b/i.test(err.message);
}

/** PATCH a work item; when the ops lead with a revision guard, a refusal by
 * the guard is a named concurrent-modification error and is never retried. */
async function patchRevGuarded(url: string, ops: PatchOp[], guarded: boolean, number: number): Promise<void> {
  try {
    await azureHttp("PATCH", url, {
      body: JSON.stringify(ops),
      contentType: "application/json-patch+json",
    });
  } catch (err) {
    if (guarded && isRevConflict(err)) {
      throw new ProviderError(
        `work item ${number} was modified concurrently (concurrent modification: its revision changed since it was read); ` +
          `re-read it and repeat the change: ${errorMessage(err)}`,
        (err as ProviderError).status,
      );
    }
    throw err;
  }
}

/** The work item's own type (System.WorkItemType). */
async function workItemType(number: number): Promise<string> {
  const { base } = witBase();
  const r = await azureHttp<AzureWorkItem>(
    "GET",
    `${base}/workitems/${number}?$fields=System.WorkItemType`,
  );
  const t = strField(r, "System.WorkItemType");
  if (t === "") throw new ProviderError(`work item ${number} has no readable type`);
  return t;
}

/** Patch the state field (the shared close/reopen path). */
async function patchState(number: number, state: string): Promise<void> {
  const { base } = witBase();
  await azureHttp("PATCH", `${base}/workitems/${number}`, {
    body: JSON.stringify([{ op: "add", path: "/fields/System.State", from: null, value: state }]),
    contentType: "application/json-patch+json",
  });
}

/** Set a work item's type. */
export async function issuesSetType(
  repo: string,
  number: number,
  typeName: string,
): Promise<void> {
  void repo;
  if (number === undefined || typeName === "") {
    throw new ProviderError("issues_set_type: number and type required");
  }
  const witType = await workItemTypeFor(typeName);
  const { base } = witBase();
  await azureHttp("PATCH", `${base}/workitems/${number}`, {
    body: JSON.stringify([{ op: "replace", path: "/fields/System.WorkItemType", value: witType }]),
    contentType: "application/json-patch+json",
  });
}

// ---------------------------------------------------------------------------
// Labels (Azure tags) + add_tag (azure-only)
// ---------------------------------------------------------------------------

/** Add a tag to the mapped work item. Azure tags are work-item-scoped flat
 * strings — color/description are accepted and ignored. Idempotent, and the
 * same case-insensitive, ';'-splitting, revision-guarded edit as issuesEdit. */
export async function issuesAddTag(number: number, tag: string): Promise<void> {
  if (number === undefined || tag === "") {
    throw new ProviderError("issues_add_tag: work item id and tag required");
  }
  const tags = azureTagsSplit(tag);
  if (tags.length === 0) {
    throw new ProviderError("issues_add_tag: a tag must contain at least one non-empty name (';' separates tags)");
  }
  await editTags(number, tags, []);
}

/** Remove a tag from the mapped work item. Idempotent; the same semantics as
 * issuesEdit (see tagOps for how Azure's tag field is written). */
export async function issuesRemoveTag(number: number, tag: string): Promise<void> {
  const tags = azureTagsSplit(tag);
  if (tags.length === 0) {
    throw new ProviderError("issues_remove_tag: a tag must contain at least one non-empty name (';' separates tags)");
  }
  await editTags(number, [], tags);
}

export interface IssuesLabelListOptions {
  limit?: number;
  json?: string;
  jq?: string;
}

/** The project's tag names as [{name}] — from the tags API when available,
 * else harvested from up to 500 work items (the bash fallback). */
async function labelNames(): Promise<Array<{ name: string }>> {
  const { base } = witBase();
  try {
    const r = await azureHttp<{ value?: Array<{ name: string }> }>("GET", `${base}/tags`);
    if (Array.isArray(r.value)) {
      return [...new Set(r.value.map((t) => t.name.trim()).filter((n) => n !== ""))].map(
        (name) => ({ name }),
      );
    }
  } catch {
    // fall through to the WIQL harvest
  }
  const wiql = { query: "SELECT [System.Id] FROM WorkItems WHERE [System.TeamProject] = @project" };
  const idsResponse = await azureHttp<{ workItems?: Array<{ id: number }> }>("POST", `${base}/wiql`, {
    body: JSON.stringify(wiql),
    idempotent: true,
  });
  const ids = (idsResponse.workItems ?? []).map((w) => w.id).slice(0, 500);
  if (ids.length === 0) return [];
  const details = await workItemsBatch(base, ids);
  const names = new Set<string>();
  for (const item of details) for (const t of azureTagsSplit(strField(item, "System.Tags"))) names.add(t);
  return [...names].map((name) => ({ name }));
}

/** List the project's tags as seam label records. */
export async function issuesLabelList(
  repo: string,
  opts: IssuesLabelListOptions = {},
): Promise<string> {
  void repo;
  let labels = await labelNames();
  if (opts.limit !== undefined) labels = labels.slice(0, opts.limit);
  const withEmpty = labels.map((l) => ({ ...l, description: "", color: "" }));
  return renderListFlags(withEmpty, opts);
}

/** Ensure a tag exists: azure tags materialize on first use — a no-op that
 * always succeeds for interface parity. */
export async function issuesLabelEnsure(): Promise<void> {}

/** Create a label = tag the given work item (azure tags live on items). */
export async function issuesLabelCreate(
  repo: string,
  name: string,
  opts: { color?: string; description?: string; issue?: number } = {},
): Promise<void> {
  void repo;
  void opts.color;
  void opts.description;
  if (opts.issue === undefined) {
    throw new ProviderError("issues_label_create: azure tags live on work items — pass issue");
  }
  await issuesAddTag(opts.issue, name);
}

/** Update a label: azure tags are immutable flat strings — a documented
 * no-op. */
export async function issuesLabelUpdate(): Promise<void> {}

/** Milestones: Azure iterations are config-mapped and informational — the
 * list is intentionally empty (documented degrade). */
export async function issuesMilestones(
  repo: string,
  opts: { jq?: string } = {},
): Promise<string> {
  void repo;
  return renderListFlags([], opts);
}

// ---------------------------------------------------------------------------
// Sub-issue graph (work-item relations)
// ---------------------------------------------------------------------------

/** Link a child work item under a parent (Hierarchy-Forward). Idempotent: a
 * duplicate relation is a store conflict, judged done only when the parent
 * really lists the child. */
export async function issueGraphLink(
  repo: string,
  parent: number,
  child: number,
): Promise<void> {
  void repo;
  const { base, org, project } = witBase();
  const relUrl = `https://dev.azure.com/${azureUri(org)}/${azureUri(project)}/_apis/wit/workItems/${child}`;
  const body = [
    {
      op: "add",
      path: "/relations/-",
      value: { rel: "System.LinkTypes.Hierarchy-Forward", url: relUrl },
    },
  ];
  try {
    await azureHttp("PATCH", `${base}/workitems/${parent}`, {
      body: JSON.stringify(body),
      contentType: "application/json-patch+json",
    });
  } catch (err) {
    // A duplicate relation is a store conflict: success only when the parent
    // really lists the child. Any other cause, and a confirmation read that
    // itself fails, surface the original error.
    let linked = false;
    try {
      linked = (await issueGraphChildren(repo, parent)).includes(child);
    } catch {
      linked = false;
    }
    if (linked) return;
    throw err;
  }
}

/** The leading JSON-patch op that makes a relation-index write conditional on
 * the revision the index was read at: a concurrent relation change fails the
 * PATCH instead of removing a different relation. Empty when the read carried
 * no revision. */
function revGuard(item: AzureWorkItem): PatchOp[] {
  const rev = item.rev ?? (typeof item.fields?.["System.Rev"] === "number" ? (item.fields["System.Rev"] as number) : undefined);
  return rev === undefined ? [] : [{ op: "test", path: "/rev", value: rev }];
}

/** Remove the child relation from a parent. */
export async function issueGraphUnlink(
  repo: string,
  parent: number,
  child: number,
): Promise<void> {
  void repo;
  const { base } = witBase();
  const item = await azureHttp<AzureWorkItem>(
    "GET",
    `${base}/workitems/${parent}?$expand=relations`,
  );
  const relations = item.relations ?? [];
  const childUrlSuffix = `/_apis/wit/workItems/${child}`;
  const index = relations.findIndex(
    (r) =>
      r.rel === "System.LinkTypes.Hierarchy-Forward" &&
      (r.url ?? "").endsWith(childUrlSuffix),
  );
  if (index === -1) return; // not linked — idempotent
  const guard = revGuard(item);
  await patchRevGuarded(`${base}/workitems/${parent}`, [...guard, { op: "remove", path: `/relations/${index}` }], guard.length > 0, parent);
}

/** Children of a work item (Hierarchy-Forward relations), as ids. */
export async function issueGraphChildren(
  repo: string,
  parent: number,
): Promise<number[]> {
  void repo;
  const { base } = witBase();
  const item = await azureHttp<AzureWorkItem>(
    "GET",
    `${base}/workitems/${parent}?$expand=relations`,
  );
  return (item.relations ?? [])
    .filter((r) => r.rel === "System.LinkTypes.Hierarchy-Forward")
    .map((r) => Number((r.url ?? "").split("/").pop()))
    .filter((n) => Number.isFinite(n));
}

/** The parent of a work item (the Hierarchy-Reverse relation), as an id, or
 * null. */
export async function issueGraphParent(
  repo: string,
  child: number,
): Promise<number | null> {
  void repo;
  const { base } = witBase();
  const item = await azureHttp<AzureWorkItem>(
    "GET",
    `${base}/workitems/${child}?$expand=relations`,
  );
  const rel = (item.relations ?? []).find(
    (r) => r.rel === "System.LinkTypes.Hierarchy-Reverse",
  );
  if (rel === undefined) return null;
  const n = Number((rel.url ?? "").split("/").pop());
  return Number.isFinite(n) ? n : null;
}

// ---------------------------------------------------------------------------
// Dependency links (blocked-by = predecessor/successor, NOT the hierarchy)
// ---------------------------------------------------------------------------

/** Azure's relation type for "ISSUE is blocked by BLOCKER": ISSUE carries a
 * Dependency-Forward link pointing at BLOCKER (predecessor). */
const DEPENDENCY_FORWARD = "System.LinkTypes.Dependency-Forward";

function dependencyUrl(org: string, project: string, blocker: number): string {
  return `https://dev.azure.com/${azureUri(org)}/${azureUri(project)}/_apis/wit/workItems/${blocker}`;
}

function azureWitBase(): { base: string; org: string; project: string } {
  return witBase();
}

/** Whether ISSUE holds a blocked-by link to BLOCKER; null when the read fails. */
async function dependencyHeld(issue: number, blocker: number): Promise<boolean | null> {
  try {
    const { base } = azureWitBase();
    const item = await azureHttp<AzureWorkItem>("GET", `${base}/workitems/${issue}?$expand=relations`);
    const suffix = `/_apis/wit/workItems/${blocker}`;
    return (item.relations ?? []).some((r) => r.rel === DEPENDENCY_FORWARD && (r.url ?? "").endsWith(suffix));
  } catch {
    return null;
  }
}

/** Record ISSUE as blocked by BLOCKER (Dependency-Forward relation).
 * Idempotent: an existing identical link is a no-op success, including one
 * that appeared between the read and the write (a refused add is judged done
 * only when the item really holds the link). */
export async function issueDependencyLink(
  repo: string,
  issue: number,
  blocker: number,
): Promise<void> {
  void repo;
  const { base, org, project } = azureWitBase();
  const item = await azureHttp<AzureWorkItem>(
    "GET",
    `${base}/workitems/${issue}?$expand=relations`,
  );
  const suffix = `/_apis/wit/workItems/${blocker}`;
  const exists = (item.relations ?? []).some(
    (r) => r.rel === DEPENDENCY_FORWARD && (r.url ?? "").endsWith(suffix),
  );
  if (exists) return; // idempotent add
  try {
    // An append does not depend on the relation index, so it needs no revision
    // guard; patchRevGuarded still gives it the shared failure mapping.
    await patchRevGuarded(
      `${base}/workitems/${issue}`,
      [
        {
          op: "add",
          path: "/relations/-",
          value: {
            rel: DEPENDENCY_FORWARD,
            url: dependencyUrl(org, project, blocker),
          },
        },
      ],
      false,
      issue,
    );
  } catch (err) {
    if ((await dependencyHeld(issue, blocker)) === true) return;
    throw err;
  }
}

/** Remove ISSUE's blocked-by link to BLOCKER. Removing an absent link is a
 * no-op success. The removal addresses the relation by index, so it is
 * conditional on the revision the index was read at; a refused removal is
 * judged done only when the link is really gone. */
export async function issueDependencyUnlink(
  repo: string,
  issue: number,
  blocker: number,
): Promise<void> {
  void repo;
  const { base } = azureWitBase();
  const item = await azureHttp<AzureWorkItem>(
    "GET",
    `${base}/workitems/${issue}?$expand=relations`,
  );
  const suffix = `/_apis/wit/workItems/${blocker}`;
  const index = (item.relations ?? []).findIndex(
    (r) => r.rel === DEPENDENCY_FORWARD && (r.url ?? "").endsWith(suffix),
  );
  if (index === -1) return; // absent = no-op
  const guard = revGuard(item);
  try {
    await patchRevGuarded(
      `${base}/workitems/${issue}`,
      [...guard, { op: "remove", path: `/relations/${index}` }],
      guard.length > 0,
      issue,
    );
  } catch (err) {
    if ((await dependencyHeld(issue, blocker)) === false) return;
    throw err;
  }
}

// keep the strict-option helpers referenced (github module parity).
void needValue;
void unknownOption;
