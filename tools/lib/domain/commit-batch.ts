// commit-batch.ts — the commit-batch manifest model (domain/headless).
//
// A commit batch manifest is a strict, human-editable markdown artifact in
// .local-artifacts/ that assigns FILES TO COMMITS: one `## group N` section
// per intended commit plus an optional trailing `## excluded` section for
// files deliberately left out of this batch. repo-batch-draft generates it;
// repo-stage interprets and validates it on every invocation. Attribution
// is file-level and timeless — the manifest does not care what a file
// contains yet, so late-arriving content lands in the right commit for
// free while its group is uncommitted.
//
// Grammar (strict; anything else refuses in the parser):
//   # Commit batch: <free-form title>            exactly one, first line
//   ## group <n> — <suggested subject>           sequential from 1, no gaps
//   - <repo-root-relative path>                  whole-file claim
//   - <path> @ <hunk-spec>                       partial-file claim (spec:
//                                                comma-separated 1-based hunk
//                                                numbers / a-b ranges over
//                                                the file's live git diff,
//                                                default U3 context — the
//                                                tool's own enumeration)
//   ## excluded                                  optional, exactly one, last
//   - <path>                                     same entry grammar
//   <!-- ... --> and blank lines                 allowed anywhere
//
// A partial claim carries the hunk spec but NOT the hunks themselves —
// selectors resolve against the live diff at staging time (regenerate +
// echo protocol: the tool echoes what actually staged, and the skill's
// staged-glance shows the user the real staged diff before committing).
//
// Entries are FILES ONLY (a directory entry refuses — implicit sweeps are
// how unreviewed content rides along) and must not start with "-" beyond
// the entry bullet itself. Paths are repo-root-relative literals in every
// mode. Subjects are informational echoes (repo-stage prints them;
// repo-commit owns messages and never reads this file).

/** One group of the batch: an intended commit's content set. */
export interface CommitBatchGroup {
  /** 1-based sequential number; groups run 1..N with no gaps. */
  readonly number: number;
  /** Informational suggested subject — echoed in output, never enforced. */
  readonly subject: string;
  /** Files only; repo-root-relative literals. */
  readonly files: string[];
  /** Partial claims: path → parsed hunk spec (1-based positions in the
   * file's live unstaged diff, default U3). A path appears here only via
   * a `- path @ spec` entry; whole-file entries stay in `files`. */
  readonly hunkClaims: ReadonlyMap<string, number[]>;
}

/** A parsed commit-batch manifest. `excluded` holds deliberately-omitted
 * paths (the pressure valve that keeps coverage absolute: an orphan file
 * must be excluded in writing, in the reviewed artifact, never silently). */
export interface CommitBatch {
  readonly title: string;
  readonly groups: CommitBatchGroup[];
  readonly excluded: string[];
}

/** All paths the manifest claims, in order: every group's files plus the
 * excluded set. Coverage and index-purity checks run against this union. */
export function batchClaimedPaths(batch: CommitBatch): string[] {
  return [
    ...batch.groups.flatMap((g) => g.files),
    ...batch.groups.flatMap((g) => [...g.hunkClaims.keys()]),
    ...batch.excluded,
  ];
}

// ---------------------------------------------------------------------------
// strict parser + validators (pure functions over text; no I/O)
// ---------------------------------------------------------------------------

import { parseHunkSpec } from "./hunk-select.ts";

/** A named refusal from parsing or validation. Remediation text is part of
 * the contract: every error names what failed and what to do. */
export interface BatchError {
  message: string;
}


const GROUP_RE = /^## group ([0-9]+) — (.*)$/;
const EXCLUDED_RE = /^## excluded$/;
const TITLE_RE = /^# Commit batch: (.*)$/;
const COMMENT_RE = /^<!--.*-->$/;
/** `- <path> @ <spec>` — partial-file claim. The ` @ ` separator keeps the
 * grammar unambiguous (paths may not contain ` @ ` in practice; a path that
 * does refuses as non-literal). */
const HUNK_CLAIM_RE = /^- (.+) @ ([1-9][0-9]*(?:-[1-9][0-9]*)?(?:,[1-9][0-9]*(?:-[1-9][0-9]*)?)*)$/;


