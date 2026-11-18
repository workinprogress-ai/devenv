// azure/pipelines.ts — Azure DevOps pipelines domain: builds = runs, build definitions = workflows.
// The builds filter takes the repository's GUID; --status maps the gh
// vocabulary onto statusFilter+resultFilter pairs. Contract: throw
// ProviderError; never exit.

import { ProviderError, providerDeclareCapability } from "../provider-core.ts";
import { azureHttp, azureHttpPaginate, azureHttpDownload } from "./http.ts";
import { azureBranchRef, azureRepoParts, azureUri } from "./urls.ts";
import { repoGuidShared, reposDefaultBranch } from "./repos.ts";

// Azure implements the whole pipelines verb family (builds = runs).
providerDeclareCapability("pipelines");

/** Build API root for a repo spec's org/project. */
function buildRoot(repo: string): string {
  const { org, project } = azureRepoParts(repo);
  return `https://dev.azure.com/${azureUri(org)}/${azureUri(project)}/_apis/build`;
}

/** The project's web base ("https://dev.azure.com/org/project"). */
function webBase(repo: string): string {
  const { org, project } = azureRepoParts(repo);
  return `https://dev.azure.com/${azureUri(org)}/${azureUri(project)}`;
}

/** Resolve a pipeline (build definition) to its numeric id(s): a number is
 * the id already; a name is looked up (exact match). Several definitions may
 * share a name across folders, so more than one id can come back. */
async function definitionIds(spec: string, nameOrId: string): Promise<string[]> {
  if (/^\d+$/.test(nameOrId)) return [nameOrId];
  const root = buildRoot(spec);
  const r = await azureHttp<{ value?: Array<{ id?: number; name?: string }> }>(
    "GET",
    `${root}/definitions?name=${azureUri(nameOrId)}`,
  );
  const ids = (r.value ?? []).filter((d) => d.name === nameOrId).map((d) => String(d.id));
  if (ids.length === 0) throw new ProviderError(`no pipeline named '${nameOrId}' in this project`);
  return ids;
}

/** Map an Azure build status to the seam's status dialect. */
export function buildStatusToSeam(status: string | undefined): string {
  switch (status) {
    case "inProgress":
    case "cancelling":
      return "in_progress";
    case "notStarted":
      return "queued";
    case "completed":
      return "completed";
    default:
      return "unknown";
  }
}

/** Map an Azure build result to the seam's conclusion dialect. */
export function buildResultToSeam(result: string | undefined): string | null {
  switch (result) {
    case "succeeded":
    case "partiallySucceeded":
      return "success";
    case "failed":
      return "failure";
    case "canceled":
      return "cancelled";
    default:
      return null;
  }
}

/** The fields a run record carries (the seam's run dialect). A --json list
 * naming anything else is an error, as on gh, never a null. */
export const AZURE_BUILD_FIELDS = [
  "id", "workflowName", "name", "event", "status", "conclusion",
  "headBranch", "headSha", "createdAt", "updatedAt", "url",
] as const;

/** Map one Azure build record to the seam's run shape; when fieldList is
 * present the projection emits only those keys (--json shape). */
