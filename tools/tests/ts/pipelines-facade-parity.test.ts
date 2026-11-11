// pipelines-facade-parity.test.ts — the pipelines facade honours the same
// flags on both providers. Azure HTTP is mocked by stubbing globalThis.fetch;
// GitHub is mocked with a stub `gh` on PATH. Nothing reaches a backend.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type * as facadeTypes from "../../lib/providers/facade/pipelines.ts";
import { pathWithStubs, rmrf, stubCalls, stubGh, tmpDir } from "./harness/index.ts";

const FACADE = "../../lib/providers/facade/pipelines.ts";
const savedEnv = { ...process.env };
const dirs: string[] = [];
const realFetch = globalThis.fetch;

type Facade = typeof facadeTypes;

async function useProvider(provider: "github" | "azure"): Promise<Facade> {
  const root = tmpDir("pipefacade");
  dirs.push(root);
  writeFileSync(
    join(root, "devenv.config"),
    `[provider]\nname=${provider}\nazure_org=org\nazure_project=proj\n\n[organization]\norg=fixture-org\n`,
  );
  process.env.DEVENV_ROOT = root;
  process.env.AZURE_PAT = "fake-pat-for-test";
  vi.resetModules();
  return (await import(FACADE)) as Facade;
}

interface FetchStub {
  urls: string[];
}

/** Answer Azure build endpoints: one build record, an artifact list, zip bytes. */
function stubAzureFetch(build: Record<string, unknown>, artifactNames: string[] = []): FetchStub {
  const seen: FetchStub = { urls: [] };
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    seen.urls.push(url);
    if (url.includes("/artifacts") && !url.includes("download")) {
      return new Response(
        JSON.stringify({
          value: artifactNames.map((n, i) => ({
            id: i + 1,
            name: n,
            resource: { downloadUrl: `https://dev.azure.com/org/proj/_apis/build/builds/7/artifacts?artifactName=${n}&download=true` },
          })),
        }),
        { status: 200 },
      );
    }
    if (url.includes("download=true")) return new Response(new Uint8Array([1, 2, 3]), { status: 200 });
    if (url.includes("/definitions")) {
      return new Response(JSON.stringify({ value: [{ id: 3, name: "ci", path: "\\", enabled: true }] }), { status: 200 });
    }
    return new Response(JSON.stringify(build), { status: 200 });
  }) as typeof fetch;
  return seen;
}

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
  globalThis.fetch = realFetch;
  vi.restoreAllMocks();
  for (const k of Object.keys(process.env)) if (!(k in savedEnv)) delete process.env[k];
  Object.assign(process.env, savedEnv);
  for (const d of dirs.splice(0)) rmrf(d);
});

describe("pipelinesRunWatch --exit-status", () => {
  const failed = { id: 7, status: "completed", result: "failed", definition: { name: "ci" } };

  it("azure: a failed run returns a non-zero status with the reason", async () => {
    const facade = await useProvider("azure");
    stubAzureFetch(failed);
    const r = await facade.pipelinesRunWatch("org/proj/repo", "7", ["--exit-status"]);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/run 7 concluded failure/);
  });

  it("azure: without --exit-status a failed run still reports status 0", async () => {
    const facade = await useProvider("azure");
    stubAzureFetch(failed);
    const r = await facade.pipelinesRunWatch("org/proj/repo", "7", []);
    expect(r.status).toBe(0);
  });

  it("azure: a succeeded run with --exit-status returns status 0", async () => {
    const facade = await useProvider("azure");
    stubAzureFetch({ ...failed, result: "succeeded" });
    const r = await facade.pipelinesRunWatch("org/proj/repo", "7", ["--exit-status"]);
    expect(r.status).toBe(0);
  });
});