/** Strict parse of a commit-batch manifest. Refuses (never best-effort) on
 * any construct outside the grammar: bad title line, non-sequential group
 * numbers, entries outside a section, a directory path, a leading-dot or
 * traversal path, a second `## excluded`, or any other line shape. Empty
 * group sections are allowed (a group may have been committed already and
 * its section emptied by hand — coverage, not parse, judges staleness). */
export function parseCommitBatch(text: string): { batch: CommitBatch } | { errors: BatchError[] } {
  const errors: BatchError[] = [];
  const lines = text.split("\n");
  const titleLine = lines[0] ?? "";
  const titleMatch = TITLE_RE.exec(titleLine);
  if (!titleMatch) {
    errors.push({
      message: `line 1: expected '# Commit batch: <title>' as the first line — got '${titleLine.trim()}'`,
    });
  }
  const groups: CommitBatchGroup[] = [];
  const excluded: string[] = [];
  let inExcluded = false;
  let expected = 1;
  for (let i = 1; i < lines.length; i += 1) {
    const raw = lines[i] ?? "";
    const line = raw.trimEnd();
    if (line === "" || COMMENT_RE.test(line)) continue;
    const groupMatch = GROUP_RE.exec(line);
    if (groupMatch) {
      const num = Number.parseInt(groupMatch[1] ?? "", 10);
      const subject = (groupMatch[2] ?? "").trim();
      if (inExcluded) {
        errors.push({ message: `line ${i + 1}: a group heading after '## excluded' — excluded must be the last section` });
        continue;
      }
      if (num !== expected) {
        errors.push({
          message: `line ${i + 1}: group numbers must be sequential from 1 — expected 'group ${expected}', got 'group ${num}'`,
        });
      }
      groups.push({ number: num, subject, files: [], hunkClaims: new Map() });
      expected += 1;
      continue;
    }
    if (EXCLUDED_RE.test(line)) {
      if (inExcluded) errors.push({ message: `line ${i + 1}: duplicate '## excluded' section — the section repeats; excluded entries themselves may not carry selectors` });
      if (groups.length === 0) errors.push({ message: `line ${i + 1}: '## excluded' before any group — a batch needs at least one group` });
      inExcluded = true;
      continue;
    }
    if (line.startsWith("- ")) {
      const entry = line.slice(2).trim();
      const hunkMatch = HUNK_CLAIM_RE.exec(line);
      if (hunkMatch) {
        const path = (hunkMatch[1] ?? "").trim();
        const spec = hunkMatch[2] ?? "";
        if (groups.length === 0) {
          errors.push({ message: `line ${i + 1}: entry '${path}' before any group heading` });
          continue;
        }
        if (inExcluded) {
          errors.push({ message: `line ${i + 1}: hunk selectors are not valid in '## excluded' — excluded entries are whole files` });
          continue;
        }
        const group = groups[groups.length - 1];
        if (!group) {
          errors.push({ message: `line ${i + 1}: entry before any group heading` });
          continue;
        }
        try {
          // Parse builds into the group's claim map; the interface exposes
          // it readonly to consumers — parse-time population is the writer.
          // parseHunkSpec is THE selector parser (one grammar, one ceiling
          // set — hunk-select owns it; commit-batch carries no divergent copy).
          (group.hunkClaims as Map<string, number[]>).set(path, parseHunkSpec(spec));
        } catch (e) {
          // Carry the parser's specific reason (range ceiling, total
          // ceiling, 1-based) through — a generic "malformed" would hide
          // which cap fired.
          const reason = e instanceof Error ? e.message.replace(/^line 1: /, "").replace(/ \(got: .*\)$/, "") : "not a valid spec";
          errors.push({
            message: `line ${i + 1}: malformed hunk selector on '${path}' — ${reason}`,
          });
        }
        continue;
      }
      // An entry CONTAINING ' @ ' (or ENDING in a bare ' @') that failed the
      // strict selector regex is a malformed selector, never a whole-file
      // path: refuse it by name so a typo'd spec cannot silently stage an
      // entire file.
      if (entry.includes(" @ ") || entry.endsWith(" @")) {
        const path = entry.split(" @ ")[0]!.split(" @")[0]!.trim();
        errors.push({
          message: `line ${i + 1}: malformed hunk selector on '${path}' — the spec is comma-separated 1-based hunk numbers / a-b ranges with no spaces (e.g. '@ 1-2,4')`,
        });
        continue;
      }
      const path = entry;
      if (groups.length === 0) {
        errors.push({ message: `line ${i + 1}: entry '${path}' before any group heading` });
        continue;
      }
      if (inExcluded) excluded.push(path);
      else groups[groups.length - 1]?.files.push(path);
      continue;
    }
    if (line.startsWith("#")) {
      errors.push({ message: `line ${i + 1}: unknown heading '${line}' — expected '## group N — subject' or '## excluded'` });
      continue;
    }
    errors.push({ message: `line ${i + 1}: unrecognized line '${line}' — entries are '- <path>', headings '## group N — subject' / '## excluded', comments '<!-- ... -->'` });
  }
  if (groups.length === 0 && errors.length === 0) {
    errors.push({ message: "no groups — a commit batch must have at least one '## group N — subject' section" });
  }
  if (errors.length > 0) return { errors };
  return { batch: { title: titleMatch?.[1]?.trim() ?? "", groups, excluded } };
}

