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
] as const;

/** Advertised flags the probe must NOT execute: they have side effects
 * outside the tool's own process (browser launch, $EDITOR, interactive
 * picker). Parse-coverage for them is established by the flag table
 * review, not by running them. */
const SIDE_EFFECT_FLAGS = new Set(["--web", "--edit", "--select-template"]);

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
    // would fire the effect.
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
