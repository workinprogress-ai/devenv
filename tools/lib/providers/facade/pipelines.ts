// providers/facade/pipelines.ts — the provider-neutral pipelines family.
//
// The only import surface tools use for CI-pipeline verbs. Normalizations
// owned here:
//   - RunList: github returns JSON text; azure records-or-string — the
//     facade always returns JSON text (the tools' `.trim()`/jq flows hold).
//   - Watch/WorkflowRun/RunRerun/RunDownload: github returns {stdout,
//     status} (the tools exit on `watched.status`); azure's string/void
//     returns wrap into that shape (status 0, azure's poll text in stdout).
//   - RunArtifacts: github is sync (gh api) returning text; azure async —
//     the facade is async, text both sides.
//   - Azure's surplus verbs (RunCancel, buildStatusToSeam,
//     buildResultToSeam, AZURE_BUILD_FIELDS) are provider-internal helpers
//     (its own tools never imported RunCancel; the seam mappers feed its
//     record projection) — NOT surfaced neutrally.
//
// The module never exits; failures throw ProviderError and callers decide.

import type { GhResult } from "../github/transport.ts";
import { ProviderError, needValue, unknownOption } from "../provider-core.ts";
import { loadProviderModules } from "./provider-loader.ts";
import type * as ghTypes from "../github/pipelines.ts";
import type * as azTypes from "../azure/pipelines.ts";

type GithubPipelines = typeof ghTypes;
type AzurePipelines = typeof azTypes;

async function load(): Promise<{ provider: string; gh: GithubPipelines | undefined; az: AzurePipelines | undefined }> {
  const loaded = await loadProviderModules("pipelines");
  if (loaded.provider === "azure") {
    return { provider: "azure", gh: undefined, az: loaded.get<AzurePipelines>("pipelines.ts") };
  }
  return { provider: "github", gh: loaded.get<GithubPipelines>("pipelines.ts"), az: undefined };
}

/** List pipeline runs (JSON text). */
export async function pipelinesRunList(
  spec: string | undefined,
  opts: { limit?: number; json?: string; jq?: string; status?: string; branch?: string } = {},
): Promise<string> {
  const m = await load();
  if (m.provider === "azure") {
    const out = await m.az!.pipelinesRunList(spec ?? "", opts);
    return typeof out === "string" ? out : JSON.stringify(out);
  }
  return m.gh!.pipelinesRunList(spec, opts);
}

/** View one run (JSON text). */
export async function pipelinesRunView(
  spec: string | undefined,
  runId: string,
  opts: { json?: string; jq?: string } = {},
): Promise<string> {
  const m = await load();
  if (m.provider === "azure") {
    return m.az!.pipelinesRunView(spec ?? "", Number.parseInt(runId, 10), opts);
  }
  return m.gh!.pipelinesRunView(spec, runId, opts);
}

/** Watch a run to completion; {stdout, status} (the tool exits on status). */
export async function pipelinesRunWatch(
  spec: string | undefined,
  runId: string,
  flags: string[] = [],
): Promise<GhResult> {
  const m = await load();
  if (m.provider === "azure") {
    // The Azure verb throws a ProviderError for a failed run under
    // exitStatus (and for a timeout); the facade owns turning that into the
    // {status} the tool exits with.
    // Azure maps --exit-status only; any other flag is refused by name.
    for (const flag of flags) {
      if (flag !== "--exit-status") unknownOption("pipelinesRunWatch", flag);
    }
    try {
      const out = await m.az!.pipelinesRunWatch(spec ?? "", Number.parseInt(runId, 10), {
        exitStatus: flags.includes("--exit-status"),
      });
      return { stdout: out, stderr: "", status: 0 };
    } catch (e) {
      if (e instanceof ProviderError) return { stdout: "", stderr: e.message, status: 1 };
      throw e;
    }
  }
  return m.gh!.pipelinesRunWatch(spec, runId, flags);
}

