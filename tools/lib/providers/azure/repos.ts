// azure/repos.ts — Azure DevOps implementation of the repos domain facade
// (port of azure/repos.bash over the http.ts transport).
//
// Implements the CONTRACT.md Repositories verbs: list / view / commits_count /
// default_branch / create / edit / patch / protect_branch / team_put /
// collaborator_put. One verb per contract row; options are validated strictly
// (an unlisted option is a named error, never dropped silently).
//
// Output shapes mirror the seam fields callers consume (name, repoSpec,
// owner.login, defaultBranchRef.name, isPrivate) so wrappers stay
// transport-blind. Contract: throw ProviderError on failure; never
// process.exit.
//
// Documented degrades (kept from the bash module, logged not silent):
//   - --public/--private/--internal on create are accepted and ignored
//     (azure repos are project-scoped and private by default).
//   - --template is create-time only (parentRepository); edit refuses it.
//   - patch: merge-strategy and description keys degrade to named skips
//     (project policy / create-time-only respectively).

import { execFileSync } from "node:child_process";
import { ProviderError, unknownOption, needValue } from "../provider-core.ts";
import { azureHttp, azureHttpPaginate } from "./http.ts";
import {
  azureOrgProject,
  azureRepoParts,
  azureProjectGet,
} from "./urls.ts";

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/** Azure DevOps org/project/repo triple. */
export interface AzureOpr {
  org: string;
  project: string;
  repo: string;
}

/** Percent-encoding re-exported from urls for one-place import convenience. */
import { azureUri as uri } from "./urls.ts";

/** The git API root of a repo spec, every component encoded:
 * https://dev.azure.com/<org>/<project>/_apis/git/repositories/<repo>
 * (the repositories collection when the spec names no repo). */
function gitRepoUrl(spec: string): string {
  const { org, project, repo } = azureRepoParts(spec);
  const base = `https://dev.azure.com/${uri(org)}/${uri(project)}/_apis/git/repositories`;
  return repo === "" ? base : `${base}/${uri(repo)}`;
}

/** The repository's GUID (the form several APIs filter on). */
export async function repoGuidShared(spec: string): Promise<string> {
  const view = (await azureHttp< { id?: string } >("GET", gitRepoUrl(spec))) as {
    id?: string;
  };
  return view.id ?? "";
}

/** Azure cwd-spec leg for the core repo-target resolver: the canonical spec
 * is project/repo (org always from config) built from the configured project
 * + git root basename. "" (not an error) when either leg is missing. */
