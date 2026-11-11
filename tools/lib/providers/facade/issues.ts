// providers/facade/issues.ts — the provider-neutral issues family.
//
// The only import surface tools use for issue verbs. Every verb is
// provider-neutral: the facade resolves the active provider via the loader
// and normalizes the verbs whose provider shapes diverge. Divergences owned
// here (never visible to tools):
//   - blocked-by: GitHub's body-section link takes the blocker LIST, Azure's
//     dependency links are per-blocker — blockedByAdd/Remove take the list
//     (Azure applies them sequentially: parallel relation PATCHes on one
//     work item would race each other's revision).
//   - edit: Azure's edit has no assignee/milestone surface and takes single
//     label strings; the neutral IssuesEditOptions matches GitHub's superset
//     and the facade refuses the unrepresentable Azure fields with the named
//     errors the tools previously emitted inline (behavior-preserving).
//   - view: GitHub projects server-side via --json and returns text; Azure
//     returns a mapped record. The neutral view returns JSON text projected
//     to the requested fields on both, with the jq subset the tool call
//     sites use (`.field`, `.a.b // empty`).
//   - setType: GitHub's verb takes owner+name, Azure's resolves org/project
//     from config — the neutral verb takes the repo spec either way.
//   - create: Azure's create takes body text (bodyFile is read here) and
//     refuses assignee/milestone/project per the contract's documented
//     errors; its new-work-item id is stringified to the seam's one-line
//     reference.
//
// Verbs with no Azure seam primitive (comment record create/edit,
// org_issue_types) throw the same named "not implemented for provider
// 'azure'" errors the tools used inline — the gap is named, never silently
// dropped.
//
// The module never exits; failures throw ProviderError and callers decide.

import { ProviderError, providerRepoSplit } from "../provider-core.ts";
import { loadProviderModules } from "./provider-loader.ts";
// Type-only imports: erased at runtime (type-stripping), so the runtime
// dispatch stays lazy through the loader. The facade is the one layer that
// knows provider types — it is what normalizes them.
import type * as ghTypes from "../github/issues.ts";
import type * as azTypes from "../azure/issues.ts";
import type * as azUrlTypes from "../azure/urls.ts";

type GithubIssues = typeof ghTypes;
type AzureIssues = typeof azTypes;
type AzureUrls = typeof azUrlTypes;

/** The loaded family, discriminated by provider so each verb's branches
 * narrow to exactly the modules its provider manifest provides. */
type Loaded =
  | { provider: "github"; gh: GithubIssues }
  | { provider: "azure"; az: AzureIssues; azUrls: AzureUrls };

