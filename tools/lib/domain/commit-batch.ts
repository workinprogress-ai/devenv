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
//   - <repo-root-relative path>                  one file per line, exactly
//   ## excluded                                  optional, exactly one, last
//   - <path>                                     same entry grammar
//   <!-- ... --> and blank lines                 allowed anywhere
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
  return [...batch.groups.flatMap((g) => g.files), ...batch.excluded];
}

// ---------------------------------------------------------------------------
// strict parser + validators (pure functions over text; no I/O)
// ---------------------------------------------------------------------------

/** A named refusal from parsing or validation. Remediation text is part of
 * the contract: every error names what failed and what to do. */
export interface BatchError {
  message: string;
}

const GROUP_RE = /^## group ([0-9]+) — (.*)$/;
const EXCLUDED_RE = /^## excluded$/;
const TITLE_RE = /^# Commit batch: (.*)$/;
const COMMENT_RE = /^<!--.*-->$/;

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
      groups.push({ number: num, subject, files: [] });
      expected += 1;
      continue;
    }
    if (EXCLUDED_RE.test(line)) {
      if (inExcluded) errors.push({ message: `line ${i + 1}: duplicate '## excluded' section` });
      if (groups.length === 0) errors.push({ message: `line ${i + 1}: '## excluded' before any group — a batch needs at least one group` });
      inExcluded = true;
      continue;
    }
    if (line.startsWith("- ")) {
      const path = line.slice(2).trim();
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
  }
  for (const p of batch.excluded) {
    if (!isLiteralFilePath(p)) {
      errors.push({ message: `excluded: '${p}' is not a literal repo-root-relative file path` });
    }
  }

  // duplicate membership across all sections
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
  }

  // existence, deletion-aware: on disk OR in the changed set (a deleted
  // file is stageable — the changed set carries it)
  const claimed = new Set(batchClaimedPaths(batch));
  for (const g of batch.groups) {
    for (const p of g.files) {
      if (!opts.exists?.has(p) && !changed.has(p)) {
        errors.push({ message: `group ${g.number}: '${p}' exists neither on disk nor as a changed/deleted file — typo?` });
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
  readonly groups: { number: number; subject: string; files: string[]; readiness: GroupReadiness }[];
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
  const groups = new Map<string, { subject: string; files: string[] }>();
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

  for (const path of changedPaths) {
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
      groups.set(owner, { subject: claim.commitSubject ?? claim.title, files: [] });
    }
    groups.get(owner)?.files.push(path);
  }

  // Groups in CLAIM order (plan task order), not file-iteration order —
  // deterministic, readable drafts that mirror the plan.
  const orderedIds = claims.filter((c) => groups.has(c.id)).map((c) => c.id);
  const numbered = orderedIds.map((id, i) => {
    const g = groups.get(id) as { subject: string; files: string[] };
    return {
      number: i + 1,
      subject: `${id} — ${g.subject}`,
      files: g.files,
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
