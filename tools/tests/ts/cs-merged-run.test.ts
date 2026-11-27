// cs-merged-run.test.ts — the dependency wizard only moves to the next
// generation once a pipeline run has built the merged commit (or a later
// commit containing it). An older run, or no run at all, must not pass.
import { describe, expect, it } from "vitest";
import { mergedRunState } from "../../lib/domain/cs/merged-run.ts";

const MERGED = "a".repeat(40);
const LATER = "b".repeat(40);
const OLDER = "c".repeat(40);
const descendantsOfMerged = new Set([LATER]);
const isDescendant = (sha: string): boolean => descendantsOfMerged.has(sha);

describe("mergedRunState", () => {
  it("no run at all is 'none'", () => {
    expect(mergedRunState([], MERGED, isDescendant)).toEqual({ state: "none" });
  });

  it("a successful run of an older commit does not count", () => {
    const runs = [{ status: "completed", conclusion: "success", headSha: OLDER }];
    expect(mergedRunState(runs, MERGED, isDescendant)).toEqual({ state: "none" });
  });

  it("a queued or running build of the merged commit is 'pending'", () => {
    expect(mergedRunState([{ status: "queued", headSha: MERGED }], MERGED, isDescendant).state).toBe("pending");
    expect(mergedRunState([{ status: "in_progress", headSha: MERGED }], MERGED, isDescendant).state).toBe("pending");
  });

  it("a successful build of the merged commit is 'success'", () => {
    const runs = [{ status: "completed", conclusion: "success", headSha: MERGED }];
    expect(mergedRunState(runs, MERGED, isDescendant)).toEqual({ state: "success", headSha: MERGED });
  });

  it("a failed or cancelled build of the merged commit is 'failure' with its conclusion", () => {
    expect(mergedRunState([{ status: "completed", conclusion: "failure", headSha: MERGED }], MERGED, isDescendant)).toEqual({
      state: "failure",
      headSha: MERGED,
      conclusion: "failure",
    });
    expect(mergedRunState([{ status: "completed", conclusion: "cancelled", headSha: MERGED }], MERGED, isDescendant).state).toBe(
      "failure",
    );
  });

  it("a batched build of a later commit that contains the merge counts", () => {
    const runs = [{ status: "completed", conclusion: "success", headSha: LATER }];
    expect(mergedRunState(runs, MERGED, isDescendant)).toEqual({ state: "success", headSha: LATER });
  });

  it("the newest matching run decides, older matching runs are ignored", () => {
    const runs = [
      { status: "in_progress", headSha: LATER },
      { status: "completed", conclusion: "failure", headSha: MERGED },
    ];
    expect(mergedRunState(runs, MERGED, isDescendant).state).toBe("pending");
  });

  it("a fast second pipeline cannot pass the wait while the publishing pipeline still runs", () => {
    const runs = [
      { status: "completed", conclusion: "success", headSha: MERGED, workflowName: "lint" },
      { status: "in_progress", headSha: MERGED, workflowName: "publish" },
    ];
    expect(mergedRunState(runs, MERGED, isDescendant).state).toBe("pending");
  });

  it("every pipeline that built the commit must succeed", () => {
    const green = [
      { status: "completed", conclusion: "success", headSha: MERGED, workflowName: "lint" },
      { status: "completed", conclusion: "success", headSha: MERGED, workflowName: "publish" },
    ];
    expect(mergedRunState(green, MERGED, isDescendant).state).toBe("success");
    const oneRed = [
      { status: "completed", conclusion: "success", headSha: MERGED, workflowName: "lint" },
      { status: "completed", conclusion: "failure", headSha: MERGED, workflowName: "publish" },
    ];
    expect(mergedRunState(oneRed, MERGED, isDescendant)).toEqual({ state: "failure", headSha: MERGED, conclusion: "failure" });
  });

  it("per pipeline only the newest matching run counts", () => {
    const runs = [
      { status: "completed", conclusion: "success", headSha: LATER, workflowName: "publish" },
      { status: "completed", conclusion: "failure", headSha: MERGED, workflowName: "publish" },
    ];
    expect(mergedRunState(runs, MERGED, isDescendant).state).toBe("success");
  });

  it("rows without a commit are skipped", () => {
    const runs = [{ status: "completed", conclusion: "success" }, { status: "completed", conclusion: "success", headSha: MERGED }];
    expect(mergedRunState(runs, MERGED, isDescendant).state).toBe("success");
  });
});
