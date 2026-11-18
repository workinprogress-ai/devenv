// Azure pipeline verbs as verified against live Azure (research R3): inputs go
// as templateParameters, rerun is a retry of the same build, the size is in
// properties.artifactsize, and a PipelineArtifact downloads from its own host
// without an api-version. Plus the watch loop, ambiguous names, filters and
// the download's file safety.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { rmrf, tmpDir } from "./harness/index.ts";
import { azureJson, stubAzureFetch, useAzureEnv } from "./harness/azure-stub.ts";
import {
  pipelinesRunArtifacts,
  pipelinesRunCancel,
  pipelinesRunDownload,
  pipelinesRunList,
  pipelinesRunRerun,
  pipelinesRunWatch,
  pipelinesWorkflowList,
  pipelinesWorkflowRun,
} from "../../lib/providers/azure/pipelines.ts";

const BUILD = "https://dev.azure.com/test-org/test-project/_apis/build";
const REPO = "https://dev.azure.com/test-org/test-project/_apis/git/repositories/widgets?api-version=7.1";

let restoreEnv: () => void = () => {};
let sleeps: number[] = [];

beforeEach(() => {
  restoreEnv = useAzureEnv("test-org", "test-project");
  sleeps = [];
  // Every sleep (the watch interval, the transport's backoff) runs at once.
  vi.spyOn(globalThis, "setTimeout").mockImplementation(((fn: () => void, ms?: number) => {
    sleeps.push(ms ?? 0);
    fn();
    return 0 as unknown as NodeJS.Timeout;
  }) as typeof setTimeout);
});

afterEach(() => {
  delete process.env["AZURE_PIPELINE_WATCH_ATTEMPTS"];
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  restoreEnv();
});

const def = (id: number, name: string) => ({ id, name, path: "\\" });

describe("pipelinesWorkflowRun", () => {
  const defsRoute = (defs: unknown[]) => ({
    method: "GET",
    url: new RegExp(`${BUILD}/definitions\\?name=ci`),
    respond: azureJson({ value: defs }),
  });

  it("names the ids when a pipeline name matches several definitions, before queuing anything", async () => {
    const stub = stubAzureFetch([defsRoute([def(12, "ci"), def(34, "ci")])]);
    await expect(pipelinesWorkflowRun("widgets", "ci", { ref: "main" })).rejects.toThrow(/several.*12.*34.*numeric id/s);
    expect(stub.requests.some((r) => r.method === "POST")).toBe(false);
  });

  it("sends --field inputs as templateParameters and never as parameters", async () => {
    const stub = stubAzureFetch([
      defsRoute([def(12, "ci")]),
      { method: "POST", url: `${BUILD}/builds?api-version=7.1`, respond: azureJson({ id: 99 }) },
    ]);
    const id = await pipelinesWorkflowRun("widgets", "ci", { ref: "main", fields: { p_str: "x", p_bool: "true" } });
    expect(id).toBe(99);
    const body = stub.requests.find((r) => r.method === "POST")?.body as Record<string, unknown>;
    expect(body["templateParameters"]).toEqual({ p_str: "x", p_bool: "true" });
    expect(body["parameters"]).toBeUndefined();
  });

  it.each([
    ["main", "refs/heads/main"],
    ["refs/heads/main", "refs/heads/main"],
    ["refs/tags/v1", "refs/tags/v1"],
  ])("queues ref %s as %s", async (ref, expected) => {
    const stub = stubAzureFetch([
      { method: "POST", url: `${BUILD}/builds?api-version=7.1`, respond: azureJson({ id: 1 }) },
    ]);
    await pipelinesWorkflowRun("widgets", "12", { ref });
    expect((stub.requests[0]?.body as { sourceBranch: string }).sourceBranch).toBe(expected);
  });
});

describe("pipelinesRunRerun", () => {
  it("retries the same build in place", async () => {
    const stub = stubAzureFetch([{ method: "PATCH", url: `${BUILD}/builds/5?retry=true&api-version=7.1`, respond: azureJson({ id: 5 }) }]);
    await pipelinesRunRerun("widgets", 5);
    expect(stub.unmatched()).toEqual([]);
  });

  it("says the run did not fail when Azure refuses to retry a build whose previous attempt succeeded", async () => {
    stubAzureFetch([
      {
        method: "PATCH",
        url: /builds\/5\?retry=true/,
        respond: azureJson({ message: "BuildStatusInvalidChangeException: Unable to retry pipeline 1.1 because the previous attempt did not fail." }, 500),
      },
    ]);
    const err = (await pipelinesRunRerun("widgets", 5).catch((e: unknown) => e)) as Error;
    expect(err.message).toMatch(/run 5 did not fail/);
    expect(err.message).not.toMatch(/may have taken effect/);
  });

  it("leaves other failures as they are", async () => {
    stubAzureFetch([{ method: "PATCH", url: /builds\/5\?retry=true/, respond: azureJson({ message: "boom" }, 500) }]);
    await expect(pipelinesRunRerun("widgets", 5)).rejects.toThrow(/boom/);
  });
});

