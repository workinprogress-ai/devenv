// hunk-stage.ts — the partial-staging engine (domain module, I/O injected).
//
// Layered on the pure primitives in hunk-select.ts: this module owns the
// git-facing choreography (enumerate → resolve → build → preflight → apply
// → verify) behind an injected executor so it stays testable against real
// temp repos without the tool layer. The CLI modes (repo-stage path/batch)
// compose `stageSelection`; tests may compose the same functions or drive
// the whole entry.
//
// Regenerate + echo protocol: selectors always resolve against the LIVE
// worktree-vs-index diff at staging time. Committing or staging earlier
// groups renumbers the live hunks; that drift is detected at validation
// (out-of-range selectors refuse naming the live count) and the post-apply
// verification proves the staged content equals the resolved selection.
//
// Verification-failure policy: report the mismatch plus a
// `git restore --staged <path>` recipe. The tool never mutates beyond its
// mandate to fix its own error; the restore is the user's (or skill's) call.
import {
  type DiffHunk,
  HunkParseError,
  buildSelectionPatch,
  hunkPayload,
  splitDiff,
} from "./hunk-select.ts";

/** Config overrides + flags that pin `git diff` to the one rendering the
 * engine parses and re-applies. A user's diff.noprefix, diff.mnemonicPrefix,
 * diff.external, diff.context, diff.interHunkContext, diff.renames, textconv
 * drivers, colour or quoted-path settings would otherwise change header shape
 * or hunk numbering and break parsing or mis-number hunks. */
export function diffArgs(...rest: string[]): string[] {
  return [
    "-c", "diff.noprefix=false",
    "-c", "diff.mnemonicPrefix=false",
    "-c", "core.quotePath=false",
    "diff",
    "--no-ext-diff", "--no-textconv", "--no-color", "--no-renames",
    "--src-prefix=a/", "--dst-prefix=b/",
    "-U3", "--inter-hunk-context=0",
    ...rest,
  ];
}

/** One git invocation's result (spawnSync-shaped). */
export interface ExecResult {
  status: number;
  stdout: string;
  stderr: string;
}

/** Injected git executor: runs `git <args...>` with optional stdin; the
 * caller pins cwd (repoRoot) and environment. */
export type GitExec = (args: string[], input?: string) => ExecResult;

/** v1 partial-claim refusal classes (doctrine choices, not mechanics —
 * see the plan's spike finding 5). */
export type RefusalClass = "binary" | "rename" | "new-file";

/** A path's enumerated live state: its hunks and any refusal class. */
export interface FileEnumeration {
  path: string;
  /** The diff preamble (file headers) — re-used when building patches. */
  preamble: string[];
  /** Live unstaged hunks (worktree vs index), 1-based enumeration. */
  hunks: DiffHunk[];
  /** Refusal class when partial claims on this file are refused. */
  refusalClass?: RefusalClass;
}

/** Structured engine refusal: named, renderable, remediation-bearing. The
 * `kind` discriminates failure classes so the CLI never re-parses prose
 * (a path named src/renamed/x.ts must not classify as a rename refusal). */
export interface EngineError {
  path: string;
  /** Failure class: refusal classes mirror the v1 doctrine; drift is a
   * selector/count mismatch; verify is a post-apply invariant failure;
   * apply is a git-apply failure; enum is an enumeration failure. */
  kind: "binary" | "rename" | "new-file" | "drift" | "verify" | "apply" | "enum";
  message: string;
}

/**
 * Enumerate one file's live unstaged diff: hunks plus refusal class.
 *
 * Classification: a rename (from `git diff --name-status` R status), a
 * new file (`new file mode` in the preamble), or a binary diff (`GIT
 * binary patch` / `Binary files ... differ`). Anything else enumerates.
 * A file with no unstaged diff returns zero hunks (the caller decides
 * whether that is consumption or a mistake).
 */
