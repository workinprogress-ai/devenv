// github/repos.ts - GitHub implementation of the repos domain facade.
//
// Ports the provider_repos_* verbs the repo-family tools consume (view /
// create / commits-count) plus the seam field-name mapping helper. The
// remaining repos verbs (list / default-branch / edit / protect-branch /
// team-put / collaborator-put / patch) port with their consuming batches per
// the family-batch doctrine — same scope rule the prs/issues ports followed.
// Contract: throw or return non-zero-shaped results on failure; never
// process.exit.

import { ghApi, ghApiSync } from "../provider-core.ts";

export const REPO_SEAM_FIELD_MAP: Record<string, string> = { repoSpec: "nameWithOwner" };

interface RunResult {
  stdout: string;
  stderr: string;
  status: number;
}

/** Rename JSON object keys per the inverse map, recursively (arrays too),
 * then emit one line per record — `gh --json F --jq '.[].name'` prints one
 * value per line, and list consumers (repo-get's org listing) split on
 * newlines. */
export function renameJsonKeys(raw: string, inverse: Record<string, string>): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return raw;
  }
  const ren = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(ren);
    if (v !== null && typeof v === "object") {
      const out: Record<string, unknown> = {};
      for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
        out[inverse[k] ?? k] = ren(val);
      }
      return out;
    }
    return v;
  };
  return JSON.stringify(ren(parsed));
}

/** Apply a caller's `-q` jq program to the renamed records. Supports the
 * projection programs the facade's verbs document (`.field`, `.[].field`,
 * `.[N].field`); anything else passes the program through to gh instead (the
 * verb forwards `--jq` untouched when no field mapping is needed). Throws
 * naming the unsupported program — fail loud, never silent. */
