// azure/prs.ts — Azure DevOps implementation of the PRs domain facade (port
// of azure/prs.bash over the http.ts transport).
//
// Implements the CONTRACT.md Pull-requests verbs: list / view / diff / create
// / merge / comment / threads_page / thread_create / thread_reply /
// thread_resolve. One verb per contract row; options are validated strictly.
//
// Shape contract: state is OPEN/MERGED/CLOSED (the seam's closed covers
// completed+abandoned; merged maps to completed only). The list API pages
// with $top/$skip (not continuation tokens) and caps a page at its server
// default, so paging continues until a short page. Completion is asynchronous
// and guarded by lastMergeSourceCommit (Azure would accept the PATCH and
// silently keep the PR active without it). Contract: throw ProviderError on
// failure; never process.exit.

import { ProviderError, unknownOption, needValue } from "../provider-core.ts";
import { azureHttp } from "./http.ts";
import { azureRepoParts, azureUri } from "./urls.ts";

/** The PR list API's server-side page cap. */
const AZURE_PR_PAGE_SIZE = 100;
/** Azure refuses a PR description over this many characters. */
const AZURE_PR_DESCRIPTION_MAX = 4000;
/** The changes endpoint's page size. */
const AZURE_PR_CHANGES_PAGE = 200;

// ---------------------------------------------------------------------------
// URL builders + state mapping
// ---------------------------------------------------------------------------

/** PR API base for a repo spec (org/project/repo, project/repo, bare name or
 * empty — empty gives the project-wide endpoint the list wrapper wants). */
function prBase(repo: string): string {
  if (repo !== "") {
    const { org, project, repo: r } = azureRepoParts(repo);
    return `https://dev.azure.com/${azureUri(org)}/${azureUri(project)}/_apis/git/repositories/${azureUri(r)}`;
  }
  const { org, project } = azureRepoParts("");
  return `https://dev.azure.com/${azureUri(org)}/${azureUri(project)}/_apis/git`;
}

/** Map a seam state word to the Azure status filter (empty = all). Unknown
 * words fail defined instead of silently degrading to 'active'. */
function statusFilter(state: string): string {
  switch (state) {
    case "open":
      return "active";
    // The seam's closed covers completed+abandoned (no single status selects
    // both): fetch all and drop the active ones. merged maps to completed.
    case "closed":
    case "all":
      return "all";
    case "merged":
      return "completed";
    default:
      throw new ProviderError(
        `unknown state '${state}' (valid: open, closed, merged, all)`,
      );
  }
}

