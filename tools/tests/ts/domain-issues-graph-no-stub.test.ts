// The graph reads and writes with default roots (no override, no generated
// depth-1 stubs): the status read runs in-process through the provider
// facade and the status write runs the sibling tool from this checkout.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { onEvent, readStatus, writeStatus } from "../../lib/domain/issues/graph.ts";
import { pathWithStubs, stubGh, tmpDir, CALLS_LOG_NAME } from "./harness/index.ts";

let stubDir = "";
const saved: Record<string, string | undefined> = {};

function setEnv(k: string, v: string | undefined): void {
  if (!(k in saved)) saved[k] = process.env[k];
  if (v === undefined) delete process.env[k];
  else process.env[k] = v;
}

const PROJECT_ITEMS = JSON.stringify({
  data: {
    resource: {
      projectItems: {
        pageInfo: { hasNextPage: false },
        nodes: [
          {
            project: { title: "Board", number: 3, owner: { login: "org" } },
            fieldValues: {
              pageInfo: { hasNextPage: false },
              nodes: [{ __typename: "ProjectV2ItemFieldSingleSelectValue", name: "Ready", field: { name: "Status" } }],
            },
          },
        ],
      },
    },
  },
});

/** gh stub: logs every call; answers the project-items query with one card. */
function installGh(items: string): void {
  stubGh(
    stubDir,
    [
      "#!/usr/bin/env bash",
      'if [ "$1" = "auth" ] && [ "$2" = "status" ]; then exit 0; fi',
      `printf '%s\\n' "gh $*" >> "${join(stubDir, CALLS_LOG_NAME)}"`,
      'case "$*" in',
      `  *projectItems*) printf '%s' '${items}' ;;`,
      "esac",
      "exit 0",
    ].join("\n"),
  );
}

function ghLog(): string {
  const f = join(stubDir, CALLS_LOG_NAME);
  return existsSync(f) ? readFileSync(f, "utf8") : "";
}

beforeEach(() => {
  stubDir = tmpDir("grnostub");
  setEnv("PATH", pathWithStubs(stubDir));
  setEnv("DEVENV_REPO", "org/repo");
  setEnv("ISSUE_GRAPH_TOOLS", undefined);
  setEnv("WORKFLOW_CORE_TOOLS", undefined);
  installGh(PROJECT_ITEMS);
});

afterEach(() => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  rmSync(stubDir, { recursive: true, force: true });
});

describe("domain/issues/graph without generated stubs", () => {
  it("readStatus returns the card's status through the provider facade", async () => {
    expect(await readStatus(42)).toBe("Ready");
    expect(ghLog()).toContain("projectItems");
    expect(ghLog()).toContain("https://github.com/org/repo/issues/42");
  });

  it("writeStatus runs the sibling project-update-issue from this checkout", async () => {
    // The issue is on no board: the sibling's --safe fan-out reports success,
    // which is only reachable if the sibling actually ran and queried it.
    installGh(JSON.stringify({ data: { resource: { projectItems: { nodes: [] } } } }));
    const warnings: string[] = [];
    const ok = await writeStatus(42, "Ready", { onWarning: (m) => warnings.push(m) }, "suppress");
    expect(warnings).toEqual([]);
    expect(ok).toBe(true);
    expect(ghLog()).toContain("projectItems");
  });

  it("onEvent resolves and writes through the same default path", async () => {
    installGh(JSON.stringify({ data: { resource: { projectItems: { nodes: [] } } } }));
    const ctx = { onWarning: () => {} } as { onWarning: () => void; failed?: boolean };
    await onEvent("_on_begin_grooming", 42, ctx);
    expect(ctx.failed).not.toBe(true);
    expect(ghLog()).toContain("projectItems");
  });
});