async function load(): Promise<Loaded> {
  const loaded = await loadProviderModules("issues");
  // Exhaustive, not default-fallthrough: a future third provider added to
  // the manifest must arm its own arm here, never silently dispatch into
  // github's module with mismatched shapes.
  switch (loaded.provider) {
    case "azure":
      return {
        provider: "azure",
        az: loaded.get<AzureIssues>("issues.ts"),
        azUrls: loaded.get<AzureUrls>("urls.ts"),
      };
    case "github":
      return { provider: "github", gh: loaded.get<GithubIssues>("issues.ts") };
    default:
      throw new ProviderError(
        `facade/issues: provider '${String(loaded.provider)}' has no issues-family arm — add it to load()`,
      );
  }
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export interface IssuesListOptions {
  state?: "open" | "closed" | "all";
  label?: string[];
  assignee?: string[];
  milestone?: string;
  author?: string;
  mention?: string;
  type?: string;
  limit?: number;
  json?: string;
  jq?: string;
  web?: boolean;
  lock?: boolean;
  search?: string;
}

/** List issues. Pass-through of caller-owned `--json` field lists (the bash
 * verb's pure pass-through contract — the facade appends nothing). */
export async function issuesList(spec: string | undefined, opts: IssuesListOptions = {}): Promise<string> {
  const m = await load();
  if (m.provider === "github") return m.gh.issuesList(spec, opts);
  // Azure accepts the documented subset; anything else is a named error,
  // never a silently dropped filter (the contract's option rule).
  if ((opts.label?.length ?? 0) > 1) {
    throw new ProviderError("provider 'azure' takes at most one --label per list");
  }
  for (const [opt, v] of [
    ["--assignee", opts.assignee?.length],
    ["--milestone", opts.milestone !== undefined],
    ["--author", opts.author !== undefined],
    ["--mention", opts.mention !== undefined],
    ["--web", opts.web === true],
    ["--lock", opts.lock === true],
    ["--search", opts.search !== undefined],
  ] as const) {
    if (v) throw new ProviderError(`'${opt}' is not implemented for provider 'azure' yet (github-only seam)`);
  }
  const out = await m.az.issuesList(spec ?? "", {
    ...(opts.state !== undefined ? { state: opts.state } : {}),
    ...(opts.label?.[0] !== undefined ? { label: opts.label[0] } : {}),
    ...(opts.type !== undefined ? { type: opts.type } : {}),
    ...(opts.limit !== undefined ? { limit: opts.limit } : {}),
    ...(opts.json !== undefined ? { json: opts.json } : {}),
    ...(opts.jq !== undefined ? { jq: opts.jq } : {}),
  });
  return typeof out === "string" ? out : JSON.stringify(out);
}

/** View one issue as JSON text. GitHub projects server-side via --json;
 * Azure's mapped record is projected to the requested fields here (the
 * issue-get azure arm's established `?? null` projection). */
export async function issuesView(
  spec: string | undefined,
  number: number,
  opts: { json?: string; jq?: string } = {},
): Promise<string> {
  const m = await load();
  if (m.provider === "github") return m.gh.issuesView(spec, number, opts);
  const rec = await m.az.issuesView(spec ?? "", number);
  let out: unknown = rec;
  if (opts.json !== undefined) {
    const proj: Record<string, unknown> = {};
    for (const f of opts.json.split(",").map((f) => f.trim())) proj[f] = rec[f] ?? null;
    out = proj;
  }
  if (opts.jq === undefined) return JSON.stringify(out);
  return azureJq(out, opts.jq);
}

/** The jq subset the tool call sites use against view output: dotted-field
 * paths with an optional `// empty` fallback. `null` at any path step reads
 * as the fallback (or "null"). */
function azureJq(value: unknown, program: string): string {
  const trimmed = program.trim();
  const m = /^\.([A-Za-z_][A-Za-z0-9_.]*)(?:\s*\/\/\s*empty)?$/.exec(trimmed);
  if (m?.[1] === undefined) {
    throw new ProviderError(
      `unsupported jq program '${program}' — the issues view supports '.field' and '.a.b // empty'`,
    );
  }
  let v: unknown = value;
  for (const seg of m[1].split(".")) {
    if (v === null || v === undefined || typeof v !== "object") {
      v = undefined;
      break;
    }
    v = (v as Record<string, unknown>)[seg];
  }
  // jq's // falls through on false and null: a false leaf yields the
  // fallback (or "null"), matching real jq's alternative-operator rule.
  if (v === undefined || v === null || v === false) {
    return trimmed.endsWith("empty") ? "" : v === false ? "false" : "null";
  }
  return typeof v === "string" ? v : JSON.stringify(v);
}

/** Presence test (no output, errors tolerated). */
export async function issuesExists(spec: string | undefined, number: number): Promise<boolean> {
  const m = await load();
  return m.provider === "azure" ? m.az.issuesExists(spec ?? "", number) : m.gh.issuesExists(spec, number);
}

/** List an issue's comments (seam shape), oldest first. */
export async function issuesComments(spec: string | undefined, number: number): Promise<string> {
  const m = await load();
  if (m.provider === "azure") {
    return JSON.stringify(await m.az.issuesComments(spec ?? "", number));
  }
  return m.gh.issuesComments(spec, number);
}

/** List milestones (JSON text; Azure: an empty list, documented degrade).
 * GitHub's seam verb takes no jq (raw REST JSON is its pass-through) — a
 * jq request there is a named error, never a silently dropped option. */
export async function issuesMilestones(spec: string | undefined, opts: { jq?: string } = {}): Promise<string> {
  const m = await load();
  if (m.provider === "azure") return m.az.issuesMilestones(spec ?? "", opts);
  if (opts.jq !== undefined) {
    throw new ProviderError("issues_milestones: --jq is not implemented for provider 'github' (raw REST JSON pass-through)");
  }
  return m.gh.issuesMilestones(spec);
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

export interface IssuesCreateOptions {
  title: string;
  body?: string;
  bodyFile?: string;
  label?: string[];
  assignee?: string[];
  type?: string;
  milestone?: string;
  project?: string[];
  web?: boolean;
  dryRun?: boolean;
}

/** Create an issue. Returns the new issue's URL or number, one line. */
export async function issuesCreate(spec: string | undefined, opts: IssuesCreateOptions): Promise<string> {
  const m = await load();
  if (m.provider === "github") return m.gh.issuesCreate(spec, opts);
  for (const [opt, v] of [
    ["--assignee", opts.assignee?.length],
    ["--milestone", opts.milestone !== undefined],
    ["--project", opts.project?.length],
    ["--web", opts.web === true],
    ["--dry-run", opts.dryRun === true],
  ] as const) {
    if (v) throw new ProviderError(`'${opt}' is not implemented for provider 'azure' yet (github-only seam)`);
  }
  const body = await resolveBody(opts);
  const id = await m.az.issuesCreate(spec ?? "", {
    title: opts.title,
    ...(body !== undefined ? { body } : {}),
    ...(opts.label !== undefined ? { labels: opts.label } : {}),
    ...(opts.type !== undefined ? { type: opts.type } : {}),
  });
  return String(id);
}

export interface IssuesEditOptions {
  title?: string;
  body?: string;
  bodyFile?: string;
  addLabel?: string[];
  removeLabel?: string[];
  addAssignee?: string[];
  removeAssignee?: string[];
  milestone?: string;
  type?: string;
}

/** Edit an issue. The neutral options are GitHub's superset; on Azure the
 * fields its seam cannot represent are refused with the named errors the
 * tools previously emitted inline (never silently dropped). */
export async function issuesEdit(
  spec: string | undefined,
  number: number,
  opts: IssuesEditOptions,
): Promise<void> {
  const m = await load();
  if (m.provider === "azure") {
    if (opts.addAssignee?.length || opts.removeAssignee?.length) {
      throw new ProviderError("--add-assignee/--remove-assignee is not implemented for provider 'azure' yet (github-only seam)");
    }
    if (opts.milestone !== undefined) {
      throw new ProviderError("--milestone is not implemented for provider 'azure' yet (github-only seam)");
    }
    const body = await resolveBody(opts);
    // With a body the type is changed first, so the body is written to the
    // field of the type the item now has.
    if (opts.type !== undefined && body !== undefined) {
      await m.az.issuesSetType(spec ?? "", number, opts.type);
    }
    await m.az.issuesEdit(spec ?? "", number, {
      ...(opts.title !== undefined ? { title: opts.title } : {}),
      ...(body !== undefined ? { body } : {}),
      ...(opts.addLabel?.length ? { addLabel: opts.addLabel.join(";") } : {}),
      ...(opts.removeLabel?.length ? { removeLabel: opts.removeLabel.join(";") } : {}),
      ...(opts.type !== undefined && body !== undefined ? { type: opts.type } : {}),
    });
    if (opts.type !== undefined && body === undefined) {
      await m.az.issuesSetType(spec ?? "", number, opts.type);
    }
    return;
  }
  await m.gh.issuesEdit(spec, number, opts);
}

/** Close an issue (`--reason` is GitHub's completed|not planned; Azure
 * accepts and drops it — there is no close reason). */
export async function issuesClose(
  spec: string | undefined,
  number: number,
  opts: { reason?: string; comment?: string } = {},
): Promise<string> {
  const m = await load();
  if (m.provider === "azure") {
    await m.az.issuesClose(spec ?? "", number, opts);
    return "";
  }
  return m.gh.issuesClose(spec, number, opts);
}

/** Reopen an issue, optionally leaving a comment. */
export async function issuesReopen(
  spec: string | undefined,
  number: number,
  opts: { comment?: string } = {},
): Promise<string> {
  const m = await load();
  if (m.provider === "azure") {
    await m.az.issuesReopen(spec ?? "", number, opts);
    return "";
  }
  return m.gh.issuesReopen(spec, number, opts);
}

/** Comment on an issue; returns the display value (URL or id). */
export async function issuesComment(
  spec: string | undefined,
  number: number,
  opts: { body?: string; bodyFile?: string },
): Promise<string> {
  const m = await load();
  return m.provider === "azure"
    ? m.az.issuesComment(spec ?? "", number, opts)
    : m.gh.issuesComment(spec, number, opts);
}

/** Create a comment; emits the created comment record (seam shape). Azure
 * has no record-returning create — the composite ref its comment verb
 * returns is read back through comment-get. */
export async function issuesCommentAdd(
  spec: string | undefined,
  number: number,
  opts: { body?: string; bodyFile?: string },
): Promise<string> {
  const m = await load();
  if (m.provider === "azure") {
    const ref = await m.az.issuesComment(spec ?? "", number, opts);
    return JSON.stringify(await m.az.issuesCommentGet(spec ?? "", ref));
  }
  return m.gh.issuesCommentAdd(spec, number, opts);
}

/** Fetch one comment as seam-shaped JSON. */
export async function issuesCommentGet(spec: string | undefined, commentRef: string): Promise<string> {
  const m = await load();
  if (m.provider === "azure") {
    return JSON.stringify(await m.az.issuesCommentGet(spec ?? "", commentRef));
  }
  return m.gh.issuesCommentGet(spec, commentRef);
}

/** Replace a comment's body; emits the updated record (seam shape). Azure's
 * seam has no comment-edit primitive — named error, matching the inline
 * refusals this facade absorbed from the tools. */
export async function issuesCommentEdit(
  spec: string | undefined,
  commentRef: string,
  opts: { body?: string; bodyFile?: string },
): Promise<string> {
  const m = await load();
  if (m.provider === "azure") {
    void commentRef;
    throw new ProviderError("issues_comment_edit is not implemented for provider 'azure' yet (github-only seam)");
  }
  return m.gh.issuesCommentEdit(spec, commentRef, opts);
}

// ---------------------------------------------------------------------------
// Native issue types (GitHub-native, capability-gated) + the family's
// org-level type query
// ---------------------------------------------------------------------------

/** Set an issue's native type. The neutral verb takes the repo spec;
 * GitHub's owner/name context is resolved here via providerRepoSplit, and
 * Azure maps the devenv type through its workItemTypeFor. */
export async function issuesSetType(spec: string, number: number, typeName: string): Promise<void> {
  const m = await load();
  if (m.provider === "azure") return m.az.issuesSetType(spec, number, typeName);
  const { owner, name } = providerRepoSplit(spec);
  return m.gh.issuesSetType(owner, name, number, typeName);
}

/** The org's configured issue types (GitHub-native). Azure's type
 * vocabulary is project config, not org settings — a named error, not an
 * empty success, so callers see the seam instead of a blank table. */
export async function orgIssueTypes(org: string): Promise<Array<{ id: string; name: string }>> {
  const m = await load();
  if (m.provider === "azure") {
    void org;
    throw new ProviderError("org_issue_types is not implemented for provider 'azure' yet (github-only seam)");
  }
  return m.gh.orgIssueTypes(org);
}

// ---------------------------------------------------------------------------
// Labels
// ---------------------------------------------------------------------------

/** List labels (pass-through of caller field lists). */
export async function issuesLabelList(
  spec: string | undefined,
  opts: { json?: string; jq?: string; limit?: number } = {},
): Promise<string> {
  const m = await load();
  return m.provider === "azure" ? m.az.issuesLabelList(spec ?? "", opts) : m.gh.issuesLabelList(spec, opts);
}

/** Create a label if absent (idempotent). */
export async function issuesLabelEnsure(
  spec: string | undefined,
  name: string,
  color = "ededed",
  description = "Automated process",
): Promise<void> {
  const m = await load();
  return m.provider === "azure"
    ? m.az.issuesLabelEnsure()
    : m.gh.issuesLabelEnsure(spec, name, color, description);
}

export interface IssuesLabelCreateOptions {
  color?: string;
  description?: string;
  /** Azure: a tag exists only on a work item. */
  issue?: number;
}

/** Create a label. */
export async function issuesLabelCreate(
  spec: string | undefined,
  name: string,
  opts: IssuesLabelCreateOptions = {},
): Promise<string> {
  const m = await load();
  if (m.provider === "azure") {
    await m.az.issuesLabelCreate(spec ?? "", name, opts);
    return "";
  }
  return m.gh.issuesLabelCreate(spec, name, opts.color, opts.description);
}

export interface IssuesLabelUpdateOptions {
  newName?: string;
  color?: string;
  description?: string;
}

/** Update a label's color/description/name. Azure tags are immutable flat
 * strings — the documented no-op. */
export async function issuesLabelUpdate(
  spec: string | undefined,
  name: string,
  opts: IssuesLabelUpdateOptions = {},
): Promise<string> {
  const m = await load();
  if (m.provider === "azure") {
    void spec;
    void name;
    void opts;
    return "";
  }
  return m.gh.issuesLabelUpdate(spec, name, opts);
}

// ---------------------------------------------------------------------------
// Sub-issue graph
// ---------------------------------------------------------------------------

/** Link a child issue under a parent via native sub-issues. parentSpec
 * allows a cross-repo parent (GitHub); Azure's hierarchy is project-scoped
 * and the extra spec is dropped. */
export function issueGraphLink(
  spec: string | undefined,
  parent: number,
  child: number,
  parentSpec?: string,
): Promise<void> {
  return load().then((m) =>
    m.provider === "azure"
      ? m.az.issueGraphLink(spec ?? "", parent, child)
      : m.gh.issueGraphLink(spec, parent, child, parentSpec),
  );
}

/** Unlink a child issue from its parent. */
export function issueGraphUnlink(
  spec: string | undefined,
  parent: number,
  child: number,
  parentSpec?: string,
): Promise<void> {
  return load().then((m) =>
    m.provider === "azure"
      ? m.az.issueGraphUnlink(spec ?? "", parent, child)
      : m.gh.issueGraphUnlink(spec, parent, child, parentSpec),
  );
}

/** List a parent's sub-issue children (numbers). */
export async function issueGraphChildren(spec: string | undefined, parent: number): Promise<number[]> {
  const m = await load();
  return m.provider === "azure" ? m.az.issueGraphChildren(spec ?? "", parent) : m.gh.issueGraphChildren(spec, parent);
}

/** Resolve an issue's native parent number, or null when unlinked. */
export async function issueGraphParent(spec: string | undefined, issue: number): Promise<number | null> {
  const m = await load();
  return m.provider === "azure" ? m.az.issueGraphParent(spec ?? "", issue) : m.gh.issueGraphParent(spec, issue);
}

/** Issue web URL (display address). Async in the facade: provider resolution
 * and module load are lazy (a tool's --help must not import a provider
 * module). Azure's implementation lives in its urls module. */
export async function issueWebUrl(spec: string, number: number): Promise<string> {
  const m = await load();
  return m.provider === "azure" ? m.azUrls.issueWebUrl(spec, number) : m.gh.issueWebUrl(spec, number);
}

// ---------------------------------------------------------------------------
// Blocked-by relations (the flagship normalization)
// ---------------------------------------------------------------------------

/** Record ISSUE as blocked by BLOCKERS. GitHub: one idempotent body-section
 * write; Azure: one predecessor link per blocker, applied sequentially
 * (parallel relation PATCHes on one work item would race revisions). */
export async function blockedByAdd(spec: string | undefined, issue: number, blockers: number[]): Promise<void> {
  const m = await load();
  if (m.provider === "azure") {
    for (const b of blockers) await m.az.issueDependencyLink(spec ?? "", issue, b);
    return;
  }
  return m.gh.issueBlockedByLink(spec, issue, blockers);
}

/** Remove BLOCKERS from ISSUE's blocked-by set (absent = no-op success). */
export async function blockedByRemove(spec: string | undefined, issue: number, blockers: number[]): Promise<void> {
  const m = await load();
  if (m.provider === "azure") {
    for (const b of blockers) await m.az.issueDependencyUnlink(spec ?? "", issue, b);
    return;
  }
  return m.gh.issueBlockedByUnlink(spec, issue, blockers);
}

// ---------------------------------------------------------------------------
// Local helpers
// ---------------------------------------------------------------------------

/** Body resolution shared by create/edit: `--body-file F` (`-` is stdin)
 * reads to text on the providers whose verbs take body text only. Both
 * given is refused (GitHub's own rule); both absent is the caller's
 * business (no body update). */
async function resolveBody(opts: { body?: string; bodyFile?: string }): Promise<string | undefined> {
  if (opts.body !== undefined && opts.bodyFile !== undefined) {
    throw new ProviderError("--body and --body-file are mutually exclusive");
  }
  if (opts.body !== undefined) return opts.body;
  if (opts.bodyFile === undefined) return undefined;
  const { readFileSync } = await import("node:fs");
  return opts.bodyFile === "-" ? readFileSync(0, "utf8") : readFileSync(opts.bodyFile, "utf8");
}