export function mapBuild(
  build: Record<string, unknown>,
  fieldList?: string,
  webBase?: string,
): Record<string, unknown> {
  const definition = build.definition as { name?: string } | undefined;
  const status = build.status as string | undefined;
  const result = build.result as string | undefined;
  const rec: Record<string, unknown> = {
    id: build.id,
    workflowName: definition?.name ?? "",
    name: build.buildNumber ?? "",
    event: build.reason ?? "",
    status: buildStatusToSeam(status),
    conclusion: status !== "completed" ? null : buildResultToSeam(result),
    headBranch: String(build.sourceBranch ?? "").replace(/^refs\/heads\//, ""),
    headSha: build.sourceVersion ?? "",
    createdAt: build.queueTime ?? "",
    updatedAt: build.finishTime ?? build.startTime ?? build.queueTime ?? "",
    // The browser page of the build; the REST address (build.url) is not a link.
    url: webBase !== undefined && build.id !== undefined ? `${webBase}/_build/results?buildId=${String(build.id)}` : (build.url ?? ""),
  };
  if (fieldList === undefined || fieldList === "") return rec;
  const keys = fieldList.split(",").map((k) => k.trim());
  const out: Record<string, unknown> = {};
  for (const k of keys) {
    if (!(AZURE_BUILD_FIELDS as readonly string[]).includes(k)) {
      throw new ProviderError(`unknown JSON field '${k}'`);
    }
    out[k] = rec[k] ?? null;
  }
  return out;
}

export interface PipelinesRunListOptions {
  branch?: string;
  workflow?: string;
  limit?: number;
  json?: string;
  /** gh vocabulary, mapped onto Azure's statusFilter+resultFilter. */
  status?: string;
  jq?: string;
}

/** List workflow runs (builds). */
export async function pipelinesRunList(
  repo: string,
  opts: PipelinesRunListOptions = {},
): Promise<Array<Record<string, unknown>> | string> {
  const limit = opts.limit ?? 30;
  let statusFilterQ = "";
  let resultFilterQ = "";
  if (opts.status !== undefined && opts.status !== "") {
    switch (opts.status) {
      case "in_progress":
        // mapBuild reports a cancelling build as in_progress, so the filter does too.
        statusFilterQ = "inProgress,cancelling";
        break;
      case "queued":
      case "requested":
      case "waiting":
      case "pending":
        statusFilterQ = "notStarted";
        break;
      case "completed":
        statusFilterQ = "completed";
        break;
      case "success":
        statusFilterQ = "completed";
        // mapBuild reports partiallySucceeded as success, so the filter does too.
        resultFilterQ = "succeeded,partiallySucceeded";
        break;
      case "failure":
      case "timed_out":
      case "startup_failure":
        statusFilterQ = "completed";
        resultFilterQ = "failed";
        break;
      case "cancelled":
        statusFilterQ = "completed";
        resultFilterQ = "canceled";
        break;
      default:
        throw new ProviderError(
          `run_list: --status '${opts.status}' has no Azure analog (use in_progress, queued, completed, success, failure or cancelled)`,
        );
    }
  }
  const root = buildRoot(repo);
  let query = `${root}/builds?$top=${limit}&queryOrder=queueTimeDescending`;
  // The builds filter takes the repository's GUID, not its name.
  if (repo !== "") {
    const guid = await repoGuidShared(repo);
    if (guid === "") throw new ProviderError(`repository '${repo}' not found`);
    query += `&repositoryId=${guid}&repositoryType=TfsGit`;
  }
  if (opts.branch !== undefined && opts.branch !== "") {
    query += `&branchName=${azureUri(azureBranchRef(opts.branch))}`;
  }
  if (opts.workflow !== undefined && opts.workflow !== "") {
    const defIds = await definitionIds(repo, opts.workflow);
    query += `&definitions=${defIds.join(",")}`;
  }
  if (statusFilterQ !== "") query += `&statusFilter=${statusFilterQ}`;
  if (resultFilterQ !== "") query += `&resultFilter=${resultFilterQ}`;
  const builds = await azureHttpPaginate<Record<string, unknown>>(query, limit);
  const mapped = builds.map((b) => mapBuild(b, opts.json, webBase(repo)));
  if (opts.jq !== undefined) {
    // The program subset the run tools pass to gh on the other provider:
    // `.[].f`, `.[N].f`, each optionally followed by `// empty` or
    // `// "default"` (an absent value is dropped, or replaced by the default).
    const m = /^\.\[(\d*)\]\.([A-Za-z_][A-Za-z0-9_]*)(?:\s*\/\/\s*(empty|"([^"]*)"))?$/.exec(opts.jq.trim());
    if (m?.[2] !== undefined) {
      // An index past the end is an absent element (jq yields null), so the
      // default still applies.
      const rows = m[1] === "" ? mapped : [mapped[Number(m[1])] ?? {}];
      const fallback = m[4];
      return rows
        .map((r) => {
          const v = r[m[2] as string];
          if (v === undefined || v === null) return fallback ?? null;
          return typeof v === "string" ? v : JSON.stringify(v);
        })
        .filter((v) => v !== null)
        .join("\n");
    }
    throw new ProviderError(
      `unsupported jq program '${opts.jq}' — azure run list supports '.[].field' and '.[N].field', optionally followed by '// empty' or '// "default"'`,
    );
  }
  return mapped;
}

export interface PipelinesRunViewOptions {
  json?: string;
  jq?: string;
}

/** View one run. */
export async function pipelinesRunView(
  repo: string,
  runId: number,
  opts: PipelinesRunViewOptions = {},
): Promise<string> {
  const root = buildRoot(repo);
  const raw = await azureHttp<Record<string, unknown>>("GET", `${root}/builds/${runId}`);
  const mapped = mapBuild(raw, opts.json, webBase(repo));
  if (opts.jq !== undefined) {
    const one = /^\.([A-Za-z_][A-Za-z0-9_]*)$/.exec(opts.jq.trim());
    if (one?.[1] !== undefined) {
      const v = mapped[one[1] as string];
      return v === undefined || v === null ? "" : typeof v === "string" ? v : JSON.stringify(v);
    }
    throw new ProviderError(
      `unsupported jq program '${opts.jq}' — azure run view supports '.field'`,
    );
  }
  return JSON.stringify(mapped);
}

export interface PipelinesRunWatchOptions {
  exitStatus?: boolean;
}

/** A non-negative integer from the environment; anything else is the default. */
function envNonNegativeInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || !/^\d+$/.test(raw.trim())) return fallback;
  return Number(raw.trim());
}

