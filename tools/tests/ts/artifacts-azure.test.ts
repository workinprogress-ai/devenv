// Artifact comments on an Azure config: Azure stores a plan's header as bare
// key lines (it strips HTML comments), so the provider hands the comments back
// in marker form and the artifact readers, which only know the marker form,
// find them. The transport is a stubbed fetch; nothing reaches the network.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { azureJson, stubAzureFetch } from "./harness/azure-stub.ts";
import { rmrf, tmpDir } from "./harness/index.ts";
import { azureMarkerTransform } from "../../lib/providers/azure/entity-roundtrip.ts";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const ROOT = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))));
const PLAN_PARSE = join(ROOT, "tools", "ts", "plan-parse.ts");
const COMMENTS = /\/workitems\/101986\/comments\?/;
const DOC_ID = "dv1:acme/claims:local:plan:issue-101986-001";

const PLAN = [
  "<!-- DEVENV_ARTIFACT_V1",
  `doc_id: ${DOC_ID}`,
  "artifact_type: plan",
  "artifact_scope: local-file",
  "issue_number: 101986",
  "planning_repo: acme/planning",
  "source_file: .local-artifacts/Plan-issue-101986-001.md",
  "updated_at_utc: 2026-11-19T00:00:00Z",
  "commit_alignment: commit-free",
  "-->",
  "",
  "# Plan title",
  "",
  "## Phases",
  "",
  "### Phase 1 — Only phase",
  "",
  "- [ ] **1.1 [S] A task**",
].join("\n");

let root = "";

function comment(id: number, text: string, modified = "2026-11-19T12:00:00Z") {
  return { id, text, createdBy: { displayName: "Dev" }, createdDate: modified, modifiedDate: modified };
}

beforeEach(() => {
  root = tmpDir("artifacts-azure");
  writeFileSync(join(root, "devenv.config"), "[provider]\nname=azure\n\n[organization]\norg=test-org\n");
  process.env.DEVENV_ROOT = root;
  process.env.AZURE_DEVOPS_ORG = "test-org";
  process.env.AZURE_DEVOPS_PROJECT = "test-project";
  process.env.AZURE_PAT = "test-pat";
  process.env.DEVENV_REPO = "test-project/claims";
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllGlobals();
  rmrf(root);
  for (const k of ["DEVENV_ROOT", "AZURE_DEVOPS_ORG", "AZURE_DEVOPS_PROJECT", "AZURE_PAT", "DEVENV_REPO"]) delete process.env[k];
});

describe("artifact comments stored by Azure", () => {
  it("listArtifacts finds a plan stored with a bare header, with its header fields", async () => {
    stubAzureFetch([{ method: "GET", url: COMMENTS, respond: azureJson({ comments: [comment(1, azureMarkerTransform(PLAN))] }) }]);
    const artifacts = await import("../../lib/domain/artifacts.ts");
    const found = await artifacts.listArtifacts("test-project/claims", 101986, "plan");
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({
      doc_id: DOC_ID,
      artifact_type: "plan",
      source_file: ".local-artifacts/Plan-issue-101986-001.md",
      title: "Plan title",
    });
    expect(artifacts.headerField(String(found[0]?.body), "planning_repo")).toBe("acme/planning");
  });

  it("a comment without a header is not an artifact and an ordinary comment is returned untouched", async () => {
    stubAzureFetch([
      {
        method: "GET",
        url: COMMENTS,
        respond: azureJson({ comments: [comment(1, "Status: open\n\nJust a note."), comment(2, azureMarkerTransform(PLAN))] }),
      },
    ]);
    const artifacts = await import("../../lib/domain/artifacts.ts");
    const all = await artifacts.fetchIssueComments("test-project/claims", 101986);
    expect(all.find((c) => c.body === "Status: open\n\nJust a note.")).toBeDefined();
    expect(await artifacts.listArtifacts("test-project/claims", 101986, "plan")).toHaveLength(1);
  });

  it("two comments carrying one doc_id both surface, so select/get can report the conflict", async () => {
    stubAzureFetch([
      {
        method: "GET",
        url: COMMENTS,
        respond: azureJson({
          comments: [comment(1, azureMarkerTransform(PLAN), "2026-11-10T12:00:00Z"), comment(2, azureMarkerTransform(PLAN), "2026-11-19T12:00:00Z")],
        }),
      },
    ]);
    const artifacts = await import("../../lib/domain/artifacts.ts");
    const found = await artifacts.listArtifacts("test-project/claims", 101986, "plan");
    expect(found.map((a) => a.doc_id)).toEqual([DOC_ID, DOC_ID]);
  });

  it("a header stored with six keys (before every key was kept) is still found", async () => {
    const six = [
      "artifact_type: plan",
      `doc_id: ${DOC_ID}`,
      "issue_number: 101986",
      "planning_repo: acme/planning",
      "source_file: .local-artifacts/Plan-issue-101986-001.md",
      "updated_at_utc: 2026-11-19T00:00:00Z",
      "",
      "# Plan title",
    ].join("\n");
    stubAzureFetch([{ method: "GET", url: COMMENTS, respond: azureJson({ comments: [comment(1, six)] }) }]);
    const artifacts = await import("../../lib/domain/artifacts.ts");
    expect(await artifacts.listArtifacts("test-project/claims", 101986, "plan")).toHaveLength(1);
  });

  it("a plan fetched from Azure passes the pre-upsert lint gate (header, every key kept)", async () => {
    stubAzureFetch([{ method: "GET", url: COMMENTS, respond: azureJson({ comments: [comment(1, azureMarkerTransform(PLAN))] }) }]);
    const artifacts = await import("../../lib/domain/artifacts.ts");
    const [found] = await artifacts.listArtifacts("test-project/claims", 101986, "plan");
    const fetched = String(found?.body);
    expect(fetched).toBe(PLAN);
    const file = join(root, "Plan-issue-101986-001.md");
    writeFileSync(file, fetched);
    const r = spawnSync("node", [PLAN_PARSE, file, "--lint", "--require-header"], { encoding: "utf8" });
    expect(r.status).toBe(0);
    expect(JSON.parse(r.stdout)).toMatchObject({ ok: true, errors: [] });
  });
});