function stripRef(ref: string | undefined): string {
  return (ref ?? "").replace(/^refs\/heads\//, "");
}

function seamState(status: string | undefined): "OPEN" | "MERGED" | "CLOSED" {
  if (status === "active") return "OPEN";
  if (status === "completed") return "MERGED";
  return "CLOSED";
}

// ---------------------------------------------------------------------------
// Raw shapes
// ---------------------------------------------------------------------------

interface AzurePr {
  pullRequestId?: number;
  title?: string;
  description?: string;
  status?: string;
  isDraft?: boolean;
  sourceRefName?: string;
  targetRefName?: string;
  lastMergeSourceCommit?: { commitId?: string };
  mergeStatus?: string;
  creationDate?: string;
  closedDate?: string;
  mergeFailureMessage?: string;
  createdBy?: { displayName?: string };
  labels?: Array<{ name: string; active?: boolean }>;
  repository?: { webUrl?: string };
}

function mapListPr(p: AzurePr): Record<string, unknown> {
  return {
    number: p.pullRequestId,
    title: p.title ?? "",
    state: seamState(p.status),
    headRefName: stripRef(p.sourceRefName),
    baseRefName: stripRef(p.targetRefName),
    isDraft: p.isDraft ?? false,
    author: { login: p.createdBy?.displayName ?? "unknown" },
    createdAt: p.creationDate ?? "",
    updatedAt: p.closedDate ?? p.creationDate ?? "",
    labels: (p.labels ?? [])
      .filter((l) => l.active !== false)
      .map((l) => ({ name: l.name })),
    url: `${p.repository?.webUrl ?? ""}/pullrequest/${String(p.pullRequestId ?? "")}`,
  };
}

/** View's projection contract: every field in pr-get's DEFAULT_FIELDS present
 * and non-null — absent Azure data maps to typed empties, never null.
 * mergeable/mergeStateStatus map from Azure's mergeStatus (per pr-get docs). */
function mapViewPr(p: AzurePr): Record<string, unknown> {
  const mergeStatus = p.mergeStatus ?? "";
  return {
    number: p.pullRequestId,
    id: p.pullRequestId,
    title: p.title ?? "",
    body: p.description ?? "",
    state: seamState(p.status),
    isDraft: p.isDraft ?? false,
    headRefName: stripRef(p.sourceRefName),
    baseRefName: stripRef(p.targetRefName),
    headRefOid: p.lastMergeSourceCommit?.commitId ?? "",
    author: { login: p.createdBy?.displayName ?? "unknown" },
    labels: (p.labels ?? [])
      .filter((l) => l.active !== false)
      .map((l) => ({ name: l.name })),
    assignees: [],
    reviewRequests: [],
    milestone: "",
    mergeable:
      mergeStatus === "conflicts"
        ? "CONFLICTING"
        : mergeStatus === "succeeded"
          ? "MERGEABLE"
          : "UNKNOWN",
    mergeStateStatus:
      mergeStatus === "conflicts"
        ? "DIRTY"
        : mergeStatus === "succeeded"
          ? "CLEAN"
          : "UNKNOWN",
    url: `${p.repository?.webUrl ?? ""}/pullrequest/${String(p.pullRequestId ?? "")}`,
    createdAt: p.creationDate ?? "",
    updatedAt: p.closedDate ?? p.creationDate ?? "",
    closedAt: p.closedDate ?? "",
    mergedAt: p.status === "completed" ? (p.closedDate ?? "") : "",
    comments: [],
    reviews: [],
  };
}

// ---------------------------------------------------------------------------
// List-flag rendering (same seam semantics as the issues module)
// ---------------------------------------------------------------------------

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
      `unsupported jq program '${opts.jq}' — azure pr list supports '.[N].field' and '.[].field'`,
    );
  }
  return JSON.stringify(out);
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export interface PrsListOptions {
  state?: "open" | "closed" | "merged" | "all";
  head?: string;
  base?: string;
  /** Seam --search dialect: "head:branch" filters the source branch; anything
   * else filters on title contains. */
  search?: string;
  limit?: number;
  json?: string;
  jq?: string;
}

/** List PRs. Pages $top/$skip until a short page; state=closed is fetched as
 * all with still-active PRs dropped per page. */
export async function prsList(
  repo: string,
  opts: PrsListOptions = {},
): Promise<Array<Record<string, unknown>> | string> {
  const state = opts.state ?? "open";
  const status = statusFilter(state);
  let api = `${prBase(repo)}/pullrequests?status=${status}`;
  if (opts.head !== undefined && opts.head !== "") {
    api += `&searchCriteria.sourceRefName=${azureUri(`refs/heads/${opts.head}`)}`;
  }
  if (opts.base !== undefined && opts.base !== "") {
    api += `&searchCriteria.targetRefName=${azureUri(`refs/heads/${opts.base}`)}`;
  }
  const collected: AzurePr[] = [];
  let skip = 0;
  for (;;) {
    let top = AZURE_PR_PAGE_SIZE;
    if (opts.limit !== undefined) {
      const remaining = opts.limit - collected.length;
      if (remaining <= 0) break;
      if (remaining < top) top = remaining;
    }
    const page = await azureHttp<{ value?: AzurePr[] }>(
      "GET",
      `${api}&$top=${top}&$skip=${skip}`,
    );
    let items = page.value ?? [];
    const got = items.length;
    if (state === "closed") items = items.filter((p) => p.status !== "active");
    collected.push(...items);
    skip += got;
    if (got < top) break;
  }
  let mapped = collected.map(mapListPr);
  if (opts.search !== undefined && opts.search !== "") {
    if (opts.search.startsWith("head:")) {
      const h = opts.search.slice("head:".length);
      mapped = mapped.filter((r) => r.headRefName === h);
    } else {
      const t = opts.search;
      mapped = mapped.filter((r) => (r.title as string ?? "").includes(t));
    }
  }
  if (opts.json !== undefined || opts.jq !== undefined) {
    return renderListFlags(mapped, opts);
  }
  return mapped;
}