/** Polls in a row that may fail before the watch gives up. */
const WATCH_MAX_CONSECUTIVE_ERRORS = 5;

/** Whether a failed poll is worth trying again: a lost connection or timeout,
 * throttling or a server error. A missing or refused credential, a missing run
 * or a bad request will fail the same way next time. */
function isTransientPollError(err: unknown): boolean {
  if (!(err instanceof ProviderError)) return false;
  if (err.status !== undefined) return err.status === 429 || err.status >= 500;
  return /request failed after|timed out/i.test(err.message);
}

/** Watch a run to completion (10s polls, 120 max by default —
 * AZURE_PIPELINE_WATCH_ATTEMPTS and AZURE_PIPELINE_WATCH_INTERVAL tune them).
 * A poll that fails transiently is tried again, up to five in a row; progress
 * goes to stderr. With exitStatus, a completed run whose conclusion is not
 * success throws — the CI semantic. */
export async function pipelinesRunWatch(
  repo: string,
  runId: number,
  opts: PipelinesRunWatchOptions = {},
): Promise<string> {
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const attempts = envNonNegativeInt("AZURE_PIPELINE_WATCH_ATTEMPTS", 120);
  const interval = envNonNegativeInt("AZURE_PIPELINE_WATCH_INTERVAL", 10);
  let failures = 0;
  let lastFailure = "";
  for (let poll = 1; poll <= attempts; poll++) {
    let mapped = "";
    try {
      mapped = await pipelinesRunView(repo, runId);
      failures = 0;
    } catch (err) {
      failures++;
      if (!isTransientPollError(err) || failures >= WATCH_MAX_CONSECUTIVE_ERRORS) throw err;
      lastFailure = err instanceof Error ? err.message : String(err);
      console.error(`run ${runId}: poll ${poll} failed (${err instanceof Error ? err.message : String(err)}); trying again`);
    }
    if (mapped !== "") {
      const record = JSON.parse(mapped) as { status?: string; conclusion?: string | null };
      const status = record.status ?? "";
      console.error(`run ${runId}: ${status}${record.conclusion ? ` (${record.conclusion})` : ""}`);
      if (status === "completed") {
        // The final run record is the verb's stdout, once.
        console.log(mapped);
        if (opts.exitStatus === true && record.conclusion !== "success") {
          throw new ProviderError(`run ${runId} concluded ${record.conclusion ?? "unknown"}`);
        }
        return mapped;
      }
    }
    // No sleep after the last poll: the timeout is reported at once.
    if (poll < attempts) await sleep(interval * 1000);
  }
  throw new ProviderError(
    `timed out waiting for run ${runId}` + (lastFailure !== "" ? ` (the last poll failed: ${lastFailure})` : ""),
  );
}

export interface PipelinesWorkflowListOptions {
  json?: string;
  jq?: string;
}

/** List workflows (build definitions); every definition is active unless
 * disabled (the seam's state field). */