export function applyJq(recordsJson: string, program: string): string {
  const eachField = /^\.\[\]\.([A-Za-z_][A-Za-z0-9_]*)$/.exec(program.trim());
  const oneField = /^\.([A-Za-z_][A-Za-z0-9_]*)$/.exec(program.trim());
  const indexField = /^\.\[(\d+)\]\.([A-Za-z_][A-Za-z0-9_]*)$/.exec(program.trim());
  let parsed: unknown;
  try {
    parsed = JSON.parse(recordsJson);
  } catch {
    throw new Error(`applyJq: invalid JSON records for program '${program}'`);
  }
  // Null results produce no output line, matching the bash seam's trailing
  // `| select(. != null)` on every projection.
  const value = (rec: unknown, field: string): string | null => {
    const v = (rec as Record<string, unknown> | null)?.[field];
    if (v === undefined || v === null) return null;
    return typeof v === "string" ? v : JSON.stringify(v);
  };
  if (eachField && eachField[1] !== undefined) {
    if (!Array.isArray(parsed)) throw new Error(`applyJq: program '${program}' requires an array; got non-array JSON`);
    return parsed
      .map((rec) => value(rec, eachField[1] as string))
      .filter((v) => v !== null)
      .join("\n");
  }
  if (oneField && oneField[1] !== undefined) {
    return value(parsed, oneField[1]) ?? "";
  }
  if (indexField && indexField[1] !== undefined && indexField[2] !== undefined) {
    if (!Array.isArray(parsed)) throw new Error(`applyJq: program '${program}' requires an array; got non-array JSON`);
    const rec = parsed[Number(indexField[1])];
    return value(rec, indexField[2]) ?? "";
  }
  throw new Error(
    `applyJq: unsupported jq program '${program}' — the seam supports '.field', '.[].field' and '.[N].field'; pass other programs through to gh --jq`,
  );
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export interface ReposViewOptions {
  json?: string;
  jq?: string;
}

export interface ReposListOptions {
  limit?: number;
  json?: string;
  jq?: string;
}

/** List an org's repos. --json FIELDS use the seam's names (mapped out and
 * back, per `_gh_json_run`); -q applies to the neutral records here, exactly
 * as bash's `_gh_json_run` applied it post-mapping. Supported -q programs:
 * `.field` and `.[].field` (nulls dropped); anything else throws naming the
 * program. */
export async function reposList(org: string, opts: ReposListOptions = {}): Promise<string> {
  const args: string[] = ["repo", "list", org];
  if (opts.limit !== undefined) args.push("--limit", String(opts.limit));
  if (opts.json !== undefined) {
    args.push("--json", opts.json.split(",").map((f) => REPO_SEAM_FIELD_MAP[f] ?? f).join(","));
    const inverse: Record<string, string> = {};
    for (const [seam, ghName] of Object.entries(REPO_SEAM_FIELD_MAP)) inverse[ghName] = seam;
    const renamed = renameJsonKeys((await ghApi(args)).stdout, inverse);
    if (opts.jq !== undefined) return applyJq(renamed, opts.jq);
    return renamed;
  }
  if (opts.jq !== undefined) args.push("--jq", opts.jq);
  return (await ghApi(args)).stdout;
}

/** View a repo. gh ≥2.95 takes the repository positionally on `gh repo view`;
 * `-R` is no longer accepted on the repo command family (it remains valid on
 * the issue/pr/run families) — so the spec rides positionally here, exactly
 * as the bash verb does. --json FIELDS use the seam's names (mapped to gh's
 * on the way out, renamed back on the way in, per `_gh_json_run`). */
export async function reposView(spec: string | undefined, opts: ReposViewOptions = {}): Promise<string> {
  const args: string[] = ["repo", "view"];
  const repo = spec ?? "";
  if (repo !== "") args.push(repo);
  if (opts.json !== undefined) {
    args.push("--json", opts.json.split(",").map((f) => REPO_SEAM_FIELD_MAP[f] ?? f).join(","));
    const inverse: Record<string, string> = {};
    for (const [seam, ghName] of Object.entries(REPO_SEAM_FIELD_MAP)) inverse[ghName] = seam;
    return renameJsonKeys((await ghApi(args)).stdout, inverse);
  }
  if (opts.jq !== undefined) args.push("--jq", opts.jq);
  return (await ghApi(args)).stdout;
}

// ---------------------------------------------------------------------------
// Mutations (the verbs this batch's tools consume; the rest port with their
// consuming batch)
// ---------------------------------------------------------------------------

export interface ReposCreateOptions {
  description?: string;
  template?: string;
  visibility?: "public" | "private" | "internal";
  addReadme?: boolean;
  gitignore?: string;
  license?: string;
  homepage?: string;
  source?: string;
  push?: boolean;
  team?: string;
  disableIssues?: boolean;
}

/** Create a repo. Flag pass-through mirrors bash's `provider_repos_create
 * NAME [FLAGS]` — callers build validated flags; the facade appends them and
 * returns gh's result for the caller to surface. */
export async function reposCreate(name: string, opts: ReposCreateOptions = {}): Promise<RunResult> {
  const args: string[] = ["repo", "create", name];
  if (opts.description !== undefined) args.push("--description", opts.description);
  if (opts.template !== undefined) args.push("--template", opts.template);
  if (opts.visibility !== undefined) args.push(`--${opts.visibility}`);
  if (opts.addReadme) args.push("--add-readme");
  if (opts.gitignore !== undefined) args.push("--gitignore", opts.gitignore);
  if (opts.license !== undefined) args.push("--license", opts.license);
  if (opts.homepage !== undefined) args.push("--homepage", opts.homepage);
  if (opts.source !== undefined) args.push("--source", opts.source);
  if (opts.push) args.push("--push");
  if (opts.team !== undefined) args.push("--team", opts.team);
  if (opts.disableIssues) args.push("--disable-issues");
  const r = await ghApi(args, { tolerateFailure: true });
  return { stdout: r.stdout, stderr: r.stderr, status: r.status };
}

/** Whether a repository has at least one commit (templates may 409 while
 * syncing; the caller polls). False on transport failure, as bash returned
 * non-zero; a caller that must distinguish empty from unreachable probes
 * reposView first. */
/** The repo's HEAD tree blob+entry count via the git trees API
 * (recursive); null when the call fails OR the tree was truncated (a
 * truncated tree reads as not-ready, never as ready — 15.13). */
export async function reposTreeCount(repo: string): Promise<number | null> {
  const r = ghApiSync(["api", `repos/${repo}/git/trees/HEAD?recursive=1`], { tolerateFailure: true });
  if (r.status !== 0) return null;
  try {
    const parsed = JSON.parse(r.stdout) as { tree?: unknown[]; truncated?: boolean };
    if (parsed.truncated === true) return null;
    return Array.isArray(parsed.tree) ? parsed.tree.length : null;
  } catch {
    return null;
  }
}

export async function reposCommitsCount(repo: string): Promise<boolean> {
  const r = ghApiSync(["api", `repos/${repo}/commits?per_page=1`], { tolerateFailure: true });
  if (r.status !== 0) return false;
  try {
    const parsed: unknown = JSON.parse(r.stdout);
    return Array.isArray(parsed) && parsed.length >= 1;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Settings mutations (consumed by the repo-types domain's configure functions)
// ---------------------------------------------------------------------------

/** Edit a repo (settings flips: template, visibility, ...). Success is a
 * zero status; output discarded (bash parity `>/dev/null 2>&1`). */
export function reposEdit(repo: string, flags: string[]): boolean {
  return ghApiSync(["repo", "edit", repo, ...flags], { tolerateFailure: true }).status === 0;
}

/** Patch repo settings (REST PATCH with the caller's -f/-F flags verbatim). */
export function reposPatch(repo: string, flags: string[]): boolean {
  return reposPatchWithError(repo, flags).ok;
}

/** reposPatch with the API error body surfaced: on failure `error` carries
 * GitHub's own message (redacted by the transport) so callers can quote the
 * real cause instead of guessing (15.11 — the allow_forking-on-public case
 * reported as "may require admin access"). */
export function reposPatchWithError(repo: string, flags: string[]): { ok: boolean; error: string } {
  const r = ghApiSync(["api", "-X", "PATCH", `repos/${repo}`, ...flags], { tolerateFailure: true });
  if (r.status === 0) return { ok: true, error: "" };
  const first = r.stderr.trim().split("\n").find((l) => l.trim() !== "") ?? "";
  const msg = first.replace(/^gh:/, "").replace(/\(HTTP \d+\)\s*$/, "").trim();
  return { ok: false, error: msg };
}

/** Grant a team access to a repo (idempotent REST PUT). */
export function reposTeamPut(org: string, team: string, repo: string, permission?: string): boolean {
  const flags = permission !== undefined ? ["-f", `permission=${permission}`] : [];
  return ghApiSync(["api", "-X", "PUT", `orgs/${org}/teams/${team}/repos/${repo}`, ...flags], {
    tolerateFailure: true,
  }).status === 0;
}

/** Grant a user collaborator access (idempotent REST PUT). */
export function reposCollaboratorPut(repo: string, user: string, permission?: string): boolean {
  const flags = permission !== undefined ? ["-f", `permission=${permission}`] : [];
  return ghApiSync(["api", "-X", "PUT", `repos/${repo}/collaborators/${user}`, ...flags], {
    tolerateFailure: true,
  }).status === 0;
}
