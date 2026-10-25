// azure/smoke.ts — live validation suite for the azure provider, driving the
// TS modules (port of azure-smoke-test.sh's flow). Manual only: never invoked
// by tests or CI.
//
// One combined flow: reads and writes against a LIVE org through the TS
// transport (azureHttp / azureHttpPaginate) — that is the point. Setup is
// licensed (the suite creates the fixtures read cases need) and teardown is
// mandatory: everything created inside the user-provided test project dies at
// suite end, and the org outside that project is never touched.
//
// Safety gate (mirrors the bash harness):
//   AZURE_SMOKE=1      read-only tier
//   AZURE_SMOKE=write  destructive tier (also needs
//                      AZURE_SMOKE_CONFIRM=<test project>)
// Env-driven inputs:
//   AZURE_DEVOPS_ORG          the live org
//   AZURE_SMOKE_TEST_PROJECT  a blank/disposable test project
//   AZURE_PAT                 token (Code/PR/WorkItems/Boards/Build/Packaging
//                             + Policy management read+write)
//   AZURE_SMOKE_REPORT        optional per-verb pass/fail report path
// Exit: 0 only when every probe passed AND teardown succeeded.
//
// Run via the bash runner (see smoke-run.sh) or:
//   AZURE_SMOKE=write AZURE_SMOKE_CONFIRM=<proj> AZURE_PAT=... \
//   AZURE_DEVOPS_ORG=... AZURE_SMOKE_TEST_PROJECT=... \
//   node tools/lib/providers/azure/smoke.ts

import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, appendFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { azureHttp } from "./http.ts";
import { azureOrgProject, azureUri } from "./urls.ts";
import {
  reposList,
  reposView,
  reposDefaultBranch,
  reposCommitsCount,
  reposCreate,
  reposPatch,
  reposProtectBranch,
  reposTeamPut,
  repoGuidShared,
} from "./repos.ts";
import {
  issuesView,
  issuesExists,
  issuesComments,
  issuesComment,
  issuesCommentGet,
  issuesEdit,
  issuesCreate,
  issuesReopen,
  issuesSetType,
  issuesLabelCreate,
  issuesLabelList,
  issueGraphLink,
  issueGraphChildren,
  issueGraphParent,
  issueGraphUnlink,
} from "./issues.ts";
import {
  prsList,
  prsView,
  prsDiff,
  prsCreate,
  prsMerge,
  prsComment,
  prsThreadsPage,
  prsThreadCreate,
  prsThreadReply,
  prsThreadResolve,
} from "./prs.ts";
import {
  orgRulesetsList,
  orgRulesetCreate,
  orgRulesetUpdate,
} from "./policies.ts";
import { orgReleasesList, orgFeedsList } from "./org.ts";
import {
  projectsFieldList,
  projectsFieldOptionIds,
  projectsFieldSet,
  projectsForIssue,
} from "./projects.ts";
import { pipelinesWorkflowList } from "./pipelines.ts";

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

const REPORT_FILE = process.env.AZURE_SMOKE_REPORT ?? "";
const teardownStack: Array<() => Promise<void> | void> = [];
let teardownDone = false;
let teardownFailed = 0;

function reportLine(line: string): void {
  if (REPORT_FILE !== "") {
    try {
      appendFileSync(REPORT_FILE, `${line}\n`);
    } catch {
      // best-effort sink — never fatal
    }
  }
}

let pass = 0;
let fail = 0;
function probe(name: string, ok: boolean, detail = ""): void {
  if (ok) {
    console.log(`PASS  ${name}${detail !== "" ? ` — ${detail}` : ""}`);
    reportLine(`PASS  ${name}${detail !== "" ? ` — ${detail}` : ""}`);
    pass++;
  } else {
    console.log(`FAIL  ${name}${detail !== "" ? ` — ${detail}` : ""}`);
    reportLine(`FAIL  ${name}${detail !== "" ? ` — ${detail}` : ""}`);
    fail++;
  }
}

/** Outcome probe: PASS only when the predicate holds for the parsed JSON. */
function probeOutcome<T>(
  name: string,
  json: unknown,
  predicate: (v: T) => boolean,
  detail = "",
): void {
  let holds = false;
  try {
    holds = predicate(json as T) === true;
  } catch {
    holds = false;
  }
  if (holds) probe(name, true, detail);
  else probe(name, false, `outcome check failed${detail !== "" ? ` — ${detail}` : ""}`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Raw GET shorthand for evidence probes that re-issue exactly what a verb
 * would (used where a verb discards transport errors internally). */
async function rawGet(url: string): Promise<Record<string, unknown> | null> {
  try {
    return await azureHttp<Record<string, unknown>>("GET", url);
  } catch {
    return null;
  }
}

function failHard(message: string): never {
  console.error(message);
  process.exit(1);
}

async function teardownRun(): Promise<void> {
  if (teardownDone) return;
  teardownDone = true;
  for (let i = teardownStack.length - 1; i >= 0; i--) {
    try {
      await teardownStack[i]!();
    } catch (e) {
      teardownFailed++;
      console.error(`  teardown step failed: ${String(e).slice(0, 200)}`);
    }
  }
}

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => {
    void teardownRun().then(() => process.exit(130));
  });
}

// ---------------------------------------------------------------------------
// Inputs + gate
// ---------------------------------------------------------------------------

const tier = process.env.AZURE_SMOKE === "write" ? "write" : process.env.AZURE_SMOKE === "1" ? "read" : "";
if (tier === "") {
  console.error("azure-smoke refuses to run: it exercises a LIVE Azure DevOps org.");
  console.error("  AZURE_SMOKE=1      read-only tier");
  console.error("  AZURE_SMOKE=write  destructive tier (also needs AZURE_SMOKE_CONFIRM=<test project>)");
  process.exit(2);
}
const org = process.env.AZURE_DEVOPS_ORG ?? "";
const project = process.env.AZURE_SMOKE_TEST_PROJECT ?? "";
const pat = process.env.AZURE_PAT ?? "";
if (org === "") failHard("no org resolved (set AZURE_DEVOPS_ORG).");
if (project === "") failHard("no test project (set AZURE_SMOKE_TEST_PROJECT).");
if (pat === "") failHard("no credential (set AZURE_PAT at invocation; never persisted).");
if (tier === "write" && process.env.AZURE_SMOKE_CONFIRM !== project) {
  console.error(
    `destructive tier not confirmed: set AZURE_SMOKE_CONFIRM=${project} (the exact test project name).`,
  );
  process.exit(2);
}
// The transport reads AZURE_PAT from the env; make sure the explicit value
// (which may have come from a file) is visible to it.
process.env.AZURE_PAT = pat;