/** List workflows (JSON text). */
export async function pipelinesWorkflowList(spec: string | undefined, flags: string[] = []): Promise<string> {
  const m = await load();
  if (m.provider === "azure") {
    // Only the flags the Azure verb maps are accepted; anything else is
    // rejected by name rather than silently dropped.
    const opts: { json?: string; jq?: string } = {};
    for (let i = 0; i < flags.length; i++) {
      const flag = flags[i] as string;
      if (flag === "--json" || flag === "--jq" || flag === "-q") {
        const value = flags[i + 1];
        if (value === undefined) needValue("pipelinesWorkflowList", flag);
        if (flag === "--json") opts.json = value;
        else opts.jq = value;
        i++;
      } else {
        unknownOption("pipelinesWorkflowList", flag);
      }
    }
    return m.az!.pipelinesWorkflowList(spec ?? "", opts);
  }
  return m.gh!.pipelinesWorkflowList(spec, flags);
}

/** Trigger a workflow run; {stdout, status}. */
export async function pipelinesWorkflowRun(
  spec: string | undefined,
  workflow: string,
  flags: string[] = [],
): Promise<GhResult> {
  const m = await load();
  if (m.provider === "azure") {
    // github's flag list carries --ref; azure's opts object carries ref
    // and --field k=v inputs (the caller's validated pairs land as fields).
    let ref = "";
    const fields: Record<string, string> = {};
    for (let i = 0; i < flags.length; i++) {
      const flag = flags[i] as string;
      if (flag === "--ref") {
        const value = flags[i + 1];
        if (value === undefined) needValue("pipelinesWorkflowRun", flag);
        ref = value;
        i++;
      } else if (flag === "-f" || flag === "--field") {
        const kv = flags[i + 1];
        if (kv === undefined) needValue("pipelinesWorkflowRun", flag);
        const eq = kv.indexOf("=");
        if (eq <= 0) {
          throw new ProviderError(`pipelinesWorkflowRun: option '${flag}' expects KEY=VALUE, got '${kv}'`);
        }
        fields[kv.slice(0, eq)] = kv.slice(eq + 1);
        i++;
      } else {
        unknownOption("pipelinesWorkflowRun", flag);
      }
    }
    const runId = await m.az!.pipelinesWorkflowRun(spec ?? "", workflow, {
      ...(ref !== "" ? { ref } : {}),
      ...(Object.keys(fields).length > 0 ? { fields } : {}),
    });
    return { stdout: String(runId), stderr: "", status: 0 };
  }
  return m.gh!.pipelinesWorkflowRun(spec, workflow, flags);
}

/** Rerun a pipeline run; {stdout, status}. */
export async function pipelinesRunRerun(spec: string | undefined, runId: string, flags: string[] = []): Promise<GhResult> {
  const m = await load();
  if (m.provider === "azure") {
    // Azure retries the whole build in place: there is no failed-jobs-only or
    // debug rerun, so any flag is refused rather than silently dropped.
    if (flags.length > 0) unknownOption("pipelinesRunRerun", flags[0] as string);
    await m.az!.pipelinesRunRerun(spec ?? "", Number.parseInt(runId, 10));
    return { stdout: "", stderr: "", status: 0 };
  }
  return m.gh!.pipelinesRunRerun(spec, runId, flags);
}

/** Fetch run artifacts metadata (JSON text). */
export async function pipelinesRunArtifacts(repo: string, runId: string): Promise<string> {
  const m = await load();
  if (m.provider === "azure") {
    return m.az!.pipelinesRunArtifacts(repo, Number.parseInt(runId, 10), {});
  }
  return m.gh!.pipelinesRunArtifacts(repo, runId);
}

/** Download a run artifact; {stdout, status}. flags are the caller's
 * validated list (github's gh-run-download arg list; azure maps its
 * options object). */
export async function pipelinesRunDownload(
  spec: string | undefined,
  runId: string,
  flags: string[] = [],
): Promise<GhResult> {
  const m = await load();
  if (m.provider === "azure") {
    const opts: { name?: string; destDir?: string } = {};
    for (let i = 0; i < flags.length; i++) {
      const flag = flags[i] as string;
      if (flag === "-n" || flag === "--name" || flag === "-D" || flag === "--dir") {
        const value = flags[i + 1];
        if (value === undefined) needValue("pipelinesRunDownload", flag);
        if (flag === "-n" || flag === "--name") opts.name = value;
        else opts.destDir = value;
        i++;
      } else {
        unknownOption("pipelinesRunDownload", flag);
      }
    }
    await m.az!.pipelinesRunDownload(spec ?? "", Number.parseInt(runId, 10), opts);
    return { stdout: "", stderr: "", status: 0 };
  }
  return m.gh!.pipelinesRunDownload(spec, runId, flags);
}