export function enumerateFile(exec: GitExec, path: string): FileEnumeration | EngineError {
  // Rename detection needs the UNFILTERED diff: a rename line carries both
  // paths, so a pathspec-filtered name-status normalizes the new side to A
  // and never shows R. Scan the full worktree-vs-index name-status (with
  // --find-renames, mirroring changedFiles() discipline) for R lines naming
  // this path on either side.
  const statusAll = exec(diffArgs("--name-status", "--find-renames"));
  if (statusAll.status !== 0) {
    return { path, message: `git diff --name-status failed: ${statusAll.stderr.trim()}`, kind: "enum" };
  }
  for (const line of statusAll.stdout.split("\n")) {
    if (!line.startsWith("R")) continue;
    // R100\told\tnew — tab-separated
    const parts = line.split("\t");
    const oldP = parts[1] ?? "";
    const newP = parts[2] ?? "";
    if (newP === path || oldP === path) {
      return { path, message: `'${path}' is a rename diff (with '${oldP === path ? newP : oldP}') — partial staging of rename pairs is refused in v1; claim the whole file in one group or split the work by hand`, kind: "rename" };
    }
  }
  const diff = exec(diffArgs("--", path));
  if (diff.status !== 0) {
    return { path, message: `git diff failed for '${path}': ${diff.stderr.trim()}`, kind: "enum" };
  }
  // Refusal-class markers live in the PREAMBLE — the text before the
  // first line STARTING with @@ (a filename may itself contain '@@', so
  // substring indexOf is wrong; anchor to the line start). Changed
  // content lines can legitimately contain the marker text (a code line
  // reading `"new file mode"`) — unanchored matching false-refuses.
  const anchorMatch = /^@@/m.exec(diff.stdout);
  const firstAt = anchorMatch === null ? -1 : anchorMatch.index;
  const preambleText = firstAt === -1 ? diff.stdout : diff.stdout.slice(0, firstAt);
  if (preambleText.includes("GIT binary patch") || /Binary files .* differ/.test(preambleText)) {
    return { path, message: `'${path}' is a binary diff — partial staging of binary files is refused in v1; claim the whole file in one group or split the work by hand`, kind: "binary" };
  }
  if (preambleText.includes("new file mode")) {
    return { path, message: `'${path}' is a new file — partial staging of new files is refused in v1 (intermediate commits must be individually mergeable); claim the whole file in one group or split the work by hand`, kind: "new-file" };
  }
  // Deleted-in-worktree tracked files (preamble 'deleted file mode') render
  // as one all-removal hunk — deletions are whole-file claims (path mode /
  // batch whole-file entry; --patch refuses deletion patches); a selector
  // staging the full deletion would bypass that doctrine.
  if (preambleText.includes("deleted file mode")) {
    return { path, message: `'${path}' is deleted in the worktree — deletions are whole-file claims (path mode or a batch whole-file entry), not hunk selectors`, kind: "enum" };
  }
  if (diff.stdout.trim() === "") {
    // Nothing textual unstaged. An untracked path also lands here via its
    // empty diff — classify explicitly so the CLI never reports a fake
    // "0 hunks" drift for a file git cannot see.
    const ls = exec(["ls-files", "--error-unmatch", "--", path]);
    if (ls.status !== 0) {
      return { path, message: `'${path}' is untracked — partial staging of new files is refused in v1 (intermediate commits must be individually mergeable); claim the whole file in one group`, kind: "new-file" };
    }
    return { path, preamble: [], hunks: [] };
  }
  if (!diff.stdout.includes("@@") && /old mode |new mode /.test(diff.stdout)) {
    return { path, message: `'${path}' has only a mode change unstaged — there are no text hunks to select; stage the whole path or adjust the mode by hand`, kind: "enum" };
  }
  try {
    const { preamble, hunks } = splitDiff(diff.stdout);
    return { path, preamble, hunks };
  } catch (e) {
    if (e instanceof HunkParseError) {
      return { path, message: `cannot parse the live diff for '${path}': ${e.message}`, kind: "enum" };
    }
    throw e;
  }
}

/**
 * Resolve a selector list against a file's enumeration: payload per chosen
 * hunk number, refusing out-of-range selectors with the live count and
 * remediation (renumbering after earlier groups, or edit the selectors).
 */
export function resolveSelectors(
  enumeration: FileEnumeration,
  numbers: readonly number[],
): { payloads: string[]; headers: string[] } | EngineError {
  const live = enumeration.hunks.length;
  const over = numbers.filter((n) => n < 1 || n > live);
  if (over.length > 0) {
    return {
      path: enumeration.path,
      kind: "drift",
      message: `selector drift on '${enumeration.path}': hunk ${over[0]} claimed but the file now has ${live} hunk${live === 1 ? "" : "s"} — renumber after earlier commits (the live diff regenerates per group) or edit the selectors`,
    };
  }
  const chosen = enumeration.hunks.filter((h) => numbers.includes(h.index));
  return {
    payloads: chosen.map(hunkPayload),
    headers: chosen.map((h) => h.header),
  };
}