export interface PrsViewOptions {
  json?: string;
  jq?: string;
}

/** View a PR as the full mapped record (or the rendered projection when
 * flags are present). */
export async function prsView(
  repo: string,
  number: number,
  opts: PrsViewOptions = {},
): Promise<Record<string, unknown> | string> {
  if (!Number.isFinite(number)) {
    throw new ProviderError("prs_view requires a PR number");
  }
  const raw = await azureHttp<AzurePr>("GET", `${prBase(repo)}/pullrequests/${number}`);
  const mapped = mapViewPr(raw);
  if (opts.json !== undefined || opts.jq !== undefined) {
    return renderListFlags([mapped], opts).replace(/^\[/, "").replace(/\]$/, "");
  }
  return mapped;
}

export interface PrsDiffOptions {
  nameOnly?: boolean;
}

/** Diff a PR: the latest iteration's changes, paged via nextSkip. Emits
 * {path, changeType} records, or bare paths with nameOnly. */
export async function prsDiff(
  repo: string,
  number: number,
  opts: PrsDiffOptions = {},
): Promise<string> {
  const base = prBase(repo);
  const iterations = await azureHttp<{ value?: Array<{ id?: number }> }>(
    "GET",
    `${base}/pullrequests/${number}/iterations`,
  );
  const ids = (iterations.value ?? []).map((i) => i.id ?? 0);
  const latestIter = ids.length > 0 ? Math.max(...ids) : 1;
  const changes: Array<{ item?: { path?: string }; changeType?: string }> = [];
  let skip = 0;
  for (;;) {
    const page = await azureHttp<{
      changes?: Array<{ item?: { path?: string }; changeType?: string }>;
      nextSkip?: number;
    }>(
      "GET",
      `${base}/pullrequests/${number}/iterations/${latestIter}/changes?$top=${AZURE_PR_CHANGES_PAGE}&$skip=${skip}`,
    );
    changes.push(...(page.changes ?? []));
    const nextSkip = page.nextSkip ?? 0;
    // A server that keeps answering the same position would loop forever.
    if (!(Number.isInteger(nextSkip) && nextSkip > skip)) break;
    skip = nextSkip;
  }
  if (changes.length === 0) return "";
  if (opts.nameOnly === true) {
    return changes.map((c) => c.item?.path ?? "").join("\n");
  }
  return changes
    .map((c) => JSON.stringify({ path: c.item?.path ?? "", changeType: c.changeType ?? "" }))
    .join("\n");
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

/** Resolve a reviewer to the identity id Azure takes: a GUID as-is; an
 * email/account/display name through the identities API, exactly one match. */
async function reviewerId(who: string): Promise<string> {
  if (/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(who)) {
    return who;
  }
  const { org } = azureRepoParts("");
  const r = await azureHttp<{ value?: Array<{ id: string }> }>(
    "GET",
    `https://vssps.dev.azure.com/${azureUri(org)}/_apis/identities?searchFilter=General&filterValue=${azureUri(who)}&queryMembership=None`,
  );
  const list = r.value ?? [];
  if (list.length !== 1) {
    throw new ProviderError(`reviewer '${who}' did not resolve to exactly one identity`);
  }
  return list[0]!.id;
}

export interface PrsCreateOptions {
  title?: string;
  body?: string;
  head?: string;
  base?: string;
  draft?: boolean;
  reviewers?: string[];
  labels?: string[];
  /** Azure PRs have no assignee: accepted and reported as ignored. */
  assignee?: string;
}

/** Create a PR. Returns the new PR's id. A description past Azure's limit is
 * cut to fit and the full text is posted as the PR's first comment. */
export async function prsCreate(
  repo: string,
  opts: PrsCreateOptions,
): Promise<number> {
  const { title, head, base } = opts;
  if (title === undefined || head === undefined || base === undefined) {
    throw new ProviderError("prs_create requires title, head and base");
  }
  if (repo === "") {
    throw new ProviderError("prs_create: a repository is required");
  }
  let description = opts.body ?? "";
  if (description.length > AZURE_PR_DESCRIPTION_MAX) {
    description = description.slice(0, AZURE_PR_DESCRIPTION_MAX - 3) + "...";
    console.error(
      `WARN: prs_create: description is ${opts.body?.length} characters; Azure allows ${AZURE_PR_DESCRIPTION_MAX} — it is cut and the full text is posted as a PR comment`,
    );
  }
  const payload: Record<string, unknown> = {
    sourceRefName: `refs/heads/${head}`,
    targetRefName: `refs/heads/${base}`,
    title,
    description,
    isDraft: opts.draft === true,
  };
  if (opts.reviewers !== undefined && opts.reviewers.length > 0) {
    const ids: string[] = [];
    for (const r of opts.reviewers) ids.push(await reviewerId(r));
    payload.reviewers = ids.map((id) => ({ id }));
  }
  if (opts.labels !== undefined && opts.labels.length > 0) {
    payload.labels = opts.labels.map((name) => ({ name }));
  }
  const r = await azureHttp<{ pullRequestId?: number }>(
    "POST",
    `${prBase(repo)}/pullrequests`,
    { body: JSON.stringify(payload) },
  );
  const number = r.pullRequestId ?? 0;
  if (opts.body !== undefined && opts.body.length > AZURE_PR_DESCRIPTION_MAX) {
    await prsComment(repo, number, { body: opts.body });
  }
  return number;
}

export interface PrsMergeOptions {
  /** rebase (default) | squash | noFastForward (--merge). */
  method?: "rebase" | "squash" | "noFastForward";
  deleteBranch?: boolean;
  /** --admin maps to completionOptions.bypassPolicy. */
  admin?: boolean;
  subject?: string;
  body?: string;
}

/** Merge (complete) a PR. Guards with lastMergeSourceCommit (Azure would
 * accept the PATCH but leave the PR active without it), then polls the
 * asynchronous completion to a terminal state. */
export async function prsMerge(
  repo: string,
  number: number,
  opts: PrsMergeOptions = {},
): Promise<Record<string, unknown>> {
  if (!Number.isFinite(number)) {
    throw new ProviderError("prs_merge: PR number is required");
  }
  if (repo === "") {
    throw new ProviderError("prs_merge: a repository is required");
  }
  const method = opts.method ?? "rebase";
  const prUrl = `${prBase(repo)}/pullrequests/${number}`;
  const pr = await azureHttp<AzurePr>("GET", prUrl);
  const commitId = pr.lastMergeSourceCommit?.commitId ?? "";
  if (commitId === "") {
    throw new ProviderError(
      `could not resolve lastMergeSourceCommit for PR ${number} — refusing to complete without it (Azure would accept the PATCH but leave the PR active)`,
    );
  }
  let message = opts.subject ?? "";
  if (message !== "" && opts.body !== undefined && opts.body !== "") {
    message = `${message}\n\n${opts.body}`;
  } else if (message === "" && opts.body !== undefined) {
    message = opts.body;
  }
  const completionOptions: Record<string, unknown> = {
    mergeStrategy: method,
    deleteSourceBranch: opts.deleteBranch === true,
  };
  if (opts.admin === true) {
    completionOptions.bypassPolicy = true;
    console.error("INFO: azure merge: admin mapped to completionOptions.bypassPolicy (policy checks bypassed)");
  }
  if (message !== "") completionOptions.mergeCommitMessage = message;
  let response = await azureHttp<AzurePr>("PATCH", prUrl, {
    body: JSON.stringify({
      status: "completed",
      lastMergeSourceCommit: { commitId },
      completionOptions,
    }),
  });
  // Completion is asynchronous: poll until completed, abandoned, or a failure
  // surface. Defaults: 30 checks, 2s apart (the bash module's env-tunables).
  const attempts = Number(process.env.AZURE_PR_MERGE_POLL_ATTEMPTS ?? "30");
  const interval = Number(process.env.AZURE_PR_MERGE_POLL_INTERVAL ?? "2");
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  for (let polled = 0; ; polled++) {
    const prStatus = response.status ?? "";
    const mergeStatus = response.mergeStatus ?? "";
    if (prStatus === "completed") return response as unknown as Record<string, unknown>;
    if (prStatus === "abandoned") {
      throw new ProviderError(`PR ${number} is abandoned, not completed`);
    }
    if (["conflicts", "failure", "rejectedByPolicy"].includes(mergeStatus)) {
      const failure = response.mergeFailureMessage ?? "";
      throw new ProviderError(
        `PR ${number} could not be completed (mergeStatus: ${mergeStatus})${failure !== "" ? `: ${failure}` : ""}`,
      );
    }
    if (polled >= attempts) {
      throw new ProviderError(
        `PR ${number} is not completed after ${polled} checks (status: ${prStatus}, mergeStatus: ${mergeStatus || "unset"}); the merge may still finish — check the PR`,
      );
    }
    await sleep(interval * 1000);
    response = await azureHttp<AzurePr>("GET", prUrl);
  }
}

export interface PrsCommentOptions {
  body?: string;
  bodyFile?: string;
  commentBody?: string;
}

/** Comment on a PR (PR-level comment via the threads API). The thread is
 * created with no status: a GitHub PR comment has no resolution state, so it
 * is neither Active (counts against must-resolve policies) nor resolved.
 * Returns the thread id. */
export async function prsComment(
  repo: string,
  number: number,
  opts: PrsCommentOptions,
): Promise<string> {
  let text = opts.body ?? opts.commentBody ?? "";
  if (text === "" && opts.bodyFile !== undefined) text = opts.bodyFile;
  if (text === "") throw new ProviderError("prs_comment requires a body");
  const r = await azureHttp<{ id?: number }>(
    "POST",
    `${prBase(repo)}/pullrequests/${number}/threads`,
    { body: JSON.stringify({ comments: [{ parentCommentId: 0, content: text, commentType: 1 }] }) },
  );
  return String(r.id ?? "");
}

// ---------------------------------------------------------------------------
// Review threads
// ---------------------------------------------------------------------------

export interface PrsThread {
  id: string;
  isResolved: boolean;
  path: string | null;
  line: number;
  comments: Array<{ id: string; nodeId: null; body: string; author: { login: string } }>;
}

export interface ThreadsPage {
  data: {
    repository: {
      pullRequest: {
        reviewThreads: {
          pageInfo: { hasNextPage: boolean; endCursor: null };
          nodes: PrsThread[];
        };
      };
    };
  };
}

/** One page of review threads for a PR, mapped to the seam-threads shape.
 * Azure system-note threads (all comments commentType "system") and deleted
 * threads are not review conversation and are dropped. A status-less,
 * context-less single-comment thread is a plain PR comment (prs_comment
 * creates them) — also dropped, until someone replies in it. Each comment id
 * is <thread>/<comment>, the token thread_reply takes. Azure returns threads
 * in one array (no cursor pagination): a requested continuation emits an
 * empty page. */
export async function prsThreadsPage(
  repo: string,
  pr: number,
  cursor = "",
): Promise<ThreadsPage> {
  if (repo === "") throw new ProviderError("prs_threads_page: repo is required");
  if (!Number.isFinite(pr)) throw new ProviderError("prs_threads_page: PR number is required");
  const emptyPage: ThreadsPage = {
    data: {
      repository: {
        pullRequest: {
          reviewThreads: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [] },
        },
      },
    },
  };
  if (cursor !== "") return emptyPage;
  const response = await azureHttp<{ value?: Array<Record<string, unknown>> }>(
    "GET",
    `${prBase(repo)}/pullrequests/${pr}/threads`,
  );
  const nodes: PrsThread[] = [];
  for (const t of response.value ?? []) {
    if (t.isDeleted === true) continue;
    const comments = (t.comments as Array<Record<string, unknown>> | undefined) ?? [];
    const human = comments.filter((c) => (c.commentType ?? "text") !== "system");
    if (human.length === 0) continue;
    const status = (t.status as string | undefined) ?? "unknown";
    const ctx = t.threadContext as Record<string, unknown> | null | undefined;
    if (status === "unknown" && ctx == null && human.length <= 1) continue;
    const threadId = String(t.id ?? "");
    const right = ctx?.rightFileStart as { line?: number } | undefined;
    const left = ctx?.leftFileStart as { line?: number } | undefined;
    nodes.push({
      id: `${pr}/${threadId}`,
      isResolved: ["fixed", "wontFix", "closed", "byDesign"].includes(status),
      path: (ctx?.filePath as string | undefined) ?? null,
      line: right?.line ?? left?.line ?? 0,
      comments: human.map((c) => ({
        id: `${threadId}/${String(c.id ?? "")}`,
        nodeId: null,
        body: String(c.content ?? ""),
        author: {
          login:
            (c.author as { displayName?: string } | undefined)?.displayName ??
            "unknown",
        },
      })),
    });
  }
  return { data: { repository: { pullRequest: { reviewThreads: { pageInfo: { hasNextPage: false, endCursor: null }, nodes } } } } };
}

