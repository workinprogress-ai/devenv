// domain/cs/merged-run.ts — which pipeline run proves a merged commit was built.
//
// After the dependency wizard merges an update, the next generation may only
// start once a pipeline run has built that commit. A run for an older commit
// proves nothing, and a pipeline whose CI trigger is missing produces no run
// at all — the selection below makes both visible instead of passing them.

export interface RunRow {
  status?: string;
  conclusion?: string | null;
  headSha?: string;
}

export type MergedRunState =
  | { state: "none" }
  | { state: "pending"; headSha: string }
  | { state: "success"; headSha: string }
  | { state: "failure"; headSha: string; conclusion: string };

/** The state of the newest run that built `mergedSha` — the commit itself or
 * a later commit containing it (`isDescendant(sha)` answers the latter, for
 * batched CI that builds only the newest pushed commit). `runs` is ordered
 * newest first, as the provider's run list returns it. */
export function mergedRunState(
  runs: RunRow[],
  mergedSha: string,
  isDescendant: (sha: string) => boolean,
): MergedRunState {
  for (const run of runs) {
    const sha = run.headSha ?? "";
    if (sha === "") continue;
    if (sha !== mergedSha && !isDescendant(sha)) continue;
    if (run.status !== "completed") return { state: "pending", headSha: sha };
    const conclusion = run.conclusion ?? "";
    if (conclusion === "success") return { state: "success", headSha: sha };
    return { state: "failure", headSha: sha, conclusion: conclusion === "" ? "unknown" : conclusion };
  }
  return { state: "none" };
}
