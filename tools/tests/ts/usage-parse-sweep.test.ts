// Tool-level usage↔parse consistency sweep: every tool adopted on toolCli
// must parse every long flag its rendered --help block advertises. Locks
// the per-tool adoption (not just the shared block function) — the class
// of defect where a tool renders a block variant its own toolCli config
// contradicts.
import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

const TOOLS = [
  "issue-close",
  "issue-comment",
  "issue-comment-list",
  "issue-comment-update",
  "issue-create",
  "issue-create-batch",
  "issue-get",
  "issue-graph-link",
  "issue-label-create",
  "issue-label-list",
  "issue-list",
  "issue-search",
  "issue-select",
  "issue-triage",
  "issue-types",
  "issue-update",
  "issue-artifact-doc-id",
  "issue-artifact-get",
  "issue-artifact-list",
  "issue-artifact-select",
  "issue-artifact-upsert",
  "pr-comment",
  "pr-cleanup-review-branches",
  "pr-diff",
  "pr-get",
  "pr-get-merge-link",
  "pr-get-review-link",
  "pr-list",
  "pr-merge",
  "pr-review-comment",
  "pr-thread-reply",
  "pr-thread-resolve",
  "pr-threads-get",
  "repo-batch-draft",
  "repo-bisect",
  "repo-bump-version",
  "repo-calc-version",
  "repo-create",
  "repo-get",
  "repo-scratchpad",
  "repo-stage",
  "repo-update-all",
  "repo-update-config",
  "repo-version-list",
  "git-prune-branches",
  "git-unwip",
  "git-update",
  "repo-commit",
  "git-wip",
  "git-wip-recover",
  // Phase 7.2 cluster A — tooling family
  "artifact-clean",
  "artifact-header",
  "artifacts-list",
  "devenv-marker-check",
  "devenv-memory-watch",
  "lint-documentation",
  "lint-scripts",
  "lint-skills",
  "markdown-plan-complete-ac",
  "markdown-plan-complete-task",
  "next-id",
  "plan-parse",
  "policy-export",
  "roadmap-parse",
  "skill-orient",
  "spec-dependency-check",
  "workflow-signal",
  // Phase 7.2 cluster B — cs family
  "cs-dependencies-trace",
  "cs-dependencies-update-wizard",
  "cs-nuget-publish-local",
  "cs-references-update",
  "cs-references-update-wizard",
  // Phase 7.2 cluster C — fork / mongo
  "fork-export",
  "fork-sync",
  "mongo-backup-server",
  "mongo-restore-server",
  // Phase 7.2 cluster D — kube forwarders
  "kube-forward-ports",
  "kube-intercept",
  // Phase 7.2 cluster E — pipelines / project
  "pipelines-artifacts",
  "pipelines-list",
  "pipelines-status",
  "project-add-issue",
  "project-update-issue",
  "fork-setup",
] as const;

/** Advertised flags the probe must NOT execute: they have side effects
 * outside the tool's own process (browser launch, $EDITOR, interactive
 * picker) or mutate repo state when run in the checkout hosting the suite
 * (branch creation/checkout, scratchpad entry, staging). Parse-coverage
 * for them is established by the flag table review, not by running them. */
const SIDE_EFFECT_FLAGS = new Set([
  "--web", "--edit", "--select-template", "--select", "--interactive",
  "--all", "--batch", "--branch", "--wip", "--unstage", "--promote",
  "--enter", "--reset", "--exit", "--amend", "--fix", "--reword",
  "--fold-window", "--carry", "--force",
]);

/** Tools whose MAIN PATH runs (and mutates) with zero arguments: probing
 * ANY of their advertised flags executes the tool itself, so the flag-probe
 * loop is skipped for them entirely — the help-block assertions still run.
 * The flag-level denylist above cannot protect this class: every one of
 * their flags is optional, so a lone-flag probe parses cleanly and falls
 * through to the mutating main path.
 *  - repo-update-all: spawned live repo-get over every cached repo for
 *    minutes (fetches, master fast-forwards) when probed.
 *  - git-unwip: soft-resets to the last non-WIP commit (and force-pushes
 *    when the remote tip is a WIP commit) when probed.
 *  - git-update: fetches; on a clean behind branch it pulls.
 *  - repo-commit: opens $EDITOR whenever the hosting repo's index is
 *    non-empty when probed. */
