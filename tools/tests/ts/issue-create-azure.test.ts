// End-to-end tests for issue-create under the Azure provider: the tool runs as
// a node child with `fetch` replaced by a routed stub (harness/azure-fetch-
// preload.ts), so every request the create path makes is observable and
// nothing reaches the network.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { runTool, tmpDir, tmpStubBin, stubGit, pathWithStubs, rmrf } from "./harness/index.ts";
import { canaryEnv } from "./harness/canary.ts";

const FETCH_PRELOAD = fileURLToPath(new URL("./harness/azure-fetch-preload.ts", import.meta.url));
const WIT = "https://dev\\.azure\\.com/test-org/test-project/_apis/wit";

interface Route {
  method?: string;
  url: string;
  status?: number;
  body?: unknown;
}

let root = "";
let stubDir = "";

const CREATED_FIELDS = { "System.Rev": 1, "System.ChangedDate": "2026-01-01T00:00:00Z" };

/** Routes every create-path request needs: the repository probe, the type
 * probe, the POST, and the read-back of the created item. */
function createRoutes(): Route[] {
  return [
    { method: "GET", url: "/_apis/git/repositories/", body: { id: "r1", name: "planning" } },
    { method: "GET", url: `${WIT}/workitemtypes/[^/?]+\\?`, body: { name: "probed" } },
    { method: "POST", url: `${WIT}/workitems/\\$`, body: { id: 4821, rev: 1, fields: CREATED_FIELDS } },
    { method: "GET", url: `${WIT}/workitems/4821\\?`, body: { id: 4821, rev: 1, fields: CREATED_FIELDS } },
  ];
}

const TYPED_CREATE = ["--no-interactive", "--no-template", "--type", "Feature", "--title", "T", "--body", "b"];

function run(
  args: string[],
  opts: { repo?: string; routes?: Route[] } = {},
): { status: number; output: string; requests: string[]; bodies: string[] } {
  const log = join(root, "requests.log");
  const bodyLog = join(root, "bodies.log");
  const routesFile = join(root, "routes.json");
  writeFileSync(routesFile, JSON.stringify(opts.routes ?? createRoutes()));
  const base = canaryEnv();
  const path = pathWithStubs(stubDir);
  const r = runTool("issue-create", args, {
    cwd: root,
    env: {
      ...base,
      PATH: path,
      NODE_OPTIONS: `${base["NODE_OPTIONS"] ?? ""} --import ${FETCH_PRELOAD}`.trim(),
      AZURE_STUB_LOG: log,
      AZURE_STUB_BODY_LOG: bodyLog,
      AZURE_STUB_ROUTES: routesFile,
      DEVENV_ROOT: root,
      DEVENV_REPO: opts.repo ?? "test-project/planning",
      AZURE_DEVOPS_ORG: "test-org",
      AZURE_DEVOPS_PROJECT: "test-project",
      AZURE_PAT: "test-pat",
      WORKFLOW_CORE_TOOLS: "/nonexistent-workflow-tools",
    },
  });
  const lines = (file: string): string[] => (existsSync(file) ? readFileSync(file, "utf8").split("\n").filter(Boolean) : []);
  return { status: r.status, output: r.output, requests: lines(log), bodies: lines(bodyLog) };
}

describe("issue-create (azure provider)", () => {
  beforeEach(() => {
    root = tmpDir("icx-azure");
    stubDir = tmpStubBin("icx-azure-bin");
    stubGit(stubDir, root);
    writeFileSync(
      join(root, "devenv.config"),
      "[provider]\nname=azure\nazure_org=test-org\nazure_project=test-project\n",
    );
  });

  afterEach(() => {
    rmrf(root);
    rmrf(stubDir);
  });

  it("a typed create posts to the requested work item type and makes no follow-up type change", () => {
    const r = run(TYPED_CREATE);
    expect(r.status, r.output).toBe(0);
    const posts = r.requests.filter((l) => l.startsWith("POST "));
    expect(posts).toHaveLength(1);
    expect(posts[0]).toMatch(/\/workitems\/\$Feature\?/);
    expect(r.requests.some((l) => l.startsWith("PATCH "))).toBe(false);
    // Only the create's own availability probe: the type is probed once.
    expect(r.requests.filter((l) => /\/workitemtypes\//.test(l))).toHaveLength(1);
  });

  it("a typed create writes the body to the field configured for that type", () => {
    writeFileSync(
      join(root, "devenv.config"),
      "[provider]\nname=azure\nazure_org=test-org\nazure_project=test-project\n\n[azure_body_fields]\nFeature=Microsoft.VSTS.Common.AcceptanceCriteria\n",
    );
    const r = run(TYPED_CREATE);
    expect(r.status, r.output).toBe(0);
    const post = r.bodies.find((l) => l.startsWith("POST "));
    expect(post).toContain('"path":"/fields/Microsoft.VSTS.Common.AcceptanceCriteria"');
    expect(post).not.toContain('"path":"/fields/System.Description"');
  });

  it("a create against a disabled type fails before the POST, naming the config key", () => {
    const routes = createRoutes().map((r) =>
      r.url.includes("workitemtypes") ? { ...r, body: { name: "Feature", isDisabled: true } } : r,
    );
    const r = run(TYPED_CREATE, { routes });
    expect(r.status).not.toBe(0);
    expect(r.output).toContain("'feature=<enabled Azure type>' under [azure_issue_types]");
    expect(r.requests.some((l) => l.startsWith("POST "))).toBe(false);
  });

  it("a URL-form DEVENV_REPO is refused before any request, naming the spec forms", () => {
    const r = run(TYPED_CREATE, { repo: "https://dev.azure.com/test-org/test-project/_git/planning" });
    expect(r.status).not.toBe(0);
    expect(r.output).toContain("DEVENV_REPO 'https://dev.azure.com/test-org/test-project/_git/planning' is a URL");
    expect(r.output).toContain("project/repo (Azure DevOps)");
    expect(r.requests).toEqual([]);
  });
});