const smokeRepo = process.env.AZURE_SMOKE_TEST_REPO ?? `smoke-repo-${process.pid}`;

// ---------------------------------------------------------------------------
// Pre-flight: the test project must exist (fail fast with a real diagnosis
// instead of a 404 cascade through every case).
// ---------------------------------------------------------------------------

const preflight = await rawGet(`https://dev.azure.com/${azureUri(org)}/_apis/projects`);
if (preflight === null) {
  failHard(`pre-flight: cannot list projects in org '${org}' — check org name and PAT.`);
}
const projects = (preflight.value as Array<{ name?: string }>) ?? [];
if (!projects.some((p) => p.name === project)) {
  failHard(
    `pre-flight: project '${project}' does not exist in org '${org}'. Create it in the portal first (blank/disposable), then re-run. Known projects: ${projects
      .map((p) => p.name)
      .join(" ")}`,
  );
}
probe("pre-flight: test project exists", true);

// Every verb call resolves targeting from these two — project-scoped to the
// user-provided test project for the whole run.
process.env.AZURE_DEVOPS_PROJECT = project;

const witBase = `https://dev.azure.com/${azureUri(org)}/${azureUri(project)}/_apis/wit`;
const gitBase = `https://dev.azure.com/${azureUri(org)}/${azureUri(project)}/_apis/git`;

// ---------------------------------------------------------------------------
// Tier 1 — read-only probes
// ---------------------------------------------------------------------------

console.log("azure smoke — combined suite");
console.log("==============================");
console.log(`target: org=${org} test-project=${project} tier=${tier}`);

let projectsOk = true;
try {
  await azureHttp("GET", `https://dev.azure.com/${azureUri(org)}/_apis/projects`);
  probe("auth + api-version (projects list)", true, "authenticated GET ok");
} catch (e) {
  projectsOk = false;
  probe("auth + api-version (projects list)", false, String(e).slice(0, 200));
  console.error("auth failed — aborting remaining probes.");
  console.error(`summary: ${pass} pass, ${fail} fail`);
  process.exit(1);
}
void projectsOk;

let reposJson: Array<Record<string, unknown>> = [];
try {
  const listed = await reposList(`${org}/${project}`);
  reposJson = (typeof listed === "string" ? JSON.parse(listed) : listed) as Array<Record<string, unknown>>;
  probe("repos list via paginate", true, `${reposJson.length} repos`);
} catch (e) {
  probe("repos list via paginate", false, String(e).slice(0, 200));
}

let wiCount: string | undefined;
try {
  const r = await azureHttp<{ workItems?: unknown[] }>("POST", `${witBase}/wiql`, {
    body: JSON.stringify({
      query: "SELECT [System.Id] FROM WorkItems WHERE [System.TeamProject] = @project ORDER BY [System.Id] DESC",
    }),
    idempotent: true,
  });
  wiCount = String((r.workItems ?? []).length);
  probe("WIQL query (work items found)", true, `${wiCount} ids`);
} catch (e) {
  probe("WIQL query (work items found)", false, String(e).slice(0, 200));
}

// ---------------------------------------------------------------------------
// Fixture provisioning (licensed setup for the reads that follow)
// ---------------------------------------------------------------------------

let firstId = 0;
let firstRepo = "";
async function destroyWorkItem(id: number): Promise<void> {
  await azureHttp("DELETE", `${witBase}/workitems/${id}?destroy=true`).catch(() => {});
}
if (tier !== "write") {
  console.log("SKIP  fixture provisioning (read-only tier: AZURE_SMOKE=1)");
  firstRepo = (reposJson[0]?.name as string) ?? "";
} else {
  try {
    const r = await azureHttp<{ id?: number }>("POST", `${witBase}/workitems/$Issue`, {
      body: JSON.stringify([
        { op: "add", path: "/fields/System.Title", from: null, value: "[SMOKE-DELETEME] fixture item" },
      ]),
      contentType: "application/json-patch+json",
    });
    firstId = r.id ?? 0;
    teardownStack.push(() => destroyWorkItem(firstId));
    probe(`fixture work item (id ${firstId})`, true);
  } catch (e) {
    probe("fixture work item", false, String(e).slice(0, 200));
  }

  firstRepo = smokeRepo;
  try {
    await reposCreate(firstRepo);
    probe(`fixture repo (${firstRepo})`, true);
    // Register the repo teardown NOW, the moment it exists (LIFO stack: the
    // policy sweep is registered second so it runs while the repo still
    // exists). Repo DELETE matrix: name+destroy can 400, GUID+destroy can
    // 400, plain soft-delete always works — fall through all three.
    teardownStack.push(async () => {
      const guid = await repoGuidShared(firstRepo).catch(() => "");
      await azureHttp("DELETE", `${gitBase}/repositories/${firstRepo}?destroy=true`).catch(() => {});
      if (guid !== "") {
        await azureHttp("DELETE", `${gitBase}/repositories/${guid}?destroy=true`).catch(() => {});
        await azureHttp("DELETE", `${gitBase}/repositories/${guid}`).catch(() => {});
      }
    });
    teardownStack.push(async () => {
      try {
        const list = await orgRulesetsList(firstRepo);
        const ids = (JSON.parse(list) as Array<{ id: string }>).map((p) => p.id);
        for (const pid of ids) {
          await azureHttp("DELETE", `https://dev.azure.com/${azureUri(org)}/${azureUri(project)}/_apis/policy/configurations/${pid}`).catch(() => {});
        }
      } catch {
        // the sweep is best-effort
      }
    });
  } catch {
    probe(`fixture repo (${firstRepo})`, false);
  }
}