describe("pipelinesRunView JSON on github", () => {
  it("forwards --json and -q to gh run view", async () => {
    const facade = await useProvider("github");
    const bin = tmpDir("pipefacade-bin");
    dirs.push(bin);
    stubGh(bin);
    process.env.PATH = pathWithStubs(bin);
    await facade.pipelinesRunView("o/r", "987", { json: "url", jq: ".url" });
    expect(stubCalls(bin, "gh")).toEqual(["gh run view 987 -R o/r --json url -q .url"]);
  });

  it("without options it stays a plain run view", async () => {
    const facade = await useProvider("github");
    const bin = tmpDir("pipefacade-bin");
    dirs.push(bin);
    stubGh(bin);
    process.env.PATH = pathWithStubs(bin);
    await facade.pipelinesRunView("o/r", "987");
    expect(stubCalls(bin, "gh")).toEqual(["gh run view 987 -R o/r"]);
  });
});

describe("pipelinesRunDownload on azure", () => {
  it("-n NAME -D DIR writes only that artifact into DIR (created when missing)", async () => {
    const facade = await useProvider("azure");
    stubAzureFetch({ id: 7 }, ["a", "b"]);
    const out = join(tmpDir("pipefacade-dl"), "nested", "out");
    dirs.push(join(out, "..", ".."));
    const r = await facade.pipelinesRunDownload("org/proj/repo", "7", ["-n", "a", "-D", out]);
    expect(r.status).toBe(0);
    expect(readdirSync(out)).toEqual(["a.zip"]);
    expect(readFileSync(join(out, "a.zip")).length).toBe(3);
  });

  it("long flags --name/--dir are accepted", async () => {
    const facade = await useProvider("azure");
    stubAzureFetch({ id: 7 }, ["a", "b"]);
    const out = join(tmpDir("pipefacade-dl"), "o");
    dirs.push(join(out, ".."));
    await facade.pipelinesRunDownload("org/proj/repo", "7", ["--name", "b", "--dir", out]);
    expect(readdirSync(out)).toEqual(["b.zip"]);
  });

  it("an unknown flag throws naming it, before any request", async () => {
    const facade = await useProvider("azure");
    const seen = stubAzureFetch({ id: 7 }, ["a"]);
    await expect(facade.pipelinesRunDownload("org/proj/repo", "7", ["--pattern", "x"])).rejects.toThrow(/--pattern/);
    expect(seen.urls).toEqual([]);
  });

  it("a flag missing its value throws", async () => {
    const facade = await useProvider("azure");
    stubAzureFetch({ id: 7 }, ["a"]);
    await expect(facade.pipelinesRunDownload("org/proj/repo", "7", ["-n"])).rejects.toThrow(/requires a value/);
  });

  it("a name that matches nothing is a named error and writes no file", async () => {
    const facade = await useProvider("azure");
    stubAzureFetch({ id: 7 }, ["a"]);
    const out = join(tmpDir("pipefacade-dl"), "none");
    dirs.push(join(out, ".."));
    await expect(facade.pipelinesRunDownload("org/proj/repo", "7", ["-n", "zzz", "-D", out])).rejects.toThrow(/artifact 'zzz' not found/);
    expect(existsSync(out)).toBe(true);
    expect(readdirSync(out)).toEqual([]);
    mkdirSync(out, { recursive: true });
  });
});

describe("pipelinesWorkflowList on azure", () => {
  it("--json FIELDS projects the requested fields", async () => {
    const facade = await useProvider("azure");
    stubAzureFetch({});
    const out = await facade.pipelinesWorkflowList("org/proj/repo", ["--json", "id,name"]);
    expect(JSON.parse(out)).toEqual([{ id: "3", name: "ci" }]);
  });

  it("--json with --jq applies the projection program", async () => {
    const facade = await useProvider("azure");
    stubAzureFetch({});
    const out = await facade.pipelinesWorkflowList("org/proj/repo", ["--json", "name", "-q", ".[].name"]);
    expect(out).toBe("ci");
  });

  it("an unsupported flag is rejected by name", async () => {
    const facade = await useProvider("azure");
    stubAzureFetch({});
    await expect(facade.pipelinesWorkflowList("org/proj/repo", ["--all"])).rejects.toThrow(/--all/);
  });
});