export async function pipelinesWorkflowList(
  repo: string,
  opts: PipelinesWorkflowListOptions = {},
): Promise<string> {
  const root = buildRoot(repo);
  // Only this repository's definitions, every page.
  let url = `${root}/definitions`;
  if (repo !== "") {
    const guid = await repoGuidShared(repo);
    if (guid === "") throw new ProviderError(`repository '${repo}' not found`);
    url += `?repositoryId=${guid}&repositoryType=TfsGit`;
  }
  const definitions = await azureHttpPaginate<Record<string, unknown>>(url);
  const rows: Array<Record<string, unknown>> = definitions.map((d) => ({
    id: String(d.id ?? ""),
    name: d.name ?? "",
    path: d.path ?? "",
    state: d.enabled === false ? "disabled" : "active",
  }));
  if (opts.json !== undefined) {
    const fields = opts.json.split(",").map((f) => f.trim());
    const projected = rows.map((rec) => {
      const proj: Record<string, unknown> = {};
      for (const f of fields) {
        if (!(f in rec)) throw new ProviderError(`unsupported --json field '${f}'`);
        proj[f] = rec[f] ?? null;
      }
      return proj;
    });
    if (opts.jq !== undefined) {
      const each = /^\.\[\]\.([A-Za-z_][A-Za-z0-9_]*)$/.exec(opts.jq.trim());
      if (each?.[1] !== undefined) {
        return projected
          .map((r2) => {
            const v = r2[each[1] as string];
            return v === undefined || v === null ? null : typeof v === "string" ? v : JSON.stringify(v);
          })
          .filter((v) => v !== null)
          .join("\n");
      }
      return renderRowsJq(projected, opts.jq);
    }
    return JSON.stringify(projected);
  }
  if (opts.jq !== undefined) {
    return renderRowsJq(rows, opts.jq);
  }
  return rows.map((r2) => JSON.stringify(r2)).join("\n");
}

function renderRowsJq(rows: Array<Record<string, unknown>>, program: string): string {
  const each = /^\.\[\]\.([A-Za-z_][A-Za-z0-9_]*)$/.exec(program.trim());
  if (each?.[1] !== undefined) {
    return rows
      .map((r) => {
        const v = r[each[1] as string];
        return v === undefined || v === null ? null : typeof v === "string" ? v : JSON.stringify(v);
      })
      .filter((v) => v !== null)
      .join("\n");
  }
  throw new ProviderError(
    `unsupported jq program '${program}' — azure workflow list supports '.[].field'`,
  );
}

export interface PipelinesRunArtifactsOptions {
  json?: string;
  jq?: string;
}

/** List a run's artifacts (seam-shaped records). */
export async function pipelinesRunArtifacts(
  repo: string,
  runId: number,
  opts: PipelinesRunArtifactsOptions = {},
): Promise<string> {
  const root = buildRoot(repo);
  const r = await azureHttp<{
    value?: Array<{
      id?: number;
      name?: string;
      resource?: { downloadUrl?: string; properties?: Record<string, unknown> };
      createdDate?: string;
    }>;
  }>("GET", `${root}/builds/${runId}/artifacts`);
  const rows = (r.value ?? []).map((a) => ({
    id: String(a.id ?? ""),
    name: a.name ?? "",
    // Azure reports the size as a string in properties.artifactsize.
    size_in_bytes: Number(a.resource?.properties?.["artifactsize"] ?? 0) || 0,
    created_at: a.createdDate ?? "",
    url: a.resource?.downloadUrl ?? "",
  }));
  return renderRowsGeneric(rows, opts);
}

function renderRowsGeneric(
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
  if (opts.jq !== undefined) return renderRowsJq(out, opts.jq);
  return out.map((r) => JSON.stringify(r)).join("\n");
}

export interface PipelinesWorkflowRunOptions {
  ref?: string;
  /** Dispatch inputs (--field k=v) become the queue's parameters. */
  fields?: Record<string, string>;
}

/** Queue a run of a workflow (definition id or name). The default ref is the
 * repo's default branch (resolved, not guessed). Dispatch inputs go to
 * `templateParameters` as strings; a name the pipeline does not declare is
 * Azure's own 400 ("Unexpected parameter"), passed through unchanged. A name
 * shared by several definitions is refused. Returns the new build's id. */
