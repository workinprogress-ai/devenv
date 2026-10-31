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

import { ProviderError, providerConfigPath, unknownOption, needValue } from "../provider-core.ts";
import { configGetRaw } from "../../core/config.ts";
import { azureHttp } from "./http.ts";
import { azureOrgProject, azureUri } from "./urls.ts";

/** Work-item comments are a preview resource: the API rejects stable 7.1 and
 * requires a pinned -preview api-version. 7.2-preview.4 is required for the
 * comment `format` attribute (?format=markdown as a QUERY parameter — a body
 * format field is silently ignored). */
const AZURE_COMMENTS_API_VERSION = "7.2-preview.4";
/** workitemsbatch accepts at most 200 ids per request. */
const AZURE_BATCH_MAX = 200;

// ---------------------------------------------------------------------------
// URL builders
// ---------------------------------------------------------------------------

/** Project-scoped WIQL API base for the configured org/project. */
function witBase(): { base: string; org: string; project: string } {
  const { org, project } = azureOrgProject();
  return {
    base: `https://dev.azure.com/${azureUri(org)}/${azureUri(project)}/_apis/wit`,
    org,
    project,
  };
}

/** Web UI base for a work item's page (comments anchor included by callers). */
function webItemsBase(): string {
  const { org, project } = azureOrgProject();
  return `https://dev.azure.com/${azureUri(org)}/${azureUri(project)}/_workitems/edit/`;
}

// ---------------------------------------------------------------------------
// Text round-trip (entity decode / newline pairing)
// ---------------------------------------------------------------------------