/** Reply to a review thread. COMMENT_REF is what prsThreadsPage prints as a
 * comment id: <thread>/<comment> (the reply nests under that comment), or a
 * bare <thread> id (nests under the thread's first comment). */
export async function prsThreadReply(
  repo: string,
  pr: number,
  commentRef: string,
  body: string,
): Promise<{ id: string }> {
  if (repo === "" || !Number.isFinite(pr) || commentRef === "" || body === "") {
    throw new ProviderError("prs_thread_reply: repo, pr, comment ref and body are required");
  }
  let threadId = "";
  let parent = "";
  const m = /^(\d+)\/(\d+)$/.exec(commentRef);
  if (m !== null) {
    threadId = m[1] as string;
    parent = m[2] as string;
  } else if (/^\d+$/.test(commentRef)) {
    threadId = commentRef;
    parent = "1";
  } else {
    throw new ProviderError(
      "azure comment refs are '<thread>/<comment>' — take the id from pr-threads-get output",
    );
  }
  // The comments endpoint takes a bare comment object — the threads envelope
  // (comments:[…], status) is rejected here as empty content.
  const r = await azureHttp<{ id?: number }>(
    "POST",
    `${prBase(repo)}/pullrequests/${pr}/threads/${threadId}/comments`,
    {
      body: JSON.stringify({
        content: body,
        commentType: 1,
        parentCommentId: Number(parent),
        format: "markdown",
      }),
    },
  );
  return { id: String(r.id ?? "") };
}

