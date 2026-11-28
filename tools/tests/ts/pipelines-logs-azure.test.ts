// End-to-end tests for pipelines-logs under the Azure provider: the tool runs
// as a node child with `fetch` replaced by a routed stub (harness/azure-fetch-
// preload.ts), so nothing reaches the network.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { runTool, tmpDir, tmpStubBin, stubGit, pathWithStubs, rmrf } from "./harness/index.ts";
import { canaryEnv } from "./harness/canary.ts";
import { EXIT_API_FAILURE } from "../../lib/core/exit-codes.ts";

const FETCH_PRELOAD = fileURLToPath(new URL("./harness/azure-fetch-preload.ts", import.meta.url));
const BUILD = "https://dev\\.azure\\.com/test-org/test-project/_apis/build";

let root = "";
let stubDir = "";

function run(args: string[]): { status: number; output: string } {
  const routesFile = join(root, "routes.json");
  writeFileSync(
    routesFile,
    JSON.stringify([
      { method: "GET", url: `${BUILD}/builds/5/timeline`, body: { records: [{ name: "Install .NET SDK", order: 1, log: { id: 3 } }] } },
      { method: "GET", url: `${BUILD}/builds/5/logs/3`, body: "Installed SDK 11.0.100\n" },
    ]),
  );
  const base = canaryEnv();
  const r = runTool("pipelines-logs", args, {
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

describe("pipelines-logs (azure provider)", () => {
  beforeEach(() => {
    root = tmpDir("pl-azure");
    stubDir = tmpStubBin("pl-azure-bin");
    stubGit(stubDir, root);
    writeFileSync(join(root, "devenv.config"), "[provider]\nname=azure\nazure_org=test-org\nazure_project=test-project\n");
  });

  afterEach(() => {
    rmrf(root);
    rmrf(stubDir);
  });

  it("prints a finished run's step log under its step name", () => {
    const r = run(["5", "--repo", "test-project/widgets"]);
    expect(r.status, r.output).toBe(0);
    expect(r.output).toContain("===== Install .NET SDK =====");
    expect(r.output).toContain("Installed SDK 11.0.100");
  });

  it("an unknown step exits with the API-failure code and lists the steps", () => {
    const r = run(["5", "--repo", "test-project/widgets", "--step", "Deploy"]);
    expect(r.status).toBe(EXIT_API_FAILURE);
    expect(r.output).toContain("steps with logs: Install .NET SDK");
  });
});
