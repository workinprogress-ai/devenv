// End-to-end tests for pipelines-artifacts under the Azure provider: the tool
// runs as a node child with `fetch` replaced by a routed stub (harness/azure-
// fetch-preload.ts), so nothing reaches the network.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { runTool, tmpDir, tmpStubBin, stubGit, pathWithStubs, rmrf } from "./harness/index.ts";
import { canaryEnv } from "./harness/canary.ts";

const FETCH_PRELOAD = fileURLToPath(new URL("./harness/azure-fetch-preload.ts", import.meta.url));
const BUILD = "https://dev\\.azure\\.com/test-org/test-project/_apis/build";

let root = "";
let stubDir = "";

function run(args: string[], artifacts: unknown[]): { status: number; output: string } {
  const routesFile = join(root, "routes.json");
  writeFileSync(
    routesFile,
    JSON.stringify([{ method: "GET", url: `${BUILD}/builds/5/artifacts`, body: { count: artifacts.length, value: artifacts } }]),
  );
  const base = canaryEnv();
  const r = runTool("pipelines-artifacts", args, {
    cwd: root,
    env: {
      ...base,
      PATH: pathWithStubs(stubDir),
      NODE_OPTIONS: `${base["NODE_OPTIONS"] ?? ""} --import ${FETCH_PRELOAD}`.trim(),
      AZURE_STUB_ROUTES: routesFile,
      DEVENV_ROOT: root,
      AZURE_DEVOPS_ORG: "test-org",
      AZURE_DEVOPS_PROJECT: "test-project",
      AZURE_PAT: "test-pat",
      WORKFLOW_CORE_TOOLS: "/nonexistent-workflow-tools",
    },
  });
  return { status: r.status, output: r.output };
}

describe("pipelines-artifacts (azure provider)", () => {
  beforeEach(() => {
    root = tmpDir("pa-azure");
    stubDir = tmpStubBin("pa-azure-bin");
    stubGit(stubDir, root);
    writeFileSync(join(root, "devenv.config"), "[provider]\nname=azure\nazure_org=test-org\nazure_project=test-project\n");
  });

  afterEach(() => {
    rmrf(root);
    rmrf(stubDir);
  });

  it("a run with no artifacts reports that and exits 0", () => {
    const r = run(["5", "--repo", "test-project/widgets", "--json"], []);
    expect(r.status, r.output).toBe(0);
    expect(r.output).toContain("No artifacts found for run 5");
    expect(r.output).not.toContain("Unexpected end of JSON input");
  });

  it("a run with one artifact lists it as a JSON array", () => {
    const r = run(["5", "--repo", "test-project/widgets", "--json"], [
      { id: 1, name: "drop", resource: { properties: { artifactsize: "10" }, downloadUrl: "u" } },
    ]);
    expect(r.status, r.output).toBe(0);
    const json = JSON.parse(r.output.split("\n").find((l) => l.startsWith("[")) ?? "") as Array<{ name: string; size_in_bytes: number }>;
    expect(json).toEqual([expect.objectContaining({ name: "drop", size_in_bytes: 10 })]);
  });
});