const SKIP_FLAG_PROBES = new Set([
  "repo-update-all",
  "git-unwip",
  "git-update",
  "repo-commit",
  // WIP snapshot lane: commits and pushes on the main path (TTY-gated, but
  // the gate is not a safety mechanism — it exists for accidental pipes).
  "git-wip",
  // Restores a WIP commit to a branch (checkout -b) on the main path.
  "git-wip-recover",
  // Deletes files from .local-artifacts/ on the main path: --tmp
  // auto-deletes without confirmation; probing any flag falls through
  // to a deleting main path.
  "artifact-clean",
  // Watch daemon: the zero-arg main path samples in a loop (never
  // exits); probes would leave sampler processes behind.
  "devenv-memory-watch",
  // Zero-arg main path opens an interactive picker; on fallback it
  // dispatches live workflow events (tracker writes).
  "workflow-signal",
  // Zero-flag main path runs shellcheck over the whole workspace (~1 min,
  // read-only but far past the probe timeout).
  "lint-scripts",
  // Mutating main paths: probes fall through to dotnet build/publish or
  // branch-creating wizard flows on the hosting checkout.
  "cs-nuget-publish-local",
  "cs-references-update",
  "cs-references-update-wizard",
  "cs-dependencies-update-wizard",
  "cs-dependencies-trace",
  // Mutating git/history tools: fork-sync replays/pushes, fork-export
  // creates clones and applies patches; mongo tools dump/restore live
  // servers. All fail closed without config, but probing any optional
  // flag falls through to a mutating main path.
  "fork-sync",
  "fork-export",
  "mongo-backup-server",
  "mongo-restore-server",
  // Long-running forwarder daemons: kubectl port-forward / telepresence
  // loops that only end on SIGINT — a probe would hang past timeout.
  "kube-forward-ports",
  "kube-intercept",
  // Zero-arg main path hits the live provider (org listing over network).
  "pipelines-list",
  // Same provider-listing main path as pipelines-list (network per probe).
  "pipelines-status",
  // Zero-arg main path adds/rewrites the upstream git remote.
  "fork-setup",
]);

/** Extract advertised long flags from a usage block: any line of the
 * shape "-x, --long-flag ARG  desc" or indented "--long-flag ...".
 * Bundle/sub-block flags sit at deeper indentation — the regex anchors on
 * the leading hyphen-hyphen token, not the indent width. */
function advertisedLongFlags(helpText: string): string[] {
  const flags: string[] = [];
  for (const line of helpText.split("\n")) {
    const m = /^\s+(?:-\w,\s*)?(--[a-z][a-z0-9-]*)/i.exec(line);
    if (m?.[1]) flags.push(m[1]);
  }
  return [...new Set(flags)];
}

describe("usage↔parse sweep: every advertised flag parses", () => {
  it.each([...TOOLS])("%s", (tool) => {
    const toolPath = join(import.meta.dirname, "..", "..", "ts", `${tool}.ts`);
    const help = spawnSync("node", [toolPath, "--help"], { encoding: "utf8", input: "" });
    // Some tools render usage to stderr or exit non-zero after help;
    // either is fine — the block just has to be present somewhere.
    const helpText = (help.stdout ?? "") + (help.stderr ?? "");
    expect(helpText.length, `${tool} --help printed nothing`).toBeGreaterThan(0);
    const flags = advertisedLongFlags(helpText);
    expect(flags.length, `${tool} advertises no flags?`).toBeGreaterThan(0);

    // Probe each advertised flag. String flags need a value; a lone flag
    // that takes one yields "needs an argument" (a PARSE-REACHED error,
    // distinct from "Unknown option" which is the mismatch we hunt).
    // Boolean flags parse alone. Unknown-option is the failure signal.
    // Side-effect flags (browser/editor/picker) are skipped: probing them
    // would fire the effect. Zero-arg main-path mutators are skipped whole
    // (SKIP_FLAG_PROBES): their optional flags all parse cleanly into a
    // mutating main path.
    if (SKIP_FLAG_PROBES.has(tool)) return;
    for (const flag of flags) {
      if (SIDE_EFFECT_FLAGS.has(flag)) continue;
      const probe = spawnSync("node", [toolPath, flag], { encoding: "utf8", input: "" });
      const out = (probe.stdout ?? "") + (probe.stderr ?? "");
      expect(out, `${tool}: advertised ${flag} but parse rejects it`).not.toMatch(
        /Unknown option|unknown option/i,
      );
    }
  }, 30_000);
});