describe("pipelinesRunWatch", () => {
  const build = (status: string, result?: string) => ({ id: 5, status, ...(result !== undefined ? { result } : {}), definition: { name: "ci" } });
  const BUILD5 = `${BUILD}/builds/5?api-version=7.1`;

  function scripted(steps: Array<number | ReturnType<typeof build>>) {
    let i = 0;
    return stubAzureFetch([
      {
        method: "GET",
        url: BUILD5,
        respond: () => {
          const step = steps[Math.min(i++, steps.length - 1)] as number | ReturnType<typeof build>;
          return typeof step === "number" ? azureJson({ message: "unavailable" }, step) : azureJson(step);
        },
      },
    ]);
  }

  it("survives one poll that fails after the transport's own retries", async () => {
    // Three 503s are one whole poll failing (the transport tries three times).
    scripted([503, 503, 503, build("inProgress"), build("completed", "succeeded")]);
    const out = await pipelinesRunWatch("widgets", 5, { exitStatus: true });
    expect((JSON.parse(out) as { conclusion: string }).conclusion).toBe("success");
  });

  it("gives up after several polls in a row fail", async () => {
    scripted([503]);
    await expect(pipelinesRunWatch("widgets", 5)).rejects.toThrow(/unavailable|503/);
  });

  it("does not keep polling after a rejected credential", async () => {
    const stub = stubAzureFetch([{ method: "GET", url: BUILD5, respond: azureJson({}, 401) }]);
    await expect(pipelinesRunWatch("widgets", 5)).rejects.toThrow(/credential/);
    expect(stub.requests).toHaveLength(1);
  });

  it("does not sleep after the last poll before reporting a timeout", async () => {
    process.env["AZURE_PIPELINE_WATCH_ATTEMPTS"] = "3";
    scripted([build("inProgress")]);
    await expect(pipelinesRunWatch("widgets", 5)).rejects.toThrow(/timed out/);
    expect(sleeps.filter((ms) => ms === 10_000)).toHaveLength(2);
  });

  it("writes progress to stderr and the final run record to stdout, once", async () => {
    const out = vi.spyOn(console, "log").mockImplementation(() => {});
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    scripted([build("inProgress"), build("completed", "succeeded")]);
    await pipelinesRunWatch("widgets", 5);
    expect(out).toHaveBeenCalledTimes(1);
    expect((JSON.parse(String(out.mock.calls[0]?.[0])) as { status: string }).status).toBe("completed");
    expect(err).toHaveBeenCalled();
  });

  it("does not retry a missing credential", async () => {
    const stub = stubAzureFetch([{ method: "GET", url: BUILD5, respond: azureJson(build("inProgress")) }]);
    const saved = process.env["AZURE_PAT"];
    delete process.env["AZURE_PAT"];
    process.env["HOME"] = "/nonexistent-home-for-test";
    try {
      await expect(pipelinesRunWatch("widgets", 5)).rejects.toThrow(/no stored azure credential/);
      expect(stub.requests).toHaveLength(0);
      expect(sleeps.filter((ms) => ms === 10_000)).toHaveLength(0);
    } finally {
      if (saved !== undefined) process.env["AZURE_PAT"] = saved;
    }
  });

  it("reports the last failed poll when the watch runs out of attempts", async () => {
    process.env["AZURE_PIPELINE_WATCH_ATTEMPTS"] = "2";
    scripted([503]);
    await expect(pipelinesRunWatch("widgets", 5)).rejects.toThrow(/unavailable/);
  });

  it("still fails a completed run under --exit-status", async () => {
    scripted([build("completed", "failed")]);
    await expect(pipelinesRunWatch("widgets", 5, { exitStatus: true })).rejects.toThrow(/concluded failure/);
  });
});

describe("pipelinesRunList filters and fields", () => {
  const listRoutes = (capture: string[]) => [
    { method: "GET", url: REPO, respond: azureJson({ id: "g1" }) },
    {
      method: "GET",
      url: /\/build\/builds\?/,
      respond: (req: { url: string }) => {
        capture.push(req.url);
        return azureJson({ value: [{ id: 1, status: "inProgress", queueTime: "q", startTime: "s", definition: { name: "ci" }, sourceBranch: "refs/tags/v1" }] });
      },
    },
  ];

  it("lists in_progress runs together with the ones being cancelled", async () => {
    const urls: string[] = [];
    stubAzureFetch(listRoutes(urls));
    await pipelinesRunList("widgets", { status: "in_progress" });
    expect(decodeURIComponent(urls[0] ?? "")).toContain("statusFilter=inProgress,cancelling");
  });

  it("does not prefix a branch that is already a full ref", async () => {
    const urls: string[] = [];
    stubAzureFetch(listRoutes(urls));
    await pipelinesRunList("widgets", { branch: "refs/tags/v1" });
    expect(urls[0]).toContain("branchName=refs%2Ftags%2Fv1");
  });

  it("reports an unfinished run's update time as its start time, not its queue time", async () => {
    stubAzureFetch(listRoutes([]));
    const rows = (await pipelinesRunList("widgets")) as Array<{ createdAt: string; updatedAt: string }>;
    expect(rows[0]).toMatchObject({ createdAt: "q", updatedAt: "s" });
  });
});

