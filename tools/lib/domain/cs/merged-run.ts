// domain/cs/merged-run.ts — which pipeline runs prove a merged commit was built.
//
// After the dependency wizard merges an update, the next generation may only
// start once the repository's pipelines have built that commit. A run for an
// older commit proves nothing, and a pipeline whose CI trigger is missing
// produces no run at all — the selection below makes both visible instead of
// passing them. A repository can have several pipelines: each one that built
// the commit must succeed, so a fast pipeline cannot pass the wait while the
// one that publishes the package is still running. A pipeline that has not
// queued its run yet is not visible here.

export interface RunRow {
  status?: string;
  conclusion?: string | null;
  headSha?: string;
  workflowName?: string;
}

export type MergedRunState =
  | { state: "none" }
  | { state: "pending"; headSha: string }
  | { state: "success"; headSha: string }
  | { state: "failure"; headSha: string; conclusion: string };

/** The combined state of the pipelines that built `mergedSha` — the commit
 * itself or a later commit containing it (`isDescendant(sha)` answers the
 * latter, for batched CI that builds only the newest pushed commit). Per
 * pipeline (`workflowName`) only its newest such run counts. A failure in any
 * pipeline wins, then any still running; success needs every pipeline done and
 * green. `runs` is ordered newest first, as the provider's run list returns it. */
export function mergedRunState(
  runs: RunRow[],
  mergedSha: string,
  isDescendant: (sha: string) => boolean,
): MergedRunState {
  const newestPerPipeline = new Map<string, RunRow>();
  for (const run of runs) {
    const sha = run.headSha ?? "";
    if (sha === "") continue;
    if (sha !== mergedSha && !isDescendant(sha)) continue;
    const pipeline = run.workflowName ?? "";
    if (!newestPerPipeline.has(pipeline)) newestPerPipeline.set(pipeline, run);
  }
  if (newestPerPipeline.size === 0) return { state: "none" };
  const relevant = [...newestPerPipeline.values()];
  const failed = relevant.find((r) => r.status === "completed" && r.conclusion !== "success");
  if (failed !== undefined) {
    const conclusion = failed.conclusion ?? "";
    return { state: "failure", headSha: failed.headSha ?? "", conclusion: conclusion === "" ? "unknown" : conclusion };
  }
  const running = relevant.find((r) => r.status !== "completed");
  if (running !== undefined) return { state: "pending", headSha: running.headSha ?? "" };
  return { state: "success", headSha: relevant[0]?.headSha ?? "" };
}
