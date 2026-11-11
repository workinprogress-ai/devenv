// providers/facade/prs.ts — the provider-neutral pull-request family.
//
// The only import surface tools use for PR verbs. The github contract is
// GhResult-shaped ({stdout, status}) and every tool consumes that — the
// facade keeps it as the neutral return and adapts azure's record returns
// into the same shape.
//
// Normalizations owned here (never visible to tools):
//   - comment: github's prsComment takes a body STRING; azure's takes an
//     options object whose --body-file posts the file's CONTENT (the
//     batch-6 as-built divergence). The neutral verb takes the options
//     object; github reads the file, azure's verb reads it. Returns the
//     display value in stdout (comment URL / thread id).
//   - list/view/diff: azure's record-or-string returns stringify into
//     stdout; github passes through untouched (byte-identical).
//   - create: azure returns the new PR id; the facade stringifies it into
//     stdout (github's stdout carries the PR URL — both are the seam's
//     one-line display reference; pr-create parses either).
//   - merge: azure's completion record stringifies to stdout; github's
//     gh stdout passes through; status is 0 on success for both (the
//     callers' `r.status === 0` checks hold).
//   - thread verbs: github's GhResult/GhResult-ish returns pass through;
//     azure's {id}/{thread:{url}} records stringify to stdout. threadReply
//     takes the numeric comment id on github and the thread-ref on azure —
//     the neutral verb keeps github's positional shape and forwards the
//     ref to azure (its verb parses `<pr>/<thread>` routes).
//   - threadsPage: both providers emit the graphql-shaped page JSON —
//     the shared pr-threads-get pagination loop consumes either verbatim.
//
// The module never exits; failures throw ProviderError and callers decide.

import { ProviderError, providerRepoTarget } from "../provider-core.ts";
import type { GhResult } from "../github/transport.ts";
import { loadProviderModules } from "./provider-loader.ts";
import type * as ghTypes from "../github/prs.ts";
import type * as azTypes from "../azure/prs.ts";
import type { PrsCreateOptions as GhPrsCreateOptions } from "../github/prs.ts";
import type { PrsCreateOptions as AzPrsCreateOptions } from "../azure/prs.ts";
import type { PrsListOptions as AzPrsListOptions } from "../azure/prs.ts";

type GithubPrs = typeof ghTypes;
type AzurePrs = typeof azTypes;

/** The neutral create-options shape (github's superset; azure maps it). */
export type PrsCreateOptions = GhPrsCreateOptions;

/** Thread record shape (github's graphql page nodes; azure maps to the
 * same page shape). Re-exported for the pagination tool's typing. */
export type GhThread = ghTypes.GhThread;

/** The neutral comment-options shape (the normalized divergence). */
export interface PrsCommentOptions {
  body?: string;
  bodyFile?: string;
}

async function load(): Promise<{ provider: string; gh: GithubPrs | undefined; az: AzurePrs | undefined }> {
  const loaded = await loadProviderModules("prs");
  if (loaded.provider === "azure") {
    return { provider: "azure", gh: undefined, az: loaded.get<AzurePrs>("prs.ts") };
  }
  return { provider: "github", gh: loaded.get<GithubPrs>("prs.ts"), az: undefined };
}

function ghResult(stdout: string, status = 0): GhResult {
  return { stdout, stderr: "", status };
}

/** List PRs. Pass-through of caller flag lists (mirrors bash). */
export async function prsList(
  spec: string | undefined,
  opts: {
    state?: string;
    head?: string;
    base?: string;
    search?: string;
    limit?: number;
    json?: string;
    jq?: string;
    author?: string;
    label?: string;
  } = {},
): Promise<GhResult> {
  const m = await load();
  if (m.provider === "azure") {
    // Azure's seam has no author/label list filters — named errors, never
    // silently dropped filters (the contract's option rule).
    if (opts.author !== undefined) {
      throw new ProviderError("'--author' is not implemented for provider 'azure' yet (github-only seam)");
    }
    if (opts.label !== undefined) {
      throw new ProviderError("'--label' is not implemented for provider 'azure' yet (github-only seam)");
    }
    const az = m.az as AzurePrs;
    const azOpts: AzPrsListOptions = {
      ...(opts.state !== undefined ? { state: opts.state as "open" | "closed" | "merged" | "all" } : {}),
      ...(opts.head !== undefined ? { head: opts.head } : {}),
      ...(opts.base !== undefined ? { base: opts.base } : {}),
      ...(opts.search !== undefined ? { search: opts.search } : {}),
      ...(opts.limit !== undefined ? { limit: opts.limit } : {}),
      ...(opts.json !== undefined ? { json: opts.json } : {}),
      ...(opts.jq !== undefined ? { jq: opts.jq } : {}),
    };
    const out = await az.prsList(spec ?? "", azOpts);
    return ghResult(typeof out === "string" ? out : JSON.stringify(out));
  }
  return m.gh!.prsList(spec, opts);
}