/** Literal-path check: repo-root-relative file literals only. Refuses
 * globs, absolute paths, dot-relative paths, and traversal. */
export function isLiteralFilePath(path: string): boolean {
  if (path === "" || path !== path.trim()) return false;
  if (path.startsWith("/") || path.startsWith("-")) return false;
  if (path === "." || path === ".." || path.startsWith("./") || path.startsWith("../")) return false;
  if (path.includes("..")) return false;
  if (/[\\]\s*$/.test(path)) return false;
  // a trailing slash is a directory claim — implicit sweeps are how
  // unreviewed content (e.g. an embedded repo as a gitlink) rides along
  if (path.endsWith("/")) return false;
  // any glob metacharacter refuses
  if (/[*?\[\]!]/.test(path)) return false;
  return true;
}

export interface ValidateOptions {
  /** The working tree's changed set (changedFiles()) — coverage input. */
  changedPaths: string[];
  /** Paths currently staged in the index. */
  stagedPaths: string[];
  /** Paths that exist on disk (the tool layer reads the disk; the domain
   * stays pure). Existence is deletion-aware: a path in the changed set
   * counts as existing even when absent from this set (deleted files are
   * stageable). */
  exists?: Set<string>;
  /** Group numbers whose files are fully consumed — every file's worktree
   * content matches HEAD (committed and untouched since). A consumed group
   * is exempt from the existence check: its paths may have since been
   * renamed or deleted by later commits, which is evidence of consumption,
   * not a manifest typo. */
  consumedGroups?: Set<number>;
  /** Hunk-level validation inputs. When the batch carries any hunk claims,
   * the tool layer supplies per-file hunk facts and the validators below
   * extend coverage/purity to hunk grain. Omit the whole object (or leave
   * `refusalClasses` undefined) for whole-file-only batches — the hunk
   * validators are additive and never weaken the path-level rules. */
  hunkFacts?: {
    /** Live hunk count per partially-claimed path (from the file's current
     * unstaged diff). A claimed hunk number above this count is drift. */
    liveCounts: ReadonlyMap<string, number>;
    /** Refusal-class paths among the claimed files: "binary", "rename",
     * "new-file" — partial claims on these refuse (v1 doctrine). */
    refusalClasses: ReadonlyMap<string, "binary" | "rename" | "new-file">;
    /** Staged hunk payloads per path: identity strings for the hunks
     * CURRENTLY in the index (from `git diff --cached`, hunkPayload-shaped).
     * Purity = every staged payload ∈ the union of all groups' claims for
     * that file (set-membership; the stateless model cannot attribute a
     * staged hunk to a specific group — documented residual risk). */
    stagedPayloads: ReadonlyMap<string, readonly string[]>;
    /** Payload per hunk number per path, from the tool's own enumeration of
     * the live unstaged diff: selector numbers → content identity, so
     * coverage can check that every unstaged hunk is claimed or excluded. */
    payloadByNumber: ReadonlyMap<string, readonly string[]>;
  };
}

/** Run every validator over a parsed batch: literal paths, deletion-aware
 * existence, duplicate membership, coverage of the live changed set, and
 * index purity. Returns all named errors (empty = valid). */
