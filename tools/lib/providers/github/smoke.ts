// github/smoke.ts — live validation suite for the github provider, driving
// the provider facade (and, for the few verbs the facade does not expose, the
// github modules). Manual only: never invoked by tests or CI, and never
// collected by the vitest include. Documented in SMOKE.md beside this file.
//
// One combined flow against a LIVE GitHub organisation. The suite creates its
// own throwaway repository, project, team, labels, issues, pull requests and
// so on, records every one of them by identifier the moment it exists, and
// tears down exactly the recorded items (newest first) at the end — also on
// failure and on SIGINT/SIGTERM. It never touches a repository it did not
// create. The recording, teardown and signal logic is shared with the Azure
// suite (../smoke-teardown.ts).
//
// Opt-in gate (everything below is required; the suite refuses otherwise):
//   GITHUB_SMOKE=write              the only accepted value (the suite is destructive)
//   GITHUB_SMOKE_OWNER=<org>        the organisation that receives the throwaway items
//   GITHUB_SMOKE_CONFIRM=<org>      must equal GITHUB_SMOKE_OWNER exactly
//   GITHUB_SMOKE_ALLOW_REAL_ORG=<org>   additionally required when <org> (as typed,
//                                   and again as GitHub resolves it) is the
//                                   organisation configured in devenv.config, or
//                                   when that configured organisation cannot be read
// Optional inputs:
//   GITHUB_SMOKE_COLLABORATOR=<login>   enables the collaborator scenario
//   GITHUB_SMOKE_REPORT=<path>          per-probe report file
// Credentials come from gh's own store; the suite never reads or prints a token.
//
// Exit: 0 only when no probe failed AND teardown succeeded; 2 when the gate
// refuses; 130 after an interrupt, once teardown has finished.
//
// Run directly:
//   GITHUB_SMOKE=write GITHUB_SMOKE_OWNER=<org> GITHUB_SMOKE_CONFIRM=<org> \
//   node tools/lib/providers/github/smoke.ts
//
// `--list-coverage` prints the scenario/verb registry as JSON and exits before
// the gate, without any backend call (the guard test uses it to compare the
// registry with the contract's verb table).

import { spawnSync } from "node:child_process";
import { appendFileSync, existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EXIT_MISUSE, EXIT_SUCCESS } from "../../core/exit-codes.ts";
import { providerOrgGet } from "../provider-core.ts";
import { ghApi, type GhResult } from "./transport.ts";
import { absentOk, lacksDeleteRepo, notFoundOk, parseOAuthScopes, scrubTokens } from "./live-guards.ts";
import { createTeardown, describeError, InterruptedError, installSignalHandlers, ResourceCapError } from "../smoke-teardown.ts";
import * as fIssues from "../facade/issues.ts";
import * as fPrs from "../facade/prs.ts";
import * as fRepos from "../facade/repos.ts";
import * as fOrg from "../facade/org.ts";
import * as fPipelines from "../facade/pipelines.ts";
import * as fProjects from "../facade/projects.ts";
import * as fUrls from "../facade/urls.ts";
import * as ghProjects from "./projects.ts";
import * as ghPipelines from "./pipelines.ts";
import * as ghUrls from "./urls.ts";

// ---------------------------------------------------------------------------
// Coverage registry (data only; the guard test reads it through --list-coverage)
// ---------------------------------------------------------------------------

interface Scenario {
  id: string;
  family: string;
  /** Contract verb names (provider_<family>_<verb>) the scenario exercises. */
  verbs: string[];
  run: () => Promise<void>;
}

/** Contract verbs the github column lists as gaps: the suite cannot exercise
 * a verb the adapter does not implement. The guard test requires this list to
 * equal the contract's github gap cells. */
const EXCLUDED_VERBS: Array<{ verb: string; reason: string }> = [
  { verb: "provider_repos_default_branch", reason: "gap: not yet ported to the TypeScript GitHub module" },
  { verb: "provider_repos_protect_branch", reason: "gap: not yet ported to the TypeScript GitHub module" },
  { verb: "provider_org_packages_list", reason: "gap: not yet ported to the TypeScript GitHub module" },
  { verb: "provider_org_package_versions", reason: "gap: not yet ported to the TypeScript GitHub module" },
];

/** A hard ceiling on the resources one run may create. */
const MAX_RESOURCES = 60;

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

const REPORT_FILE = process.env.GITHUB_SMOKE_REPORT ?? "";

function out(line: string): void {
  const text = scrubTokens(line);
  console.log(text);
  if (REPORT_FILE !== "") {
    try {
      appendFileSync(REPORT_FILE, `${text}\n`);
    } catch {
      // best-effort sink — never fatal
    }
  }
}

function errOut(line: string): void {
  console.error(scrubTokens(line));
}

let pass = 0;
let fail = 0;
let skipped = 0;
function probe(name: string, ok: boolean, detail = ""): void {
  const tail = detail !== "" ? ` — ${detail}` : "";
  if (ok) {
    pass++;
    out(`PASS  ${name}${tail}`);
  } else {
    fail++;
    out(`FAIL  ${name}${tail}`);
  }
}

function skip(name: string, reason: string): void {
  skipped++;
  out(`SKIP  ${name} — ${reason}`);
}

/** Thrown inside a scenario to skip the rest of it with a reported reason. */
class SkipError extends Error {}
/** Thrown to stop the run (the remaining scenarios cannot work). */
class FatalError extends Error {}
/** Thrown when a gate re-check refuses the run (exit code 2, nothing created). */
class RefusalError extends Error {}

const errText = describeError;

const exercised = new Set<string>();

type Result<T> = { ok: true; value: T } | { ok: false };

/** Run one verb call and report it. The assertion returns true or the reason
 * the outcome is wrong. */