/** A successful partial-stage result: what landed and what remains. */
export interface StageSelectionResult {
  path: string;
  /** Hunk headers actually staged (echo material). */
  stagedHeaders: string[];
  /** Payload identities staged. */
  stagedPayloads: string[];
  /** Live hunk count remaining for this file after staging. */
  remaining: number;
  /** Warnings: staged-diff rendering merged adjacent hunks, or identical
   * payload content is staged more often than claimed (attribution
   * ambiguity). Non-empty means the caller surfaces the staged diff for
   * explicit approval (the uncertainty trigger). */
  readonly warnings: string[];
}

/**
 * The composer: enumerate → resolve → build → preflight → apply → verify.
 *
 * Applies exactly the selected hunks to the index via `git apply --cached`,
 * leaving the working tree untouched. Verification is the three-part
 * invariant, checked against a snapshot taken BEFORE apply (comparing
 * against a freshly regenerated diff after apply would misattribute
 * drift — the apply itself changes the unstaged diff):
 *   1. the path's index blob equals the pre-apply index content with exactly
 *      the selected hunks applied (verified by blob hash, computed in-process);
 *   2. every other index entry is unchanged;
 *   3. the working tree file is byte-identical before and after.
 *
 * On verification failure: report with a `git restore --staged <path>`
 * recipe; the index is left exactly as apply left it (report + recipe
 * policy — the tool never mutates beyond its mandate to fix its own
 * error).
 */
export function stageSelection(
  exec: GitExec,
  path: string,
  numbers: readonly number[],
): StageSelectionResult | EngineError {
  const enumeration = enumerateFile(exec, path);
  if ("message" in enumeration) return enumeration;
  const resolution = resolveSelectors(enumeration, numbers);
  if ("message" in resolution) return resolution;
  const selectedPayloads = resolution.payloads;
  const unselected = enumeration.hunks.filter((h) => !numbers.includes(h.index)).map(hunkPayload);

  // Pre-apply snapshots: staged payloads already in the index for this
  // path, and the worktree file's hash (apply --cached never writes the
  // worktree; the hash check proves it held).
  const preStaged = extractPayloads(exec(diffArgs("--cached", "--", path)).stdout);
  const indexBefore = captureIndex(exec, path);
  const lossyBefore = nonUtf8IndexProblem(exec, path, indexBefore);
  if (lossyBefore !== null) return { path, kind: "verify", message: lossyBefore };
  const worktreeHashBefore = exec(["hash-object", "--", path]).stdout.trim();

  let patch: string;
  try {
    patch = buildSelectionPatch(enumeration.preamble, enumeration.hunks, [...numbers]);
  } catch (e) {
    if (e instanceof HunkParseError) {
      return { path, message: `cannot build a selection patch for '${path}': ${e.message}`, kind: "drift" };
    }
    throw e;
  }

  // Preflight: applicability only (apply is context-tolerant; correctness
  // is proven by the post-apply verification, not by --check).
  const check = exec(["apply", "--cached", "--check", "-"], patch);
  if (check.status !== 0) {
    return {
      path,
      kind: "apply",
      message: `patch does not apply to the index for '${path}': ${check.stderr.trim()} — the worktree may have drifted since grouping; re-check the grouping or edit the selectors`,
    };
  }

  // Apply: stages the patch content into the index, worktree untouched.
  const apply = exec(["apply", "--cached", "-"], patch);
  if (apply.status !== 0) {
    return {
      path,
      kind: "apply",
      message: `git apply --cached failed for '${path}': ${apply.stderr.trim()} — index unchanged`,
    };
  }

  // Verify by content hash: the index blob for this path must be exactly the
  // pre-apply index content with the selected hunks applied (computed here,
  // independently of git apply), and every other index entry must be
  // untouched. Rendering-level comparisons (merged hunks, reordered payloads)
  // cannot false-refuse or false-accept under this check.
  const stagedNow = extractPayloads(exec(diffArgs("--cached", "--", path)).stdout);
  const warnings: string[] = [];
  const known = [...preStaged, ...selectedPayloads];
  const chosen = enumeration.hunks.filter((h) => numbers.includes(h.index));
  const problem = verifyIndexAfter(exec, path, indexBefore, chosen);
  if (problem !== null) {
    return {
      path,
      kind: "verify",
      message: `verification failed for '${path}': ${problem} — restore with 'git restore --staged ${path}' and re-group (apply is context-tolerant and may have matched unexpected content)`,
    };
  }
  // Merge-rendering note: fewer staged hunks than distinct claims imply —
  // warn so the caller surfaces the staged diff (uncertainty trigger).
  if (stagedNow.length < new Set(known).size) {
    warnings.push("staged hunks merged in rendering (adjacent staged content) — confirm the staged diff");
  }
  // Twin-payload multiplicity: identical payload content staged more
  // often than claimed — attribution ambiguity the stateless model cannot
  // resolve; warn so the caller triggers the staged-diff approval.
  const claimedCounts = new Map<string, number>();
  for (const p of selectedPayloads) claimedCounts.set(p, (claimedCounts.get(p) ?? 0) + 1);
  const stagedCounts = new Map<string, number>();
  for (const p of stagedNow) stagedCounts.set(p, (stagedCounts.get(p) ?? 0) + 1);
  for (const [p, n] of claimedCounts) {
    if ((stagedCounts.get(p) ?? 0) > n) {
      warnings.push(`identical hunk content staged more often than claimed (${n}× claimed, ${stagedCounts.get(p)}× staged) — attribution is ambiguous; surface the staged diff for approval`);
    }
  }
  // Worktree bytes unchanged.
  const worktreeHashAfter = exec(["hash-object", "--", path]).stdout.trim();
  if (worktreeHashBefore !== worktreeHashAfter) {
    return {
      path,
      kind: "verify",
      message: `verification failed for '${path}': the working-tree file changed during staging — this should be impossible with git apply --cached; restore with 'git restore --staged ${path}' and inspect the worktree`,
    };
  }

  return {
    path,
    stagedHeaders: resolution.headers,
    stagedPayloads: selectedPayloads,
    remaining: unselected.length,
    warnings,
  };
}