export function validateCommitBatch(batch: CommitBatch, opts: ValidateOptions): BatchError[] {
  const errors: BatchError[] = [];
  const changed = new Set(opts.changedPaths);

  for (const g of batch.groups) {
    for (const p of g.files) {
      if (!isLiteralFilePath(p)) {
        errors.push({ message: `group ${g.number}: '${p}' is not a literal repo-root-relative file path (no globs, dirs, absolute, or traversal paths)` });
      }
    }
    // Hunk-claim paths are paths too: the literal-path rule applies at
    // selector grain (a glob or traversal claim must refuse HERE, with a
    // named class — not later as enumerate noise).
    for (const p of g.hunkClaims.keys()) {
      if (!isLiteralFilePath(p)) {
        errors.push({ message: `group ${g.number}: '${p} @ …' is not a literal repo-root-relative file path (no globs, dirs, absolute, or traversal paths)` });
      }
    }
  }
  for (const p of batch.excluded) {
    if (!isLiteralFilePath(p)) {
      errors.push({ message: `excluded: '${p}' is not a literal repo-root-relative file path` });
    }
  }

  // duplicate membership across all sections — both grains: a path in two
  // whole-file claims, or in any whole-file claim AND any selector claim
  // (the whole-file claim would swallow the selector's hunks at stage
  // time — exactly the silent re-attribution this validator exists to
  // prevent), or the same selector-claimed path in two groups.
  const seen = new Map<string, string>();
  const sectionOf = (g: CommitBatchGroup | "excluded"): string => (g === "excluded" ? "excluded" : `group ${g.number}`);
  for (const g of batch.groups) {
    for (const p of g.files) {
      const prior = seen.get(p);
      if (prior !== undefined) errors.push({ message: `'${p}' appears in both ${prior} and ${sectionOf(g)}` });
      else seen.set(p, sectionOf(g));
    }
  }
  for (const p of batch.excluded) {
    const prior = seen.get(p);
    if (prior !== undefined) errors.push({ message: `'${p}' appears in both ${prior} and excluded` });
    seen.set(p, "excluded");
  }
  // Selector-grain membership vs whole-file claims AND the excluded set —
  // a path both excluded and selector-claimed would stage content the
  // manifest says is deliberately left out (the exact hand-edit mistake
  // the validator exists to catch). Selector-vs-selector on the SAME path
  // in different groups is the intended shape (different hunks of one
  // file in different commits); the hunk-duplicate-membership validator
  // refuses same-HUNK overlap, which is the actual grain of conflict.
  for (const g of batch.groups) {
    for (const p of g.hunkClaims.keys()) {
      const wholePrior = seen.get(p);
      if (wholePrior !== undefined) {
        errors.push({ message: `'${p}' appears as ${wholePrior === "excluded" ? "an excluded entry" : `a whole-file claim in ${wholePrior}`} and as a hunk-selector claim in ${sectionOf(g)} — a path is claimed whole, claimed by hunks, or excluded, never two of these` });
      }
    }
  }

  // existence, deletion-aware: on disk OR in the changed set (a deleted
  // file is stageable — the changed set carries it). A consumed group's
  // paths are exempt: the group was already committed, so a missing path
  // (renamed/deleted by later work) is consumption evidence, not a typo.
  const claimed = new Set(batchClaimedPaths(batch));
  for (const g of batch.groups) {
    if (opts.consumedGroups?.has(g.number)) continue;
    for (const p of g.files) {
      if (!opts.exists?.has(p) && !changed.has(p)) {
        errors.push({ message: `group ${g.number}: '${p}' exists neither on disk nor as a changed/deleted file — typo?` });
      }
    }
    // Selector-claimed paths are deletion-aware too (existence at path
    // grain; the hunk-level live-count check below handles the rest).
    for (const p of g.hunkClaims.keys()) {
      if (!opts.exists?.has(p) && !changed.has(p)) {
        errors.push({ message: `group ${g.number}: '${p} @ …' exists neither on disk nor as a changed/deleted file — typo?` });
      }
    }
  }
  for (const p of batch.excluded) {
    if (!opts.exists?.has(p) && !changed.has(p)) {
      errors.push({ message: `excluded: '${p}' exists neither on disk nor as a changed/deleted file — typo?` });
    }
  }

  // coverage: every changed path must be claimed by a group or excluded
  for (const p of opts.changedPaths) {
    if (!claimed.has(p)) {
      errors.push({ message: `coverage: '${p}' is changed but claimed by no group and not excluded — add it to a group or '## excluded'` });
    }
  }

  // index purity: staged content must be inside the manifest union
  for (const p of opts.stagedPaths) {
    if (!claimed.has(p)) {
      errors.push({ message: `index: '${p}' is staged but not in the batch — unstage it (repo-stage --unstage) or add it to a group` });
    }
  }

  // --- hunk-level validators (additive; run when the batch carries hunk
  // claims and the tool layer supplied hunk facts) ---
  const hunkClaimsByFile = new Map<string, { group: number; numbers: number[] }[]>();
  for (const g of batch.groups) {
    for (const [path, numbers] of g.hunkClaims) {
      const list = hunkClaimsByFile.get(path) ?? [];
      list.push({ group: g.number, numbers });
      hunkClaimsByFile.set(path, list);
    }
  }
  if (hunkClaimsByFile.size === 0) return errors;
  const facts = opts.hunkFacts;
  if (!facts) {
    errors.push({ message: "hunk claims present but no hunk facts supplied — the tool layer must enumerate the live diff (internal error)" });
    return errors;
  }

  // refusal classes: binary / rename / new-file refuse partial claims (v1)
  for (const [path, klass] of facts.refusalClasses) {
    if (hunkClaimsByFile.has(path)) {
      errors.push({
        message: `group ${hunkClaimsByFile.get(path)![0]!.group}: '${path}' is a ${klass} diff — partial staging of ${klass === "new-file" ? "new files" : klass === "rename" ? "rename pairs" : "binary files"} is refused in v1; claim the whole file in one group or split the work by hand`,
      });
    }
  }

  // selector drift: claimed hunk numbers must exist in the live enumeration
  for (const [path, claims] of hunkClaimsByFile) {
    const live = facts.liveCounts.get(path);
    if (live === undefined) continue; // not currently changed — consumed-group logic owns it
    for (const { group, numbers } of claims) {
      const over = numbers.filter((n) => n > live);
      if (over.length > 0) {
        errors.push({
          message: `group ${group}: selector drift on '${path}' — hunk ${over[0]} claimed but the file now has ${live} hunk${live === 1 ? "" : "s"}; renumber after earlier commits (the live diff regenerates per group) or edit the selectors`,
        });
      }
    }
  }

  // hunk duplicate membership: the same hunk of a file in two groups
  for (const [path, claims] of hunkClaimsByFile) {
    const seen = new Map<number, number>();
    for (const { group, numbers } of claims) {
      for (const n of numbers) {
        const prior = seen.get(n);
        if (prior !== undefined) {
          errors.push({ message: `'${path}' hunk ${n} is claimed by both group ${prior} and group ${group}` });
        } else {
          seen.set(n, group);
        }
      }
    }
  }

  // hunk coverage: every unstaged hunk of a partially-claimed file is
  // claimed by some group (excluded hunks are not a concept — the file
  // itself is either claimed (partially) or excluded whole)
  for (const [path, claims] of hunkClaimsByFile) {
    const claimedNums = new Set(claims.flatMap((c) => c.numbers));
    const live = facts.liveCounts.get(path);
    const payloads = facts.payloadByNumber.get(path) ?? [];
    if (live === undefined) continue;
    for (let n = 1; n <= live; n += 1) {
      if (!claimedNums.has(n)) {
        const payload = payloads[n - 1] ?? "";
        errors.push({
          message: `coverage: '${path}' hunk ${n} is changed but claimed by no group${payload ? ` (${payload.split("\n")[0]?.slice(0, 40)}…)` : ""} — every hunk of a partially-claimed file must belong to a group; move the work or re-check the grouping`,
        });
      }
    }
  }

  // hunk purity (set-membership): every staged payload ∈ union of claims.
  // The staged payloads are identified by CONTENT, not number — a staged
  // hunk whose content no group claimed is smuggled content.
  for (const [path, staged] of facts.stagedPayloads) {
    if (!hunkClaimsByFile.has(path)) continue; // path-grain purity above already covers whole-file paths
    const claimedPayloads = new Set<string>();
    for (const [n, payload] of (facts.payloadByNumber.get(path) ?? []).entries()) {
      // only hunks some group claimed contribute their payloads
      const claimedNums = new Set((hunkClaimsByFile.get(path) ?? []).flatMap((c) => c.numbers));
      if (claimedNums.has(n + 1)) claimedPayloads.add(payload);
    }
    for (const sp of staged) {
      if (!claimedPayloads.has(sp)) {
        errors.push({
          message: `index: '${path}' has staged hunk content no group claimed — unstage it (repo-stage --unstage '<path>') or claim the whole file in a group; selectors only name unstaged hunks, so hand-staged content needs a whole-file claim`,
        });
      }
    }
  }
  return errors;
}