async function check<T>(
  name: string,
  verb: string | null,
  fn: () => Promise<T> | T,
  assert?: (v: T) => true | string,
): Promise<Result<T>> {
  // After an interrupt no further verb call is made; the scenario unwinds.
  td.throwIfInterrupted();
  if (verb !== null) exercised.add(verb);
  let value: T;
  try {
    value = await fn();
  } catch (e) {
    probe(name, false, errText(e));
    return { ok: false };
  }
  if (assert !== undefined) {
    let verdict: true | string;
    try {
      verdict = assert(value);
    } catch (e) {
      verdict = `assertion threw: ${errText(e)}`;
    }
    if (verdict !== true) {
      probe(name, false, verdict);
      return { ok: false };
    }
  }
  // Without an assertion only the absence of an error is known; say so rather
  // than imply the outcome was verified.
  probe(name, true, assert === undefined ? "call returned without error; outcome not asserted here" : "");
  return { ok: true, value };
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function poll<T>(fn: () => Promise<T | undefined>, tries: number, ms: number): Promise<T | undefined> {
  for (let i = 0; i < tries; i++) {
    td.throwIfInterrupted();
    let value: T | undefined;
    try {
      value = await fn();
    } catch {
      value = undefined;
    }
    if (value !== undefined) return value;
    await sleep(ms);
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Recorded resources and teardown
// ---------------------------------------------------------------------------

const td = createTeardown({
  cap: MAX_RESOURCES,
  out,
  err: errOut,
  verbose: true,
  leftoverHints: () => [
    "Find any other leftovers by the naming prefix:",
    `  gh repo list ${state.owner} --limit 200 --json name -q '.[].name' | grep '^devenv-smoke-'`,
    `  gh project list --owner ${state.owner} --format json | grep devenv-smoke-project-`,
    `  gh api orgs/${state.owner}/teams --paginate --jq '.[].slug' | grep '^devenv-smoke-team-'`,
  ],
});
const record = td.record;
const assertCapacity = td.assertCapacity;

installSignalHandlers(td, { host: process, exit: (code) => process.exit(code), err: errOut });

// ---------------------------------------------------------------------------
// Run state and transport helpers
// ---------------------------------------------------------------------------

const stamp = Date.now();
const state = {
  owner: "",
  repoName: `devenv-smoke-${process.pid}-${stamp}`,
  spec: "",
  repoCreated: false,
  defaultBranch: "main",
  tmp: "",
  label1: { name: `smoke-label-${process.pid}` },
  label2: { name: `smoke-label2-${process.pid}` },
  milestone: { number: 0, title: "" },
  issues: {} as Record<string, { number: number; url: string }>,
  project: { number: "", id: "", title: `devenv-smoke-project-${process.pid}-${stamp}` },
  pr1: 0,
  pr2: 0,
  runId: "",
  teamSlug: "",
  workflowFile: "",
};

/** The throwaway repository's spec; throws until the run has created it. */
function R(): string {
  if (!state.repoCreated || state.spec === "") throw new FatalError("the throwaway repository does not exist yet");
  return state.spec;
}

async function gh(args: string[], input?: string): Promise<string> {
  return (await ghApi(args, input !== undefined ? { input } : {})).stdout;
}

async function ghTry(args: string[]): Promise<GhResult> {
  return ghApi(args, { tolerateFailure: true });
}

function numberFromUrl(text: string): number {
  const m = /(\d+)\s*$/.exec(text.trim().split("\n").pop() ?? "");
  if (m?.[1] === undefined) throw new Error(`no trailing number in '${text.trim().slice(0, 80)}'`);
  return Number(m[1]);
}

function parse<T>(text: string): T {
  return JSON.parse(text) as T;
}

async function pushBranch(branch: string, path: string, content: string): Promise<void> {
  assertCapacity();
  const spec = R();
  const sha = (await gh(["api", `repos/${spec}/git/ref/heads/${state.defaultBranch}`, "--jq", ".object.sha"])).trim();
  await gh(["api", "-X", "POST", `repos/${spec}/git/refs`, "-f", `ref=refs/heads/${branch}`, "-f", `sha=${sha}`]);
  record("branch", branch, `gh api -X DELETE repos/${spec}/git/refs/heads/${branch}`, async () => {
    const r = await ghTry(["api", "-X", "DELETE", `repos/${spec}/git/refs/heads/${branch}`]);
    if (!absentOk(r)) throw new Error(r.stderr.trim().split("\n")[0] ?? "delete failed");
  });
  await gh([
    "api", "-X", "PUT", `repos/${spec}/contents/${path}`,
    "-f", `message=smoke: add ${path}`,
    "-f", `content=${Buffer.from(content).toString("base64")}`,
    "-f", `branch=${branch}`,
  ]);
}

function issueKey(key: string): { number: number; url: string } {
  const i = state.issues[key];
  if (i === undefined) throw new SkipError(`issue '${key}' was not created`);
  return i;
}

async function createIssue(key: string, title: string, labels: string[]): Promise<void> {
  assertCapacity();
  const spec = R();
  const url = (await fIssues.issuesCreate(spec, { title, body: `smoke issue ${key}`, label: labels })).trim();
  const number = numberFromUrl(url);
  state.issues[key] = { number, url };
  record("issue", `${spec}#${number}`, `gh issue delete ${number} -R ${spec} --yes  (or close it)`, async () => {
    const del = await ghTry(["issue", "delete", String(number), "-R", spec, "--yes"]);
    if (del.status === 0) return;
    const close = await ghTry(["issue", "close", String(number), "-R", spec]);
    if (!absentOk(close) && !/already closed/i.test(close.stderr)) throw new Error(close.stderr.trim().split("\n")[0] ?? "close failed");
  });
}

// ---------------------------------------------------------------------------
// Scenarios — repositories
// ---------------------------------------------------------------------------

async function reposCreateAndInspect(): Promise<void> {
  assertCapacity();
  const spec = state.spec;
  // Recorded BEFORE the create call: the name embeds the process id and a
  // timestamp and was verified absent during the preflight, so a repository
  // that exists under it afterwards is this run's. If the create never happened
  // the cleanup finds nothing and succeeds; a create still in flight when a
  // signal arrives is waited for by teardown before it cleans up. The resource
  // is confirmed once the create call succeeds or the repository is seen to exist.
  const owner = state.owner;
  const expectedSpec = `${owner}/devenv-smoke-${process.pid}-${stamp}`;
  const repoRecord = record("repo", spec, `gh repo delete ${spec} --yes   (needs: gh auth refresh -s delete_repo)`, async () => {
    // Independent of the recorded spec: the target must be the exact name this
    // process builds from the resolved owner, and must carry the throwaway prefix.
    if (spec !== expectedSpec || !spec.slice(owner.length + 1).startsWith("devenv-smoke-")) {
      throw new Error(`refusing to delete '${spec}': not the repository this run created`);
    }
    const r = await ghTry(["api", "-X", "DELETE", `repos/${spec}`]);
    if (!notFoundOk(r)) throw new Error(r.stderr.trim().split("\n")[0] ?? "delete failed");
  }, false);
  const created = await check(
    "repos_create (private, with README)",
    "provider_repos_create",
    () =>
      td.inflight(
        fRepos.reposCreate(spec, { visibility: "private", addReadme: true, description: `devenv smoke ${state.repoName}` }).then((r) => {
          if (r.status === 0) repoRecord.confirm();
          return r;
        }),
        `gh repo delete ${spec} --yes`,
      ),
    (r) => (r.status === 0 ? true : `exit ${r.status}: ${r.stderr.trim().split("\n")[0] ?? ""}`),
  );
  // The name is unique to this run, so a repository that exists after a
  // reported failure is the one this run started creating.
  const exists = created.ok || (await fRepos.reposExists(spec).catch(() => false));
  if (exists) {
    state.repoCreated = true;
    repoRecord.confirm();
  }
  if (!created.ok || !state.repoCreated) throw new FatalError("the throwaway repository could not be created");

  const view = await check(
    "repos_view returns the repository record",
    "provider_repos_view",
    () => fRepos.reposView(spec, { json: "name,repoSpec,defaultBranchRef,description" }),
    (t) => {
      const v = parse<{ repoSpec?: string; name?: string }>(t);
      return v.repoSpec === spec && v.name === state.repoName ? true : `unexpected record: ${t.slice(0, 120)}`;
    },
  );
  if (view.ok) {
    const branch = parse<{ defaultBranchRef?: { name?: string } }>(view.value).defaultBranchRef?.name;
    if (branch !== undefined && branch !== "") state.defaultBranch = branch;
  }
  await check("repos_exists is true for the new repository", "provider_repos_exists", () => fRepos.reposExists(spec), (b) => b === true || "false");
  await check(
    "repos_exists is false for a name this run never created",
    "provider_repos_exists",
    () => fRepos.reposExists(`${spec}-absent`),
    (b) => b === false || "true",
  );
  const commits = await poll(async () => ((await fRepos.reposCommitsCount(spec)) ? true : undefined), 10, 1500);
  probe("repos_commits_count reports the README commit", commits === true);
  exercised.add("provider_repos_commits_count");
  await check("repos_tree_count counts the README", "provider_repos_tree_count", () => fRepos.reposTreeCount(spec), (n) => (n !== null && n >= 1 ? true : `got ${String(n)}`));
  await check("repos_squash_merge_allowed on a new repository", "provider_repos_squash_merge_allowed", () => fRepos.reposSquashMergeAllowed(spec), (b) => b === true || "false");
  await check(
    "repos_list includes the new repository",
    "provider_repos_list",
    () => fRepos.reposList(state.owner, { limit: 100, json: "name" }),
    (t) => (parse<Array<{ name?: string }>>(t).some((r) => r.name === state.repoName) ? true : "not listed"),
  );
}

async function reposSettings(): Promise<void> {
  const spec = R();
  await check("repos_edit changes the description", "provider_repos_edit", () => fRepos.reposEdit(spec, ["--description", "devenv smoke (edited)"]), (b) => b === true || "false");
  await check(
    "repos_edit is visible in the repository record",
    null,
    () => fRepos.reposView(spec, { json: "description" }),
    (t) => (parse<{ description?: string }>(t).description === "devenv smoke (edited)" ? true : t.slice(0, 120)),
  );
  await check("repos_patch disables the wiki", "provider_repos_patch", () => fRepos.reposPatch(spec, ["-f", "has_wiki=false"]), (b) => b === true || "false");
  await check(
    "repos_patch is visible through the REST record",
    null,
    async () => (await gh(["api", `repos/${spec}`, "--jq", ".has_wiki"])).trim(),
    (v) => (v === "false" ? true : `has_wiki=${v}`),
  );
  await check("repos_patch_with_error succeeds on a valid change", "provider_repos_patch_with_error", () => fRepos.reposPatchWithError(spec, ["-f", "has_projects=false"]), (r) => (r.ok ? true : r.error));
  await check(
    "repos_patch_with_error surfaces the API message for an invalid change",
    "provider_repos_patch_with_error",
    () => fRepos.reposPatchWithError(spec, ["-f", "default_branch=smoke-no-such-branch"]),
    (r) => (!r.ok && r.error !== "" ? true : `ok=${r.ok} error='${r.error}'`),
  );
}

async function reposNameFromDirectory(): Promise<void> {
  const spec = R();
  const dir = join(state.tmp, "clone");
  spawnSync("git", ["init", "-q", dir], { encoding: "utf8" });
  spawnSync("git", ["-C", dir, "remote", "add", "origin", `https://github.com/${spec}.git`], { encoding: "utf8" });
  await check("repos_name_with_owner resolves a directory's repository", "provider_repos_name_with_owner", () => fRepos.reposNameWithOwner(dir), (n) => (n === spec ? true : `got ${String(n)}`));
}

async function reposTeamAccess(): Promise<void> {
  assertCapacity();
  const spec = R();
  const slug = `devenv-smoke-team-${process.pid}-${stamp}`;
  const owner = state.owner;
  const recordTeam = (teamSlug: string, confirmed: boolean) =>
    record("team", `${owner}/${teamSlug}`, `gh api -X DELETE orgs/${owner}/teams/${teamSlug}`, async () => {
      // Only a real not-found counts as cleaned; the team is not protected by
      // the repository delete.
      const r = await ghTry(["api", "-X", "DELETE", `orgs/${owner}/teams/${teamSlug}`]);
      if (!notFoundOk(r)) throw new Error(r.stderr.trim().split("\n")[0] ?? "delete failed");
    }, confirmed);
  // Recorded before the create call; the slug GitHub derives from this name is
  // the name itself, and a cleanup of a team that was never created finds
  // nothing. The record is confirmed when the create succeeds, so a refused
  // create whose cleanup then fails is only a notice. Teardown waits for the
  // create call if a signal arrives while it is in flight.
  const teamRecord = recordTeam(slug, false);
  const created = await td.inflight(
    ghTry(["api", "-X", "POST", `orgs/${owner}/teams`, "-f", `name=${slug}`, "-f", "privacy=closed", "--jq", ".slug"]).then((r) => {
      if (r.status === 0) teamRecord.confirm();
      return r;
    }),
    `gh api -X DELETE orgs/${owner}/teams/${slug}`,
  );
  if (created.status !== 0) throw new SkipError(`team creation refused: ${created.stderr.trim().split("\n")[0] ?? ""}`);
  state.teamSlug = created.stdout.trim();
  const teamSlug = state.teamSlug;
  if (teamSlug !== slug) recordTeam(teamSlug, true);
  await check("repos_team_put grants the team pull access", "provider_repos_team_put", () => fRepos.reposTeamPut(owner, teamSlug, spec, "pull"), (b) => b === true || "false");
  await check(
    "the team has the repository",
    null,
    () => ghTry(["api", `orgs/${owner}/teams/${teamSlug}/repos/${spec}`]),
    (r) => (r.status === 0 ? true : r.stderr.trim().split("\n")[0] ?? "not granted"),
  );
}

async function reposCollaborator(): Promise<void> {
  const user = process.env.GITHUB_SMOKE_COLLABORATOR ?? "";
  if (user === "") throw new SkipError("GITHUB_SMOKE_COLLABORATOR is not set (granting access invites a real account)");
  const spec = R();
  const r = await check("repos_collaborator_put invites the collaborator with pull access", "provider_repos_collaborator_put", () => fRepos.reposCollaboratorPut(spec, user, "pull"), (b) => b === true || "false");
  if (r.ok) {
    record("collaborator", `${spec}:${user}`, `gh api -X DELETE repos/${spec}/collaborators/${user}`, async () => {
      const d = await ghTry(["api", "-X", "DELETE", `repos/${spec}/collaborators/${user}`]);
      if (!absentOk(d)) throw new Error(d.stderr.trim().split("\n")[0] ?? "delete failed");
    });
  }
}

// ---------------------------------------------------------------------------
// Scenarios — issues
// ---------------------------------------------------------------------------

async function issuesLabels(): Promise<void> {
  const spec = R();
  const l1 = state.label1.name;
  const r1 = await check("issues_label_ensure creates a missing label", "provider_issues_label_ensure", () => fIssues.issuesLabelEnsure(spec, l1, "ededed", "devenv smoke"));
  if (r1.ok) {
    record("label", l1, `gh label delete ${l1} -R ${spec} --yes`, async () => {
      const d = await ghTry(["label", "delete", l1, "-R", spec, "--yes"]);
      if (!absentOk(d)) throw new Error(d.stderr.trim().split("\n")[0] ?? "delete failed");
    });
    await check("issues_label_ensure is idempotent", "provider_issues_label_ensure", () => fIssues.issuesLabelEnsure(spec, l1, "ededed", "devenv smoke"));
  }
  const l2 = state.label2;
  const r2 = await check("issues_label_create creates a label", "provider_issues_label_create", () => fIssues.issuesLabelCreate(spec, l2.name, { color: "fbca04", description: "devenv smoke 2" }));
  if (r2.ok) {
    record("label", l2.name, `gh label delete <the label above, or ${l2.name}-renamed> -R ${spec} --yes`, async () => {
      const d = await ghTry(["label", "delete", l2.name, "-R", spec, "--yes"]);
      if (!absentOk(d)) throw new Error(d.stderr.trim().split("\n")[0] ?? "delete failed");
    });
  }
  await check(
    "issues_label_list shows both labels",
    "provider_issues_label_list",
    () => fIssues.issuesLabelList(spec, { json: "name,color,description", limit: 100 }),
    (t) => {
      const names = parse<Array<{ name: string }>>(t).map((l) => l.name);
      return names.includes(l1) && names.includes(l2.name) ? true : `labels: ${names.join(",")}`;
    },
  );
  if (r2.ok) {
    const renamed = `${l2.name}-renamed`;
    const u = await check("issues_label_update renames and recolours a label", "provider_issues_label_update", () => fIssues.issuesLabelUpdate(spec, l2.name, { newName: renamed, color: "0e8a16", description: "edited" }));
    if (u.ok) {
      l2.name = renamed;
      await check(
        "the renamed label is listed with its new colour",
        null,
        () => fIssues.issuesLabelList(spec, { json: "name,color", limit: 100 }),
        (t) => (parse<Array<{ name: string; color: string }>>(t).some((l) => l.name === renamed && l.color === "0e8a16") ? true : "not listed as edited"),
      );
    }
  }
}

async function issuesMilestoneScenario(): Promise<void> {
  assertCapacity();
  const spec = R();
  const title = `smoke-milestone-${process.pid}`;
  const created = await ghTry(["api", "-X", "POST", `repos/${spec}/milestones`, "-f", `title=${title}`, "--jq", ".number"]);
  if (created.status !== 0) throw new SkipError(`milestone fixture refused: ${created.stderr.trim().split("\n")[0] ?? ""}`);
  const number = Number(created.stdout.trim());
  state.milestone = { number, title };
  record("milestone", `${spec}#${number}`, `gh api -X DELETE repos/${spec}/milestones/${number}`, async () => {
    const d = await ghTry(["api", "-X", "DELETE", `repos/${spec}/milestones/${number}`]);
    if (!absentOk(d)) throw new Error(d.stderr.trim().split("\n")[0] ?? "delete failed");
  });
  await check(
    "issues_milestones lists the milestone",
    "provider_issues_milestones",
    () => fIssues.issuesMilestones(spec),
    (t) => (t.includes(title) ? true : "milestone not listed"),
  );
}

async function issuesCreateAndRead(): Promise<void> {
  const spec = R();
  const a = await check("issues_create (with a label) creates issue A", "provider_issues_create", async () => createIssue("A", "smoke issue A", [state.label1.name]));
  await check("issues_create creates issue B (child candidate)", "provider_issues_create", async () => createIssue("B", "smoke issue B", []));
  await check("issues_create creates issue C (blocker candidate)", "provider_issues_create", async () => createIssue("C", "smoke issue C", []));
  if (!a.ok) throw new SkipError("issue A was not created");
  const A = issueKey("A");
  await check(
    "issues_view returns the issue",
    "provider_issues_view",
    () => fIssues.issuesView(spec, A.number, { json: "number,title,state,labels" }),
    (t) => {
      const v = parse<{ number: number; title: string; state: string; labels: Array<{ name: string }> }>(t);
      return v.number === A.number && v.state === "OPEN" && v.labels.some((l) => l.name === state.label1.name) ? true : t.slice(0, 160);
    },
  );
  await check(
    "issues_list includes the issue",
    "provider_issues_list",
    () => fIssues.issuesList(spec, { state: "open", json: "number,title", limit: 50 }),
    (t) => (parse<Array<{ number: number }>>(t).some((i) => i.number === A.number) ? true : "not listed"),
  );
  await check("issues_exists is true for the issue", "provider_issues_exists", () => fIssues.issuesExists(spec, A.number), (b) => b === true || "false");
  await check("issues_exists is false for an absent number", "provider_issues_exists", () => fIssues.issuesExists(spec, 999999), (b) => b === false || "true");
  await check("issue_web_url addresses the issue", "provider_issue_web_url", () => fIssues.issueWebUrl(spec, A.number), (u) => (u === `https://github.com/${spec}/issues/${A.number}` ? true : u));
}

async function issuesEditAndComments(): Promise<void> {
  const spec = R();
  const A = issueKey("A");
  const B = issueKey("B");
  await check(
    "issues_edit changes title, body and labels",
    "provider_issues_edit",
    () => fIssues.issuesEdit(spec, A.number, { title: "smoke issue A (edited)", body: "edited body", addLabel: [state.label2.name], removeLabel: [state.label1.name] }),
  );
  await check(
    "the edit is visible",
    null,
    () => fIssues.issuesView(spec, A.number, { json: "title,body,labels" }),
    (t) => {
      const v = parse<{ title: string; body: string; labels: Array<{ name: string }> }>(t);
      const names = v.labels.map((l) => l.name);
      return v.title === "smoke issue A (edited)" && v.body === "edited body" && names.includes(state.label2.name) && !names.includes(state.label1.name)
        ? true
        : t.slice(0, 200);
    },
  );
  if (state.milestone.title !== "") {
    await check("issues_edit assigns a milestone", "provider_issues_edit", () => fIssues.issuesEdit(spec, B.number, { milestone: state.milestone.title }));
    await check(
      "the milestone is visible",
      null,
      () => fIssues.issuesView(spec, B.number, { json: "milestone" }),
      (t) => (parse<{ milestone: { title?: string } | null }>(t).milestone?.title === state.milestone.title ? true : t.slice(0, 120)),
    );
  }
  await check("issues_comment posts a comment and returns its URL", "provider_issues_comment", () => fIssues.issuesComment(spec, A.number, { body: "smoke comment" }), (u) => (/\/issues\/\d+#issuecomment-\d+/.test(u) ? true : u.slice(0, 120)));
  await check(
    "issues_comments lists the comment",
    "provider_issues_comments",
    () => fIssues.issuesComments(spec, A.number),
    (t) => (parse<Array<{ body: string }>>(t).some((c) => c.body === "smoke comment") ? true : "comment missing"),
  );
  const added = await check(
    "issues_comment_add returns the comment record",
    "provider_issues_comment_add",
    () => fIssues.issuesCommentAdd(spec, A.number, { body: "smoke comment record" }),
    (t) => (typeof parse<{ id?: number }>(t).id === "number" ? true : t.slice(0, 120)),
  );
  if (added.ok) {
    const id = String(parse<{ id: number }>(added.value).id);
    await check("issues_comment_get reads the comment", "provider_issues_comment_get", () => fIssues.issuesCommentGet(spec, id), (t) => (parse<{ body: string }>(t).body === "smoke comment record" ? true : t.slice(0, 120)));
    await check("issues_comment_edit replaces the body", "provider_issues_comment_edit", () => fIssues.issuesCommentEdit(spec, id, { body: "smoke comment edited" }), (t) => (parse<{ body: string }>(t).body === "smoke comment edited" ? true : t.slice(0, 120)));
    await check("the edited comment reads back", null, () => fIssues.issuesCommentGet(spec, id), (t) => (parse<{ body: string }>(t).body === "smoke comment edited" ? true : t.slice(0, 120)));
  }
}

async function issuesGraph(): Promise<void> {
  const spec = R();
  const A = issueKey("A");
  const B = issueKey("B");
  const linked = await check("issue_graph_link makes B a sub-issue of A", "provider_issue_graph_link", () => fIssues.issueGraphLink(spec, A.number, B.number));
  if (!linked.ok) return;
  await check("issue_graph_children lists B", "provider_issue_graph_children", () => fIssues.issueGraphChildren(spec, A.number), (n) => (n.includes(B.number) ? true : `children: ${n.join(",")}`));
  await check("issue_graph_parent names A", "provider_issue_graph_parent", () => fIssues.issueGraphParent(spec, B.number), (n) => (n === A.number ? true : `parent: ${String(n)}`));
  await check("issue_graph_unlink detaches B", "provider_issue_graph_unlink", () => fIssues.issueGraphUnlink(spec, A.number, B.number));
  await check("B has no parent after the unlink", null, () => fIssues.issueGraphParent(spec, B.number), (n) => (n === null ? true : `parent: ${String(n)}`));
}

async function issuesBlockedBy(): Promise<void> {
  const spec = R();
  const A = issueKey("A");
  const C = issueKey("C");
  await check("blocked_by_add records C as a blocker of A", "provider_issue_blocked_by_add", () => fIssues.blockedByAdd(spec, A.number, [C.number]));
  await check(
    "the blocker appears in the body",
    null,
    () => fIssues.issuesView(spec, A.number, { json: "body" }),
    (t) => (new RegExp(`#${C.number}\\b`).test(parse<{ body: string }>(t).body) ? true : "blocker line missing"),
  );
  await check("blocked_by_remove clears the blocker", "provider_issue_blocked_by_remove", () => fIssues.blockedByRemove(spec, A.number, [C.number]));
  await check(
    "the blocker is gone from the body",
    null,
    () => fIssues.issuesView(spec, A.number, { json: "body" }),
    (t) => (new RegExp(`#${C.number}\\b`).test(parse<{ body: string }>(t).body) ? "blocker line still present" : true),
  );
}

async function issuesCloseReopen(): Promise<void> {
  const spec = R();
  const B = issueKey("B");
  const stateOf = async (): Promise<string> => parse<{ state: string }>(await fIssues.issuesView(spec, B.number, { json: "state" })).state;
  await check("issues_close closes with a comment", "provider_issues_close", () => fIssues.issuesClose(spec, B.number, { reason: "completed", comment: "smoke close" }));
  await check("the issue reads CLOSED", null, stateOf, (s) => (s === "CLOSED" ? true : s));
  await check("issues_reopen reopens with a comment", "provider_issues_reopen", () => fIssues.issuesReopen(spec, B.number, { comment: "smoke reopen" }));
  await check("the issue reads OPEN", null, stateOf, (s) => (s === "OPEN" ? true : s));
  await check("issues_close closes as not planned", "provider_issues_close", () => fIssues.issuesClose(spec, B.number, { reason: "not planned" }));
  await check("the issue reads CLOSED again", null, stateOf, (s) => (s === "CLOSED" ? true : s));
}

async function issuesNativeTypes(): Promise<void> {
  const spec = R();
  const C = issueKey("C");
  const types = await check("org_issue_types lists the organisation's types", "provider_org_issue_types", () => fIssues.orgIssueTypes(state.owner), (t) => (Array.isArray(t) ? true : "not a list"));
  if (!types.ok) return;
  const first = types.value[0];
  if (first === undefined) throw new SkipError("the organisation defines no issue types (creating one is an organisation-wide change this suite does not make)");
  await check("issues_set_type sets the issue's native type", "provider_issues_set_type", () => fIssues.issuesSetType(spec, C.number, first.name));
  await check(
    "the native type reads back",
    null,
    async () => (await gh(["api", `repos/${spec}/issues/${C.number}`, "--jq", ".type.name"])).trim(),
    (n) => (n === first.name ? true : `type: ${n}`),
  );
}

// ---------------------------------------------------------------------------
// Scenarios — projects (organisation-level writes)
// ---------------------------------------------------------------------------

async function projectsLifecycle(): Promise<void> {
  assertCapacity();
  const owner = state.owner;
  const originalTitle = state.project.title;
  // Recorded before the create call. A project has no identifier until the
  // create response arrives, so until then the cleanup looks the project up by
  // the exact throwaway titles this run uses (the original and the edited one)
  // and deletes only an exact single match; once the number is known it deletes
  // by number.
  const projectRecord = record("project", `${owner} project titled ${originalTitle}`, `gh project list --owner ${owner} --format json   (find the title, then: gh project delete <number> --owner ${owner})`, async () => {
    let number = state.project.number;
    if (number === "") {
      const titles = new Set([originalTitle, `${originalTitle}-edited`]);
      const listed = await ghTry(["project", "list", "--owner", owner, "--format", "json", "--limit", "200"]);
      if (listed.status !== 0) throw new Error(`could not list projects to find '${originalTitle}': ${listed.stderr.trim().split("\n")[0] ?? ""}`);
      const matches = parse<{ projects?: Array<{ number: number; title: string }> }>(listed.stdout).projects?.filter((p) => titles.has(p.title)) ?? [];
      if (matches.length === 0) return;
      if (matches.length > 1) throw new Error(`${matches.length} projects match '${originalTitle}'; refusing to delete any automatically`);
      number = String(matches[0]!.number);
    }
    const d = await ghTry(["project", "delete", number, "--owner", owner]);
    if (!notFoundOk(d)) throw new Error(d.stderr.trim().split("\n")[0] ?? "delete failed");
  }, false);
  // The record is confirmed when the create call succeeds, whether or not its
  // response is readable; teardown waits for the call if a signal arrives
  // while it is in flight.
  const created = await td.inflight(
    ghTry(["project", "create", "--owner", owner, "--title", originalTitle, "--format", "json"]).then((r) => {
      if (r.status === 0) projectRecord.confirm();
      return r;
    }),
    `gh project list --owner ${owner} --format json   (find '${originalTitle}', then: gh project delete <number> --owner ${owner})`,
  );
  if (created.status !== 0) throw new SkipError(`project creation refused (token needs the 'project' scope and organisation project permission): ${created.stderr.trim().split("\n")[0] ?? ""}`);
  // An unreadable response leaves the number unset; the recorded cleanup then
  // finds the project by its title.
  const rec = parse<{ number: number; id: string }>(created.stdout);
  state.project.number = String(rec.number);
  state.project.id = rec.id;
  const number = state.project.number;
  const edited = `${state.project.title}-edited`;
  const e = await ghTry(["project", "edit", number, "--owner", owner, "--title", edited, "--description", "devenv smoke"]);
  probe("project edit (title and description)", e.status === 0, e.status === 0 ? "" : e.stderr.trim().split("\n")[0] ?? "");
  if (e.status === 0) state.project.title = edited;
  await check(
    "projects_list shows the project under its edited title",
    "provider_projects_list",
    async () => ghProjects.projectsList(undefined, ["--owner", owner, "--format", "json", "--limit", "100"]),
    (t) => (parse<{ projects: Array<{ number: number; title: string }> }>(t).projects.some((p) => String(p.number) === number && p.title === state.project.title) ? true : "not listed as edited"),
  );
  await check("projects_number_by_name resolves the title to its number", "provider_projects_number_by_name", () => fProjects.projectsNumberByName(owner, state.project.title), (n) => (n === number ? true : `got ${n}`));
  const ops = await fProjects.projectsOps();
  await check("projects_id_by_name resolves the title to its node id", "provider_projects_id_by_name", () => ops.idByName(owner, state.project.title), (id) => (id === state.project.id ? true : `got ${id}`));
}

async function projectsItemsAndFields(): Promise<void> {
  if (state.project.number === "") throw new SkipError("the project was not created");
  const owner = state.owner;
  const A = issueKey("A");
  const B = issueKey("B");
  const ops = await fProjects.projectsOps();
  await check("projects_item_add puts issue A on the project", "provider_projects_item_add", () => ops.itemAdd(state.project.number, A.url, owner));
  await check("projects_add_issue adds issue B by project title", "provider_projects_add_issue", () => fProjects.projectsAddIssue(owner, state.project.title, B.url));
  const item = await check("projects_item_id_for_issue finds A's card", "provider_projects_item_id_for_issue", () => ops.itemIdForIssue(state.project.id, String(A.number), owner, state.repoName), (id) => (id !== "" ? true : "empty id"));
  await check(
    "projects_field_list shows the Status field",
    "provider_projects_field_list",
    () => ops.fieldList(state.project.number, owner),
    (t) => (t.includes("Status") ? true : "no Status field"),
  );
  if (!item.ok) return;
  for (const word of ["In Progress", "Done"]) {
    const ids = await check(`projects_field_option_ids resolves '${word}'`, "provider_projects_field_option_ids", () => ops.fieldOptionIds(state.project.id, "Status", word));
    if (!ids.ok) continue;
    await check(`projects_field_set moves the card to '${word}'`, "provider_projects_field_set", () => ops.fieldSet(state.project.id, item.value, ids.value.fieldId, ids.value.optionId), (b) => b === true || "false");
    await check(
      `projects_for_issue reports '${word}'`,
      "provider_projects_for_issue",
      () => ops.forIssue(A.url, owner),
      (rows) => (rows.some((r) => r.number === state.project.number && r.status === word) ? true : `rows: ${JSON.stringify(rows).slice(0, 160)}`),
    );
  }
}

async function projectsClose(): Promise<void> {
  if (state.project.number === "") throw new SkipError("the project was not created");
  const owner = state.owner;
  const number = state.project.number;
  const c = await ghTry(["project", "close", number, "--owner", owner]);
  probe("project close", c.status === 0, c.status === 0 ? "" : c.stderr.trim().split("\n")[0] ?? "");
  const v = await ghTry(["project", "view", number, "--owner", owner, "--format", "json"]);
  probe("the project reads closed", v.status === 0 && parse<{ closed?: boolean }>(v.stdout).closed === true);
}

// ---------------------------------------------------------------------------
// Scenarios — pull requests
// ---------------------------------------------------------------------------

async function prsOpen(): Promise<void> {
  const spec = R();
  const branch = `smoke-pr1-${process.pid}`;
  await pushBranch(branch, "SMOKE1.md", `smoke ${process.pid}\n`);
  const created = await check("prs_create opens a pull request", "provider_prs_create", () => fPrs.prsCreate(spec, { title: "smoke: first pull request", body: "smoke", head: branch, base: state.defaultBranch }), (r) => (r.status === 0 ? true : r.stderr.slice(0, 160)));
  if (!created.ok) throw new SkipError("the first pull request was not created");
  state.pr1 = numberFromUrl(created.value.stdout);
  const n = state.pr1;
  record("pr", `${spec}#${n}`, `gh pr close ${n} -R ${spec}`, async () => {
    const r = await ghTry(["pr", "close", String(n), "-R", spec]);
    if (!absentOk(r) && !/already (closed|merged)/i.test(r.stderr)) throw new Error(r.stderr.trim().split("\n")[0] ?? "close failed");
  });
  await check("prs_list shows the open pull request", "provider_prs_list", () => fPrs.prsList(spec, { state: "open", json: "number,headRefName" }), (r) => (parse<Array<{ number: number }>>(r.stdout).some((p) => p.number === n) ? true : "not listed"));
  await check("prs_view reads the pull request", "provider_prs_view", () => fPrs.prsView(spec, n, { json: "number,state,headRefName" }), (r) => {
    const v = parse<{ state: string; headRefName: string }>(r.stdout);
    return v.state === "OPEN" && v.headRefName === branch ? true : r.stdout.slice(0, 120);
  });
  await check("prs_diff contains the changed file", "provider_prs_diff", () => fPrs.prsDiff(spec, n), (r) => (r.stdout.includes("SMOKE1.md") ? true : "file missing from the diff"));
  await check("prs_diff --name-only lists the path", "provider_prs_diff", () => fPrs.prsDiff(spec, n, { nameOnly: true }), (r) => (r.stdout.trim() === "SMOKE1.md" ? true : r.stdout.slice(0, 80)));
}

interface ThreadNode {
  id: string;
  isResolved: boolean;
  comments: { nodes: Array<{ databaseId: number; body: string }> };
}

async function threadNodes(spec: string, pr: number): Promise<ThreadNode[]> {
  const r = await fPrs.prsThreadsPage(spec, pr);
  return parse<{ data: { repository: { pullRequest: { reviewThreads: { nodes: ThreadNode[] } } } } }>(r.stdout).data.repository.pullRequest.reviewThreads.nodes;
}

async function prsThreads(): Promise<void> {
  const spec = R();
  const branch = `smoke-pr2-${process.pid}`;
  await pushBranch(branch, "SMOKE2.md", `smoke two ${process.pid}\n`);
  const created = await fPrs.prsCreate(spec, { title: "smoke: thread pull request", body: "smoke", head: branch, base: state.defaultBranch });
  state.pr2 = numberFromUrl(created.stdout);
  const n = state.pr2;
  record("pr", `${spec}#${n}`, `gh pr close ${n} -R ${spec}`, async () => {
    const r = await ghTry(["pr", "close", String(n), "-R", spec]);
    if (!absentOk(r) && !/already (closed|merged)/i.test(r.stderr)) throw new Error(r.stderr.trim().split("\n")[0] ?? "close failed");
  });
  await check("prs_comment posts a pull request comment", "provider_prs_comment", () => fPrs.prsComment(spec, n, { body: "smoke pr comment" }), (r) => (/#issuecomment-\d+/.test(r.stdout) ? true : r.stdout.slice(0, 120)));
  const thread = await check("prs_thread_create opens an inline thread", "provider_prs_thread_create", () => fPrs.prsThreadCreate(spec, n, { body: "smoke inline thread", path: "SMOKE2.md", line: 1 }), (r) => (parse<{ thread?: { url?: string } }>(r.stdout).thread?.url ? true : r.stdout.slice(0, 120)));
  await check("prs_thread_create opens a general thread", "provider_prs_thread_create", () => fPrs.prsThreadCreate(spec, n, { body: "smoke general thread" }), (r) => (parse<{ thread?: { url?: string } }>(r.stdout).thread?.url ? true : r.stdout.slice(0, 120)));
  const nodes = await check("prs_threads_page lists the threads unresolved", "provider_prs_threads_page", () => threadNodes(spec, n), (ns) => (ns.length >= 1 && ns.every((t) => !t.isResolved) ? true : `threads: ${ns.length}`));
  if (!thread.ok || !nodes.ok) return;
  const mine = nodes.value.find((t) => t.comments.nodes[0]?.body === "smoke inline thread");
  if (mine === undefined) {
    probe("the inline thread is listed by its first comment", false);
    return;
  }
  const commentId = mine.comments.nodes[0]!.databaseId;
  await check("prs_thread_reply replies in the thread", "provider_prs_thread_reply", () => fPrs.prsThreadReply(spec, n, commentId, "smoke reply"), (r) => (r.status === 0 ? true : r.stderr.slice(0, 120)));
  await check("prs_thread_resolve resolves the thread", "provider_prs_thread_resolve", () => fPrs.prsThreadResolve(spec, mine.id), (r) => (r.stdout.trim() === "true" ? true : r.stdout.slice(0, 40)));
  await check("the thread reads as resolved with the reply", null, () => threadNodes(spec, n), (ns) => {
    const t = ns.find((x) => x.id === mine.id);
    return t !== undefined && t.isResolved && t.comments.nodes.length === 2 ? true : "thread not resolved or reply missing";
  });
}

async function prsMergeAndStates(): Promise<void> {
  const spec = R();
  if (state.pr1 === 0) throw new SkipError("the first pull request was not created");
  const n = state.pr1;
  await check("prs_merge rebase-merges and deletes the branch", "provider_prs_merge", () => fPrs.prsMerge(spec, n, { method: "rebase", deleteBranch: true }), (r) => (r.status === 0 ? true : r.stderr.slice(0, 160)));
  const merged = await poll(async () => {
    const v = parse<{ state: string }>((await fPrs.prsView(spec, n, { json: "state" })).stdout);
    return v.state === "MERGED" ? true : undefined;
  }, 15, 2000);
  probe("the merged pull request reads MERGED", merged === true);
  await check("prs_list --state merged includes it", "provider_prs_list", () => fPrs.prsList(spec, { state: "merged", json: "number" }), (r) => (parse<Array<{ number: number }>>(r.stdout).some((p) => p.number === n) ? true : "not listed"));
  if (state.pr2 !== 0) {
    const p2 = state.pr2;
    const closed = await ghTry(["pr", "close", String(p2), "-R", spec]);
    probe("closing the thread pull request without merging", closed.status === 0, closed.stderr.trim().split("\n")[0] ?? "");
    await check("prs_list --state closed lists only the unmerged one", "provider_prs_list", () => fPrs.prsList(spec, { state: "closed", json: "number" }), (r) => {
      const nums = parse<Array<{ number: number }>>(r.stdout).map((p) => p.number);
      return nums.includes(p2) && !nums.includes(n) ? true : `closed: ${nums.join(",")}`;
    });
  }
}

// ---------------------------------------------------------------------------
// Scenarios — pipelines
// ---------------------------------------------------------------------------

const WORKFLOW_YAML = `name: smoke
on: workflow_dispatch
jobs:
  noop:
    runs-on: ubuntu-latest
    steps:
      - run: echo smoke > smoke.txt
      - run: sleep 25
      - uses: actions/upload-artifact@v4
        with:
          name: smoke-artifact
          path: smoke.txt
`;

async function pipelinesDispatch(): Promise<void> {
  const spec = R();
  const put = await ghTry([
    "api", "-X", "PUT", `repos/${spec}/contents/.github/workflows/smoke.yml`,
    "-f", "message=smoke: add workflow",
    "-f", `content=${Buffer.from(WORKFLOW_YAML).toString("base64")}`,
    "-f", `branch=${state.defaultBranch}`,
  ]);
  if (put.status !== 0) throw new SkipError(`workflow file push refused (token needs the 'workflow' scope, or Actions is disabled): ${put.stderr.trim().split("\n")[0] ?? ""}`);
  const listed = await poll(async () => {
    const t = await fPipelines.pipelinesWorkflowList(spec, ["--json", "name,path,state"]);
    return parse<Array<{ path: string }>>(t).some((w) => w.path.endsWith("smoke.yml")) ? true : undefined;
  }, 30, 2000);
  exercised.add("provider_pipelines_workflow_list");
  if (listed !== true) throw new SkipError("the workflow was not registered within 60 seconds");
  probe("pipelines_workflow_list shows the workflow", true);
  await check("pipelines_workflow_run dispatches the workflow", "provider_pipelines_workflow_run", () => fPipelines.pipelinesWorkflowRun(spec, "smoke.yml", ["--ref", state.defaultBranch]), (r) => (r.status === 0 ? true : r.stderr.slice(0, 160)));
  const runId = await poll(async () => {
    const t = await fPipelines.pipelinesRunList(spec, { json: "id,status,workflowName", limit: 5 });
    const run = parse<Array<{ id: number; workflowName: string }>>(t).find((r) => r.workflowName === "smoke");
    return run !== undefined ? String(run.id) : undefined;
  }, 45, 2000);
  exercised.add("provider_pipelines_run_list");
  if (runId === undefined) throw new SkipError("no run appeared within 90 seconds (Actions disabled, or no runner available)");
  state.runId = runId;
  probe("pipelines_run_list shows the dispatched run", true, `run ${runId}`);
  record("run", `${spec} run ${runId}`, `gh run delete ${runId} -R ${spec}`, async () => {
    const d = await ghTry(["run", "delete", runId, "-R", spec]);
    if (!absentOk(d) && !/in progress|cannot delete/i.test(d.stderr)) throw new Error(d.stderr.trim().split("\n")[0] ?? "delete failed");
  });
  await check("pipelines_run_view reads the run", "provider_pipelines_run_view", () => fPipelines.pipelinesRunView(spec, runId, { json: "status,conclusion" }), (t) => (typeof parse<{ status?: string }>(t).status === "string" ? true : t.slice(0, 120)));
  await check("pipelines_run_watch follows the run to success", "provider_pipelines_run_watch", () => fPipelines.pipelinesRunWatch(spec, runId, ["--exit-status"]), (r) => (r.status === 0 ? true : `exit ${r.status}: ${r.stderr.trim().split("\n")[0] ?? ""}`));
  await check("pipelines_run_artifacts lists the artifact", "provider_pipelines_run_artifacts", () => fPipelines.pipelinesRunArtifacts(spec, runId), (t) => (t.includes("smoke-artifact") ? true : t.slice(0, 120)));
  const dest = join(state.tmp, "artifact");
  await check("pipelines_run_download fetches the artifact", "provider_pipelines_run_download", () => fPipelines.pipelinesRunDownload(spec, runId, ["--name", "smoke-artifact", "--dir", dest]), (r) => {
    if (r.status !== 0) return r.stderr.slice(0, 160);
    return existsSync(dest) && readdirSync(dest).length > 0 ? true : "no file was downloaded";
  });
}

async function pipelinesRerunCancel(): Promise<void> {
  const spec = R();
  if (state.runId === "") throw new SkipError("no run was dispatched");
  const runId = state.runId;
  await check("pipelines_run_rerun starts a new attempt", "provider_pipelines_run_rerun", () => fPipelines.pipelinesRunRerun(spec, runId, []), (r) => (r.status === 0 ? true : r.stderr.slice(0, 160)));
  await sleep(4000);
  await check("pipelines_run_cancel cancels the rerun", "provider_pipelines_run_cancel", async () => ghPipelines.pipelinesRunCancel(spec, runId), (r) => (r.status === 0 ? true : r.stderr.slice(0, 160)));
}

// ---------------------------------------------------------------------------
// Scenarios — organisation
// ---------------------------------------------------------------------------

async function orgRulesets(): Promise<void> {
  const spec = R();
  const payloadFile = join(state.tmp, "ruleset.json");
  const name = `smoke-ruleset-${process.pid}`;
  const payload = (n: string): string =>
    JSON.stringify({ name: n, target: "branch", enforcement: "disabled", conditions: { ref_name: { include: ["~DEFAULT_BRANCH"], exclude: [] } }, rules: [{ type: "deletion" }] });
  writeFileSync(payloadFile, payload(name));
  exercised.add("provider_org_ruleset_create");
  const created = await fOrg.orgRulesetCreate(spec, payloadFile);
  if (!created.ok) {
    if (/upgrade|not available|403/i.test(created.stderr)) throw new SkipError(`rulesets are unavailable for this plan or repository visibility: ${created.stderr.trim().split("\n")[0] ?? ""}`);
    probe("org_ruleset_create", false, created.stderr.trim().split("\n")[0] ?? "");
    return;
  }
  probe("org_ruleset_create creates a disabled ruleset", true);
  const listed = await check("org_rulesets_list finds the ruleset", "provider_org_rulesets_list", () => fOrg.orgRulesetsList(spec), (t) => (parse<Array<{ name: string }>>(t).some((r) => r.name === name) ? true : "not listed"));
  if (!listed.ok) return;
  const id = String(parse<Array<{ id: number; name: string }>>(listed.value).find((r) => r.name === name)?.id ?? "");
  record("ruleset", `${spec}#${id}`, `gh api -X DELETE repos/${spec}/rulesets/${id}`, async () => {
    const d = await ghTry(["api", "-X", "DELETE", `repos/${spec}/rulesets/${id}`]);
    if (!absentOk(d)) throw new Error(d.stderr.trim().split("\n")[0] ?? "delete failed");
  });
  await check("org_ruleset_get reads it", "provider_org_ruleset_get", () => fOrg.orgRulesetGet(spec, id), (t) => (parse<{ name: string }>(t).name === name ? true : t.slice(0, 120)));
  writeFileSync(payloadFile, payload(`${name}-edited`));
  await check("org_ruleset_update renames it", "provider_org_ruleset_update", () => fOrg.orgRulesetUpdate(spec, id, payloadFile), (r) => (r.ok ? true : r.stderr.slice(0, 160)));
  await check("the update reads back", null, () => fOrg.orgRulesetGet(spec, id), (t) => (parse<{ name: string }>(t).name === `${name}-edited` ? true : t.slice(0, 120)));
}

async function orgReleasesAndPackages(): Promise<void> {
  const spec = R();
  await check("org_releases_list answers a list", "provider_org_releases_list", () => fOrg.orgReleasesList(spec, ["--json", "tagName"]), (t) => (Array.isArray(parse<unknown>(t)) ? true : t.slice(0, 80)));
  exercised.add("provider_org_packages_query");
  const q = await fOrg.orgPackagesQuery(state.owner, { type: "npm" });
  if (q.status !== 0) {
    if (/scope|403/i.test(q.stderr)) skip("org_packages_query", `token lacks read:packages: ${q.stderr.trim().split("\n")[0] ?? ""}`);
    else probe("org_packages_query", false, q.stderr.trim().split("\n")[0] ?? "");
    return;
  }
  probe("org_packages_query answers", true);
  const first = parse<Array<{ name?: string }>>(q.stdout)[0];
  if (first?.name === undefined) throw new SkipError("the organisation has no npm packages to query versions of (the suite does not publish packages)");
  const pkg = first.name;
  await check("org_package_versions_query lists versions", "provider_org_package_versions_query", async () => fOrg.orgPackageVersionsQuery(state.owner, "npm", pkg), (r) => (r.status === 0 ? true : r.stderr.slice(0, 120)));
}

// ---------------------------------------------------------------------------
// Scenarios — URL helpers and auth
// ---------------------------------------------------------------------------

async function urlHelpers(): Promise<void> {
  const spec = R();
  await check("web_host names github.com", "provider_web_host", () => ghUrls.webHost(), (h) => (h === "github.com" ? true : h));
  await check("web_url builds a repository page", "provider_web_url", () => ghUrls.webUrl(spec, "issues/1"), (u) => (u === `https://github.com/${spec}/issues/1` ? true : u));
  await check("pr_web_url builds a pull request page", "provider_pr_web_url", () => fUrls.prWebUrl(spec, 7), (u) => (u === `https://github.com/${spec}/pull/7` ? true : u));
  await check("extract_url finds a URL in tool output", "provider_extract_url", () => fUrls.extractUrl(`created https://github.com/${spec}/issues/3 ok`), (u) => (u === `https://github.com/${spec}/issues/3` ? true : String(u)));
  await check("remote_to_spec parses a remote", "provider_remote_to_spec", () => fUrls.remoteToSpec(`https://github.com/${spec}.git`), (s) => (s === spec ? true : String(s)));
  await check("remote_to_web parses a remote", "provider_remote_to_web", () => fUrls.remoteToWeb(`https://github.com/${spec}.git`), (u) => (u === `https://github.com/${spec}` ? true : String(u)));
  await check("remote_is_org_owned accepts the repo's own remote", "provider_remote_is_org_owned", () => fUrls.remoteIsOrgOwned(`https://github.com/${spec}.git`, state.owner), (b) => b === true || String(b));
  await check("git_transport_url builds the clone URL", "provider_git_transport_url", () => fUrls.gitTransportUrl(state.owner, state.repoName), (u) => (u === `https://github.com/${spec}.git` ? true : u));
  await check("auth_status_ok reports an authenticated gh", "provider_auth_status_ok", () => fUrls.authStatusOk(), (b) => b === true || "false");
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

const SCENARIOS: Scenario[] = [
  { id: "repository create and inspect", family: "repos", run: reposCreateAndInspect, verbs: ["provider_repos_create", "provider_repos_view", "provider_repos_exists", "provider_repos_commits_count", "provider_repos_tree_count", "provider_repos_squash_merge_allowed", "provider_repos_list"] },
  { id: "repository settings", family: "repos", run: reposSettings, verbs: ["provider_repos_edit", "provider_repos_patch", "provider_repos_patch_with_error"] },
  { id: "repository from a directory", family: "repos", run: reposNameFromDirectory, verbs: ["provider_repos_name_with_owner"] },
  { id: "team access", family: "repos", run: reposTeamAccess, verbs: ["provider_repos_team_put"] },
  { id: "collaborator access", family: "repos", run: reposCollaborator, verbs: ["provider_repos_collaborator_put"] },
  { id: "labels", family: "issues", run: issuesLabels, verbs: ["provider_issues_label_ensure", "provider_issues_label_create", "provider_issues_label_list", "provider_issues_label_update"] },
  { id: "milestones", family: "issues", run: issuesMilestoneScenario, verbs: ["provider_issues_milestones"] },
  { id: "create and read", family: "issues", run: issuesCreateAndRead, verbs: ["provider_issues_create", "provider_issues_view", "provider_issues_list", "provider_issues_exists", "provider_issue_web_url"] },
  { id: "edit and comments", family: "issues", run: issuesEditAndComments, verbs: ["provider_issues_edit", "provider_issues_comment", "provider_issues_comments", "provider_issues_comment_add", "provider_issues_comment_get", "provider_issues_comment_edit"] },
  { id: "sub-issue graph", family: "issues", run: issuesGraph, verbs: ["provider_issue_graph_link", "provider_issue_graph_children", "provider_issue_graph_parent", "provider_issue_graph_unlink"] },
  { id: "blocked-by", family: "issues", run: issuesBlockedBy, verbs: ["provider_issue_blocked_by_add", "provider_issue_blocked_by_remove"] },
  { id: "close and reopen", family: "issues", run: issuesCloseReopen, verbs: ["provider_issues_close", "provider_issues_reopen"] },
  { id: "native types", family: "issues", run: issuesNativeTypes, verbs: ["provider_org_issue_types", "provider_issues_set_type"] },
  { id: "project create and edit", family: "projects", run: projectsLifecycle, verbs: ["provider_projects_list", "provider_projects_number_by_name", "provider_projects_id_by_name"] },
  { id: "project items and fields", family: "projects", run: projectsItemsAndFields, verbs: ["provider_projects_item_add", "provider_projects_add_issue", "provider_projects_item_id_for_issue", "provider_projects_field_list", "provider_projects_field_option_ids", "provider_projects_field_set", "provider_projects_for_issue"] },
  { id: "project close", family: "projects", run: projectsClose, verbs: [] },
  { id: "open a pull request", family: "prs", run: prsOpen, verbs: ["provider_prs_create", "provider_prs_list", "provider_prs_view", "provider_prs_diff"] },
  { id: "review threads", family: "prs", run: prsThreads, verbs: ["provider_prs_comment", "provider_prs_thread_create", "provider_prs_threads_page", "provider_prs_thread_reply", "provider_prs_thread_resolve"] },
  { id: "merge and state filters", family: "prs", run: prsMergeAndStates, verbs: ["provider_prs_merge"] },
  { id: "dispatch and observe a run", family: "pipelines", run: pipelinesDispatch, verbs: ["provider_pipelines_workflow_list", "provider_pipelines_workflow_run", "provider_pipelines_run_list", "provider_pipelines_run_view", "provider_pipelines_run_watch", "provider_pipelines_run_artifacts", "provider_pipelines_run_download"] },
  { id: "rerun and cancel", family: "pipelines", run: pipelinesRerunCancel, verbs: ["provider_pipelines_run_rerun", "provider_pipelines_run_cancel"] },
  { id: "rulesets", family: "org", run: orgRulesets, verbs: ["provider_org_ruleset_create", "provider_org_rulesets_list", "provider_org_ruleset_get", "provider_org_ruleset_update"] },
  { id: "releases and packages", family: "org", run: orgReleasesAndPackages, verbs: ["provider_org_releases_list", "provider_org_packages_query", "provider_org_package_versions_query"] },
  { id: "URL helpers and auth", family: "urls", run: urlHelpers, verbs: ["provider_web_host", "provider_web_url", "provider_pr_web_url", "provider_extract_url", "provider_remote_to_spec", "provider_remote_to_web", "provider_remote_is_org_owned", "provider_git_transport_url", "provider_auth_status_ok"] },
];

if (process.argv.includes("--list-coverage")) {
  console.log(
    JSON.stringify({
      scenarios: SCENARIOS.map((s) => ({ id: s.id, family: s.family, verbs: s.verbs })),
      excluded: EXCLUDED_VERBS,
    }),
  );
  process.exit(EXIT_SUCCESS);
}

// ---------------------------------------------------------------------------
// Gate
// ---------------------------------------------------------------------------

const owner = process.env.GITHUB_SMOKE_OWNER ?? "";
if (process.env.GITHUB_SMOKE !== "write") {
  errOut("github-smoke refuses to run: it creates and deletes items in a LIVE GitHub organisation.");
  errOut("  GITHUB_SMOKE=write          the only accepted value (the suite is destructive)");
  errOut("  GITHUB_SMOKE_OWNER=<org>    the organisation that receives the throwaway items");
  errOut("  GITHUB_SMOKE_CONFIRM=<org>  must equal GITHUB_SMOKE_OWNER exactly");
  errOut("  GITHUB_SMOKE_ALLOW_REAL_ORG=<org>  additionally required when <org> is the organisation in devenv.config");
  process.exit(EXIT_MISUSE);
}
if (owner === "") {
  errOut("github-smoke refuses to run: set GITHUB_SMOKE_OWNER to the target organisation.");
  process.exit(EXIT_MISUSE);
}
if (process.env.GITHUB_SMOKE_CONFIRM !== owner) {
  errOut(`github-smoke refuses to run: set GITHUB_SMOKE_CONFIRM=${owner} (the exact target organisation).`);
  process.exit(EXIT_MISUSE);
}
// The configured organisation is read before the suite points the provider
// layer at its own temporary configuration. An unreadable configuration is
// not evidence that no real organisation exists, so it refuses as well.
let configuredOrg = "";
try {
  configuredOrg = providerOrgGet();
} catch {
  configuredOrg = "";
}
const realOrgAllowed = process.env.GITHUB_SMOKE_ALLOW_REAL_ORG === owner;
if (configuredOrg === "" && !realOrgAllowed) {
  errOut("github-smoke refuses to run: the real-organisation guard could not be evaluated (no organisation could be read from devenv.config or the setup seed file).");
  errOut(`  Fix the configuration, or set GITHUB_SMOKE_ALLOW_REAL_ORG=${owner} to accept that '${owner}' may be the real organisation.`);
  process.exit(EXIT_MISUSE);
}
if (configuredOrg !== "" && configuredOrg.toLowerCase() === owner.toLowerCase() && !realOrgAllowed) {
  errOut(`github-smoke refuses to run: '${owner}' is the organisation configured in devenv.config.`);
  errOut(`  Use a dedicated test organisation, or set GITHUB_SMOKE_ALLOW_REAL_ORG=${owner} to accept creating throwaway items there.`);
  process.exit(EXIT_MISUSE);
}

// ---------------------------------------------------------------------------
// Preflight and run
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  state.tmp = mkdtempSync(join(tmpdir(), "gh-smoke-"));
  record("tempdir", state.tmp, `rm -rf ${state.tmp}`, async () => {
    rmSync(state.tmp, { recursive: true, force: true });
  });
  // Force the facade to the github provider whatever the host config says,
  // and never let an ambient repository target leak into a verb call.
  process.env.DEVENV_ROOT = state.tmp;
  delete process.env.DEVENV_REPO;
  delete process.env.GH_REPO;

  if (!ghUrls.authStatusOk()) throw new FatalError("gh is not authenticated (run: gh auth login)");
  const login = await ghTry(["api", `orgs/${owner}`, "--jq", ".login"]);
  if (login.status !== 0 || login.stdout.trim() === "") {
    throw new FatalError(`'${owner}' is not an organisation visible to this gh login: ${login.stderr.trim().split("\n")[0] ?? ""}`);
  }
  state.owner = login.stdout.trim();
  // GitHub redirects a renamed organisation, so the name it resolves to can
  // differ from the one typed: compare the configured organisation again
  // against the owner every destructive call will use.
  if (configuredOrg !== "" && configuredOrg.toLowerCase() === state.owner.toLowerCase() && process.env.GITHUB_SMOKE_ALLOW_REAL_ORG?.toLowerCase() !== state.owner.toLowerCase()) {
    throw new RefusalError(
      `'${owner}' resolves to '${state.owner}', the organisation configured in devenv.config; set GITHUB_SMOKE_ALLOW_REAL_ORG=${state.owner} to accept creating throwaway items there.`,
    );
  }
  // The throwaway repository can only be deleted with the delete_repo scope.
  // A classic token reports its scopes in a header. An installation (app)
  // token is refused by `GET /user`, so the run stops with the 'could not read
  // the token's scopes' error. A fine-grained user token reads the user but
  // exposes no scope header, so the check is skipped for it with a notice.
  const scopeProbe = await ghTry(["api", "-i", "user"]);
  if (scopeProbe.status !== 0) {
    throw new FatalError(`could not read the token's scopes: ${scopeProbe.stderr.trim().split("\n")[0] ?? ""}`);
  }
  const scopes = parseOAuthScopes(scopeProbe.stdout);
  if (scopes === null) {
    out("notice: token scopes could not be checked (fine-grained token); a missing delete_repo permission would only show at teardown");
  } else if (lacksDeleteRepo(scopes)) {
    throw new FatalError("the token lacks the delete_repo scope, so the throwaway repository could not be removed (run: gh auth refresh -s delete_repo)");
  }
  writeFileSync(join(state.tmp, "devenv.config"), `[provider]\nname=github\n\n[organization]\norg=${state.owner}\n`);
  state.spec = `${state.owner}/${state.repoName}`;
  if (await fRepos.reposExists(state.spec)) {
    throw new FatalError(`'${state.spec}' already exists and was not created by this run; refusing to touch it`);
  }

  out("github smoke — combined suite");
  out("==============================");
  out(`target: owner=${state.owner} repository=${state.spec} (created by this run)`);
  out(`resource cap: ${MAX_RESOURCES}`);

  for (const s of SCENARIOS) {
    if (td.isInterrupted()) break;
    out(`\n[${s.family}] ${s.id}`);
    const failBefore = fail;
    const skipBefore = skipped;
    try {
      await s.run();
    } catch (e) {
      if (e instanceof InterruptedError) break;
      if (e instanceof FatalError || e instanceof ResourceCapError) {
        probe(s.id, false, e.message);
        break;
      }
      if (e instanceof SkipError) skip(s.id, e.message);
      else probe(s.id, false, errText(e));
    }
    if (fail === failBefore && skipped === skipBefore) {
      const missing = s.verbs.filter((v) => !exercised.has(v));
      if (missing.length > 0) probe(`${s.id}: every declared verb was called`, false, `never called: ${missing.join(", ")}`);
    }
  }
}

let fatal = "";
let refused = false;
try {
  await main();
} catch (e) {
  fatal = errText(e);
  refused = e instanceof RefusalError;
  errOut(`${refused ? "github-smoke refuses to run" : "aborted"}: ${fatal}`);
} finally {
  // The same shared run a signal started, if one did: never a second pass.
  await td.teardown();
}
out("================================");
out(`summary: ${pass} pass, ${fail} fail, ${skipped} skip; ${td.recordedCount()} resources recorded, ${td.failedCount()} teardown failures`);
const unexercised = SCENARIOS.flatMap((s) => s.verbs).filter((v) => !exercised.has(v));
if (unexercised.length > 0) {
  out(`not exercised (skipped or stopped early): ${[...new Set(unexercised)].join(", ")}`);
}
if (td.isInterrupted()) process.exit(130);
if (refused) process.exit(EXIT_MISUSE);
process.exit(fail === 0 && td.failedCount() === 0 && fatal === "" ? EXIT_SUCCESS : 1);