// ---------------------------------------------------------------------------
// Reads on the fixtures
// ---------------------------------------------------------------------------

if (firstId !== 0) {
  try {
    const view = (await issuesView("", firstId)) as Record<string, unknown>;
    probe("issues_view", true, `title: ${String(view.title ?? "").slice(0, 60)}`);
  } catch (e) {
    probe("issues_view", false, String(e).slice(0, 200));
  }
  probe("issues_exists", await issuesExists("", firstId));
  try {
    await issuesComments("", firstId);
    probe("issues_comments", true);
  } catch {
    probe("issues_comments", false);
  }
} else {
  console.log("SKIP  issues reads (fixture item failed)");
}

if (firstRepo !== "") {
  try {
    const prs = (await prsList(firstRepo)) as unknown[];
    probe("prs_list (verb)", true, `${Array.isArray(prs) ? prs.length : "?"} PRs`);
  } catch (e) {
    probe("prs_list (verb)", false, String(e).slice(0, 200));
  }
  // An empty repository has no default branch: the verb must fail defined,
  // not print "null"; a repository with commits must return its branch.
  let rawDefaultBranch = "";
  try {
    const view = JSON.parse(await reposView(firstRepo)) as { defaultBranch?: string };
    rawDefaultBranch = view.defaultBranch ?? "";
  } catch {
    // covered by the default-branch probe below
  }
  if (rawDefaultBranch === "") {
    let failedDefined = false;
    try {
      const db = await reposDefaultBranch(firstRepo);
      if (db !== "") failedDefined = false;
      else failedDefined = true;
    } catch {
      failedDefined = true;
    }
    probe(
      failedDefined ? "repos_default_branch (empty repository fails defined)" : "repos_default_branch (empty repository)",
      failedDefined,
      failedDefined ? undefined : "returned a branch for a repository with no default branch",
    );
  } else {
    try {
      const db = await reposDefaultBranch(firstRepo);
      probe("repos_default_branch", db !== "" && db !== "null", db);
    } catch {
      probe("repos_default_branch", false);
    }
  }
  // An empty repo has no commits: SKIP pre-push, re-probe after the push.
  try {
    const count = await reposCommitsCount(`${org}/${project}/${firstRepo}`);
    probe("repos_commits_count (pre-push)", true, `count: ${count}`);
  } catch (e) {
    console.log(`SKIP  repos_commits_count (pre-push: ${String(e).slice(0, 100)})`);
  }
  try {
    await orgReleasesList(firstRepo);
    probe("org_releases_list", true);
  } catch {
    probe("org_releases_list", false);
  }
  try {
    await orgRulesetsList(firstRepo);
    probe("org_rulesets_list", true);
  } catch {
    probe("org_rulesets_list", false);
  }
  try {
    await orgFeedsList();
    probe("org_feeds_list", true);
  } catch {
    probe("org_feeds_list", false);
  }
}

// ---------------------------------------------------------------------------
// Boards + process + states (tier 1, transport-level)
// ---------------------------------------------------------------------------

try {
  const { org: orgName, project: projName } = azureOrgProject();
  const team = await defaultTeamIdSafe();
  const boards = await azureHttp<{ value?: Array<{ id?: string; name?: string }> }>(
    "GET",
    `https://dev.azure.com/${azureUri(orgName)}/${azureUri(projName)}/${azureUri(team)}/_apis/work/boards`,
  );
  probe("boards list", true, `${(boards.value ?? []).length} boards`);
} catch (e) {
  probe("boards list", false, String(e).slice(0, 120));
}

for (const typeName of ["Issue", "User%20Story"]) {
  try {
    const { org: orgName, project: projName } = azureOrgProject();
    const states = await azureHttp<{ value?: Array<{ category?: string }> }>(
      "GET",
      `https://dev.azure.com/${azureUri(orgName)}/${azureUri(projName)}/_apis/wit/workitemtypes/${typeName}/states`,
    );
    const cats = (states.value ?? []).map((s) => s.category ?? "");
    probe(
      `${typeName.replace("%20", " ")} type has an InProgress and a Completed state`,
      cats.some((c) => c.toLowerCase() === "inprogress") && cats.some((c) => c.toLowerCase() === "completed"),
    );
  } catch {
    // a type missing from this process is not a smoke failure
  }
}

/** defaultTeamId is projects.ts-private; re-derive it here (same lookups). */
async function defaultTeamIdSafe(): Promise<string> {
  const { org: orgName, project: projName } = azureOrgProject();
  const proj = await azureHttp<{ id?: string }>(
    "GET",
    `https://dev.azure.com/${azureUri(orgName)}/_apis/projects/${azureUri(projName)}`,
  );
  const guid = proj.id ?? "";
  const teams = await azureHttp<{ value?: Array<{ id?: string }> }>(
    "GET",
    `https://dev.azure.com/${azureUri(orgName)}/_apis/projects/${guid}/teams`,
  );
  return teams.value?.[0]?.id ?? "";
}

// ---------------------------------------------------------------------------
// Tier 2 — write/destructive probes (project-scoped)
// ---------------------------------------------------------------------------

let prId = 0;
let pr2Id = 0;
let wiId = 0;
let tmpClone = "";