// ---------------------------------------------------------------------------
// batch-draft expansion: plan claims x live changed set -> draft manifest
// (pure functions; the tool layer supplies the plan text and changed files)
// ---------------------------------------------------------------------------

/** One plan task's commit-relevant claim set, extracted by the tool layer
 * from the plan markdown (task header line + its metadata bullets). */
export interface TaskClaim {
  /** Plan task id, e.g. "2.3". */
  readonly id: string;
  /** True when the task's checkbox is [x] (done tasks no longer hold). */
  readonly done: boolean;
  /** The task title line (subject source when no commit: bullet exists). */
  readonly title: string;
  /** Files: bullet paths, verbatim (files or directories, plan-relative). */
  readonly files: string[];
  /** Hunk-selector claims from Files: bullets: 'path @ spec' entries parsed
   * into path → spec. Rendered as selector entries in the draft; the draft
   * generator makes no content decisions — specs pass through verbatim. */
  readonly hunkSpecs?: ReadonlyMap<string, string>;
  /** commit: bullet subject, when the plan declared one. */
  readonly commitSubject?: string;
}

/** Readiness of one group relative to the plan's open tasks. */
export type GroupReadiness =
  | { ready: true }
  | { ready: false; blockers: { task: string; overlap: string[] }[] };

/** A group whose files overlap an open task's claims is held. Overlap is
 * computed against task `files` claims expanded as prefixes (a claimed
 * directory holds every changed file beneath it). Done tasks never hold. */
