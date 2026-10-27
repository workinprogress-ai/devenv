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

import { configGet, configGetArray } from "../../core/config.ts";
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

// ---------------------------------------------------------------------------
// Workflow state model (the workflow-core.bash port, pure half).
//
// Semantics (design-settled, unchanged from the bash original):
// - Vocabulary order comes from devenv.config [workflows] status_workflow
//   (WORKFLOW_ORDER_OVERRIDE honored for forks/tests).
// - DELIVERY segment = the anchor token (Implementing by default)..last.
//   Anything earlier is pre-delivery.
// - Rollup: parent = pure function of current child states. All children
//   pre-delivery -> parent keeps its own state (undefined). Any child in
//   delivery -> parent = min child state, pre-delivery children floored at
//   the anchor. Sanctioned regression propagates: statuses are revocable
//   current-state.
// - Unreadable child status reads as the fallback token (pre-delivery).
// - Loop guard lives in the write half: rollup writes suppress upward
//   re-propagation; climbs continue only on actual change.
// ---------------------------------------------------------------------------

/** The policy knobs: [workflows] delivery_segment_anchor / status_fallback
 * with the org's built-in defaults (workflow-policy.bash parity). */
export interface WorkflowPolicy {
  anchor: string;
  fallback: string;
}

export function workflowPolicy(devenvRoot?: string): WorkflowPolicy {
  const root = devenvRoot ?? defaultRoot();
  const file = join(root, "devenv.config");
  return {
    anchor: configGet(file, "workflows", "delivery_segment_anchor")?.trim() || "Implementing",
    fallback: configGet(file, "workflows", "status_fallback")?.trim() || "Ready",
  };
}

/** A status token's 0-based position in the configured order; -1 when
 * unknown to the vocabulary. */
export function statusOrder(token: string, devenvRoot?: string): number {
  if (token === "") return -1;
  return workflowOrder(devenvRoot).indexOf(token);
}

/**
 * Compute the rolled-up parent status from child statuses. Pure function.
 * Returns undefined when: no children, any unknown status, or all children
 * pre-delivery (the caller leaves the parent's own state alone). Otherwise
 * the minimum child state with pre-delivery children floored at the anchor.
 */
export function computeRollup(
  childStatuses: string[],
  devenvRoot?: string,
): string | undefined {
  if (childStatuses.length === 0) return undefined;
  const order = workflowOrder(devenvRoot);
  if (order.length === 0) return undefined;
  const policy = workflowPolicy(devenvRoot);
  const anchorIdx = order.indexOf(policy.anchor);
  if (anchorIdx === -1) return undefined;
  const floored = childStatuses.map((st) => {
    const idx = order.indexOf(st);
    if (idx === -1) return undefined;
    return idx < anchorIdx ? anchorIdx : idx;
  });
  if (floored.some((i) => i === undefined)) return undefined;
  // All children pre-delivery: indistinguishable from a genuine
  // anchor-token child — signal undefined, the parent keeps its own state.
  const anyDelivery = childStatuses.some((st) => order.indexOf(st) >= anchorIdx);
  if (!anyDelivery) return undefined;
  return order[Math.min(...(floored as number[]))];
}

// ---------------------------------------------------------------------------
// Workflow state model — write/propagation half (the workflow-core.bash
// orchestration port). All writes funnel through writeStatus (the single
// guarded choke point, --all-projects --safe fan-out via the
// project-update-issue wrapper). Best-effort contract: write failures warn
// and never throw past the entry points; idempotent (fixed values), so a
// later signal repairs drift from a failed run.
// ---------------------------------------------------------------------------

export interface WorkflowWriteContext {
  /** Entry-point root: real tools by default; the WORKFLOW_CORE_TOOLS test
   * seam equivalent. */
  toolsRoot?: string;
  devenvRoot?: string;
  /** Capture warnings instead of emitting to stderr (tests). */
  onWarning?: (message: string) => void;
}

function workflowToolsRoot(ctx?: WorkflowWriteContext): string {
  if (ctx?.toolsRoot !== undefined) return ctx.toolsRoot;
  const env = process.env["WORKFLOW_CORE_TOOLS"];
  if (env !== undefined && env !== "") return env;
  // This module sits three directories below the tools root
  // (tools/lib/domain/issues/) — the depth-1 wrappers live at the root.
  return fileURLToPath(new URL("../../..", import.meta.url));
}

/** The single guarded write choke point. mode "suppress" = a rollup-computed
 * write: do not propagate upward (the loop guard). Returns true when the
 * fan-out succeeded. */
