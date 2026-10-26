// Behavioral port of the fan-out semantics tests (test_fanout_semantics.bats):
// updateStatusAllProjects' contract driven through the real tool with a
// scenario-controlled gh stub — zero membership strict/safe, lookup failure
// strict/safe, single-project write, idempotent skip, all-fail, partial.
// The stub answers the exact GraphQL shapes projectsForIssue /
// projectsItemIdForIssue / projectsFieldSet issue (resource.projectItems,
// projectV2(number:), updateProjectV2ItemFieldValue).
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const TOOL = join(fileURLToPath(new URL(".", import.meta.url)), "../../ts/project-update-issue.ts");

let stubDir = "";
let sandbox = "";

interface Row {
  title: string;
  number: string;
  status: string;
}

function row(status: Row["status"], number: string, title: string): Row {
  return { status, number, title };
}

function graph(rows: Row[]): string {
  return JSON.stringify({
    data: {
      resource: {
        projectItems: {
          pageInfo: { hasNextPage: false },
          nodes: rows.map((r) => ({
            project: { id: `PVT_${r.number}`, number: Number(r.number), title: r.title, owner: { login: "test-org" } },
            fieldValues: {
              pageInfo: { hasNextPage: false },
              nodes:
                r.status === "-"
                  ? [{ __typename: "ProjectV2ItemFieldIterationValue" }]
                  : [{ __typename: "ProjectV2ItemFieldSingleSelectValue", name: r.status, field: { name: "Status" } }],
            },
          })),
        },
      },
    },
  });
}

let LOOKUP_MODE = "ok";
let LOOKUP_PAYLOAD = "[]";
// Written into the stub at runTool time; scenario tests overwrite it.
let EXTRA_STUB: string[] = [];

function writeStub(): void {
  const lines = [
    "#!/usr/bin/env bash",
    'if [ "$1 $2" = "auth status" ]; then exit 0; fi',
    'case "$*" in',
    '  *"issue view"*) echo "https://example.test/issues/44"; exit 0;;',
    '  *"api graphql"*)',
    '    if [[ "$*" == *"resource(url"* ]]; then',
    LOOKUP_MODE === "fail"
      ? '      echo "lookup boom" >&2; exit 1'
      : `      echo '${LOOKUP_PAYLOAD}'; exit 0`,
    '    fi',
    '    if [[ "$*" == *"items(first"* ]]; then',
    '      printf \'false \\nPVTI_x\\n\'; exit 0',
    '    fi',
    '    if [[ "$*" == *"ProjectV2SingleSelectField"* ]]; then',
    '      echo \'{"data":{"node":{"field":{"id":"PVTF_status","options":[{"id":"OPT_tbd","name":"TBD"},{"id":"OPT_groom","name":"To-Groom"},{"id":"OPT_ready","name":"Ready"},{"id":"OPT_impl","name":"Implementing"},{"id":"OPT_review","name":"Review"},{"id":"OPT_merged","name":"Merged"},{"id":"OPT_staging","name":"Staging"},{"id":"OPT_prod","name":"Production"}]}}}}\'; exit 0',
    '    fi',
    '    if [[ "$*" == *"projectV2(number"* ]]; then',
    '      case "$*" in',
    '        *"-F n=1"*) echo "PVT_1"; exit 0;;',
    '        *"-F n=2"*) echo "PVT_2"; exit 0;;',
    '        *) echo "null"; exit 0;;',
    "      esac",
    "    fi",
    ...(EXTRA_STUB.length > 0 ? EXTRA_STUB : [
      '    echo \'{"data":{"updateProjectV2ItemFieldValue":{"projectV2Item":{"id":"PVTI_x"}}}}\'',
      "    exit 0",
    ]),
    '    ;;',
    '  *) ;;',
    "esac",
    "exit 0",
    "",
  ];
  writeFileSync(join(stubDir, "gh"), lines.join("\n"), { mode: 0o755 });
}

beforeEach(() => {
  stubDir = mkdtempSync(join(tmpdir(), "fanout-stub-"));
  sandbox = mkdtempSync(join(tmpdir(), "fanout-cfg-"));
  writeFileSync(
    join(sandbox, "devenv.config"),
    "[organization]\norg=test-org\n[workflows]\nstatus_workflow=TBD,To-Groom,Ready,Implementing,Review,Merged,Staging,Production\n",
  );
  LOOKUP_MODE = "ok";
  LOOKUP_PAYLOAD = "[]";
  EXTRA_STUB = [];
});