export interface PrsThreadCreateOptions {
  body?: string;
  path?: string;
  line?: number;
  side?: "LEFT" | "RIGHT";
}

/** Create a PR review thread — general comment, or inline via threadContext
 * when path/line are given. Returns seam-shaped JSON ({thread:{url}}). */
export async function prsThreadCreate(
  repo: string,
  pr: number,
  opts: PrsThreadCreateOptions,
): Promise<{ thread: { url: string } }> {
  if (opts.body === undefined || opts.body === "") {
    throw new ProviderError("prs_thread_create requires a body");
  }
  let threadPayload: Record<string, unknown>;
  if (opts.path !== undefined && opts.path !== "") {
    if (opts.line === undefined) {
      throw new ProviderError("prs_thread_create: path requires line");
    }
    // Azure tracks line ranges: offset >= 1 (0 is rejected with a 400);
    // right side is the default view.
    const pos = { line: opts.line, offset: 1 };
    threadPayload = {
      comments: [{ parentCommentId: 0, content: opts.body, commentType: 1 }],
      status: 1,
      threadContext:
        opts.side === "LEFT"
          ? { filePath: opts.path, leftFileStart: pos }
          : { filePath: opts.path, rightFileStart: pos },
    };
  } else {
    threadPayload = {
      comments: [{ parentCommentId: 0, content: opts.body, commentType: 1 }],
      status: 1,
    };
  }
  const r = await azureHttp<{ id?: number; threadContext?: unknown }>(
    "POST",
    `${prBase(repo)}/pullrequests/${pr}/threads`,
    { body: JSON.stringify(threadPayload) },
  );
  const { org, project, repo: repoName } = azureRepoParts(repo);
  const url =
    `https://dev.azure.com/${azureUri(org)}/${azureUri(project)}/_git/${azureUri(repoName)}/pullrequest/${pr}/_Discussion/Thread/_Discuss?ThreadId=${r.id ?? ""}`;
  return { thread: { url } };
}