const ENTITY_SET: Array<[RegExp, string]> = [
  [/&quot;/g, '"'],
  [/&apos;/g, "'"],
  [/&#39;/g, "'"],
  [/&lt;/g, "<"],
  [/&gt;/g, ">"],
  // &amp; decodes LAST so &quot; never double-decodes to &.
  [/&amp;/g, "&"],
];

/** Un-escape the entity set Azure actually emits (azure_text_decode parity). */
export function azureTextDecode(text: string): string {
  let out = text;
  for (const [re, to] of ENTITY_SET) out = out.replace(re, to);
  return out;
}

/** Normalize text for storage: drop ONE trailing newline (the store re-adds
 * it), keeping interior formatting untouched. Pairs with the read-side trim. */
export function azureTextNormalize(text: string): string {
  return text.endsWith("\n") ? text.slice(0, -1) : text;
}

// ---------------------------------------------------------------------------
// Tags
// ---------------------------------------------------------------------------

/** System.Tags is one string, "a; b" as Azure returns it. Split into trimmed,
 * non-empty tags. */
export function azureTagsSplit(s: string): string[] {
  return s
    .split(";")
    .map((t) => t.trim())
    .filter((t) => t !== "");
}

/** Join tags the way the store expects: "; ". */
export function azureTagsJoin(tags: string[]): string {
  return tags.join("; ");
}

// ---------------------------------------------------------------------------
// Field mapping
// ---------------------------------------------------------------------------

/** Raw Azure work-item shape (the fields we consume). */
interface AzureWorkItem {
  id?: number;
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

/** The seam state projection: CLOSED for Closed/Removed/Done, else OPEN. */
function seamState(item: AzureWorkItem): "OPEN" | "CLOSED" {
  const s = strField(item, "System.State");
  return s === "Closed" || s === "Removed" || s === "Done" ? "CLOSED" : "OPEN";
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
 * candidate (System.Description) so pre-config items stay wrapper-readable
 * (e.g. #101791's body lives in Description while its Bug form shows
 * ReproSteps). */
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

function mapItem(item: AzureWorkItem, comments?: Array<{ id: string; url: string; body: string; created_at: string; updated_at: string }>): Record<string, unknown> {
  const number = item.id ?? 0;
  const devenvType = seamTypeFor(item);
  return {
    number,
    type: devenvType,
    parent: seamParent(item),
    title: strField(item, "System.Title"),
    state: seamState(item),
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

/** A devenv.config value from an arbitrary section; "" when absent. (The
 * bash seam's azure_config_get parity — section-scoped, not [provider].) */
function issueTypesConfig(key: string): string {
  return configGetRaw(providerConfigPath(), "azure_issue_types", key) ?? "";
}

/** The Azure field the issue BODY is written to and read from for a devenv
 * issue type ([azure_body_fields] override, key = devenv type; absent key
 * defaults to System.Description). The field choice is an org/process fact —
 * different Azure processes put the working body in different fields (the
 * Bug form often displays ReproSteps and can hide Description) — so it is
 * config, not wrapper code. One authoritative field per type avoids the
 * dual-write read-ambiguity. */
const DEFAULT_BODY_FIELD = "System.Description";

export function bodyFieldFor(type: string): string {
  if (type === "") return DEFAULT_BODY_FIELD;
  const section = providerConfigPath();
  // Config keys are case-sensitive: try the canonical devenv type first
  // (Bug), then the lowercase form users commonly write (bug).
  for (const key of [
    type,
    type.toLowerCase(),
    type.charAt(0).toUpperCase() + type.slice(1).toLowerCase(),
  ]) {
    const raw = configGetRaw(section, "azure_body_fields", key) ?? "";
    if (raw !== "") return raw;
  }
  return DEFAULT_BODY_FIELD;
}

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
    const detail = err instanceof Error ? err.message : String(err);
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

/** Split an opaque comment ref into work item + comment id. A bare number is
 * rejected with guidance so callers never guess scope. */
export function splitCommentRef(ref: string): { workItem: string; commentId: string } {
  if (ref === "" || /[^0-9/]/.test(ref) || ref.split("/").length !== 2) {
    throw new ProviderError(
      `azure comment ref '${ref}' is malformed — take the id from issue-comment-list output`,
    );
  }
  const [workItem, commentId] = ref.split("/");
  return { workItem: workItem as string, commentId: commentId as string };
}

/** Fetch one work-item comment as seam-shaped JSON. */
async function commentGetRaw(number: number, commentId: string): Promise<Record<string, unknown>> {
  const { base } = witBase();
  return azureHttp<Record<string, unknown>>(
    "GET",
    `${base}/workitems/${number}/comments/${commentId}?api-version=${AZURE_COMMENTS_API_VERSION}`,
  );
}

/** Artifact-marker survival transform (azure_marker_transform parity):
 * Azure strips HTML comments from markdown at write time, so a doc_id inside
 * the DEVENV_ARTIFACT_V1 comment header never reaches storage. Emit the
 * doc_id as a bare first line and drop the comment blocks ADO drops anyway
 * (everything from <!-- to -->, content between included — the bash awk
 * toggles a flag on the fence lines and skips in-between). Idempotent: a
 * body whose doc_id already survives outside comments passes through. */
export function azureMarkerTransform(body: string): string {
  const m = /^[ \t]*doc_id:[ \t]*(\S+)[ \t]*$/m.exec(body);
  if (m === null) return body;
  const docId = m[1] as string;
  let inComment = false;
  const stripped = body
    .split("\n")
    .filter((line) => {
      if (inComment) {
        if (line.startsWith("-->")) inComment = false;
        return false;
      }
      if (line.startsWith("<!--")) {
        inComment = true;
        return false;
      }
      return true;
    })
    .join("\n");
  const bareRe = new RegExp(`^[ \\t]*doc_id:[ \\t]*${docId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[ \\t]*$`, "m");
  if (bareRe.test(stripped)) return body;
  return `doc_id: ${docId}\n${stripped}`;
}

/** Upsert-hook shape: issue-artifact-upsert calls this around its doc_id
 * search so the marker it needs survives Azure storage. */
export function issuesArtifactBodyTransform(body: string): string {
  return azureMarkerTransform(body);
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
function mapBatch(items: AzureWorkItem[]): Array<Record<string, unknown>> {
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
      state: seamState(item),
      labels: seamTags(item),
      body: decodeConfiguredBody(item, bodyField),
      markdown: (item.multilineFieldsFormat?.[bodyField] ?? "") === "markdown",
      url: item.url ?? "",
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
  let type = "";
  if (opts.type !== undefined && opts.type !== "") type = await workItemTypeFor(opts.type);
  const stateFilter =
    state === "open"
      ? "AND [System.State] NOT IN ('Closed','Removed','Done')"
      : state === "closed"
        ? "AND [System.State] IN ('Closed','Removed','Done')"
        : "";
  // WIQL single quotes are doubled per the WIQL escape rule: a label
  // containing a quote cannot break out of the literal.
  const wiqlStr = (v: string) => v.replaceAll("'", "''");
  let query =
    "SELECT [System.Id] FROM WorkItems WHERE [System.TeamProject] = @project " +
    stateFilter;
  if (opts.label !== undefined && opts.label !== "") {
    query += `AND [System.Tags] CONTAINS '${wiqlStr(opts.label)}'`;
  }
  if (type !== "") {
    query += `AND [System.WorkItemType] = '${wiqlStr(type)}'`;
  }
  query += " ORDER BY [System.Id] DESC";

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
  const mapped = mapBatch(details);
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

/** View a single issue as the full mapped record. */
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
  return mapItem(raw);
}

/** Check an issue exists (presence test). */
export async function issuesExists(repo: string, number: number): Promise<boolean> {
  void repo;
  try {
    const { base } = witBase();
    await azureHttp("GET", `${base}/workitems/${number}`);
    return true;
  } catch {
    return false;
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
  value: unknown;
}

/** Write verification (15.22b): read back rev + System.ChangedDate after a
 * PATCH and confirm the server reflects the write (rev advanced past
 * PRIOR_REV when known, ChangedDate advanced). A successful mutation exit
 * must imply persistence, not just an accepted request — the accepted-
 * request-but-not-displayed class (#101791) surfaces as a named warning. */
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
  const dateOk = prior.changedDate === undefined || prior.changedDate === "" ? changedDate !== "" : changedDate > prior.changedDate;
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
  if (id !== 0) await verifyWriteReflected(id);
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
  // --body-file posts the FILE's CONTENT (F8: it was ignored entirely and
  // the comment posted empty).
  let text = opts.body ?? opts.commentBody ?? "";
  if (text === "" && opts.bodyFile !== undefined) {
    const { readFileSync } = await import("node:fs");
    text = opts.bodyFile === "-" ? readFileSync(0, "utf8") : readFileSync(opts.bodyFile, "utf8");
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
 * state. */
export async function issuesClose(
  repo: string,
  number: number,
  opts: IssuesCloseOptions = {},
): Promise<void> {
  void repo;
  void opts.reason;
  if (opts.comment !== undefined && opts.comment !== "") {
    await issuesComment(repo, number, { body: opts.comment });
  }
  const type = await workItemType(number);
  const state = await stateByCategory(type, ["Completed", "Resolved", "Done"]);
  await patchState(number, state);
}

/** Reopen: state moves to the type's first Proposed-category state. */
export async function issuesReopen(
  repo: string,
  number: number,
  opts: { comment?: string } = {},
): Promise<void> {
  void repo;
  if (opts.comment !== undefined && opts.comment !== "") {
    await issuesComment(repo, number, { body: opts.comment });
  }
  const type = await workItemType(number);
  const state = await stateByCategory(type, ["Proposed", "InProgress"]);
  await patchState(number, state);
}

export interface IssuesEditOptions {
  title?: string;
  body?: string;
  addLabel?: string;
  removeLabel?: string;
  /** The devenv issue type (resolves the [azure_body_fields] body field).
   * Absent/empty falls back to System.Description. */
  type?: string;
}

/** Edit a work item: title/body/labels. */
export async function issuesEdit(
  repo: string,
  number: number,
  opts: IssuesEditOptions,
): Promise<void> {
  void repo;
  const bodyField = bodyFieldFor(opts.type ?? "");
  const ops: PatchOp[] = [];
  if (opts.title !== undefined) {
    ops.push({ op: "add", path: "/fields/System.Title", from: null, value: opts.title });
  }
  if (opts.body !== undefined) {
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
  if (opts.addLabel !== undefined) {
    await issuesAddTag(number, opts.addLabel);
  }
  if (opts.removeLabel !== undefined) {
    await issuesRemoveTag(number, opts.removeLabel);
  }
  if (ops.length === 0) return;
  const { base } = witBase();
  // Prior rev/ChangedDate for the write-verification readback.
  const prior = await azureHttp<AzureWorkItem>(
    "GET",
    `${base}/workitems/${number}?$fields=System.Rev,System.ChangedDate`,
  );
  const priorRev = typeof prior.fields?.["System.Rev"] === "number" ? (prior.fields["System.Rev"] as number) : undefined;
  const priorDate = strField(prior, "System.ChangedDate");
  await azureHttp("PATCH", `${base}/workitems/${number}`, {
    body: JSON.stringify(ops),
    contentType: "application/json-patch+json",
  });
  await verifyWriteReflected(number, { rev: priorRev, changedDate: priorDate });
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
 * strings — color/description are accepted and ignored. Idempotent. */
export async function issuesAddTag(number: number, tag: string): Promise<void> {
  if (number === undefined || tag === "") {
    throw new ProviderError("issues_add_tag: work item id and tag required");
  }
  const { base } = witBase();
  const view = await azureHttp<AzureWorkItem>(
    "GET",
    `${base}/workitems/${number}?$fields=System.Tags`,
  );
  const existing = azureTagsSplit(strField(view, "System.Tags"));
  if (existing.includes(tag)) return; // already tagged — idempotent no-op
  const joined = azureTagsJoin([...existing, tag]);
  await azureHttp("PATCH", `${base}/workitems/${number}`, {
    body: JSON.stringify([{ op: "add", path: "/fields/System.Tags", from: null, value: joined }]),
    contentType: "application/json-patch+json",
  });
}

/** Remove a tag from the mapped work item. Idempotent. Azure semantics
 * (live-verified): an 'add' op on System.Tags APPENDS — it can never remove.
 * Removal writes the surviving tags with a 'replace' op, or drops the field
 * entirely (op 'remove') when no tags remain. */
export async function issuesRemoveTag(number: number, tag: string): Promise<void> {
  const { base } = witBase();
  const view = await azureHttp<AzureWorkItem>(
    "GET",
    `${base}/workitems/${number}?$fields=System.Tags`,
  );
  const existing = azureTagsSplit(strField(view, "System.Tags"));
  if (!existing.includes(tag)) return;
  const final = existing.filter((t) => t !== tag);
  const op =
    final.length === 0
      ? { op: "remove", path: "/fields/System.Tags" }
      : { op: "replace", path: "/fields/System.Tags", value: azureTagsJoin(final) };
  await azureHttp("PATCH", `${base}/workitems/${number}`, {
    body: JSON.stringify([op]),
    contentType: "application/json-patch+json",
  });
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
  } catch {
    const children = await issueGraphChildren(repo, parent);
    if (children.includes(child)) return; // already linked
    throw new ProviderError(`failed linking ${child} under ${parent}`);
  }
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
  await azureHttp("PATCH", `${base}/workitems/${parent}`, {
    body: JSON.stringify([
      { op: "remove", path: `/relations/${index}` },
    ]),
    contentType: "application/json-patch+json",
  });
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

/** Record ISSUE as blocked by BLOCKER (Dependency-Forward relation).
 * Idempotent: an existing identical link is a no-op success. */
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
  await azureHttp("PATCH", `${base}/workitems/${issue}`, {
    body: JSON.stringify([
      {
        op: "add",
        path: "/relations/-",
        value: {
          rel: DEPENDENCY_FORWARD,
          url: dependencyUrl(org, project, blocker),
        },
      },
    ]),
    contentType: "application/json-patch+json",
  });
}

/** Remove ISSUE's blocked-by link to BLOCKER. Removing an absent link is a
 * no-op success. */
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
  await azureHttp("PATCH", `${base}/workitems/${issue}`, {
    body: JSON.stringify([{ op: "remove", path: `/relations/${index}` }]),
    contentType: "application/json-patch+json",
  });
}

// keep the strict-option helpers referenced (github module parity).
void needValue;
void unknownOption;