/** View a PR with caller-chosen --json fields (and optional --jq). */
export async function prsView(
  spec: string | undefined,
  number: number,
  opts: { json?: string; jq?: string } = {},
): Promise<GhResult> {
  const m = await load();
  if (m.provider === "azure") {
    const out = await (m.az as AzurePrs).prsView(spec ?? "", number, opts);
    return ghResult(typeof out === "string" ? out : JSON.stringify(out));
  }
  return m.gh!.prsView(spec, number, opts);
}

/** Diff a PR (unified patch text, or bare paths with nameOnly). */
export async function prsDiff(
  spec: string | undefined,
  number: number,
  opts: { nameOnly?: boolean } = {},
): Promise<GhResult> {
  const m = await load();
  if (m.provider === "azure") {
    const out = await (m.az as AzurePrs).prsDiff(spec ?? "", number, opts);
    return ghResult(out);
  }
  return m.gh!.prsDiff(spec, number, opts);
}

export interface PrsMergeOptions {
  /** squash | merge | rebase (the neutral vocabulary); anything else is a named error. */
  method?: string;
  /** Delete the source branch after merging; off unless true. */
  deleteBranch?: boolean;
  admin?: boolean;
  subject?: string;
  body?: string;
  /** Refuse the merge unless the PR head is still this commit. */
  matchHeadCommit?: string;
}

const NEUTRAL_MERGE_METHODS = ["squash", "merge", "rebase"] as const;
type NeutralMergeMethod = (typeof NEUTRAL_MERGE_METHODS)[number];

/** Validate a neutral merge method; an unsupported word is a named error, never a silent default. */
function neutralMergeMethod(method: string | undefined): NeutralMergeMethod | undefined {
  if (method === undefined) return undefined;
  if ((NEUTRAL_MERGE_METHODS as readonly string[]).includes(method)) return method as NeutralMergeMethod;
  throw new ProviderError(
    `unsupported merge method '${method}' (must be one of: ${NEUTRAL_MERGE_METHODS.join(", ")})`,
  );
}

/** The Azure completion strategy for a neutral merge method. */
const AZURE_MERGE_STRATEGY: Record<NeutralMergeMethod, "rebase" | "squash" | "noFastForward"> = {
  rebase: "rebase",
  squash: "squash",
  merge: "noFastForward",
};

/** Merge a PR. */
export async function prsMerge(
  spec: string | undefined,
  number: number,
  opts: PrsMergeOptions = {},
): Promise<GhResult> {
  const method = neutralMergeMethod(opts.method);
  const m = await load();
  if (m.provider === "azure") {
    const azOpts: Parameters<AzurePrs["prsMerge"]>[2] = {
      ...(method !== undefined ? { method: AZURE_MERGE_STRATEGY[method] } : {}),
      ...(opts.deleteBranch !== undefined ? { deleteBranch: opts.deleteBranch } : {}),
      ...(opts.admin !== undefined ? { admin: opts.admin } : {}),
      ...(opts.subject !== undefined ? { subject: opts.subject } : {}),
      ...(opts.body !== undefined ? { body: opts.body } : {}),
      ...(opts.matchHeadCommit !== undefined ? { matchHeadCommit: opts.matchHeadCommit } : {}),
    };
    const out = await (m.az as AzurePrs).prsMerge(spec ?? "", number, azOpts);
    return ghResult(JSON.stringify(out));
  }
  const ghOpts: Parameters<GithubPrs["prsMerge"]>[2] = {
    ...(method !== undefined ? { method } : {}),
    ...(opts.deleteBranch !== undefined ? { deleteBranch: opts.deleteBranch } : {}),
    ...(opts.admin !== undefined ? { admin: opts.admin } : {}),
    ...(opts.subject !== undefined ? { subject: opts.subject } : {}),
    ...(opts.body !== undefined ? { body: opts.body } : {}),
    ...(opts.matchHeadCommit !== undefined ? { matchHeadCommit: opts.matchHeadCommit } : {}),
  };
  return m.gh!.prsMerge(spec, number, ghOpts);
}

