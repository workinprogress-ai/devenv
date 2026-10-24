// github/issues.ts — the GitHub provider's issues domain in TypeScript.
//
// Implements the CONTRACT.md Issues verbs: list / view / exists / create /
// edit / close / reopen / comment / comments / comment_add / comment_get /
// comment_edit / set_type / milestones, the label verbs, and the sub-issue
// graph verbs. One verb per contract row; options are validated strictly
// (an unlisted option is a named error, never dropped silently).
//
// Shape contract: neutral field names (`url` not `html_url` etc.) — comment
// records are projected from gh's dialect exactly as `_gh_neutral_comment`
// does in the bash provider. State is `OPEN`/`CLOSED`.
//
// github-only: declares the `native-issue-types` capability (mirrors
// issues.bash's declaration). The module never exits; failures throw
// ProviderError and callers decide.

import {
  ProviderError,
  providerDeclareCapability,
  providerRepoSplit,
  providerRequireCapability,
  ghApi,
  ghApiSync,
  ghApiPaginate,
  unknownOption,
  needValue,
  type GhOptions,
} from "../provider-core.ts";

providerDeclareCapability("native-issue-types");

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/** `-R owner/repo` when a spec is present; empty array otherwise (the bash
 * `provider_repo_args` contract — an empty spec means gh's cwd resolution). */
function repoArgs(spec?: string): string[] {
  const repo = spec ?? "";
  return repo === "" ? [] : ["-R", repo];
}

/** Project gh's comment JSON to the seam shape: `url` replaces `html_url`,
 * recursively, exactly as `_gh_neutral_comment`'s jq program does. */
export function neutralComment(raw: unknown): unknown {
  if (Array.isArray(raw)) return raw.map(neutralComment);
  if (raw !== null && typeof raw === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      if (k === "html_url") continue;
      out[k] = neutralComment(v);
    }
    if ("html_url" in (raw as Record<string, unknown>)) {
      out["url"] = neutralComment((raw as Record<string, unknown>)["html_url"]);
    }
    return out;
  }
  return raw;
}

/** Split an `owner/name` spec once; for the graphql verbs. */
function ownerName(spec?: string): { owner: string; name: string } {
  return providerRepoSplit(spec);
}

/** Resolve an issue's graphql node id in the target repository. */
function issueNodeId(number: number, spec?: string): string {
  const { owner, name } = ownerName(spec);
  const r = ghApiSync([
    "api",
    "graphql",
    "-f",
    "query=query($o:String!,$r:String!,$n:Int!){repository(owner:$o,name:$r){issue(number:$n){id}}}",
    "-f",
    `o=${owner}`,
    "-f",
    `r=${name}`,
    "-F",
    `n=${number}`,
    "--jq",
    ".data.repository.issue.id",
  ]);
  const id = r.stdout.trim();
  if (id === "") throw new ProviderError(`could not resolve issue #${number}'s node id`);
  return id;
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
  const args: string[] = ["issue", "list", ...repoArgs(spec)];
  if (opts.state !== undefined) args.push("--state", opts.state);
  for (const l of opts.label ?? []) args.push("--label", l);
  for (const a of opts.assignee ?? []) args.push("--assignee", a);
  if (opts.milestone !== undefined) args.push("--milestone", opts.milestone);
  if (opts.author !== undefined) args.push("--author", opts.author);
  if (opts.mention !== undefined) args.push("--mention", opts.mention);
  if (opts.type !== undefined) args.push("--type", opts.type);
  if (opts.limit !== undefined) args.push("--limit", String(opts.limit));
  if (opts.search !== undefined) args.push("--search", opts.search);
  if (opts.json !== undefined) args.push("--json", opts.json);
  if (opts.jq !== undefined) args.push("--jq", opts.jq);
  if (opts.web) args.push("--web");
  if (opts.lock) args.push("--lock");
  return (await ghApi(args)).stdout;
}