/** Index state captured before a mutation: every entry (`mode sha`) by path,
 * plus the target path's blob text for the independent re-computation. */
export interface IndexCapture {
  entries: Map<string, string> | null;
  text: string | null;
}

export function captureIndex(exec: GitExec, path: string): IndexCapture {
  const ls = exec(["-c", "core.quotePath=false", "ls-files", "--stage", "-z"]);
  if (ls.status !== 0) return { entries: null, text: null };
  const entries = new Map<string, string>();
  for (const rec of ls.stdout.split("\0")) {
    if (rec === "") continue;
    const tab = rec.indexOf("\t");
    if (tab < 0) continue;
    const [mode = "", sha = "", stage = ""] = rec.slice(0, tab).split(" ");
    entries.set(`${rec.slice(tab + 1)}\x00${stage}`, `${mode} ${sha}`);
  }
  const mine = entries.get(`${path}\x000`);
  const sha = mine?.split(" ")[1];
  const blob = sha === undefined ? null : exec(["cat-file", "blob", sha]);
  return { entries, text: blob !== null && blob.status === 0 ? blob.stdout : null };
}

/** Apply hunks to text in-process (no git): each hunk is located by its
 * old-side lines nearest the header's line number (apply-style offset
 * tolerance, no fuzz). Returns null when a hunk does not match. */
export function applyHunks(oldText: string, hunks: readonly DiffHunk[]): string | null {
  const oldLines = oldText === "" ? [] : oldText.split(/(?<=\n)/);
  const bare = (l: string | undefined): string => (l ?? "").replace(/\n$/, "");
  const ordered = [...hunks].sort((a, b) => a.index - b.index);
  const out: string[] = [];
  let pos = 0;
  for (const h of ordered) {
    const m = /^@@ -(\d+)(?:,(\d+))? \+\d+(?:,\d+)? @@/.exec(h.header);
    if (m === null) return null;
    const oldStart = Number(m[1]);
    const oldCount = m[2] === undefined ? 1 : Number(m[2]);
    const nominal = oldCount === 0 ? oldStart : oldStart - 1;
    const block = h.lines.filter((l) => l.startsWith(" ") || l.startsWith("-")).map((l) => l.slice(1));
    const fits = (i: number): boolean =>
      i >= pos && i + block.length <= oldLines.length && block.every((l, k) => bare(oldLines[i + k]) === l);
    let start = -1;
    if (block.length === 0) {
      start = Math.min(Math.max(nominal, pos), oldLines.length);
    } else {
      for (let d = 0; d <= oldLines.length && start < 0; d += 1) {
        if (fits(nominal + d)) start = nominal + d;
        else if (d > 0 && fits(nominal - d)) start = nominal - d;
      }
    }
    if (start < 0) return null;
    out.push(...oldLines.slice(pos, start));
    let k = start;
    let last: "old" | "del" | "add" | "" = "";
    for (const l of h.lines) {
      const c = l[0];
      if (c === " ") { out.push(oldLines[k] ?? ""); k += 1; last = "old"; }
      else if (c === "-") { k += 1; last = "del"; }
      else if (c === "+") { out.push(`${l.slice(1)}\n`); last = "add"; }
      else if (c === "\\" && last === "add") out[out.length - 1] = (out[out.length - 1] ?? "").replace(/\n$/, "");
    }
    pos = k;
  }
  out.push(...oldLines.slice(pos));
  return out.join("");
}