export async function pipelinesWorkflowRun(
  repo: string,
  workflow: string,
  opts: PipelinesWorkflowRunOptions = {},
): Promise<number> {
  if (workflow === "") {
    throw new ProviderError("pipelines_workflow_run requires a workflow (definition id or name)");
  }
  let ref = opts.ref ?? "";
  if (ref === "") {
    ref = await reposDefaultBranch(repo);
  }
  const root = buildRoot(repo);
  const ids = await definitionIds(repo, workflow);
  if (ids.length > 1) {
    throw new ProviderError(
      `pipeline name '${workflow}' matches several definitions (${ids.join(", ")}) — pass the numeric id`,
    );
  }
  const body: Record<string, unknown> = {
    definition: { id: Number(ids[0]) },
    sourceBranch: azureBranchRef(ref),
  };
  if (opts.fields !== undefined && Object.keys(opts.fields).length > 0) {
    // YAML runtime parameters travel as templateParameters; the build's
    // `parameters` field is for queue-time variables and Azure rejects the
    // names a pipeline declares as parameters (verified live).
    body.templateParameters = opts.fields;
  }
  const r = await azureHttp<{ id?: number }>("POST", `${root}/builds`, {
    body: JSON.stringify(body),
  });
  return r.id ?? 0;
}

/** Rerun a run: Azure retries the whole build in place (PATCH ?retry=true),
 * as a new attempt of the same build id — there is no failed-jobs-only or
 * debug rerun. */
export async function pipelinesRunRerun(
  repo: string,
  runId: number,
): Promise<void> {
  const root = buildRoot(repo);
  try {
    await azureHttp("PATCH", `${root}/builds/${runId}?retry=true`, { body: "{}" });
  } catch (err) {
    // Azure answers a retry of a build whose last attempt did not fail with a
    // 500; the request did not take effect, which the transport cannot know.
    if (err instanceof ProviderError && /previous attempt did not fail/.test(err.message)) {
      throw new ProviderError(`run ${runId} did not fail; there is nothing to rerun`, err.status);
    }
    throw err;
  }
}

/** Cancel a run. */
export async function pipelinesRunCancel(
  repo: string,
  runId: number,
): Promise<void> {
  const root = buildRoot(repo);
  await azureHttp("PATCH", `${root}/builds/${runId}`, {
    body: JSON.stringify({ status: "cancelling" }),
  });
}

export interface PipelinesRunDownloadOptions {
  /** -n: download only the named artifact. */
  name?: string;
  /** -D: destination directory (created when missing); default cwd. */
  destDir?: string;
}

/** Download run artifacts: Azure serves them as zip downloads, fetched to the
 * destination with the artifact's name, each from the URL the API returned
 * (the transport's download helper adds no api-version). */
export async function pipelinesRunDownload(
  repo: string,
  runId: number,
  opts: PipelinesRunDownloadOptions = {},
): Promise<void> {
  const { mkdirSync } = await import("node:fs");
  const { join } = await import("node:path");
  const destDir = opts.destDir ?? ".";
  if (destDir !== ".") mkdirSync(destDir, { recursive: true });
  const root = buildRoot(repo);
  const r = await azureHttp<{
    value?: Array<{ name?: string; resource?: { downloadUrl?: string } }>;
  }>("GET", `${root}/builds/${runId}/artifacts`);
  const wanted = opts.name !== undefined && opts.name !== "" ? opts.name : undefined;
  if ((r.value ?? []).length === 0) {
    throw new ProviderError(`run ${runId} has no artifacts`);
  }
  const picked: Array<{ name: string; url: string }> = [];
  for (const a of r.value ?? []) {
    const name = a.name ?? "";
    if (name === "") continue;
    if (wanted !== undefined && name !== wanted) continue;
    // The name becomes a file name under destDir: a separator or '..' would
    // write outside it. Every candidate is checked before any download starts.
    if (/[\\/]/.test(name) || name.includes("..")) {
      throw new ProviderError(`unsafe artifact name '${name}': it must not contain '/', '\\' or '..'`);
    }
    const url = a.resource?.downloadUrl ?? "";
    if (url === "") continue;
    picked.push({ name, url });
  }
  if (wanted !== undefined && picked.length === 0) {
    throw new ProviderError(`artifact '${wanted}' not found on run ${runId}`);
  }
  if (picked.length === 0) {
    throw new ProviderError(`run ${runId} has no downloadable artifacts`);
  }
  for (const { name, url } of picked) {
    await azureHttpDownload(url, join(destDir, `${name}.zip`));
  }
}