/** View a single issue (JSON by default). */
export async function issuesView(
  spec: string | undefined,
  number: number,
  opts: { json?: string; jq?: string } = {},
): Promise<string> {
  const args: string[] = ["issue", "view", String(number), ...repoArgs(spec)];
  if (opts.json !== undefined) args.push("--json", opts.json);
  if (opts.jq !== undefined) args.push("--jq", opts.jq);
  return (await ghApi(args)).stdout;
}

/** Presence test: exit-status semantics (no output), errors tolerated. */
export async function issuesExists(spec: string | undefined, number: number): Promise<boolean> {
  const r = await ghApi(["issue", "view", String(number), ...repoArgs(spec), "--json", "number"], {
    tolerateFailure: true,
  });
  return r.status === 0;
}

/** List an issue's comments (paginated), projected to the seam shape. */
export async function issuesComments(spec: string | undefined, number: number): Promise<string> {
  const repo = spec ?? "{owner}/{repo}";
  const r = await ghApiPaginate(["api", `repos/${repo}/issues/${number}/comments`]);
  const parsed: unknown = JSON.parse(r.stdout);
  return JSON.stringify(neutralComment(parsed));
}

/** List milestones (raw gh REST JSON — the bash verb's pass-through). */
export async function issuesMilestones(spec: string | undefined): Promise<string> {
  const repo = spec ?? "{owner}/{repo}";
  return (await ghApi(["api", `repos/${repo}/milestones`])).stdout;
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

/** Create an issue. Returns gh's stdout (the new issue's URL). */
export async function issuesCreate(spec: string | undefined, opts: IssuesCreateOptions): Promise<string> {
  const args: string[] = ["issue", "create", ...repoArgs(spec), "--title", opts.title];
  if (opts.body !== undefined) args.push("--body", opts.body);
  if (opts.bodyFile !== undefined) args.push("--body-file", opts.bodyFile);
  for (const l of opts.label ?? []) args.push("--label", l);
  for (const a of opts.assignee ?? []) args.push("--assignee", a);
  if (opts.type !== undefined) args.push("--type", opts.type);
  if (opts.milestone !== undefined) args.push("--milestone", opts.milestone);
  for (const p of opts.project ?? []) args.push("--project", p);
  if (opts.web) args.push("--web");
  if (opts.dryRun) args.push("--dry-run");
  return (await ghApi(args)).stdout;
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

/** Edit an issue (`--body-file -` reads stdin via opts.input). */
export async function issuesEdit(
  spec: string | undefined,
  number: number,
  opts: IssuesEditOptions,
  gh: GhOptions = {},
): Promise<string> {
  const args: string[] = ["issue", "edit", String(number), ...repoArgs(spec)];
  if (opts.title !== undefined) args.push("--title", opts.title);
  if (opts.body !== undefined) args.push("--body", opts.body);
  if (opts.bodyFile !== undefined) args.push("--body-file", opts.bodyFile);
  for (const l of opts.addLabel ?? []) args.push("--add-label", l);
  for (const l of opts.removeLabel ?? []) args.push("--remove-label", l);
  for (const a of opts.addAssignee ?? []) args.push("--add-assignee", a);
  for (const a of opts.removeAssignee ?? []) args.push("--remove-assignee", a);
  if (opts.milestone !== undefined) args.push("--milestone", opts.milestone);
  if (opts.type !== undefined) args.push("--type", opts.type);
  return (await ghApi(args, gh)).stdout;
}

/** Close an issue. `--reason` is gh's `completed|not planned`. */
export async function issuesClose(
  spec: string | undefined,
  number: number,
  opts: { reason?: string; comment?: string } = {},
): Promise<string> {
  const args: string[] = ["issue", "close", String(number), ...repoArgs(spec)];
  if (opts.reason !== undefined) args.push("--reason", opts.reason);
  if (opts.comment !== undefined) args.push("--comment", opts.comment);
  return (await ghApi(args)).stdout;
}

/** Reopen an issue, optionally leaving a comment. */
export async function issuesReopen(
  spec: string | undefined,
  number: number,
  opts: { comment?: string } = {},
): Promise<string> {
  const args: string[] = ["issue", "reopen", String(number), ...repoArgs(spec)];
  if (opts.comment !== undefined) args.push("--comment", opts.comment);
  return (await ghApi(args)).stdout;
}

/** Comment on an issue; returns the new comment's URL (display value). */
export async function issuesComment(
  spec: string | undefined,
  number: number,
  opts: { body?: string; bodyFile?: string },
): Promise<string> {
  const args: string[] = ["issue", "comment", String(number), ...repoArgs(spec)];
  if (opts.body !== undefined) args.push("--body", opts.body);
  if (opts.bodyFile !== undefined) args.push("--body-file", opts.bodyFile);
  return (await ghApi(args)).stdout;
}

// ---------------------------------------------------------------------------
// Comment contract verbs (record-shaped, REST-backed)
// ---------------------------------------------------------------------------

function commentEndpoint(spec: string | undefined, suffix: string): string {
  const repo = spec ?? "{owner}/{repo}";
  return `repos/${repo}/${suffix}`;
}

async function readCommentBody(opts: { body?: string; bodyFile?: string }, verb: string): Promise<string> {
  if (opts.body !== undefined && opts.bodyFile !== undefined) {
    throw new ProviderError(`${verb}: --body and --body-file are mutually exclusive`);
  }
  if (opts.body !== undefined) return opts.body;
  if (opts.bodyFile !== undefined) {
    const { readFileSync } = await import("node:fs");
    if (opts.bodyFile === "-") {
      return (await import("node:fs")).readFileSync(0, "utf8");
    }
    return readFileSync(opts.bodyFile, "utf8");
  }
  throw new ProviderError(`${verb} requires --body`);
}

/** Create a comment; emits the created comment record (seam shape) — unlike
 * issuesComment, whose bare URL is for interactive callers. */
export async function issuesCommentAdd(
  spec: string | undefined,
  number: number,
  opts: { body?: string; bodyFile?: string },
): Promise<string> {
  const body = await readCommentBody(opts, "provider_issues_comment_add");
  // Large bodies exceed the exec argv limit (E2BIG at ~128KB): body on
  // stdin via --input as the request JSON, same as comment-edit.
  const json = JSON.stringify({ body });
  const r = await ghApi(
    ["api", "-X", "POST", commentEndpoint(spec, `issues/${number}/comments`), "--input", "-"],
    { input: json },
  );
  return JSON.stringify(neutralComment(JSON.parse(r.stdout)));
}

/** Fetch one comment as seam-shaped JSON; fails defined when absent. */
export async function issuesCommentGet(spec: string | undefined, commentRef: string): Promise<string> {
  const r = await ghApi(["api", commentEndpoint(spec, `issues/comments/${commentRef}`)], {
    tolerateFailure: true,
  });
  if (r.status !== 0) {
    throw new ProviderError(`comment '${commentRef}' not found${r.stderr.trim() ? `: ${r.stderr.trim()}` : ""}`);
  }
  return JSON.stringify(neutralComment(JSON.parse(r.stdout)));
}

/** Replace a comment's body; emits the updated record (seam shape). */
export async function issuesCommentEdit(
  spec: string | undefined,
  commentRef: string,
  opts: { body?: string; bodyFile?: string },
): Promise<string> {
  const body = await readCommentBody(opts, "provider_issues_comment_edit");
  // Large bodies exceed the exec argv limit (E2BIG at ~128KB): hand gh the
  // body on stdin via --input instead of an inline -f arg. --input expects
  // the request's JSON shape: {"body": "..."}.
  const json = JSON.stringify({ body });
  const r = await ghApi(
    [
      "api",
      "-X",
      "PATCH",
      commentEndpoint(spec, `issues/comments/${commentRef}`),
      "--input",
      "-",
    ],
    { input: json },
  );
  return JSON.stringify(neutralComment(JSON.parse(r.stdout)));
}

// ---------------------------------------------------------------------------
// Native issue types (capability-gated)
// ---------------------------------------------------------------------------

/** Set an issue's native type. Normalization (aliases/case) stays in the
 * domain config layer — the facade takes the already-normalized name. */
export async function issuesSetType(
  owner: string,
  name: string,
  number: number,
  typeName: string,
): Promise<void> {
  providerRequireCapability("native-issue-types");
  await ghApi(["issue", "edit", String(number), "--type", typeName], {
    env: { GH_REPO: `${owner}/${name}` },
  });
}

// ---------------------------------------------------------------------------
// Labels
// ---------------------------------------------------------------------------

/** List labels (pure pass-through of caller field lists). */
export async function issuesLabelList(spec: string | undefined, opts: { json?: string; jq?: string; limit?: number } = {}): Promise<string> {
  const args: string[] = ["label", "list", ...repoArgs(spec)];
  if (opts.limit !== undefined) args.push("--limit", String(opts.limit));
  if (opts.json !== undefined) args.push("--json", opts.json);
  if (opts.jq !== undefined) args.push("--jq", opts.jq);
  return (await ghApi(args)).stdout;
}

/** Create a label if absent (idempotent). Distinguishes "cannot list" from
 * "not listed" — a permissions failure must not masquerade as absent. */
export async function issuesLabelEnsure(
  spec: string | undefined,
  name: string,
  color = "ededed",
  description = "Automated process",
): Promise<void> {
  const r = await ghApi(
    [...["label", "list", ...repoArgs(spec)], "--limit", "1000", "--json", "name", "--jq", ".[].name"],
  );
  const listed = r.stdout.split("\n").map((l) => l.trim());
  if (listed.includes(name)) return;
  await ghApi(["label", "create", name, ...repoArgs(spec), "--color", color, "--description", description]);
}

/** Create a label (fails when it exists — gh's own semantics). */
export async function issuesLabelCreate(
  spec: string | undefined,
  name: string,
  color?: string,
  description?: string,
): Promise<string> {
  const args: string[] = ["label", "create", name, ...repoArgs(spec)];
  if (color !== undefined) args.push("--color", color);
  if (description !== undefined) args.push("--description", description);
  return (await ghApi(args)).stdout;
}

/** Update a label's color/description/name. */
export async function issuesLabelUpdate(
  spec: string | undefined,
  name: string,
  opts: { newName?: string; color?: string; description?: string } = {},
): Promise<string> {
  const args: string[] = ["label", "edit", name, ...repoArgs(spec)];
  if (opts.newName !== undefined) args.push("--name", opts.newName);
  if (opts.color !== undefined) args.push("--color", opts.color);
  if (opts.description !== undefined) args.push("--description", opts.description);
  return (await ghApi(args)).stdout;
}

// ---------------------------------------------------------------------------
// Sub-issue graph (graphql)
// ---------------------------------------------------------------------------

/** Link a child issue under a parent via native sub-issues. */
export async function issueGraphLink(spec: string | undefined, parent: number, child: number): Promise<void> {
  const pid = issueNodeId(parent, spec);
  const cid = issueNodeId(child, spec);
  await ghApi([
    "api",
    "graphql",
    "-f",
    "query=mutation($p:ID!,$c:ID!){addSubIssue(input:{issueId:$p,subIssueId:$c}){issue{number}}}",
    "-f",
    `p=${pid}`,
    "-f",
    `c=${cid}`,
  ]);
}

/** Unlink a child issue from its parent. */
export async function issueGraphUnlink(spec: string | undefined, parent: number, child: number): Promise<void> {
  const pid = issueNodeId(parent, spec);
  const cid = issueNodeId(child, spec);
  await ghApi([
    "api",
    "graphql",
    "-f",
    "query=mutation($p:ID!,$c:ID!){removeSubIssue(input:{issueId:$p,subIssueId:$c}){issue{number}}}",
    "-f",
    `p=${pid}`,
    "-f",
    `c=${cid}`,
  ]);
}

/** List a parent's sub-issue children (numbers). Up to 50: beyond any
 * planned decomposition — a larger tree should split, not query deeper. */
export async function issueGraphChildren(spec: string | undefined, parent: number): Promise<number[]> {
  const { owner, name } = ownerName(spec);
  const r = await ghApi([
    "api",
    "graphql",
    "-f",
    "query=query($o:String!,$r:String!,$n:Int!){repository(owner:$o,name:$r){issue(number:$n){subIssues(first:50){nodes{number}}}}}",
    "-f",
    `o=${owner}`,
    "-f",
    `r=${name}`,
    "-F",
    `n=${parent}`,
    "--jq",
    ".data.repository.issue.subIssues.nodes[].number",
  ]);
  return r.stdout
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l !== "")
    .map((l) => Number.parseInt(l, 10));
}

/** Resolve an issue's native parent number, or null when unlinked. */
export async function issueGraphParent(spec: string | undefined, issue: number): Promise<number | null> {
  const { owner, name } = ownerName(spec);
  const r = await ghApi([
    "api",
    "graphql",
    "-f",
    "query=query($o:String!,$r:String!,$n:Int!){repository(owner:$o,name:$r){issue(number:$n){parent{number}}}}",
    "-f",
    `o=${owner}`,
    "-f",
    `r=${name}`,
    "-F",
    `n=${issue}`,
    "--jq",
    ".data.repository.issue.parent.number",
  ]);
  const out = r.stdout.trim();
  if (out === "" || out === "null") return null;
  const n = Number.parseInt(out, 10);
  return Number.isNaN(n) ? null : n;
}

/** Issue web URL (the contract's display-address verb). */
export function issueWebUrl(spec: string, number: number): string {
  const { owner, name } = providerRepoSplit(spec);
  return `https://github.com/${owner}/${name}/issues/${number}`;
}

// ---------------------------------------------------------------------------
// Org-level issue types (native-issue-types capability)
// ---------------------------------------------------------------------------

export interface OrgIssueType {
  id: string;
  name: string;
}

/** List the organization's configured issue types (first 100; a larger org
 * warns in the bash verb — here the caller sees hasNextPage via a throw on
 * the truncation contract's behalf: the field set stays {id, name}). */
export async function orgIssueTypes(org: string): Promise<OrgIssueType[]> {
  providerRequireCapability("native-issue-types");
  const r = await ghApi([
    "api",
    "graphql",
    "-f",
    "query=query($o:String!){organization(login:$o){issueTypes(first:100){edges{node{id name}} pageInfo{hasNextPage}}}}",
    "-f",
    `o=${org}`,
  ]);
  const parsed = JSON.parse(r.stdout) as {
    errors?: Array<{ message?: string }>;
    data?: { organization?: { issueTypes?: { edges?: Array<{ node?: OrgIssueType }>; pageInfo?: { hasNextPage?: boolean } } } };
  };
  if (parsed.errors && parsed.errors.length > 0) {
    throw new ProviderError(`orgIssueTypes: GraphQL error for '${org}': ${parsed.errors[0]?.message ?? "unknown"}`);
  }
  if (parsed.data?.organization?.issueTypes?.pageInfo?.hasNextPage === true) {
    // The truncation contract: a silently short type table would make
    // type-set enrichment fail downstream with no visible reason.
    throw new ProviderError(
      `orgIssueTypes: '${org}' has more than 100 issue types — the first page is not the full vocabulary`,
    );
  }
  const edges = parsed.data?.organization?.issueTypes?.edges ?? [];
  return edges
    .map((e) => e.node)
    .filter((n): n is OrgIssueType => n !== undefined && n !== null);
}

// Re-exports for callers that want one import surface for the seam errors.
export { ProviderError, unknownOption, needValue };