export function groupReadiness(files: string[], claims: TaskClaim[]): GroupReadiness {
  const blockers: { task: string; overlap: string[] }[] = [];
  for (const c of claims) {
    if (c.done || c.files.length === 0) continue;
    const overlap = files.filter((f) =>
      c.files.some((claim) => f === claim || f.startsWith(claim.endsWith("/") ? claim : `${claim}/`)),
    );
    if (overlap.length > 0) blockers.push({ task: c.id, overlap });
  }
  return blockers.length === 0 ? { ready: true } : { ready: false, blockers };
}

/** The draft-generation result: groups, unassigned parking lot, conflicts,
 * and per-group readiness — everything the tool layer renders. The
 * generator makes zero content decisions: every changed file lands in a
 * group, in unassigned (with claiming task ids as hint), or in conflicts
 * (multi-claimed, parked with both claimants named). */
export interface BatchDraft {
  readonly groups: { number: number; subject: string; files: string[]; hunkSpecs: { path: string; spec: string }[]; readiness: GroupReadiness }[];
  /** Changed files no task claims — a parking lot, never a silent exclusion. */
  readonly unassigned: { path: string }[];
  /** Changed files claimed by two or more tasks — parked, both named. */
  readonly conflicts: { path: string; tasks: string[] }[];
}

/** Expand task claims against the live changed set: each changed file goes
 * to the single task whose claim covers it (directory claims match
 * prefixes); multi-claimed files park in conflicts; unclaimed park in
 * unassigned. One group per claiming task, in first-claim order, subjects
 * from commitSubject ?? title. Readiness derived per group. */
