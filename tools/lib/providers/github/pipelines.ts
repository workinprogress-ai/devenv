// github/pipelines.ts - GitHub implementation of the pipelines domain facade.
//
// Ports the full provider_pipelines_* verb set (module-complete: run list /
// view / watch / artifacts, workflow list / run, run rerun / cancel / download).
// Optional-repo verbs carry the bash positional-repo convention: a first
// argument that is not an option/numeric rides as the repository (gh's -R);
// flags forward verbatim — the facade adds nothing.

import { ghApi, ghApiSync, providerDeclareCapability, type GhOptions } from "../provider-core.ts";
import { applyJq } from "./repos.ts";

// Capability declaration (bash pipelines.bash's declaration, carried over).
providerDeclareCapability("pipelines");

export interface GhResult {
  stdout: string;
  stderr: string;
  status: number;
}

/** `-R owner/repo` when a spec is present; empty array otherwise. */
function repoArgs(spec?: string): string[] {
  const repo = spec ?? "";
  return repo === "" ? [] : ["-R", repo];
}

/** Strip an optional leading repository positional (not an option, not the
 * run id). Returns [repo, rest]. */
function splitOptionalRepo(args: string[], allowNumeric = false): { repo?: string; rest: string[] } {
  if (args.length > 0) {
    const first = args[0] as string;
    if (!first.startsWith("--") && (allowNumeric ? !/^[0-9]+$/.test(first) : true)) {
      return { repo: first, rest: args.slice(1) };
    }
  }
  return { rest: [...args] };
}

/** List workflow runs for a repository. Seam field mapping covers id →
 * databaseId (per `_gh_json_run`'s map on run list). */
export async function pipelinesRunList(
  spec: string | undefined,
  opts: { limit?: number; json?: string; jq?: string; status?: string } = {},
): Promise<string> {
  const { repo, rest } = splitOptionalRepo(spec !== undefined ? [spec] : []);
  const args = ["run", "list", ...repoArgs(repo)];
  if (opts.limit !== undefined) args.push("--limit", String(opts.limit));
  if (opts.status !== undefined) args.push("--status", opts.status);
  if (opts.json !== undefined) {
    const seamMap: Record<string, string> = { id: "databaseId" };
    args.push("--json", opts.json.split(",").map((f) => seamMap[f] ?? f).join(","));
    const raw = (await ghApi(args)).stdout;
    const inverse: Record<string, string> = {};
    for (const [seam, ghName] of Object.entries(seamMap)) inverse[ghName] = seam;
    const renamed = renameJsonKeys(raw, inverse);
    // Bash order-of-operations parity (_gh_json_run): the caller's jq
    // projection applies to the renamed records, after the seam rename-back.
    if (opts.jq !== undefined) return applyJq(renamed, opts.jq);
    return renamed;
  }
  if (opts.jq !== undefined) args.push("--jq", opts.jq);
  void rest;
  return (await ghApi(args)).stdout;
}

/** View a workflow run. */
export async function pipelinesRunView(
  spec: string | undefined,
  runId: string,
  opts: GhOptions = {},
): Promise<string> {
  const parts = spec !== undefined ? [spec, runId] : [runId];
  const { repo, rest } = splitOptionalRepo(parts, true);
  const runIdArg = rest[0] ?? runId;
  return (await ghApi(["run", "view", runIdArg, ...repoArgs(repo)], opts)).stdout;
}

/** Watch a run to completion (gh streams progress; the caller owns polling
 * policy via forwarded flags like --exit-status). Resolves on gh's exit. */
export async function pipelinesRunWatch(
  spec: string | undefined,
  runId: string,
  flags: string[] = [],
): Promise<RunResult> {
  const parts = spec !== undefined ? [spec, runId] : [runId];
  const { repo, rest } = splitOptionalRepo(parts, true);
  const runIdArg = rest[0] ?? runId;
  const r = await ghApi(["run", "watch", runIdArg, ...repoArgs(repo), ...flags], {
    tolerateFailure: true,
  });
  return { stdout: r.stdout, stderr: r.stderr, status: r.status };
}

/** List workflow definitions. Flags (--json FIELDS, --all, ...) forward. */
export async function pipelinesWorkflowList(
  spec: string | undefined,
  flags: string[] = [],
): Promise<string> {
  const { repo, rest } = splitOptionalRepo(spec !== undefined ? [spec] : []);
  return (await ghApi(["workflow", "list", ...repoArgs(repo), ...rest, ...flags])).stdout;
}

/** Fetch run artifacts metadata (REST surface). */
export function pipelinesRunArtifacts(repo: string, runId: string): string {
  const r = ghApiSync(["api", `/repos/${repo}/actions/runs/${runId}/artifacts`, "--jq", ".artifacts"], {
    tolerateFailure: true,
  });
  if (r.status !== 0) throw new Error(`pipelinesRunArtifacts failed for '${repo}' ${runId}: ${r.stderr.trim()}`);
  return r.stdout;
}

/** Trigger a workflow dispatch. */
export async function pipelinesWorkflowRun(
  spec: string | undefined,
  workflow: string,
  flags: string[] = [],
): Promise<RunResult> {
  const { repo, rest } = splitOptionalRepo(spec !== undefined ? [spec] : []);
  const workflowArg = rest[0] ?? workflow;
  const r = await ghApi(["workflow", "run", workflowArg, ...repoArgs(repo), ...flags], {
    tolerateFailure: true,
  });
  return { stdout: r.stdout, stderr: r.stderr, status: r.status };
}

/** Rerun a workflow run. Flags (--failed, --debug) forward. */
export async function pipelinesRunRerun(
  spec: string | undefined,
  runId: string,
  flags: string[] = [],
): Promise<RunResult> {
  const parts = spec !== undefined ? [spec, runId] : [runId];
  const { repo, rest } = splitOptionalRepo(parts, true);
  const runIdArg = rest[0] ?? runId;
  const r = await ghApi(["run", "rerun", runIdArg, ...repoArgs(repo), ...flags], {
    tolerateFailure: true,
  });
  return { stdout: r.stdout, stderr: r.stderr, status: r.status };
}

/** Cancel a run. */
export function pipelinesRunCancel(repo: string, runId: string): RunResult {
  const r = ghApiSync(["run", "cancel", "-R", repo, runId], { tolerateFailure: true });
  return { stdout: r.stdout, stderr: r.stderr, status: r.status };
}

/** Download run artifacts. Flags (--name, --dir) forward. */
export async function pipelinesRunDownload(
  spec: string | undefined,
  runId: string,
  flags: string[] = [],
): Promise<RunResult> {
  const parts = spec !== undefined ? [spec, runId] : [runId];
  const { repo, rest } = splitOptionalRepo(parts, true);
  const runIdArg = rest[0] ?? runId;
  const r = await ghApi(["run", "download", runIdArg, ...repoArgs(repo), ...flags], {
    tolerateFailure: true,
  });
  return { stdout: r.stdout, stderr: r.stderr, status: r.status };
}

interface RunResult {
  stdout: string;
  stderr: string;
  status: number;
}

/** Rename JSON object keys per the inverse map, recursively. */
function renameJsonKeys(raw: string, inverse: Record<string, string>): string {
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