afterEach(() => {
  if (process.env.KEEP_STUB) return;
  rmSync(stubDir, { recursive: true, force: true });
  rmSync(sandbox, { recursive: true, force: true });
});

function runTool(args: string[]): { status: number; output: string } {
  writeStub();
  const r = spawnSync("node", [TOOL, ...args], {
    encoding: "utf8",
    input: "",
    cwd: sandbox,
    env: {
      ...process.env,
      PATH: `${stubDir}:${process.env.PATH ?? ""}`,
      DEVENV_ROOT: sandbox,
      DEVENV_REPO: "test-org/test-repo",
      GH_ORG: process.env.GH_ORG,
    },
  });
  const stdout = r.stdout ?? "";
  const stderr = r.stderr ?? "";
  return { status: r.status ?? 1, output: stdout + stderr };
}

describe("project-update-issue fan-out semantics", () => {
  it("zero membership + strict -> rc 1 with guidance", () => {
    LOOKUP_PAYLOAD = graph([]);
    const r = runTool(["44", "--all-projects", "--status", "Ready"]);
    expect(r.status).toBe(1);
    expect(r.output).toContain("no projects");
    expect(r.output).toContain("--safe");
  });

  it("zero membership + --safe -> rc 0 no-op", () => {
    LOOKUP_PAYLOAD = graph([]);
    const r = runTool(["44", "--all-projects", "--status", "Ready", "--safe"]);
    expect(r.status).toBe(0);
    expect(r.output).toContain("nothing to update");
  });

  it("lookup failure + strict -> rc 1 (distinct from empty)", () => {
    LOOKUP_MODE = "fail";
    const r = runTool(["44", "--all-projects", "--status", "Ready"]);
    expect(r.status).toBe(1);
    expect(r.output).toContain("lookup failed");
  });

  it("lookup failure + --safe -> rc 1 (reports, never lies)", () => {
    LOOKUP_MODE = "fail";
    const r = runTool(["44", "--all-projects", "--status", "Ready", "--safe"]);
    expect(r.status).toBe(1);
    expect(r.output).toContain("never lies");
  });

  it("single project, write succeeds -> rc 0", () => {
    LOOKUP_PAYLOAD = graph([row("TBD", "1", "Alpha")]);
    const r = runTool(["44", "--all-projects", "--status", "Ready"]);
    expect(r.status).toBe(0);
    expect(r.output).toContain("Status='Ready'");
  });

  it("same-status project is an idempotent no-write success", () => {
    LOOKUP_PAYLOAD = graph([row("Ready", "1", "Alpha")]);
    const r = runTool(["44", "--all-projects", "--status", "Ready"]);
    expect(r.status).toBe(0);
    expect(r.output).toContain("idempotent");
  });

  it("all projects fail -> rc 1 (updated=0)", () => {
    LOOKUP_PAYLOAD = graph([row("TBD", "1", "Alpha")]);
    // Every non-lookup graphql call fails: the projectV2(number) resolution
    // inside updateStatus errors, so the write path fails for the only row.
    EXTRA_STUB = [
      '    echo "update-path boom" >&2; exit 1',
    ];
    const r = runTool(["44", "--all-projects", "--status", "Ready"]);
    expect(r.status).toBe(1);
    expect(r.output).toContain("No project updated");
  });

  it("one of two fails -> rc 0 with partial warning", () => {
    LOOKUP_PAYLOAD = graph([row("TBD", "1", "Alpha"), row("TBD", "2", "Beta")]);
    EXTRA_STUB = [
      '    if [[ "$*" == *"updateProjectV2ItemFieldValue"* && "$*" == *"PVT_2"* ]]; then echo "proj2 boom" >&2; exit 1; fi',
      '    echo \'{"data":{"updateProjectV2ItemFieldValue":{"projectV2Item":{"id":"PVTI_x"}}}}\'',
      "    exit 0",
    ];
    const r = runTool(["44", "--all-projects", "--status", "Ready"]);
    expect(r.status).toBe(0);
    expect(r.output).toContain("Partial");
  });
});