export interface PrsThreadResolveOptions {
  /** A ref without a repo routes to DEVENV_REPO (the resolved target). */
  repo?: string;
}

/** Resolve a review thread (status -> fixed). Accepts <repo> <pr>/<thread>
 * positionally, or a single '<repo>/<pr>/<thread>' route (split from the END:
 * repo specs may be org/project/repo). Returns "true" when the thread reads
 * resolved, "unknown" when Azure answers without a status. */
export async function prsThreadResolve(
  repoOrRef: string,
  refOrUndefined?: string,
  opts: PrsThreadResolveOptions = {},
): Promise<string> {
  let repo = "";
  let ref = "";
  if (refOrUndefined === undefined) {
    ref = repoOrRef;
    // Split the trailing /<pr>/<thread> off the END: repo specs may be
    // org/project/repo (two slashes) or project/repo (one) — first-slash
    // parsing would mangle either. Bash parity: any ref with 2+ slashes
    // carries the repo prefix; exactly one slash is already '<pr>/<thread>'.
    const parts = ref.split("/");
    if (parts.length >= 3) {
      const threadId = parts[parts.length - 1];
      const pr = parts[parts.length - 2];
      repo = parts.slice(0, parts.length - 2).join("/");
      ref = `${pr}/${threadId}`;
    }
  } else {
    repo = repoOrRef;
    ref = refOrUndefined;
  }
  const m = /^(\d+)\/(\d+)$/.exec(ref);
  if (m === null) {
    throw new ProviderError(
      "azure thread refs are '<pr>/<thread>' — take the id from pr-threads-get output",
    );
  }
  const pr = m[1] as string;
  const threadId = m[2] as string;
  if (repo === "") repo = opts.repo ?? "";
  if (repo === "") {
    throw new ProviderError(
      "azure thread routes are repositories-qualified and no repository could be resolved — set DEVENV_REPO or pass '<repo>/<pr>/<thread>'",
    );
  }
  // Thread routes are repositories-qualified: /_apis/git/repositories/
  // {repo}/pullrequests/{pr}/threads/{thread}. The project-git base is an
  // MVC 404 (live-verified). The status PATCH takes the thread object under
  // plain application/json — a JSON-Patch array fails (live-verified).
  const r = await azureHttp<{ status?: string }>(
    "PATCH",
    `${prBase(repo)}/pullrequests/${pr}/threads/${threadId}`,
    { body: JSON.stringify({ status: "fixed" }) },
  );
  const s = r.status ?? "";
  return s !== "" && s !== "active" && s !== "pending" ? "true" : "unknown";
}

void unknownOption;
void needValue;
