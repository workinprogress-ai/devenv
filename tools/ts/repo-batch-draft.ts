#!/usr/bin/env node
// repo-batch-draft.ts — plan claims x live changed set -> draft commit-batch
// manifest. Version: 1.0.0
//
// Contract: read-only outside .local-artifacts/. Given --plan <file>, each
// task's `Files:` claims expand against the changed set (directory claims
// are prefixes), producing groups (subjects from `commit:` bullets when
// present, else task titles), an unassigned parking lot, multi-claim
// conflicts (both named), and per-group hold/ready annotations. Without
// --plan, everything lands in unassigned. The draft is written under
// .local-artifacts/ via next-id naming; a summary line and the unassigned
// list print to stdout. The generator makes ZERO content decisions —
// parking lots are resolved by hand in the reviewed artifact.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { assertNodeFloor } from "../lib/core/node-floor.ts";
import { errorMessage } from "../lib/core/logging.ts";
import { gitCapture } from "../lib/core/git.ts";
import { logError, logInfo } from "../lib/core/logging.ts";
import { toolCli, usageCommonFlags } from "../lib/core/cli.ts";
import { changedFiles } from "../lib/core/git.ts";
import { draftFromClaims, renderDraft, type TaskClaim } from "../lib/domain/commit-batch.ts";
import { EXIT_GENERAL_ERROR, EXIT_MISUSE } from "../lib/core/exit-codes.ts";

assertNodeFloor();

const SCRIPT_VERSION = "1.0.0";

function die(...lines: string[]): never {
  for (const l of lines) logError(l);
  process.exit(EXIT_GENERAL_ERROR);
}

function usage(): void {
  console.log(`Usage: repo-batch-draft [--plan <plan-file>]

Generates a draft commit-batch manifest from a plan's Files: claims x the
live changed set. Read-only outside .local-artifacts/.

  --plan <file>   the Plan-*.md to read claims from; without it, every
                  changed file lands in the unassigned parking lot

Options:
${usageCommonFlags({ noDryRun: true, noDevenv: true })}

Output: .local-artifacts/batch-draft-N.md (next free suffix) plus a stdout
summary: groups / assigned / unassigned / conflicts counts and the
unassigned list. Parking sections are comments — resolve them by hand
(move each file into exactly one group, or add ## excluded), then drive
staging with repo-stage --batch <file> --group N.`);
}

// --- argv
let planFile = "";
try {
  const cli = toolCli({
    name: "repo-batch-draft",
    version: SCRIPT_VERSION,
    argv: process.argv.slice(2),
    noDryRun: true,
    allowPositionals: false,
    options: {
      plan: { type: "string" },
    },
  });
  if (cli.common.help) usage();
  // --plan is optional: without it the tool runs in parking-lot mode (every
  // changed file unassigned). Only a present-but-valueless --plan is an error
  // (strict parse throws on the missing value → the catch below).
  planFile = typeof cli.values.plan === "string" ? cli.values.plan : "";
} catch (err) {
  logError(errorMessage(err));
  console.error("Use --help for usage information");
  process.exit(EXIT_MISUSE);
}

// --- repo root
const rootProbe = gitCapture(null, ["rev-parse", "--show-toplevel"]);
if (rootProbe.status !== 0) die("not inside a git repository");
const repoRoot = rootProbe.out.trim();