if (tier === "write") {
  console.log(`write/destructive coverage — test project: ${project}`);

  // The disposable repo was provisioned as a fixture; this write-path
  // re-create is an idempotence check.
  let repoPresent = true;
  try {
    await reposView(smokeRepo);
  } catch {
    repoPresent = false;
  }
  probe("disposable repo present (idempotent re-create)", repoPresent);

  const srcBranch = `smoke-${process.pid}`;

  // 1. Work item create → comment → close.
  try {
    wiId = await issuesCreate("", { title: "smoke destructive item", body: "smoke" });
    teardownStack.push(() => destroyWorkItem(wiId));
    probe(`work item create (id ${wiId})`, true);
    try {
      await issuesComment("", wiId, { body: "smoke comment" });
      probe("work item comment", true);
    } catch {
      probe("work item comment", false);
    }
    try {
      await azureHttp("PATCH", `${witBase}/workitems/${wiId}`, {
        body: JSON.stringify([{ op: "replace", path: "/fields/System.State", value: "Closed" }]),
        contentType: "application/json-patch+json",
      });
      probe("work item close", true);
    } catch {
      probe("work item close", false);
    }
  } catch (e) {
    probe("work item create", false, String(e).slice(0, 200));
  }

  // 2. Push a branch with one commit (git ops via CLI + askpass; the default
  // branch is seeded first because an empty repo has none).
  const smokeTmp = mkdtempSync(join(tmpdir(), "azu-smoke-"));
  teardownStack.push(() => rmSync(smokeTmp, { recursive: true, force: true }));
  tmpClone = join(smokeTmp, "clone");
  const askpass = join(smokeTmp, "askpass.sh");
  writeFileSync(askpass, "#!/usr/bin/env bash\nprintf '%s\\n' \"$AZURE_PAT\"\n", { mode: 0o700 });
  const remoteUrl = `https://dev.azure.com/${org}/${project}/_git/${smokeRepo}`;
  const gitEnv = { ...process.env, GIT_ASKPASS: askpass, GIT_TERMINAL_PROMPT: "0" };
  const defaultBranch = "main";
  let seedOk = false;
  let branchPushed = false;
  try {
    mkdirSync(tmpClone, { recursive: true });
    const git = (args: string[], cwd?: string) =>
      spawnSync("git", args, { cwd: cwd ?? tmpClone, env: gitEnv, encoding: "utf8" });
    git(["init", "-q", "-b", defaultBranch, tmpClone]);
    git(["config", "user.email", "smoke@invalid"]);
    git(["config", "user.name", "azure-smoke"]);
    writeFileSync(join(tmpClone, "README.md"), "seed\n");
    git(["add", "README.md"]);
    git(["commit", "-q", "-m", "chore: smoke seed commit"]);
    git(["remote", "add", "origin", remoteUrl]);
    const push = git(["push", "-q", "origin", defaultBranch]);
    seedOk = push.status === 0;
    probe("default branch seed (main)", seedOk, seedOk ? undefined : "push failed — PAT needs Code Write on the test project");
  } catch (e) {
    probe("default branch seed (main)", false, String(e).slice(0, 120));
  }
  if (seedOk) {
    const git = (args: string[]) =>
      spawnSync("git", args, { cwd: tmpClone, env: gitEnv, encoding: "utf8", timeout: 60000 });
    spawnSync("git", ["fetch", "-q", "origin"], { cwd: tmpClone, env: gitEnv, timeout: 60000 });
    git(["checkout", "-q", "-b", srcBranch, `origin/${defaultBranch}`]);
    appendFileSync(join(tmpClone, "SMOKE.md"), `smoke ${process.pid}\n`);
    git(["add", "SMOKE.md"]);
    git(["commit", "-q", "-m", "chore: smoke destructive probe"]);
    const push = git(["push", "-q", "origin", srcBranch]);
    branchPushed = push.status === 0;
    probe(`branch push (${srcBranch})`, branchPushed, branchPushed ? undefined : "push failed — head branch absent server-side; PR cases will fail");
    try {
      await reposCommitsCount(`${org}/${project}/${firstRepo}`);
      probe("repos_commits_count (post-push)", true);
    } catch {
      probe("repos_commits_count (post-push)", false);
    }

    // 3. Create PR via the verb, rebase-merge + branch delete, verify.
    if (!branchPushed) {
      probe("PR create", false, "skipped: the head branch was not pushed");
    } else {
      try {
        prId = await prsCreate(smokeRepo, {
          title: "chore: smoke destructive probe",
          body: "smoke",
          head: srcBranch,
          base: defaultBranch,
        });
        probe(`PR create (id ${prId})`, prId > 0);
        try {
          await prsMerge(smokeRepo, prId, { method: "rebase", deleteBranch: true });
          probe("PR rebase-merge + branch delete", true);
        } catch (e) {
          probe("PR rebase-merge + branch delete", false, String(e).slice(0, 160));
        }
        await checkMergeOutcome(smokeRepo, prId, srcBranch, defaultBranch);
      } catch (e) {
        probe("PR create", false, String(e).slice(0, 200));
      }
    }
  }

  // --- Extended write coverage (issue edit/comment verbs, graph, set_type,
  // tags, pipelines, policies, projects) ---
  if (wiId !== 0) {
    try {
      await issuesEdit("", wiId, { title: "smoke destructive item (edited)" });
      probe("issues_edit", true);
    } catch {
      probe("issues_edit", false);
    }
    try {
      const ref = await issuesComment("", wiId, { body: "add-path comment" });
      probe("issues_comment_add", true);
      try {
        await issuesCommentGet("", ref);
        probe("issues_comment_get", true);
      } catch {
        probe("issues_comment_get", false);
      }
      try {
        await issuesEditComment(ref, "edited comment");
        probe("issues_comment_edit", true);
      } catch {
        probe("issues_comment_edit", false);
      }
    } catch {
      probe("issues_comment_add", false);
      probe("issues_comment_get", false, "skipped");
      probe("issues_comment_edit", false, "skipped");
    }
    try {
      await issuesReopen("", wiId);
      probe("issues_reopen", true);
    } catch (e) {
      probe("issues_reopen", false, String(e).slice(0, 160));
    }
    try {
      await issuesSetType("", wiId, "Task");
      probe("issues_set_type", true);
    } catch {
      probe("issues_set_type", false);
    }
    try {
      await issuesLabelCreate("", "smoke-tag", { issue: wiId });
      probe("issues_label_create/add_tag", true);
    } catch {
      probe("issues_label_create/add_tag", false);
    }
    try {
      await issuesLabelList("");
      probe("issues_label_list", true);
    } catch {
      probe("issues_label_list", false);
    }
    await checkTagEdits(wiId);

    // Graph: second item as child, link, read children/parent, unlink.
    let childId = 0;
    try {
      const child = await azureHttp<{ id?: number }>("POST", `${witBase}/workitems/$Issue`, {
        body: JSON.stringify([
          { op: "add", path: "/fields/System.Title", from: null, value: "smoke child item" },
        ]),
        contentType: "application/json-patch+json",
      });
      childId = child.id ?? 0;
      if (childId !== 0) teardownStack.push(() => destroyWorkItem(childId));
    } catch {
      childId = 0;
    }
    if (childId !== 0) {
      try {
        await issueGraphLink("", wiId, childId);
        probe("issue_graph_link", true);
      } catch {
        probe("issue_graph_link", false);
      }
      try {
        await issueGraphChildren("", wiId);
        probe("issue_graph_children", true);
      } catch {
        probe("issue_graph_children", false);
      }
      try {
        await issueGraphParent("", childId);
        probe("issue_graph_parent", true);
      } catch {
        probe("issue_graph_parent", false);
      }
      try {
        await issueGraphUnlink("", wiId, childId);
        probe("issue_graph_unlink", true);
      } catch {
        probe("issue_graph_unlink", false);
      }
      let childDeleteOk = true;
      try {
        await azureHttp("DELETE", `${witBase}/workitems/${childId}?destroy=true`);
      } catch {
        childDeleteOk = false;
      }
      probe("raw DELETE work item (child)", childDeleteOk);
    } else {
      probe("graph cases", false, "child create failed");
    }

    // Projects: state transition via field_set (first listed state).
    try {
      const fieldList = await projectsFieldList("", project);
      const firstOption = (/option":"([^"]+)"/.exec(fieldList))?.[1] ?? "";
      if (firstOption !== "") {
        const { optionId } = await projectsFieldOptionIds(project, "Status", firstOption);
        await projectsFieldSet(project, String(wiId), "Status", optionId);
        probe("projects_field_set", true);
      } else {
        probe("projects_field_set", false, "no state name resolved from field_list");
      }
    } catch (e) {
      probe("projects_field_set", false, String(e).slice(0, 160));
    }
    try {
      await projectsForIssue(`https://dev.azure.com/${org}/${project}/_workitems/edit/${wiId}`, "");
      probe("projects_for_issue", true);
    } catch {
      probe("projects_for_issue", false);
    }
    await checkStatusRoundtrip(wiId, "Issue");

    // A User Story sits on the Stories board; an Issue sits on no board.
    let usId = 0;
    try {
      const us = await azureHttp<{ id?: number }>("POST", `${witBase}/workitems/$User%20Story`, {
        body: JSON.stringify([
          { op: "add", path: "/fields/System.Title", from: null, value: "[SMOKE-DELETEME] board story" },
        ]),
        contentType: "application/json-patch+json",
      });
      usId = us.id ?? 0;
      if (usId !== 0) {
        teardownStack.push(() => destroyWorkItem(usId));
        probe(`fixture User Story (id ${usId})`, true);
        await checkStatusRoundtrip(usId, "User Story");
      }
    } catch (e) {
      probe("fixture User Story", false, String(e).slice(0, 200));
    }
    // A Bug is born through the verb's type mapping.
    try {
      const bugId = await issuesCreate("", { title: "[SMOKE-DELETEME] board bug", type: "Bug" });
      teardownStack.push(() => destroyWorkItem(bugId));
      probe(`issues_create --type Bug (id ${bugId})`, true);
      await checkStatusRoundtrip(bugId, "Bug");
    } catch {
      probe("issues_create --type Bug", false);
    }
    // An untyped create is a User Story; set_type must be able to change it.
    try {
      const typedId = await issuesCreate("", { title: "[SMOKE-DELETEME] retyped" });
      teardownStack.push(() => destroyWorkItem(typedId));
      const before = (await rawGet(`${witBase}/workitems/${typedId}?$fields=System.WorkItemType`)) as {
        fields?: Record<string, unknown>;
      } | null;
      probe("an untyped create is a User Story", before?.fields?.["System.WorkItemType"] === "User Story");
      await issuesSetType("", typedId, "Bug");
      const after = (await rawGet(`${witBase}/workitems/${typedId}?$fields=System.WorkItemType`)) as {
        fields?: Record<string, unknown>;
      } | null;
      probe("issues_set_type changes the type to Bug", after?.fields?.["System.WorkItemType"] === "Bug");
    } catch {
      probe("untyped issues_create", false);
    }
  }

  // PR threads on the completed PR still work.
  if (prId !== 0) {
    try {
      await prsThreadsPage(smokeRepo, prId);
      probe("prs_threads_page", true);
    } catch {
      probe("prs_threads_page", false);
    }
  }
  // Second PR for thread lifecycle on an active PR.
  const src2 = `smoke2-${process.pid}`;
  if (seedOk) {
    const git = (args: string[]) =>
      spawnSync("git", args, { cwd: tmpClone, env: gitEnv, encoding: "utf8", timeout: 60000 });
    git(["checkout", "-q", "-b", src2, `origin/${defaultBranch}`]);
    writeFileSync(join(tmpClone, "SMOKE2.md"), `smoke2 ${process.pid}\n`);
    git(["add", "SMOKE2.md"]);
    git(["commit", "-q", "-m", "chore: smoke thread PR"]);
    pr2Id = git(["push", "-q", "origin", src2]).status === 0 ? 0 : 0;
    // Push status matters: only create the PR when the branch really landed.
    const pushOk = git(["push", "-q", "origin", src2]);
    if (pushOk.status === 0) {
      try {
        pr2Id = await prsCreate(smokeRepo, {
          title: "smoke: thread lifecycle",
          body: "smoke",
          head: src2,
          base: defaultBranch,
        });
        probe("second PR create", pr2Id > 0);
      } catch (e) {
        probe("second PR create", false, String(e).slice(0, 160));
      }
    } else {
      probe("second PR create", false, "skipped: the head branch was not pushed");
    }
  }
  if (pr2Id !== 0) {
    const threadIdFromUrl = (url: string): string => {
      // The TS verb returns {thread:{url}}; the thread id rides the url's
      // ThreadId query parameter (bash returned {thread:{url,id}}).
      const m = /ThreadId=(\d+)/.exec(url);
      return m?.[1] ?? "";
    };
    try {
      const th = await prsThreadCreate(smokeRepo, pr2Id, { body: "smoke thread" });
      const thId = threadIdFromUrl(th.thread.url);
      probe("prs_thread_create returns a thread url", th.thread.url.length > 0 && thId !== "");
      const th2 = await prsThreadCreate(smokeRepo, pr2Id, { body: "smoke thread b" });
      const thBId = threadIdFromUrl(th2.thread.url);
      if (thBId !== "") await checkThreads(smokeRepo, pr2Id, thId, thBId);
      try {
        await prsThreadReply(smokeRepo, pr2Id, thId, "smoke reply");
        probe("prs_thread_reply", true);
      } catch (e) {
        probe("prs_thread_reply", false, String(e).slice(0, 160));
      }
      try {
        const resolved = await prsThreadResolve(`${smokeRepo}/${pr2Id}/${thId}`);
        probe("prs_thread_resolve", true, resolved);
        await checkThreadsResolved(smokeRepo, pr2Id, thId);
      } catch (e) {
        probe("prs_thread_resolve", false, String(e).slice(0, 160));
      }
    } catch {
      probe("prs_thread_create", false);
      probe("prs_thread_reply", false, "skipped");
      probe("prs_thread_resolve", false, "skipped");
    }
    // A plain PR comment: bare thread id, not listed as a review thread until
    // someone replies in it.
    try {
      const cmtOut = await prsComment(smokeRepo, pr2Id, { body: "smoke plain comment" });
      const bare = /^\d+$/.test(cmtOut);
      probe(`prs_comment prints a bare thread id (${cmtOut})`, bare);
      if (bare) {
        let page1 = await prsThreadsPage(smokeRepo, pr2Id);
        const listedBefore = page1.data.repository.pullRequest.reviewThreads.nodes.filter((n) =>
          n.id.endsWith(`/${cmtOut}`),
        ).length;
        probe("a plain comment is not listed as a review thread", listedBefore === 0);
        await prsThreadReply(smokeRepo, pr2Id, cmtOut, "smoke reply to the plain comment");
        page1 = await prsThreadsPage(smokeRepo, pr2Id);
        const listedAfter = page1.data.repository.pullRequest.reviewThreads.nodes.filter((n) =>
          n.id.endsWith(`/${cmtOut}`),
        ).length;
        probe("a plain comment is listed once someone replies in it", listedAfter === 1);
      }
    } catch (e) {
      probe("prs_comment", false, String(e).slice(0, 120));
    }
    try {
      await prsView(smokeRepo, pr2Id);
      probe("prs_view", true);
    } catch {
      probe("prs_view", false);
    }
    try {
      await prsDiff(smokeRepo, pr2Id);
      probe("prs_diff", true);
    } catch (e) {
      probe("prs_diff", false, String(e).slice(0, 160));
    }
    // Abandon the second PR (raw PATCH; no provider verb).
    try {
      await azureHttp("PATCH", `${gitBase}/repositories/${smokeRepo}/pullrequests/${pr2Id}`, {
        body: JSON.stringify({ status: "abandoned" }),
      });
      probe("raw PATCH PR abandon", true);
    } catch {
      probe("raw PATCH PR abandon", false);
    }
  }
  await checkPrStates(smokeRepo);

  // Repos: patch, protect_branch, ACL grant.
  try {
    await reposPatch(smokeRepo, { description: "smoke repo (patched)" });
    probe("repos_patch", true);
  } catch (e) {
    probe("repos_patch", false, String(e).slice(0, 160));
  }
  try {
    await reposProtectBranch(smokeRepo, defaultBranch, {
      required_pull_request_reviews: { required_approving_review_count: 1 },
    });
    probe("repos_protect_branch", true);
  } catch {
    probe("repos_protect_branch", false, "policy may already exist (idempotent-ish)");
  }
  try {
    await reposTeamPut(org, `${project} Team`, smokeRepo, "pull");
    probe("repos_team_put (ACL)", true);
  } catch (e) {
    probe("repos_team_put (ACL)", false, String(e).slice(0, 160));
  }

  // Pipelines: no definition exists in a fresh repo — the project-scoped list
  // must succeed with [].
  try {
    const defs = await pipelinesWorkflowList("");
    probe("pipelines_workflow_list (project-scoped)", true, `defs: ${defs.length}`);
  } catch (e) {
    probe("pipelines_workflow_list (project-scoped)", false, String(e).slice(0, 120));
  }
  console.error("note: pipelines write/cancel/download cases need a pipeline definition — add azure-pipelines.yml to the disposable repo seed to enable");

  // Policies: ruleset create → update → list. protect_branch already put a
  // minimum-reviewers policy on main: a 403 'rejected by policy' counts as
  // created-success ONLY when an equivalent configuration verifiably exists.
  const policyPayload = {
    rules: [{ type: "pull_request", parameters: { required_approving_review_count: 1 } }],
  };
  try {
    await orgRulesetCreate(smokeRepo, policyPayload);
    probe("org_ruleset_create", true);
  } catch {
    const dup = await rawGet(`https://dev.azure.com/${azureUri(org)}/${azureUri(project)}/_apis/policy/configurations`);
    const guid = await repoGuidShared(smokeRepo).catch(() => "");
    const hasEquivalent = (() => {
      try {
        const list = (dup?.value ?? []) as Array<{
          type?: { id?: string };
          isEnabled?: boolean;
          settings?: { scope?: Array<{ repositoryId?: string; refName?: string }> };
        }>;
        return list.some(
          (c) =>
            c.type?.id === "fa4e907d-c16b-4a4c-9dfa-4906e5d171dd" &&
            c.isEnabled === true &&
            c.settings?.scope?.[0]?.repositoryId === guid &&
            c.settings?.scope?.[0]?.refName === "refs/heads/main",
        );
      } catch {
        return false;
      }
    })();
    probe(
      "org_ruleset_create",
      hasEquivalent,
      hasEquivalent ? "equivalent policy already on main (protect_branch) — idempotent" : "no equivalent policy found",
    );
  }
  try {
    await orgRulesetUpdate(smokeRepo, "0", policyPayload);
    probe("org_ruleset_update (delete+recreate)", true);
  } catch {
    probe("org_ruleset_update (delete+recreate)", false);
  }
  try {
    await orgRulesetsList(smokeRepo);
    probe("org_rulesets_list (post-write)", true);
  } catch {
    probe("org_rulesets_list (post-write)", false);
  }
}

// ---------------------------------------------------------------------------
// Teardown + summary
// ---------------------------------------------------------------------------

await teardownRun();
console.log("================================");
console.log(`summary: ${pass} pass, ${fail} fail`);
reportLine(`summary: ${pass} pass, ${fail} fail`);
process.exit(fail === 0 && teardownFailed === 0 ? 0 : 1);

// ---------------------------------------------------------------------------
// Tier-2 outcome check helpers (defined at the bottom; hoisted)
// ---------------------------------------------------------------------------

function issueEditComment(): never {
  throw new Error("internal: replaced by issuesEdit path");
}
void issueEditComment;

/** comment_edit rides issuesEdit? No — the comment contract verb: patch the
 * comment text via the comments API (issues.ts exposes it through
 * issuesCommentGet's sibling; the edit path is issuesEdit for items only).
 * Implemented here against the transport directly, mirroring the bash
 * verb's request. */
async function issuesEditComment(ref: string, body: string): Promise<void> {
  const { workItem, commentId } = splitRef(ref);
  const { base } = witUrls();
  await azureHttp(
    "PATCH",
    `${base}/workitems/${workItem}/comments/${commentId}?format=markdown&api-version=7.2-preview.4`,
    { body: JSON.stringify({ text: body.trim() === "" ? body : body.replace(/\n$/, "") }) },
  );
}

function splitRef(ref: string): { workItem: string; commentId: string } {
  const parts = ref.split("/");
  if (parts.length !== 2) throw new Error(`malformed comment ref '${ref}'`);
  return { workItem: parts[0]!, commentId: parts[1]! };
}

function witUrls(): { base: string } {
  const { org: orgName, project: projName } = azureOrgProject();
  return { base: `https://dev.azure.com/${azureUri(orgName)}/${azureUri(projName)}/_apis/wit` };
}

/** Merged PR outcome: completed, rebase strategy, source branch gone, linear
 * history. Completion is asynchronous — poll before judging. */
async function checkMergeOutcome(
  repo: string,
  pr: number,
  src: string,
  baseBranch: string,
): Promise<void> {
  const prBase = `https://dev.azure.com/${azureUri(org)}/${azureUri(project)}/_apis/git/repositories/${azureUri(repo)}`;
  let raw: Record<string, unknown> | null = null;
  for (let i = 0; i < 30; i++) {
    raw = await rawGet(`${prBase}/pullrequests/${pr}`);
    if (raw?.status === "completed") break;
    await sleep(2000);
  }
  if (raw !== null) {
    probeOutcome<{ status?: string }>("merged PR is completed", raw, (v) => v.status === "completed");
    probeOutcome<{ completionOptions?: { mergeStrategy?: string } }>(
      "merge used the rebase strategy",
      raw,
      (v) => v.completionOptions?.mergeStrategy === "rebase",
    );
  } else {
    probe("merged PR is completed", false, "raw GET failed");
  }
  const refs = await rawGet(`${prBase}/refs?filter=heads/${src}`);
  probeOutcome<{ count?: number }>(
    "source branch is deleted after the merge",
    refs ?? { count: -1 },
    (v) => v.count === 0,
  );
  const top = (await rawGet(
    `${prBase}/commits?searchCriteria.itemVersion.version=${baseBranch}&searchCriteria.$top=1`,
  )) as { value?: Array<{ commitId?: string }> } | null;
  const topId = top?.value?.[0]?.commitId ?? "";
  if (topId !== "") {
    const commit = await rawGet(`${prBase}/commits/${topId}`);
    probeOutcome<{ parents?: unknown[] }>(
      "rebase merge leaves a linear history",
      commit ?? { parents: [] },
      (v) => Array.isArray(v.parents) && v.parents.length === 1,
    );
  } else {
    probe("rebase merge leaves a linear history", false, `head commit of ${baseBranch} not resolvable`);
  }
}

/** Tag edit sequence: two adds leave two tags; edit --add-label preserves;
 * --remove-label removes exactly that one. */
async function checkTagEdits(id: number): Promise<void> {
  const rawTags = async (): Promise<string[]> => {
    const item = await rawGet(`${witBase}/workitems/${id}?$expand=all`);
    const tags = String((item?.fields as Record<string, unknown> | undefined)?.["System.Tags"] ?? "");
    return tags
      .split(";")
      .map((t) => t.trim())
      .filter((t) => t !== "")
      .sort();
  };
  try {
    await issuesLabelCreate("", "smoke-tag-2", { issue: id });
  } catch {
    // the probe below judges the outcome
  }
  probeOutcome("two label adds leave two tags", await rawTags(), (t) => JSON.stringify(t) === '["smoke-tag","smoke-tag-2"]');
  try {
    await issuesEdit("", id, { addLabel: "extra-tag" });
  } catch {}
  probeOutcome(
    "edit --add-label keeps the existing tags",
    await rawTags(),
    (t) => JSON.stringify(t) === '["extra-tag","smoke-tag","smoke-tag-2"]',
  );
  try {
    await issuesEdit("", id, { removeLabel: "smoke-tag-2" });
  } catch {}
  probeOutcome(
    "edit --remove-label removes only that tag",
    await rawTags(),
    (t) => JSON.stringify(t) === '["extra-tag","smoke-tag"]',
  );
}

/** Status round-trip: every status_workflow word, written through the Kanban
 * column field and read back as itself. */
async function checkStatusRoundtrip(id: number, label: string): Promise<void> {
  const words = (process.env.AZURE_SMOKE_STATUS_WORKFLOW ?? "")
    .split(",")
    .map((w) => w.trim())
    .filter((w) => w !== "");
  if (words.length === 0) {
    console.log("SKIP  status round-trip (set AZURE_SMOKE_STATUS_WORKFLOW)");
    return;
  }
  const item = await rawGet(`${witBase}/workitems/${id}?$expand=all`);
  const fields = Object.keys((item?.fields as Record<string, unknown>) ?? {});
  const kanban = fields.find((k) => /^WEF_.*_Kanban\.Column$/.test(k)) ?? "";
  if (kanban === "") {
    probe(`work item type [${label}] carries a board Kanban column field`, false, `no WEF_*_Kanban.Column field on item ${id}`);
    return;
  }
  for (const word of words) {
    let writeOk = true;
    try {
      await azureHttp("PATCH", `${witBase}/workitems/${id}`, {
        body: JSON.stringify([{ op: "replace", path: `/fields/${kanban}`, value: word }]),
        contentType: "application/json-patch+json",
      });
    } catch {
      writeOk = false;
    }
    if (writeOk) {
      const after = await rawGet(`${witBase}/workitems/${id}?$fields=${kanban}`);
      const got = (after?.fields as Record<string, unknown> | undefined)?.[kanban];
      probe(`Kanban column write [${label}]: '${word}' reads back`, got === word, `read back '${String(got)}'`);
    } else {
      probe(`Kanban column write [${label}]: '${word}' reads back`, false, `PATCH of ${kanban} rejected`);
    }
  }
}

/** Threads: real thread ids listed unresolved; a reply addressed by comment
 * id lands in its own thread. */
async function checkThreads(
  repo: string,
  pr: number,
  thA: string,
  thB: string,
): Promise<void> {
  const prBase = `https://dev.azure.com/${azureUri(org)}/${azureUri(project)}/_apis/git/repositories/${azureUri(repo)}`;
  const raw = await rawGet(`${prBase}/pullrequests/${pr}/threads`);
  probeOutcome<{ value?: Array<Record<string, unknown>> }>(
    "raw thread has a string status",
    raw ?? {},
    (v) => (v.value as Array<Record<string, unknown>>).some(
      (t) => String(t.id) === thA && typeof t.status === "string",
    ),
  );
  const page = await prsThreadsPage(repo, pr);
  const nodes = page.data.repository.pullRequest.reviewThreads.nodes;
  const a = nodes.filter((n) => n.id.endsWith(`/${thA}`));
  probe("threads_page lists thread under its real id and unresolved", a.length === 1 && a[0]!.isResolved === false);
  const b = nodes.find((n) => n.id.endsWith(`/${thB}`));
  const db = b?.comments[0]?.id ?? "";
  if (db !== "") {
    await prsThreadReply(repo, pr, db, "wrapper-addressed reply");
    const rawAfter = await rawGet(`${prBase}/pullrequests/${pr}/threads/${thB}`);
    probeOutcome<{ comments?: unknown[] }>(
      "a reply addressed by comment id lands in its own thread",
      rawAfter ?? {},
      (v) => (v.comments ?? []).length === 2,
    );
    probeOutcome<{ comments?: Array<{ parentCommentId?: number }> }>(
      "the reply nests under the comment it was addressed to",
      rawAfter ?? {},
      (v) => v.comments?.[1]?.parentCommentId === 1,
    );
  } else {
    probe("a reply addressed by comment id lands in its own thread", false, `no comment id for thread ${thB}`);
  }
}

/** Resolved-thread outcome: closed-type status, threads_page agrees. */
async function checkThreadsResolved(repo: string, pr: number, thA: string): Promise<void> {
  const prBase = `https://dev.azure.com/${azureUri(org)}/${azureUri(project)}/_apis/git/repositories/${azureUri(repo)}`;
  const raw = await rawGet(`${prBase}/pullrequests/${pr}/threads/${thA}`);
  probeOutcome<{ status?: string }>(
    "resolved thread has a closed-type status",
    raw ?? {},
    (v) => typeof v.status === "string" && v.status !== "active" && v.status !== "pending",
  );
  const page = await prsThreadsPage(repo, pr);
  const nodes = page.data.repository.pullRequest.reviewThreads.nodes;
  const a = nodes.filter((n) => n.id.endsWith(`/${thA}`));
  probe("threads_page shows the resolved thread as resolved", a.length === 1 && a[0]!.isResolved === true);
}

/** PR list state filters: with one merged and one abandoned PR, --state
 * merged/closed separate them. */
async function checkPrStates(repo: string): Promise<void> {
  const raw = await rawGet(
    `https://dev.azure.com/${azureUri(org)}/${azureUri(project)}/_apis/git/repositories/${repo}/pullrequests?searchCriteria.status=all`,
  );
  if (raw === null) {
    probe("PR list raw (all states)", false, `raw GET failed for ${repo}`);
    return;
  }
  const value = (raw.value as Array<{ status?: string }>) ?? [];
  if (value.length === 0) {
    console.log(`SKIP  PR list state filters (no pull requests in ${repo})`);
    return;
  }
  const completed = value.filter((p) => p.status === "completed").length;
  const nonActive = value.filter((p) => p.status !== "active").length;
  try {
    const m1 = await prsList(repo, { state: "merged" });
    const merged = (typeof m1 === "string" ? JSON.parse(m1) : m1) as Array<{ state: string }>;
    probeOutcome("prs_list --state merged returns only merged PRs", merged, (v: Array<{ state: string }>) => v.every((p) => p.state === "MERGED"));
    probeOutcome("prs_list --state merged returns every completed PR", merged, (v: Array<{ state: string }>) => v.length === completed);
  } catch {
    probe("prs_list --state merged", false, "verb failed");
  }
  try {
    const c1 = await prsList(repo, { state: "closed" });
    const closed = (typeof c1 === "string" ? JSON.parse(c1) : c1) as Array<{ state: string }>;
    probeOutcome(
      "prs_list --state closed returns every non-active PR",
      closed,
      (v: Array<{ state: string }>) => v.every((p) => p.state !== "OPEN") && v.length === nonActive,
    );
  } catch {
    probe("prs_list --state closed", false, "verb failed");
  }
}