/** Refusal text when the path's index blob does not survive a UTF-8 text
 * round-trip: the in-process re-computation would hash replacement characters
 * instead of the real bytes, so byte-exact verification is impossible. Null
 * when the blob is lossless (or absent — verification reports that case). */
export function nonUtf8IndexProblem(exec: GitExec, path: string, capture: IndexCapture): string | null {
  if (capture.entries === null || capture.text === null) return null;
  const sha = capture.entries.get(`${path}\x000`)?.split(" ")[1];
  if (sha === undefined) return null;
  if (exec(["hash-object", "--stdin"], capture.text).stdout.trim() === sha) return null;
  return `the index content of '${path}' is not valid UTF-8 — hunk staging cannot verify it byte-exactly; stage the whole file instead`;
}

/** Check the index after an apply: the path's blob hash equals the
 * independently computed expectation and no other entry changed. Returns a
 * problem description, or null when the index is exactly as intended. */
export function verifyIndexAfter(
  exec: GitExec,
  path: string,
  before: IndexCapture,
  hunks: readonly DiffHunk[],
): string | null {
  if (before.entries === null || before.text === null) return "the pre-apply index could not be captured for verification";
  const expectedText = applyHunks(before.text, hunks);
  if (expectedText === null) return "the selected hunks could not be re-applied in-process to the pre-apply index content";
  const expectedSha = exec(["hash-object", "--stdin"], expectedText).stdout.trim();
  const after = captureIndex(exec, path);
  if (after.entries === null) return "the post-apply index could not be read for verification";
  const key = `${path}\x000`;
  const mine = after.entries.get(key);
  const beforeMine = before.entries.get(key);
  if (mine === undefined) return "the path is absent from the index after apply";
  const [mode = "", sha = ""] = mine.split(" ");
  if (sha !== expectedSha) return "the staged blob is not the pre-apply index content plus exactly the selected hunks";
  if (beforeMine !== undefined && beforeMine.split(" ")[0] !== mode) return "the file mode in the index changed";
  const names = new Set([...before.entries.keys(), ...after.entries.keys()]);
  for (const name of names) {
    if (name === key) continue;
    if (before.entries.get(name) !== after.entries.get(name)) {
      return `another index entry changed (${name.split("\x00")[0]})`;
    }
  }
  return null;
}

/** Non-mutating preflight of a hunk claim: enumerate, resolve, build the
 * patch and `apply --cached --check` it. Lets a caller validate every claim of
 * a group before the first mutation. */
export function preflightSelection(exec: GitExec, path: string, numbers: readonly number[]): EngineError | null {
  const enumeration = enumerateFile(exec, path);
  if ("message" in enumeration) return enumeration;
  const resolution = resolveSelectors(enumeration, numbers);
  if ("message" in resolution) return resolution;
  let patch: string;
  try {
    patch = buildSelectionPatch(enumeration.preamble, enumeration.hunks, [...numbers]);
  } catch (e) {
    if (e instanceof HunkParseError) {
      return { path, message: `cannot build a selection patch for '${path}': ${e.message}`, kind: "drift" };
    }
    throw e;
  }
  const check = exec(["apply", "--cached", "--check", "-"], patch);
  if (check.status !== 0) {
    return { path, kind: "apply", message: `patch does not apply to the index for '${path}': ${check.stderr.trim()}` };
  }
  const lossy = nonUtf8IndexProblem(exec, path, captureIndex(exec, path));
  if (lossy !== null) return { path, kind: "verify", message: lossy };
  return null;
}

/** Extract hunk payload identities from a full unified diff (multi-hunk).
 * Exported: the CLI's facts collector and patch-mode verification reuse
 * the same payload-identity definition (one copy, not drifting twins). */
export function extractPayloads(diff: string): string[] {
  const out: string[] = [];
  let current: string[] | null = null;
  for (const line of diff.split("\n")) {
    if (line.startsWith("@@")) {
      if (current) out.push(current.join("\n"));
      current = [];
    } else if (current) {
      if (line.startsWith("+") || line.startsWith("-")) current.push(line.slice(1));
    }
  }
  if (current) out.push(current.join("\n"));
  return out;
}