// --- extract TaskClaims from the plan markdown
function extractClaims(content: string): TaskClaim[] {
  const claims: TaskClaim[] = [];
  const lines = content.split("\n");
  // Task header: - [ ] or [x] **N.N [S] Title...** (metadata bullets follow
  // until the next task/phase heading or non-bullet line)
  const TASK_RE = /^- \[( |x)\] \*\*([0-9]+(?:\.[0-9]+)*) \[(S|M|L)\] (.+?)\*\*\s*(.*)$/;
  for (let i = 0; i < lines.length; i += 1) {
    const m = TASK_RE.exec(lines[i] ?? "");
    if (!m) continue;
    const done = m[1] === "x";
    const id = m[2] ?? "";
    const title = (m[4] ?? "").trim();
    const files: string[] = [];
    const hunkSpecs = new Map<string, string>();
    let commitSubject: string | undefined;
    // walk metadata bullets under the task
    for (let j = i + 1; j < lines.length; j += 1) {
      const l = lines[j] ?? "";
      if (TASK_RE.test(l)) break;
      if (/^#{1,6} /.test(l)) break;
      const fm = /^ {2}- Files: (.*)$/.exec(l);
      if (fm) {
        // claims are backtick-delimited segments: split on the backticks
        // and keep inner segments (paths may contain spaces or commas);
        // backticks alternate outside-glue/path. A segment carrying
        // ' @ <spec>' is a hunk-selector claim: path into files (for claim
        // matching), path+spec into hunkSpecs (verbatim passthrough — the
        // draft generator makes no content decisions).
        const segs = (fm[1] ?? "").split("`");
        for (let k = 1; k < segs.length; k += 2) {
          const p = (segs[k] ?? "").trim();
          if (p === "") continue;
          const cleaned = p.replace(/\s*\(new\)\s*$/, "");
          const hm = /^(.+?) @ ([1-9][0-9]*(?:-[1-9][0-9]*)?(?:,[1-9][0-9]*(?:-[1-9][0-9]*)?)*)$/.exec(cleaned);
          if (hm) {
            // Selector entries claim hunks, not the whole path — they ride
            // hunkSpecs only (claim matching routes them in the hunk pass;
            // pushing them into files would make every selector a whole-file
            // claim and every same-file split a spurious conflict).
            hunkSpecs.set((hm[1] ?? "").trim(), (hm[2] ?? "").trim());
          } else {
            files.push(cleaned);
          }
        }
        continue;
      }
      const cm = /^ {2}- commit: (.*)$/.exec(l);
      if (cm) commitSubject = (cm[1] ?? "").trim();
    }
    claims.push({ id, done, title, files, ...(hunkSpecs.size > 0 ? { hunkSpecs } : {}), ...(commitSubject !== undefined ? { commitSubject } : {}) });
  }
  return claims;
}

// --- changed set
const changed = changedFiles(repoRoot);
const changedPaths = changed.map((e) => e.path);
if (changedPaths.length === 0) {
  logInfo("working tree is clean — nothing to draft");
  process.exit(0);
}

// --- claims + draft
let claims: TaskClaim[] = [];
if (planFile !== "") {
  if (!existsSync(planFile)) die(`plan file not found: ${planFile}`);
  claims = extractClaims(readFileSync(planFile, "utf8"));
}
const draft = draftFromClaims(changedPaths, claims);

// --- write the draft (next free suffix under .local-artifacts/)
const dir = join(repoRoot, ".local-artifacts");
if (!existsSync(dir)) die(".local-artifacts/ does not exist — create it first");
let n = 1;
let outPath = join(dir, `batch-draft-${n}.md`);
while (existsSync(outPath)) {
  n += 1;
  outPath = join(dir, `batch-draft-${n}.md`);
}
const title = planFile !== "" ? `draft from ${planFile.split("/").pop()}` : "draft (no plan)";
writeFileSync(outPath, renderDraft(draft, title));

const assigned = draft.groups.reduce((a, g) => a + g.files.length + g.hunkSpecs.length, 0);
logInfo(`draft written: ${outPath}`);
logInfo(
  `groups ${draft.groups.length} · assigned ${assigned} · unassigned ${draft.unassigned.length} · conflicts ${draft.conflicts.length}`,
);
if (draft.unassigned.length > 0) {
  logInfo("unassigned:");
  for (const u of draft.unassigned) logInfo(`  - ${u.path}`);
}
if (draft.conflicts.length > 0) {
  logInfo("conflicts (resolve by hand — both claimants named in the draft):");
  for (const c of draft.conflicts) logInfo(`  - ${c.path} (${c.tasks.join(", ")})`);
}
process.exit(0);
