// End-to-end tests for artifacts-list under the Azure provider: the tool runs
// as a node child with `fetch` replaced by a routed stub (harness/azure-fetch-
// preload.ts), so nothing reaches the network.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { runTool, tmpDir, tmpStubBin, stubGit, pathWithStubs, rmrf } from "./harness/index.ts";
import { canaryEnv } from "./harness/canary.ts";

const FETCH_PRELOAD = fileURLToPath(new URL("./harness/azure-fetch-preload.ts", import.meta.url));
const FEEDS_HOST = "https://feeds\\.dev\\.azure\\.com/test-org";

let root = "";
let stubDir = "";

const UTIL = {
  id: "p1",
  name: "OMSNIC.Lib.Util",
  normalizedName: "omsnic.lib.util",
  protocolType: "NuGet",
  url: "https://feeds.dev.azure.com/test-org/_apis/Packaging/Feeds/f-org/Packages/p1",
  versions: [{ version: "2.0.0", publishDate: "2026-11-27T18:14:20Z", isLatest: true }],
};

function run(args: string[], packagesStatus = 200): { status: number; output: string } {
  const routesFile = join(root, "routes.json");
  writeFileSync(
    routesFile,
    JSON.stringify([
      { method: "GET", url: `${FEEDS_HOST}/_apis/packaging/feeds\\?`, body: { value: [{ name: "org-feed", id: "f-org", url: "https://feeds.dev.azure.com/test-org/_apis/packaging/Feeds/f-org" }] } },
      { method: "GET", url: `${FEEDS_HOST}/test-project/_apis/packaging/feeds\\?`, body: { value: [] } },
      { method: "GET", url: "/Feeds/f-org/packages\\?", status: packagesStatus, body: packagesStatus === 200 ? { value: [UTIL] } : { message: "denied" } },
    ]),
  );
  const base = canaryEnv();
  const r = runTool("artifacts-list", args, {
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

describe("artifacts-list (azure provider)", () => {
  beforeEach(() => {
    root = tmpDir("al-azure");
    stubDir = tmpStubBin("al-azure-bin");
    stubGit(stubDir, root);
    writeFileSync(
      join(root, "devenv.config"),
      "[provider]\nname=azure\nazure_org=test-org\nazure_project=test-project\n\n[organization]\norg=test-org\n",
    );
  });

  afterEach(() => {
    rmrf(root);
    rmrf(stubDir);
  });

  it("finds a package held by an organization-level feed", () => {
    const r = run(["--type", "nuget", "--name", "OMSNIC.Lib.Util"]);
    expect(r.status, r.output).toBe(0);
    expect(r.output).toContain("OMSNIC.Lib.Util");
  });

  it("--versions lists the published versions", () => {
    const r = run(["--type", "nuget", "--name", "OMSNIC.Lib.Util", "--versions"]);
    expect(r.status, r.output).toBe(0);
    expect(r.output).toContain("2.0.0");
  });

  it("a refused feed call exits with the API-failure code and names the Packaging scope", () => {
    const r = run(["--type", "nuget"], 403);
    expect(r.status).toBe(4);
    expect(r.output).toContain("Packaging (Read) scope");
  });

  it("--repo is refused on Azure by name", () => {
    const r = run(["--repo", "widgets"]);
    expect(r.status).toBe(4);
    expect(r.output).toContain("not supported on provider 'azure'");
  });
});