describe("pipelinesWorkflowList", () => {
  it("pages through the definitions of this repository only", async () => {
    const urls: string[] = [];
    stubAzureFetch([
      { method: "GET", url: REPO, respond: azureJson({ id: "g1" }) },
      {
        method: "GET",
        url: /\/build\/definitions\?/,
        respond: (req) => {
          urls.push(req.url);
          return req.url.includes("continuationToken=p2")
            ? azureJson({ value: [def(2, "b")] })
            : azureJson({ value: [def(1, "a")], continuationToken: "p2" });
        },
      },
    ]);
    const out = await pipelinesWorkflowList("widgets");
    expect(out.split("\n")).toHaveLength(2);
    expect(urls[0]).toContain("repositoryId=g1");
  });

  it("refuses a jq program it cannot run instead of ignoring it", async () => {
    stubAzureFetch([
      { method: "GET", url: REPO, respond: azureJson({ id: "g1" }) },
      { method: "GET", url: /\/build\/definitions\?/, respond: azureJson({ value: [def(1, "a")] }) },
    ]);
    await expect(pipelinesWorkflowList("widgets", { json: "name", jq: ".[0].name" })).rejects.toThrow(/unsupported jq/);
  });
});

describe("pipelinesRunArtifacts", () => {
  it("reads the size from properties.artifactsize", async () => {
    stubAzureFetch([
      {
        method: "GET",
        url: `${BUILD}/builds/5/artifacts?api-version=7.1`,
        respond: azureJson({
          count: 2,
          value: [
            { id: 1, name: "legacy-drop", resource: { type: "Container", properties: { localpath: "/x", artifactsize: "5023" }, downloadUrl: "u1" } },
            { id: 2, name: "pipeline-drop", resource: { type: "PipelineArtifact", properties: { artifactsize: "5023", HashType: "x" }, downloadUrl: "u2" } },
          ],
        }),
      },
    ]);
    const rows = (await pipelinesRunArtifacts("widgets", 5)).split("\n").map((l) => JSON.parse(l) as { size_in_bytes: number });
    expect(rows.map((r) => r.size_in_bytes)).toEqual([5023, 5023]);
  });
});

describe("pipelinesRunDownload", () => {
  const ART_URL = `${BUILD}/builds/5/artifacts?api-version=7.1`;
  const ARTPROD = "https://artprodeus21.artifacts.visualstudio.com/A1/p1/_apis/artifact/xyz/content?format=zip";
  let dir = "";

  beforeEach(() => {
    dir = tmpDir("pipelines-download");
    mkdirSync(dir, { recursive: true });
  });
  afterEach(() => rmrf(dir));

  const artifacts = (url: string) =>
    azureJson({ value: [{ id: 1, name: "pipeline-drop", resource: { type: "PipelineArtifact", downloadUrl: url } }] });

  it("fetches a PipelineArtifact from its own host exactly as returned, with no api-version added", async () => {
    const stub = stubAzureFetch([
      { method: "GET", url: ART_URL, respond: artifacts(ARTPROD) },
      { method: "GET", url: ARTPROD, respond: new Response("ZIPDATA", { status: 200 }) },
    ]);
    await pipelinesRunDownload("widgets", 5, { destDir: dir });
    expect(stub.unmatched()).toEqual([]);
    expect(readFileSync(join(dir, "pipeline-drop.zip"), "utf8")).toBe("ZIPDATA");
  });

  it("leaves an earlier download in place when the new one fails", async () => {
    writeFileSync(join(dir, "pipeline-drop.zip"), "OLD");
    stubAzureFetch([
      { method: "GET", url: ART_URL, respond: artifacts(ARTPROD) },
      { method: "GET", url: ARTPROD, respond: new Response("nope", { status: 500 }) },
    ]);
    await expect(pipelinesRunDownload("widgets", 5, { destDir: dir })).rejects.toThrow(/download failed/);
    expect(readFileSync(join(dir, "pipeline-drop.zip"), "utf8")).toBe("OLD");
    expect(readdirSync(dir)).toEqual(["pipeline-drop.zip"]);
  });

  it("fails when no artifact has a download address", async () => {
    stubAzureFetch([{ method: "GET", url: ART_URL, respond: artifacts("") }]);
    await expect(pipelinesRunDownload("widgets", 5, { destDir: dir })).rejects.toThrow(/no downloadable artifacts/);
  });

  it("fails when the run has no artifacts", async () => {
    stubAzureFetch([{ method: "GET", url: ART_URL, respond: azureJson({ count: 0, value: [] }) }]);
    await expect(pipelinesRunDownload("widgets", 5, { destDir: dir })).rejects.toThrow(/no artifacts/);
  });
});

describe("pipelinesRunCancel", () => {
  it("still marks the build cancelling", async () => {
    const stub = stubAzureFetch([{ method: "PATCH", url: `${BUILD}/builds/5?api-version=7.1`, respond: azureJson({ id: 5 }) }]);
    await pipelinesRunCancel("widgets", 5);
    expect(stub.requests[0]?.body).toEqual({ status: "cancelling" });
  });
});