/** Create a PR; stdout carries the new PR's URL or id, one line. */
export async function prsCreate(spec: string | undefined, opts: PrsCreateOptions): Promise<GhResult> {
  const m = await load();
  if (m.provider === "azure") {
    const az = m.az as AzurePrs;
    const azOpts: AzPrsCreateOptions = {
      ...(opts.title !== undefined ? { title: opts.title } : {}),
      ...(opts.body !== undefined ? { body: opts.body } : {}),
      ...(opts.head !== undefined ? { head: opts.head } : {}),
      ...(opts.base !== undefined ? { base: opts.base } : {}),
      ...(opts.draft !== undefined ? { draft: opts.draft } : {}),
      ...(opts.reviewer !== undefined ? { reviewers: opts.reviewer } : {}),
      ...(opts.label !== undefined ? { labels: opts.label } : {}),
      // Azure PRs have no assignee: its seam accepts and reports the ignore
      // (the first assignee is the documented representative).
      ...(opts.assignee?.[0] !== undefined ? { assignee: opts.assignee[0] } : {}),
    };
    const id = await az.prsCreate(spec ?? "", azOpts);
    return ghResult(String(id));
  }
  return m.gh!.prsCreate(spec, opts);
}

/** Comment on a PR; stdout carries the display value (comment URL on
 * github, thread id on azure). The --body-file divergence (azure once
 * posted the file PATH) is normalized: both providers read the file's
 * CONTENT — github's here, azure's verb natively. */
export async function prsComment(
  spec: string | undefined,
  number: number,
  opts: PrsCommentOptions,
): Promise<GhResult> {
  const m = await load();
  if (m.provider === "azure") {
    const id = await (m.az as AzurePrs).prsComment(spec ?? "", number, opts);
    return ghResult(id);
  }
  let body = opts.body ?? "";
  if (body === "" && opts.bodyFile !== undefined) {
    const { readFileSync } = await import("node:fs");
    body = opts.bodyFile === "-" ? readFileSync(0, "utf8") : readFileSync(opts.bodyFile, "utf8");
  }
  return m.gh!.prsComment(spec, number, body);
}

/** Reply to a PR review-comment thread. The comment id is the opaque ref
 * pr-threads-get prints (a number on github, `<thread>/<comment>` on azure);
 * it is forwarded unchanged and each provider parses its own shape. */
export async function prsThreadReply(
  spec: string | undefined,
  pr: number,
  commentId: string | number,
  body: string,
): Promise<GhResult> {
  const m = await load();
  if (m.provider === "azure") {
    const out = await (m.az as AzurePrs).prsThreadReply(spec ?? "", pr, String(commentId), body);
    return ghResult(JSON.stringify(out));
  }
  return m.gh!.prsThreadReply(spec, pr, commentId, body);
}

/** Create a PR review thread — general, or inline when path/line are
 * given. stdout carries gh's {thread:{url}} JSON or azure's thread URL. */
export async function prsThreadCreate(
  spec: string | undefined,
  number: number,
  opts: { body: string; path?: string; line?: number; side?: "LEFT" | "RIGHT" },
): Promise<GhResult> {
  const m = await load();
  if (m.provider === "azure") {
    const out = await (m.az as AzurePrs).prsThreadCreate(spec ?? "", number, opts);
    return ghResult(JSON.stringify(out));
  }
  return m.gh!.prsThreadCreate(spec, number, opts);
}

/** Resolve a review thread; stdout carries "true"/"unknown". The thread ref
 * is github's GraphQL node id or azure's `<pr>/<thread>`; azure's thread
 * routes are repository-qualified, so the repo (spec, else DEVENV_REPO) is
 * passed along — github ignores it (a node id is global). */
export async function prsThreadResolve(spec: string | undefined, threadRef: string): Promise<GhResult> {
  const m = await load();
  if (m.provider === "azure") {
    const repo = providerRepoTarget(spec);
    // A fully prefixed '<repo>/<pr>/<thread>' ref (two or more slashes)
    // carries its own repository and is passed through alone, whatever the
    // resolved repo; '<pr>/<thread>' needs the resolved repo beside it.
    const az = m.az as AzurePrs;
    const prefixed = threadRef.split("/").length >= 3;
    const out = repo === "" || prefixed ? await az.prsThreadResolve(threadRef) : await az.prsThreadResolve(repo, threadRef);
    return ghResult(out);
  }
  const out = await m.gh!.prsThreadResolve(threadRef);
  return ghResult(out);
}

/** One page of review threads for a PR (the pagination loop calls this per
 * cursor). Emits the page JSON both providers shape identically. */
export async function prsThreadsPage(
  spec: string | undefined,
  pr: number,
  cursor?: string,
): Promise<GhResult> {
  const m = await load();
  if (m.provider === "azure") {
    const out = await (m.az as AzurePrs).prsThreadsPage(spec ?? "", pr, cursor ?? "");
    return ghResult(JSON.stringify(out));
  }
  return m.gh!.prsThreadsPage(spec, pr, cursor);
}
