// prs.ts — GitHub PR verbs over gh (port of providers/github/prs.bash).
//
// Contract (tools/lib/providers/CONTRACT.md, prs verbs): the repo spec is
// the first positional (empty = the resolved target); verbs throw
// ProviderError on transport/GraphQL failure — never exit. GraphQL
// variables ride `-f`/`-F` (gh does not fill {owner}/{repo} placeholders
// inside a -f query); thread IDs are passed as GraphQL variables, never
// interpolated into query strings.

import { readFileSync } from "node:fs";

import { providerRepoSplit, providerRepoTarget, ghApi } from "../provider-core.ts";
import type { GhOptions, GhResult } from "../provider-core.ts";
import { neutralComment } from "./issues.ts";

function repoArgs(spec: string | undefined): string[] {
  const resolved = providerRepoTarget(spec);
  return resolved === "" ? [] : ["-R", resolved];
}

function ownerName(spec: string | undefined): { owner: string; name: string } {
  return providerRepoSplit(spec);
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export interface PrsListOptions {
  state?: string;
  head?: string;
  base?: string;
  json?: string;
  jq?: string;
  limit?: number;
  author?: string;
  label?: string;
  search?: string;
}

/** List PRs. Pure pass-through of caller flag lists (mirrors bash). */
export async function prsList(spec: string | undefined, opts: PrsListOptions = {}, gh: GhOptions = {}): Promise<GhResult> {
  const args: string[] = ["pr", "list", ...repoArgs(spec)];
  if (opts.state !== undefined) args.push("--state", opts.state);
  if (opts.limit !== undefined) args.push("--limit", String(opts.limit));
  if (opts.author !== undefined) args.push("--author", opts.author);
  if (opts.label !== undefined) args.push("--label", opts.label);
  if (opts.base !== undefined) args.push("--base", opts.base);
  if (opts.head !== undefined) args.push("--head", opts.head);
  if (opts.json !== undefined) args.push("--json", opts.json);
  if (opts.jq !== undefined) args.push("--jq", opts.jq);
  if (opts.search !== undefined) args.push("--search", opts.search);
  return ghApi(args, gh);
}

/** View a PR with caller-chosen --json fields (and optional --jq). */
export async function prsView(
  spec: string | undefined,
  number: number,
  opts: { json?: string; jq?: string } = {},
  gh: GhOptions = {},
): Promise<GhResult> {
  const args: string[] = ["pr", "view", String(number)];
  if (opts.json !== undefined) args.push("--json", opts.json);
  if (opts.jq !== undefined) args.push("--jq", opts.jq);
  args.push(...repoArgs(spec));
  return ghApi(args, gh);
}

/** Diff a PR (raw patch text on stdout; `--name-only` lists file paths). */
export async function prsDiff(spec: string | undefined, number: number, opts: { nameOnly?: boolean } = {}, gh: GhOptions = {}): Promise<GhResult> {
  const args: string[] = ["pr", "diff", String(number)];
  if (opts.nameOnly === true) args.push("--name-only");
  args.push(...repoArgs(spec));
  return ghApi(args, gh);
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

export interface PrsCreateOptions {
  title?: string;
  body?: string;
  bodyFile?: string;
  head: string;
  base: string;
  draft?: boolean;
  reviewer?: string[];
  assignee?: string[];
  label?: string[];
}

/** Create a PR (stdout is the new PR's URL on GitHub). The body rides
 * stdin (`--body-file -`), matching the bash verb. */
export async function prsCreate(spec: string | undefined, opts: PrsCreateOptions, gh: GhOptions = {}): Promise<GhResult> {
  if (opts.bodyFile !== undefined && opts.body !== undefined) {
    throw new Error("provider_prs_create: body and bodyFile are mutually exclusive");
  }
  const args: string[] = ["pr", "create", ...repoArgs(spec), "--title", opts.title ?? "", "--body-file", "-"];
  args.push("--head", opts.head, "--base", opts.base);
  if (opts.draft) args.push("--draft");
  for (const r of opts.reviewer ?? []) args.push("--reviewer", r);
  for (const a of opts.assignee ?? []) args.push("--assignee", a);
  for (const l of opts.label ?? []) args.push("--label", l);
  const input = opts.bodyFile !== undefined ? readFileSync(opts.bodyFile, "utf8") : (opts.body ?? "");
  return ghApi(args, { ...gh, input });
}

export interface PrsMergeOptions {
  /** squash | merge | rebase (the tooling policy default is rebase). */
  method?: "squash" | "merge" | "rebase";
  subject?: string;
  body?: string;
  deleteBranch?: boolean;
  admin?: boolean;
}

/** Merge a PR (callers pass the method explicitly). */
export async function prsMerge(
  spec: string | undefined,
  number: number,
  opts: PrsMergeOptions = {},
  gh: GhOptions = {},
): Promise<GhResult> {
  const args: string[] = ["pr", "merge", String(number)];
  const method = opts.method ?? "rebase";
  args.push(`--${method}`);
  if (opts.subject !== undefined) args.push("--subject", opts.subject);
  if (opts.body !== undefined) args.push("--body", opts.body);
  if (opts.deleteBranch !== false) args.push("--delete-branch");
  if (opts.admin === true) args.push("--admin");
  args.push(...repoArgs(spec));
  return ghApi(args, gh);
}

/** Comment on a PR (stdout is the comment URL). */
export async function prsComment(
  spec: string | undefined,
  number: number,
  body: string,
  gh: GhOptions = {},
): Promise<GhResult> {
  return ghApi(["pr", "comment", String(number), ...repoArgs(spec), "--body", body], gh);
}

// ---------------------------------------------------------------------------
// Review threads (REST + GraphQL)
// ---------------------------------------------------------------------------

export interface GhComment {
  id: number;
  nodeId: string;
  author?: { login?: string };
  body: string;
  createdAt?: string;
  url?: string;
}

export interface GhThread {
  id: string;
  isResolved?: boolean;
  path?: string;
  line?: number | null;
  startLine?: number | null;
  diffSide?: string;
  comments: { nodes: GhComment[]; pageInfo?: { hasNextPage: boolean } };
}

export interface ThreadsPage {
  data: {
    repository?: {
      pullRequest?: {
        reviewThreads?: {
          pageInfo: { hasNextPage: boolean; endCursor?: string };
          nodes: GhThread[];
        };
      };
    };
  };
}

/** Reply to a PR review comment thread (REST). The reply JSON is projected
 * to the seam shape (`url` from gh's `html_url`) exactly as the bash
 * provider's `_gh_neutral_comment` did — callers read `.url`. */
export async function prsThreadReply(
  spec: string | undefined,
  pr: number,
  commentId: number,
  body: string,
  gh: GhOptions = {},
): Promise<GhResult> {
  const { owner, name } = ownerName(spec);
  const r = await ghApi(
    ["api", "-X", "POST", `/repos/${owner}/${name}/pulls/${pr}/comments/${commentId}/replies`, "-f", `body=${body}`],
    gh,
  );
  try {
    return { ...r, stdout: JSON.stringify(neutralComment(JSON.parse(r.stdout))) };
  } catch {
    // Non-JSON body: pass through unchanged (callers handle parse failure).
    return r;
  }
}

/** Create a PR review thread — general, or inline when path/line are given.
 * Emits gh-shaped JSON ({thread:{url}}); the caller extracts the URL. */
export async function prsThreadCreate(
  spec: string | undefined,
  number: number,
  opts: { body: string; path?: string; line?: number; side?: "LEFT" | "RIGHT" },
  gh: GhOptions = {},
): Promise<GhResult> {
  if (opts.path !== undefined && opts.line === undefined) {
    throw new Error("provider_prs_thread_create: --path requires --line");
  }
  const prId = (await prsView(spec, number, { json: "id", jq: ".id" }, gh)).stdout.trim();
  if (prId === "" || prId === "null") {
    throw new Error("provider_prs_thread_create: cannot resolve PR node id");
  }
  const { owner, name } = ownerName(spec);
  const repoNodeId = (
    await ghApi(
      [
        "api", "graphql",
        "-f", "query=query($o:String!,$r:String!){repository(owner:$o,name:$r){id}}",
        "-f", `o=${owner}`,
        "-f", `r=${name}`,
        "--jq", ".data.repository.id",
      ],
      gh,
    )
  ).stdout.trim();
  if (repoNodeId === "" || repoNodeId === "null") {
    throw new Error("provider_prs_thread_create: cannot resolve repository node id");
  }
  // GraphQL variables must not be shell-expanded; the query is a fixed
  // document built by branch: the general thread (body only) and the inline
  // thread (path/line/side) are separate documents, each syntactically
  // complete — never a spliced partial variable definition.
  const args = ["api", "graphql", "-f", `pr=${prId}`, "-f", `body=${opts.body}`, "-f", `repo=${repoNodeId}`];
  let query: string;
  if (opts.path !== undefined) {
    query = `mutation($pr: ID!, $body: String!, $repo: ID!, $path: String!, $line: Int!, $side: PullRequestReviewThreadSide!) {
        addPullRequestReviewThread(input: {
            pullRequestId: $pr,
            body: $body,
            repositoryId: $repo,
            path: $path, line: $line, side: $side
        }) { thread { url } }
    }`;
    args.push("-f", `path=${opts.path}`, "-F", `line=${opts.line}`, "-f", `side=${opts.side ?? "RIGHT"}`);
  } else {
    query = `mutation($pr: ID!, $body: String!, $repo: ID!) {
        addPullRequestReviewThread(input: {
            pullRequestId: $pr,
            body: $body,
            repositoryId: $repo
        }) { thread { url } }
    }`;
  }
  args.push("-f", `query=${query}`);
  const r = await ghApi(args, gh);
  // Normalize to the verb's gh-shaped contract ({thread:{url}}) — the raw
  // graphql envelope stays provider-internal (bash parity: the jq
  // projection at the end of provider_prs_thread_create).
  try {
    const parsed = JSON.parse(r.stdout) as {
      errors?: Array<{ message?: string }>;
      data?: { addPullRequestReviewThread?: { thread?: { url?: string } } };
    };
    if (parsed.errors && parsed.errors.length > 0) {
      throw new Error(`provider_prs_thread_create: GraphQL error posting the thread`);
    }
    const url = parsed.data?.addPullRequestReviewThread?.thread?.url ?? "";
    return { ...r, stdout: JSON.stringify({ thread: { url } }) };
  } catch (err) {
    if (err instanceof Error && err.message.startsWith("provider_prs_thread_create:")) throw err;
    // Non-JSON body: pass through unchanged (callers handle parse failure).
    return r;
  }
}

/** Resolve a PR review thread by node ID. Prints the thread's isResolved
 * state (true/false/unknown); throws named on transport or GraphQL errors.
 * The mutation passes the thread ID as a GraphQL variable. */
export async function prsThreadResolve(threadId: string, gh: GhOptions = {}): Promise<string> {
  if (threadId === "") {
    throw new Error("provider_prs_thread_resolve: thread node ID is required");
  }
  const mutation = `mutation($threadId: ID!) {
      resolveReviewThread(input: {threadId: $threadId}) {
        thread { id isResolved }
      }
    }`;
  const r = await ghApi(["api", "graphql", "-f", `query=${mutation}`, "-f", `threadId=${threadId}`], gh);
  const parsed = JSON.parse(r.stdout) as { errors?: unknown[]; data?: { resolveReviewThread?: { thread?: { isResolved?: boolean } } } };
  if (parsed.errors && parsed.errors.length > 0) {
    throw new Error(`provider_prs_thread_resolve: GraphQL error resolving ${threadId}`);
  }
  return String(parsed.data?.resolveReviewThread?.thread?.isResolved ?? "unknown");
}

/** One page of review threads for a PR (the pagination loop calls this per
 * cursor). Emits the raw GraphQL response JSON. */
export async function prsThreadsPage(
  spec: string | undefined,
  pr: number,
  cursor?: string,
  gh: GhOptions = {},
): Promise<GhResult> {
  const { owner, name } = ownerName(spec);
  const args = ["api", "graphql", "-f", `query=${QUERY_PR_THREADS}`, "-f", `owner=${owner}`, "-f", `repo=${name}`, "-F", `pr=${pr}`];
  if (cursor !== undefined && cursor !== "") args.push("-f", `cursor=${cursor}`);
  return ghApi(args, gh);
}

export { ownerName as _ownerName, repoArgs as _repoArgs, providerRepoTarget };

/** The threads-page query document (single definition; passed as a GraphQL
 * variable payload). A thread's comments are read 50 at a time; more than
 * that truncates silently (the verb warns on the page's hasNextPage). */
export const QUERY_PR_THREADS = `query($owner: String!, $repo: String!, $pr: Int!, $cursor: String) {
  repository(owner: $owner, name: $repo) {
    pullRequest(number: $pr) {
      reviewThreads(first: 100, after: $cursor) {
        pageInfo { hasNextPage endCursor }
        nodes {
          id
          isResolved
          path
          line
          startLine
          diffSide
          comments(first: 50) {
            pageInfo { hasNextPage }
            nodes {
              id
              databaseId
              author { login }
              body
              createdAt
              url
            }
          }
        }
      }
    }
  }
}`;