export function draftFromClaims(changedPaths: string[], claims: TaskClaim[]): BatchDraft {
  const groups = new Map<string, { subject: string; files: string[]; hunkSpecs: { path: string; spec: string }[] }>();
  const unassigned: { path: string }[] = [];
  const conflicts: { path: string; tasks: string[] }[] = [];

  const claimOf = (path: string): string[] => {
    const out: string[] = [];
    for (const c of claims) {
      if (c.files.some((claim) => path === claim || path.startsWith(claim.endsWith("/") ? claim : `${claim}/`))) {
        out.push(c.id);
      }
    }
    return out;
  };

  // Selector-claiming tasks for a path (hunk-grain ownership).
  const selectorClaimants = (path: string): string[] =>
    claims.filter((c) => c.hunkSpecs?.has(path)).map((c) => c.id);

  for (const path of changedPaths) {
    // Paths claimed via selectors route through the hunk pass below —
    // different hunks of one file in different groups is the intended
    // shape (same-hunk duplication refuses at stage time, never silently).
    if (selectorClaimants(path).length > 0 && claimOf(path).length === 0) continue;
    const owners = claimOf(path);
    if (owners.length === 0) {
      unassigned.push({ path });
      continue;
    }
    if (owners.length > 1) {
      conflicts.push({ path, tasks: owners });
      continue;
    }
    const owner = owners[0] ?? "";
    const claim = claims.find((c) => c.id === owner);
    if (claim && !groups.has(owner)) {
      groups.set(owner, { subject: claim.commitSubject ?? claim.title, files: [], hunkSpecs: [] });
    }
    groups.get(owner)?.files.push(path);
  }

  // Hunk-selector claims: each claimant's specs land in its own group,
  // verbatim. A path both whole-file-claimed AND selector-claimed (by any
  // task mix) is a conflict — the whole-file claim would swallow the
  // selectors' hunks at stage time.
  for (const c of claims) {
    if (!c.hunkSpecs) continue;
    for (const [path, spec] of c.hunkSpecs) {
      if (claimOf(path).length > 0) {
        conflicts.push({ path, tasks: [...claimOf(path), `${c.id} (@ hunks)`] });
        continue;
      }
      if (!groups.has(c.id)) {
        groups.set(c.id, { subject: c.commitSubject ?? c.title, files: [], hunkSpecs: [] });
      }
      const g = groups.get(c.id)!;
      if (!g.hunkSpecs.some((h) => h.path === path)) g.hunkSpecs.push({ path, spec });
    }
  }

  // Groups in CLAIM order (plan task order), not file-iteration order —
  // deterministic, readable drafts that mirror the plan.
  const orderedIds = claims.filter((c) => groups.has(c.id)).map((c) => c.id);
  const numbered = orderedIds.map((id, i) => {
    const g = groups.get(id) as { subject: string; files: string[]; hunkSpecs: { path: string; spec: string }[] };
    // A path with a selector entry drops its whole-file entry within the
    // same group (the selector is the tighter claim); whole-file entries in
    // OTHER groups stay and repo-stage validation refuses the duplicate at
    // stage time (visible in the draft, never silent).
    const selectorPaths = new Set(g.hunkSpecs.map((h) => h.path));
    const files = g.files.filter((f) => !selectorPaths.has(f));
    return {
      number: i + 1,
      subject: `${id} — ${g.subject}`,
      files,
      hunkSpecs: g.hunkSpecs,
      readiness: groupReadiness(g.files, claims),
    };
  });

  return { groups: numbered, unassigned, conflicts };
}

/** Render a BatchDraft as manifest text: groups with readiness annotation
 * comments, unassigned and conflicts as draft-only parking sections (the
 * user resolves them by hand; repo-stage's parser accepts only the group +
 * excluded sections, so parking sections are clearly marked and must be
 * emptied or removed before staging). */
export function renderDraft(draft: BatchDraft, title: string): string {
  const lines: string[] = [`# Commit batch: ${title}`, ``];
  for (const g of draft.groups) {
    const hold = g.readiness.ready
      ? `<!-- readiness: ready -->`
      : `<!-- readiness: hold — open task${g.readiness.blockers.length > 1 ? "s" : ""} ${g.readiness.blockers.map((b) => b.task).join(", ")} can still change these files -->`;
    lines.push(`## group ${g.number} — ${g.subject}`);
    lines.push(hold);
    for (const f of g.files) lines.push(`- ${f}`);
    for (const h of g.hunkSpecs) lines.push(`- ${h.path} @ ${h.spec}`);
    lines.push(``);
  }
  if (draft.conflicts.length > 0) {
    lines.push(`<!-- DRAFT ONLY — resolve by hand: each file below is claimed by multiple tasks. Move each into exactly one group, then delete this comment block. -->`);
    for (const c of draft.conflicts) lines.push(`<!-- conflict: ${c.path} claimed by ${c.tasks.join(", ")} -->`);
    lines.push(``);
  }
  if (draft.unassigned.length > 0) {
    lines.push(`<!-- DRAFT ONLY — no task claims these files. Assign each to a group, add an ## excluded section for deliberate omissions, or delete this comment block when empty. -->`);
    for (const u of draft.unassigned) lines.push(`<!-- unassigned: ${u.path} -->`);
    lines.push(``);
  }
  return lines.join("\n");
}