export async function writeStatus(
  issue: number,
  status: string,
  ctx: WorkflowWriteContext = {},
  mode: "propagate" | "suppress" = "propagate",
): Promise<boolean> {
  const root = workflowToolsRoot(ctx);
  const wrapper = `${root.replace(/\/$/, "")}/project-update-issue`;
  // An unset DEVENV_REPO means the work targets the checkout it runs in, so
  // the write carries the explicit --devenv override (and only then).
  const override = process.env["DEVENV_REPO"] === undefined || process.env["DEVENV_REPO"] === ""
    ? ["--devenv"]
    : [];
  const { spawnSync } = await import("node:child_process");
  const r = spawnSync(
    "bash",
    [wrapper, String(issue), "--status", status, "--all-projects", "--safe", ...override],
    { encoding: "utf8" },
  );
  if (r.status !== 0) {
    const warn = ctx.onWarning ?? ((m: string) => console.error(m));
    warn(`WARNING: workflow write '${status}' failed for issue #${issue} (best-effort, continuing)`);
    return false;
  }
  if (mode === "suppress") return true;
  await rollupParentOf(issue, ctx);
  return true;
}

/** Recompute an issue's parent from its children and write only on actual
 * change; climbs recursively (bounded by finite statuses + tree depth).
 * No parent -> no-op. */
export async function rollupParentOf(
  issue: number,
  ctx: WorkflowWriteContext = {},
): Promise<void> {
  const spec = repoSpec();
  const parentIssue = await parent(spec, issue).catch(() => null);
  if (parentIssue === null) return;
  const kidStatuses: string[] = [];
  const policy = workflowPolicy(ctx.devenvRoot);
  const kids = await issueGraphChildren(spec, parentIssue).catch(() => []);
  for (const kid of kids) {
    const st = await readStatus(kid, ctx).catch(() => null);
    kidStatuses.push(st ?? policy.fallback);
  }
  const rolled = computeRollup(kidStatuses, ctx.devenvRoot);
  if (rolled === undefined) return;
  const current = await readStatus(parentIssue, ctx).catch(() => null);
  if (rolled === current) return;
  await writeStatus(parentIssue, rolled, ctx, "suppress");
  // Climb: the parent's own parent may now change.
  await rollupParentOf(parentIssue, ctx);
}

/** Entry: the dispatcher's entire job — resolve event -> status (vocabulary
 * from skill-events.yml + config order), write via fan-out, propagate.
 * Unknown event: warn + return (schema tolerance). */
export async function onEvent(
  event: string,
  issue: number,
  ctx: WorkflowWriteContext = {},
): Promise<void> {
  if (event === "" || !Number.isFinite(issue)) return;
  const { eventStatusFor } = await import("../events.ts");
  const status = eventStatusFor(event);
  if (status === null) {
    const warn = ctx.onWarning ?? ((m: string) => console.error(m));
    warn(`Unknown event '${event}' - no transition configured (best-effort, continuing)`);
    return;
  }
  await writeStatus(issue, status, ctx);
}

/** Entry: statused/forced writes from tooling. direction "child" (default):
 * write + roll the parent up. direction "parent": cascade the write to
 * children once, authoritative — gated (pre-delivery) statuses reject
 * forcing. */
export async function applyStatus(
  issue: number,
  status: string,
  ctx: WorkflowWriteContext = {},
  direction: "child" | "parent" = "child",
): Promise<boolean> {
  const policy = workflowPolicy(ctx.devenvRoot);
  if (statusOrder(status, ctx.devenvRoot) === -1) {
    const warn = ctx.onWarning ?? ((m: string) => console.error(m));
    warn(`Unknown status token '${status}' (vocabulary mismatch)`);
    return false;
  }
  if (direction === "parent") {
    const anchorIdx = statusOrder(policy.anchor, ctx.devenvRoot);
    const idx = statusOrder(status, ctx.devenvRoot);
    if (idx < anchorIdx) {
      const warn = ctx.onWarning ?? ((m: string) => console.error(m));
      warn(`Status '${status}' is gated - it cannot be forced; workflow states advance by their own signals`);
      return false;
    }
    await writeStatus(issue, status, ctx, "suppress");
    const spec = repoSpec();
    const kids = await issueGraphChildren(spec, issue).catch(() => []);
    for (const c of kids) {
      await writeStatus(c, status, ctx, "suppress");
    }
    return true;
  }
  return writeStatus(issue, status, ctx);
}

/** Entry: recompute a freshly linked child's parent (parent-link ops). */
export async function recomputeParent(issue: number, ctx: WorkflowWriteContext = {}): Promise<void> {
  await rollupParentOf(issue, ctx);
}
