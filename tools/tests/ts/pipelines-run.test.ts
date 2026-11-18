// pipelines-run end to end against a stateful gh stub: the run URL printed is
// the run this invocation queued, never another workflow's.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathWithStubs, rmrf, runTool, stubCalls, stubGh, tmpStubBin, tmpToolboxRoot } from "./harness/index.ts";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

let bin = "";
let root = "";

beforeEach(() => {
  bin = tmpStubBin("plrun-bin");
  root = tmpToolboxRoot("plrun-root");
});
afterEach(() => {
  rmrf(bin);
  rmrf(root);
});

/** A gh stub whose run list is PRE before `workflow run` and POST after it.
 * `workflow run` prints WORKFLOW_RUN_OUT. */
function installGh(opts: { pre: unknown[]; post: unknown[]; workflowRunOut?: string; runViewFails?: boolean }): void {
  writeFileSync(join(bin, "pre.json"), JSON.stringify(opts.pre));
  writeFileSync(join(bin, "post.json"), JSON.stringify(opts.post));
  const log = join(bin, "calls.log");
  stubGh(
    bin,
    [
      "#!/usr/bin/env bash",
      'if [ "$1" = "auth" ] && [ "$2" = "status" ]; then exit 0; fi',
      `printf '%s\\n' "gh $*" >> "${log}"`,
      'case "$1 $2" in',
      '  "workflow run") touch "' + join(bin, "triggered") + '"; printf \'%s\\n\' "' + (opts.workflowRunOut ?? "") + '" ;;',
      '  "workflow list") echo \'[{"id":11,"name":"CI","path":".github/workflows/ci.yml","state":"active"}]\' ;;',
      '  "run list") if [ -e "' + join(bin, "triggered") + '" ]; then cat "' + join(bin, "post.json") + '"; else cat "' + join(bin, "pre.json") + '"; fi ;;',
      '  "run view") ' + (opts.runViewFails ? "exit 1" : "echo https://example.invalid/run/42") + ' ;;',
      "esac",
      "exit 0",
      "",
    ].join("\n"),
  );
}

function runPipelinesRun(): { status: number; output: string } {
  const r = runTool("pipelines-run", ["ci.yml", "--repo", "acme/widgets"], {
    env: {
      DEVENV_REPO: "acme/widgets",
      DEVENV_ROOT: root,
      DEVENV_ROOT_SET: "1",
      PATH: pathWithStubs(bin),
    },
  });
  return { status: r.status, output: r.output };
}

const future = () => new Date(Date.now() + 60_000).toISOString();
const old = "2020-01-01T00:00:00Z";

describe("pipelines-run", () => {
  it("prints the URL of a run found by its id when the trigger returns one", () => {
    installGh({ pre: [], post: [], workflowRunOut: "42" });
    const r = runPipelinesRun();
    expect(r.status).toBe(0);
    expect(r.output).toContain("Run URL: https://example.invalid/run/42");
  });

  it("prints the URL of the one new run of the triggered workflow", () => {
    const other = { databaseId: 1, workflowName: "Deploy", event: "push", createdAt: old, url: "https://example.invalid/run/1" };
    const mine = { databaseId: 2, workflowName: "CI", event: "workflow_dispatch", createdAt: future(), url: "https://example.invalid/run/2" };
    installGh({ pre: [other], post: [mine, other] });
    const r = runPipelinesRun();
    expect(r.status).toBe(0);
    expect(r.output).toContain("Run URL: https://example.invalid/run/2");
    expect(stubCalls(bin, "gh").some((c) => c.startsWith("gh workflow list"))).toBe(true);
  });

  it("never prints another workflow's newer run that was already in the snapshot", () => {
    const other = { databaseId: 1, workflowName: "Deploy", event: "workflow_dispatch", createdAt: future(), url: "https://example.invalid/run/1" };
    const mine = { databaseId: 2, workflowName: "CI", event: "workflow_dispatch", createdAt: future(), url: "https://example.invalid/run/2" };
    installGh({ pre: [other], post: [mine, other] });
    const r = runPipelinesRun();
    expect(r.status).toBe(0);
    expect(r.output).not.toContain("https://example.invalid/run/1");
    expect(r.output).toContain("Run URL: https://example.invalid/run/2");
  });

  it("reports an ambiguity, with no URL, when two new runs of the workflow appear", () => {
    const a = { id: 2, workflowName: "CI", event: "workflow_dispatch", createdAt: future(), url: "https://example.invalid/run/2" };
    const b = { id: 3, workflowName: "CI", event: "workflow_dispatch", createdAt: future(), url: "https://example.invalid/run/3" };
    installGh({ pre: [], post: [a, b] });
    const r = runPipelinesRun();
    expect(r.status).toBe(0);
    expect(r.output).not.toContain("Run URL:");
    expect(r.output).toContain("2 new runs appeared and none can be attributed");
    expect(r.output).toContain("pipelines-status --repo acme/widgets --workflow ci.yml");
  });

  it("does not fall back to polling when the direct run view fails", () => {
    const stray = { id: 2, workflowName: "CI", event: "workflow_dispatch", createdAt: future(), url: "https://example.invalid/run/2" };
    installGh({ pre: [], post: [stray], workflowRunOut: "42", runViewFails: true });
    const r = runPipelinesRun();
    expect(r.status).toBe(0);
    expect(r.output).not.toContain("Run URL:");
    expect(r.output).toContain("Run queued but URL not yet available.");
    expect(r.output).toContain("pipelines-status --repo acme/widgets --workflow ci.yml");
    const calls = stubCalls(bin, "gh");
    const viewAt = calls.findIndex((c) => c.startsWith("gh run view"));
    expect(viewAt).toBeGreaterThanOrEqual(0);
    expect(calls.slice(viewAt + 1).some((c) => c.startsWith("gh run list"))).toBe(false);
  });
});
