// graph.ts — native sub-issue hierarchy reads + body-text parent resolution
// (port of issue-graph.bash).
//
// All I/O lives here (and in the provider facade it calls); the workflow
// module stays policy-only by calling THESE helpers.
//
// API shapes (live-verified against GitHub):
//   node IDs:  repository(owner,name){ issue(number){ id } }
//   link:      addSubIssue(input:{issueId, subIssueId})
//   children:  repository(owner,name){ issue(number){ subIssues(first:50) } }
//   parent:    repository(owner,name){ issue(number){ parent{ number } } }
//
// Parent resolution reads the native sub-issue graph FIRST (Issue.parent is
// live-verified to reflect addSubIssue linkage); the 'Part of #N' body text
// is the fallback for issues without native linking. Keep the fallback:
// existing subtrees may rely on it. Removing the body-text line on such an
// issue silently stops parent rollup for that subtree.
//
// Headless (D3): returns data, never prompts; the status read shells to the
// project-list-for-issue wrapper (the board fan-out choke point) with an
// explicit override when DEVENV_REPO is unset — same rule as the status
// write.

import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { configGetArray } from "../../core/config.ts";
import { providerRepoTarget } from "../../providers/provider-core.ts";
import { issueGraphLink, issueGraphUnlink, issueGraphChildren, issueGraphParent, issuesView } from "../../providers/github/issues.ts";

export {
  issueGraphLink as linkSubissue,
  issueGraphUnlink as unlinkSubissue,
  issueGraphChildren as children,
};

/** The workflow status vocabulary from devenv.config [workflows]. */
export function workflowOrder(devenvRoot?: string): string[] {
  const override = process.env["WORKFLOW_ORDER_OVERRIDE"];
  if (override !== undefined && override !== "") {
    return override.split(",").map((t) => t.trim()).filter((t) => t !== "");
  }
  // An empty DEVENV_ROOT (set-but-blank) falls through to the default leg,
  // same as unset.
  const root = devenvRoot ?? (process.env["DEVENV_ROOT"] !== undefined && process.env["DEVENV_ROOT"] !== "" ? process.env["DEVENV_ROOT"] : defaultRoot());
  return configGetArray(join(root, "devenv.config"), "workflows", "status_workflow");
}

/** graph.ts lives at tools/lib/domain/issues/graph.ts: URL resolution pops
 * the filename first, so four `../` segments land on the repo root — the
 * directory holding devenv.config. */
function defaultRoot(): string {
  return fileURLToPath(new URL("../../../..", import.meta.url));
}

/**
 * Resolve an issue's parent: native sub-issue linkage first, 'Part of #N'
 * body text as fallback for issues without native linking. null when no
 * parent is recorded either way.
 */
export async function parent(spec: string | undefined, issue: number): Promise<number | null> {
  const native = await issueGraphParent(spec, issue).catch(() => null);
  if (native !== null) return native;
  // Body-text fallback: the first 'Part of #N' line, if any. View failures
  // read as "no parent recorded" (same as the bash `|| return 0`).
  const body = await issuesView(spec, issue, { json: "body", jq: ".body" }).catch(() => "");
  const m = /^Part of #([0-9]+)/m.exec(body);
  return m?.[1] !== undefined ? Number.parseInt(m[1], 10) : null;
}

export interface ProjectStatusRow {
  project: string;
  number: string;
  status: string;
}

/**
 * Read an issue's current Status from the project cards: the first project
 * whose Status is inside the configured vocabulary wins (dash/unset and
 * foreign values read as unknown). null when unknown.
 */
export async function readStatus(
  issue: number,
  opts: { toolsRoot?: string; devenvRoot?: string; rows?: ProjectStatusRow[] } = {},
): Promise<string | null> {
  const vocab = workflowOrder(opts.devenvRoot);
  const inVocab = (token: string): boolean => vocab.includes(token);
  let rows: ProjectStatusRow[];
  if (opts.rows !== undefined) {
    rows = opts.rows;
  } else {
    rows = await listForIssue(issue, opts.toolsRoot);
  }
  for (const row of rows) {
    if (row.status !== "" && row.status !== "-" && inVocab(row.status)) {
      return row.status;
    }
  }
  return null;
}

/** Shell to the project-list-for-issue wrapper (tab-separated rows). */
async function listForIssue(issue: number, toolsRoot?: string): Promise<ProjectStatusRow[]> {
  const root = (toolsRoot ?? process.env["ISSUE_GRAPH_TOOLS"] ?? fileURLToPath(new URL("../../../..", import.meta.url))).replace(/\/$/, "");
  const wrapper = `${root.replace(/\/$/, "")}/project-list-for-issue`;
  const override = process.env["DEVENV_REPO"] === undefined || process.env["DEVENV_REPO"] === "" ? ["--devenv"] : [];
  const { spawnSync } = await import("node:child_process");
  const r = spawnSync("bash", [wrapper, String(issue), ...override], { encoding: "utf8" });
  if (r.status !== 0 || r.stdout === undefined || r.stdout === "") return [];
  return r.stdout.split("\n").filter((l) => l.trim() !== "").map((line) => {
    const [proj = "", num = "", status = ""] = line.split("\t");
    return { project: proj, number: num, status };
  });
}

/** Repo-spec resolution (env override → cwd identity) — the graph-local naming. */
export function repoSpec(): string {
  return providerRepoTarget("");
}