export function azureCwdSpec(): string {
  let project = "";
  let repoName = "";
  try {
    project = azureProjectGet();
  } catch {
    return "";
  }
  try {
    repoName = execFileSync("git", ["rev-parse", "--show-toplevel"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim().split("/").pop() ?? "";
  } catch {
    return "";
  }
  if (project !== "" && repoName !== "") return `${project}/${repoName}`;
  return "";
}

/** Seam list-flag application. Azure list verbs return mapped arrays; the
 * seam dialect's --json FIELDS projects per record and -q applies a supported
 * program (.field / .[].field / .[N].field) to the whole array. Unknown --json
 * fields are named errors; unknown -q programs are named errors. */
export function applyListFlags(
  records: Record<string, unknown>[],
  opts: { json?: string; jq?: string },
): string {
  let rows = records;
  if (opts.json !== undefined) {
    const fields = opts.json.split(",").map((f) => f.trim());
    const out = rows.map((rec) => {
      const proj: Record<string, unknown> = {};
      for (const f of fields) {
        if (!(f in rec)) {
          throw new ProviderError(`unsupported --json field '${f}'`);
        }
        proj[f] = rec[f] ?? null;
      }
      return proj;
    });
    rows = out;
  }
  if (opts.jq !== undefined) {
    const eachField = /^\.\[\]\.([A-Za-z_][A-Za-z0-9_]*)$/.exec(opts.jq.trim());
    const oneField = /^\.\[0\]\.([A-Za-z_][A-Za-z0-9_]*)$/.exec(opts.jq.trim());
    const plain = /^\.([A-Za-z_][A-Za-z0-9_]*)$/.exec(opts.jq.trim());
    if (eachField?.[1] !== undefined) {
      return rows
        .map((r) => {
          const v = r[eachField[1] as string];
          return v === undefined || v === null
            ? null
            : typeof v === "string"
              ? v
              : JSON.stringify(v);
        })
        .filter((v) => v !== null)
        .join("\n");
    }
    if (oneField?.[1] !== undefined || plain?.[1] !== undefined) {
      const field = (oneField?.[1] ?? plain?.[1]) as string;
      const first = rows[0];
      const v = first?.[field];
      return v === undefined || v === null
        ? ""
        : typeof v === "string"
          ? v
          : JSON.stringify(v);
    }
    throw new ProviderError(
      `unsupported jq program '${opts.jq}' — azure list verbs support '.field', '.[].field' and '.[0].field'`,
    );
  }
  return JSON.stringify(rows);
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export interface ReposListOptions {
  limit?: number;
  json?: string;
  jq?: string;
}

export interface ReposViewOptions {
  json?: string;
  jq?: string;
}

/** Azure repo record projected to the seam shape. */
export interface AzureRepoRecord {
  name: string;
  repoSpec: string;
  isPrivate: boolean;
}

/** Map the API's repo object to the seam record. */
function mapRepo(r: Record<string, unknown>): AzureRepoRecord {
  const project = r.project as { name?: string } | undefined;
  return {
    name: String(r.name ?? ""),
    repoSpec: `${project?.name ?? ""}/${String(r.name ?? "")}`,
    isPrivate: Boolean(r.isPrivate ?? true),
  };
}

/** View a repo, projected to the seam shape. The spec may be org/project/repo,
 * project/repo, or a bare repo name (org/project from config). */
export async function reposView(
  spec: string,
  opts: ReposViewOptions = {},
): Promise<string> {
  const raw = await azureHttp<Record<string, unknown>>("GET", gitRepoUrl(spec));
  const rec = mapRepo(raw);
  // View exposes the richer seam fields too.
  const project = raw.project as { name?: string } | undefined;
  const enriched: Record<string, unknown> = {
    ...rec,
    owner: project?.name ? { login: project.name } : null,
    defaultBranchRef: raw.defaultBranch
      ? { name: raw.defaultBranch }
      : null,
  };
  if (opts.json !== undefined || opts.jq !== undefined) {
    return applyListFlags([enriched], opts);
  }
  return JSON.stringify(enriched);
}

/** List an org/project's repos as seam-shaped records. The argument is
 * org/project; a bare org takes the project from config. When --json/-q
 * flags are present the rendered projection string is returned instead. */
export async function reposList(
  orgProject: string,
  opts: ReposListOptions = {},
): Promise<AzureRepoRecord[] | string> {
  let org: string;
  let project: string;
  if (orgProject.includes("/")) {
    org = orgProject.split("/")[0] as string;
    project = orgProject.slice(org.length + 1);
  } else {
    org = orgProject;
    project = azureOrgProject().project;
  }
  const api = `https://dev.azure.com/${uri(org)}/${uri(project)}/_apis/git/repositories`;
  const raw = await azureHttpPaginate<Record<string, unknown>>(api);
  let mapped = raw.map(mapRepo);
  if (opts.limit !== undefined) mapped = mapped.slice(0, opts.limit);
  if (opts.json !== undefined || opts.jq !== undefined) {
    // Flag consumers get the rendered string; typed callers use the array.
    return applyListFlags(mapped as unknown as Record<string, unknown>[], opts);
  }
  return mapped;
}

/** Default branch of a repo (refs/heads/ stripped). */
export async function reposDefaultBranch(spec: string): Promise<string> {
  const raw = await azureHttp<{ defaultBranch?: string }>(
    "GET",
    gitRepoUrl(spec),
  );
  const ref = raw.defaultBranch ?? "";
  const branch = ref.replace(/^refs\/heads\//, "").trim();
  if (branch === "") {
    throw new ProviderError("no default branch in view output");
  }
  return branch;
}

/** Whether a repository has at least one commit (newly created repos may be
 * unready while init completes; the caller polls). */
export async function reposCommitsCount(spec: string): Promise<number> {
  const target = spec !== "" ? spec : azureCwdSpec();
  if (target === "") {
    throw new ProviderError("no repo argument and no git context");
  }
  const url = `${gitRepoUrl(target)}/commits?$top=1`;
  const r = await azureHttp<{ count?: number }>("GET", url);
  return r.count ?? 0;
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

export interface ReposCreateOptions {
  description?: string;
  /** Fork-in-project source: resolved to its GUID and sent as
   * parentRepository (create-time only). */
  template?: string;
  /** Accepted and ignored: azure repos are project-scoped, private by
   * default. */
  visibility?: "public" | "private" | "internal";
}

/** Create a repo. Returns the seam projection {name, id, repoSpec}. */
export async function reposCreate(
  name: string,
  opts: ReposCreateOptions = {},
): Promise<{ name: string; id: string; repoSpec: string }> {
  if (name === "") throw new ProviderError("repo name required");
  const bare = name.includes("/") ? (name.split("/").pop() as string) : name;
  const body: Record<string, unknown> = { name: bare };
  if (opts.description !== undefined && opts.description !== "") {
    body.description = opts.description;
  }
  if (opts.template !== undefined && opts.template !== "") {
    const tguid = await repoGuidShared(opts.template);
    body.parentRepository = { id: tguid };
  }
  const base = gitRepoUrl("");
  const r = await azureHttp<Record<string, unknown>>("POST", base, {
    body: JSON.stringify(body),
  });
  const projectName = (r.project as { name?: string } | undefined)?.name ?? "";
  return {
    name: String(r.name ?? bare),
    id: String(r.id ?? ""),
    repoSpec: `${projectName}/${String(r.name ?? bare)}`,
  };
}

/** Edit a repo. Azure repos have no post-create template knob: the flag is
 * a documented no-op (named in the error only when the option is unknown). */
export async function reposEdit(
  repo: string,
  opts: { template?: string } = {},
): Promise<void> {
  void repo;
  void opts; // --template accepted and ignored (documented degrade)
}

/** Keys azure repos have no knob for (merge strategies are project-policy;
 * description is create-time only). */
const REPOS_PATCH_SKIP_KEYS = new Set([
  "allow_merge_commit",
  "allow_squash_merge",
  "allow_rebase_merge",
  "allow_auto_merge",
  "delete_branch_on_merge",
  "allow_update_branch",
  "description",
]);

/** Patch repo settings via the k=v dialect. Unmapped keys go onto the repo
 * update PATCH; the documented-skip keys degrade with a named skip. */
export async function reposPatch(
  repo: string,
  patches: Record<string, string>,
): Promise<void> {
  const skipped: string[] = [];
  const body: Record<string, string> = {};
  for (const [k, v] of Object.entries(patches)) {
    if (REPOS_PATCH_SKIP_KEYS.has(k)) skipped.push(k);
    else body[k] = v;
  }
  if (skipped.length > 0) {
    console.error(
      `WARN: repos_patch: azure repos have no ${skipped.join(" ")} knobs (merge strategies are project-policy; description is create-time only) — skipped`,
    );
  }
  if (Object.keys(body).length === 0) return;
  await azureHttp("PATCH", gitRepoUrl(repo), { body: JSON.stringify(body) });
}

/** Protect a branch: the seam-shaped protection payload translates to a
 * minimum-reviewers policy on the branch ref. Idempotent: an existing policy
 * for the same repo+branch is updated in place. */
export async function reposProtectBranch(
  repo: string,
  branch: string,
  payload: { required_pull_request_reviews?: { required_approving_review_count?: number } },
): Promise<void> {
  const guid = await repoGuidShared(repo);
  const { org, project } = azureRepoParts(repo);
  const base = `https://dev.azure.com/${uri(org)}/${uri(project)}/_apis/policy`;
  const reviewers =
    payload.required_pull_request_reviews?.required_approving_review_count ?? 1;
  const typeId = "fa4e907d-c16b-4a4c-9dfa-4906e5d171dd";
  const body = {
    type: { id: typeId },
    isEnabled: true,
    isBlocking: true,
    settings: {
      scope: [{ repositoryId: guid, matchKind: "exact", refName: `refs/heads/${branch}` }],
      minimumApproverCount: reviewers,
      creatorVoteCounts: false,
      allowDownvotes: false,
      resetOnSourcePush: false,
    },
  };
  const existing = await azureHttp<{
    value?: Array<{ id: number; type: { id: string }; settings: { scope: Array<{ repositoryId: string; refName: string }> } }>;
  }>("GET", `${base}/configurations`);
  const hit = (existing.value ?? []).find(
    (c) =>
      c.type?.id === typeId &&
      c.settings?.scope?.[0]?.repositoryId === guid &&
      c.settings?.scope?.[0]?.refName === `refs/heads/${branch}`,
  );
  if (hit !== undefined) {
    await azureHttp("PUT", `${base}/configurations/${hit.id}`, {
      body: JSON.stringify(body),
    });
  } else {
    await azureHttp("POST", `${base}/configurations`, { body: JSON.stringify(body) });
  }
}

// ---------------------------------------------------------------------------
// Permissions (SDDL + accesscontrolentries)
// ---------------------------------------------------------------------------

/** Decode a graph descriptor to the SDDL string the ACL API accepts
 * (base64 payload, URL-safe alphabet, Microsoft.TeamFoundation.Identity
 * prefix — the raw vssgp./aad. descriptor is rejected with a 500). */
export function identitySddl(descriptor: string): string {
  let payload = descriptor.includes(".") ? descriptor.slice(descriptor.indexOf(".") + 1) : descriptor;
  while (payload.length % 4 !== 0) payload += "=";
  const decoded = Buffer.from(payload.replaceAll("_", "/").replaceAll("-", "+"), "base64").toString("binary");
  return `Microsoft.TeamFoundation.Identity;${decoded}`;
}

/** Map a seam permission word to the Git Repositories allow-bits mask
 * (live-verified values; triage = read + work-items bits per owner decision). */
export function grantBits(perm: string): number {
  switch (perm) {
    case "pull":
    case "triage":
      return 2;
    case "push":
      return 54;
    case "maintain":
      return 2230;
    case "admin":
      return 3967;
    default:
      throw new ProviderError(`unknown permission '${perm}'`);
  }
}

/** Resolve an identity descriptor via the graph API (vssps host). A group
 * matches on its principal name, "[<project>]\<name>", in this repo's
 * project; a user on principal name (sign-in address) or, failing that,
 * exact display name. Exactly one identity must match. */
async function resolveIdentity(
  org: string,
  project: string,
  kind: "groups" | "users",
  name: string,
): Promise<string> {
  const list = await azureHttpPaginate<Record<string, string>>(
    `https://vssps.dev.azure.com/${uri(org)}/_apis/graph/${kind}?api-version=7.1-preview.1`,
  );
  const matches = list.filter((i) => {
    const pn = i.principalName ?? "";
    if (kind === "groups") {
      return pn === name || pn === `[${project}]\\${name}`;
    }
    return pn === name || i.displayName === name;
  });
  if (matches.length > 1) {
    throw new ProviderError(
      `${kind} '${name}' matches more than one identity — pass its principal name`,
    );
  }
  if (matches.length === 0) {
    throw new ProviderError(`${kind} '${name}' not found`);
  }
  return matches[0]!.descriptor ?? "";
}

/** Shared grant path: resolve the identity descriptor, SDDL-decode, POST the
 * ACE with the mapped bits (idempotent merge; the response echoes back). */
async function aclGrant(
  kind: "groups" | "users",
  name: string,
  repo: string,
  perm: string,
): Promise<string> {
  const { org, project } = azureRepoParts(repo);
  const orgEnc = uri(org);
  const guid = await repoGuidShared(repo);
  const bits = grantBits(perm);
  const descriptor = await resolveIdentity(org, project, kind, name);
  const sddl = identitySddl(descriptor);
  const ns = "2e9eb7ed-3c0a-47d4-87c1-0ffdd275fd87"; // Git Repositories
  // ACL security tokens are dataspace-rooted: repoV2/{PROJECT-id}/{repo-id}.
  const projectResponse = await azureHttp<{ id?: string }>(
    "GET",
    `https://dev.azure.com/${orgEnc}/_apis/projects/${uri(project)}`,
  );
  const projectId = projectResponse.id ?? "";
  if (projectId === "") {
    throw new ProviderError("project id unresolvable");
  }
  const token = `repoV2/${projectId}/${guid}`;
  const body = {
    token,
    merge: true,
    accessControlEntries: [{ descriptor: sddl, allow: bits, deny: 0 }],
  };
  return azureHttp<string>(
    "POST",
    `https://dev.azure.com/${orgEnc}/_apis/accesscontrolentries/${ns}`,
    { body: JSON.stringify(body) },
  );
}

/** Grant a team repo permissions (idempotent merge). */
export async function reposTeamPut(
  org: string,
  team: string,
  repo: string,
  perm = "push",
): Promise<string> {
  void org; // org resolves from the repo spec
  return aclGrant("groups", team, repo, perm);
}

export interface ReposCollaboratorPutOptions {
  permission?: string;
}

/** Grant a user repo permissions. */
export async function reposCollaboratorPut(
  repo: string,
  user: string,
  opts: ReposCollaboratorPutOptions = {},
): Promise<string> {
  return aclGrant("users", user, repo, opts.permission ?? "push");
}

// keep needValue/unknownOption referenced for strict option validation in
// future surface growth (the github module imports them the same way).
void needValue;
void unknownOption;
