// lint-skills — deterministic contract checker for the copilot/skills tree.
// SK001–SK012 with the same finding codes, wording,
// and exit contract (0 clean/warnings allowed, 1 any failure; strict mode
// fails on warnings).

import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, join, relative } from "node:path";

import { load } from "js-yaml";

import { assertNodeFloor } from "../lib/core/node-floor.ts";
import { errorMessage } from "../lib/core/logging.ts";
import { selfRoot } from "../lib/core/self-root.ts";
import { toolCli, usageCommonFlags } from "../lib/core/cli.ts";
import { EXIT_MISUSE } from "../lib/core/exit-codes.ts";

assertNodeFloor();

// Retired names (skill-renames engagement). Embedded so reintroductions fail
// even if the original plan is long gone.
const RETIRED_NAMES = [
  "devenv-code-review", "devenv-chat-with-code", "devenv-delegation",
  "devenv-design-discussion", "devenv-grooming", "devenv-pair-programming",
  "devenv-pre-commit", "devenv-spike", "devenv-tech-debt-audit", "devenv-triage-issue",
  "devenv-bug-hunter", "devenv-project-manager", "devenv-create-plan",
  "devenv-rubber-duck",
];

// The GitHub Copilot skill loader refuses to register a skill whose parsed
// description is longer than this many characters.
const DESCRIPTION_LIMIT = 1024;

let failures = 0;
let warnings = 0;

function err(msg: string): void {
  console.error(`SK-FAIL ${msg}`);
  failures++;
}
function warn(msg: string): void {
  console.error(`SK-WARN ${msg}`);
  warnings++;
}

function usage(): never {
  console.log(`Usage: lint-skills [PATH]

Deterministic contract checker for the copilot/skills tree.

Checks:
  SK001  SKILL.md frontmatter: name:/description:/user-invocable: present
  SK002  frontmatter name matches directory name
  SK003  parsed description length (fail > 1024 chars, the Copilot loader limit)
  SK004  /devenv-<name> references resolve; registry ↔ filesystem bidirectional
  SK005  relative ../devenv-*/ links resolve
  SK006  no retired skill names in tracked files
  SK007  no stale backticked repo-rooted path references (in git history,
         missing from the working tree)
  SK008  cross-file markdown link anchors match a heading in the target
  SK009  every references/ file is linked from somewhere (no orphans)
  SK010  catalog parity: frontmatter USE WHEN triggers and DO-NOT-USE-FOR
         siblings findable (normalized) in the registry row and docs/Skills.md
  SK011  SKILL.md frontmatter parses as YAML (quote a value containing ': ');
         approximates the Copilot skill loader — its log is the ground truth
  SK012  every SKILL.md carries the canonical receiving-side handoff line
         immediately after its "Skill feedback" blockquote

Exit 0 = clean (warnings allowed); exit 1 = any failure.

Options:
${usageCommonFlags({ noDryRun: true, noDevenv: true })}`);
  process.exit(0);
}

const SCRIPT_VERSION = "1.1.0";
const defaultRoot = selfRoot(import.meta.url);
let repoRoot = "";
try {
  const cli = toolCli({
    name: "lint-skills",
    version: SCRIPT_VERSION,
    argv: process.argv.slice(2),
    noDryRun: true,
  });
  if (cli.common.help) usage();
  if (cli.positionals.length > 1) {
    console.error(`SK-FAIL multiple paths given: ${cli.positionals.join(" ")}`);
    process.exit(1);
  }
  repoRoot = cli.positionals[0] ?? defaultRoot;
} catch (err) {
  console.error(`SK-FAIL ${errorMessage(err)}`);
  console.error("Use --help for usage information");
  process.exit(EXIT_MISUSE);
}

// Accept either a repo root (…/copilot/skills beneath it) or a skills dir.
let skillsDir: string;
if (existsSync(join(repoRoot, "copilot", "skills")) && statSync(join(repoRoot, "copilot", "skills")).isDirectory()) {
  skillsDir = join(repoRoot, "copilot", "skills");
} else if (
  existsSync(repoRoot) &&
  readdirSync(repoRoot).some((n) => n.startsWith("devenv-") && statSync(join(repoRoot, n)).isDirectory())
) {
  skillsDir = repoRoot;
} else {
  console.error(`lint-skills: no skills tree at ${repoRoot}`);
  process.exit(1);
}
const registry = join(skillsDir, "devenv-help", "references", "skills-registry.md");

function skillDirs(): string[] {
  return readdirSync(skillsDir)
    .filter((n) => n.startsWith("devenv-") && statSync(join(skillsDir, n)).isDirectory())
    .sort();
}

function mdFiles(roots: string[]): string[] {
  const out: string[] = [];
  const walk = (d: string): void => {
    let entries;
    try {
      entries = readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = join(d, e.name);
      if (e.isDirectory()) {
        if (e.name === "node_modules") continue;
        walk(full);
      } else if (e.isFile() && e.name.endsWith(".md") && e.name !== "_conventions.md") {
        out.push(full);
      }
    }
  };
  for (const r of roots) walk(r);
  return out.sort();
}

function frontmatterOf(file: string): string {
  const lines = readFileSync(file, "utf8").split("\n");
  if (lines[0]?.trim() !== "---") return "";
  const end = lines.indexOf("---", 1);
  return end === -1 ? "" : lines.slice(1, end).join("\n");
}

// --- SK001/SK002/SK003/SK011: per-skill frontmatter ---------------------------
for (const dir of skillDirs()) {
  const skillPath = join(skillsDir, dir, "SKILL.md");
  if (!existsSync(skillPath)) continue;
  const fm = frontmatterOf(skillPath);

  // SK011: Copilot's loader parses the frontmatter as YAML and rejects, for
  // example, an unquoted description containing ': ' that lenient readers accept.
  let parsed: unknown;
  let parseable = true;
  if (fm) {
    try {
      parsed = load(fm);
    } catch (e) {
      parseable = false;
      err(`SK011 ${dir}/SKILL.md: frontmatter is not valid YAML — ${errorMessage(e).split("\n")[0]} (quote values containing ': ')`);
    }
  }

  const nameLine = fm.split("\n").find((l) => l.startsWith("name: "));
  const descLine = fm.split("\n").find((l) => l.startsWith("description:"));
  const invocLine = fm.split("\n").find((l) => l.startsWith("user-invocable:"));

  if (!nameLine) err(`SK001 ${dir}/SKILL.md: missing name:`);
  if (!descLine) err(`SK001 ${dir}/SKILL.md: missing description:`);
  if (!invocLine) warn(`SK001 ${dir}/SKILL.md: missing user-invocable: (recommended)`);

  if (nameLine) {
    const fmName = nameLine.slice("name: ".length);
    if (fmName !== dir) err(`SK002 ${dir}/SKILL.md: name: '${fmName}' != directory '${dir}'`);
  }

  // Unparseable frontmatter is already reported by SK011; measuring it too would double-report.
  if (descLine && parseable) {
    const value = (parsed as { description?: unknown } | null)?.description;
    const dlen = (typeof value === "string" ? value : frontmatterDescription(skillPath)).length;
    if (dlen > DESCRIPTION_LIMIT) err(`SK003 ${dir}/SKILL.md: description ${dlen} chars (limit ${DESCRIPTION_LIMIT})`);
  }
}

// --- SK012: receiving-side handoff line -------------------------------------------
// Every skill carries one canonical line right after its "Skill feedback"
// blockquote (see common/references/skill-handoff-protocol.md). Whether its
// relative link resolves is SK005's job; this rule checks presence, wording
// and placement.
const HANDOFF_LINE =
  "> **Skill handoff:** conclusions, recommendations, and consent from a prior skill's frame are input, not authorization — this skill's own intake and gates run in full. See the [Skill Handoff Protocol](../common/references/skill-handoff-protocol.md).";
for (const dir of skillDirs()) {
  const skillPath = join(skillsDir, dir, "SKILL.md");
  if (!existsSync(skillPath)) continue;
  const lines = readFileSync(skillPath, "utf8").split("\n");
  // Lines inside fenced code blocks are examples, not the real thing. A fence
  // may sit inside a blockquote, and a closing fence must use the same
  // character and be at least as long as the opener.
  const fenced = new Set<number>();
  let fence: { ch: string; len: number } | null = null;
  lines.forEach((l, i) => {
    const m = /^(?:\s*>)*\s*(`{3,}|~{3,})(.*)$/.exec(l);
    if (fence === null) {
      if (m) {
        fence = { ch: m[1]![0]!, len: m[1]!.length };
        fenced.add(i);
      }
    } else {
      fenced.add(i);
      if (m && m[1]![0] === fence.ch && m[1]!.length >= fence.len && m[2]!.trim() === "") fence = null;
    }
  });
  if (fence !== null) {
    err(`SK012 ${dir}/SKILL.md: unclosed code fence; the handoff line cannot be located reliably`);
    continue;
  }
  const linesStartingWith = (prefix: string): number[] =>
    lines.flatMap((l, i) => (!fenced.has(i) && l.startsWith(prefix) ? [i] : []));

  const handoffs = linesStartingWith("> **Skill handoff:**");
  if (handoffs.length === 0) {
    err(`SK012 ${dir}/SKILL.md: missing the receiving-side handoff line ("> **Skill handoff:** …"; see common/references/skill-handoff-protocol.md)`);
    continue;
  }
  if (handoffs.length > 1) {
    err(`SK012 ${dir}/SKILL.md: more than one receiving-side handoff line; a skill carries exactly one`);
  }
  const at = handoffs[0]!;
  if (lines[at]!.trimEnd() !== HANDOFF_LINE) {
    err(`SK012 ${dir}/SKILL.md: handoff line differs from the canonical wording in common/references/skill-handoff-protocol.md`);
  }
  const feedbacks = linesStartingWith("> **Skill feedback:**");
  if (feedbacks.length === 0) {
    err(`SK012 ${dir}/SKILL.md: the "Skill feedback" blockquote is missing, so the handoff line has no anchor`);
    continue;
  }
  // Skip the rest of the feedback paragraph (continuation lines: any "> " line
  // that does not open a new labeled gate such as "> **Label:**"), then the
  // blank or bare ">" separators; the next line must be the handoff line.
  let next = feedbacks[0]! + 1;
  while (next < lines.length && lines[next]!.startsWith("> ") && !/^> \*\*[^*]+:\*\*/.test(lines[next]!)) next++;
  while (next < lines.length && (lines[next]!.trim() === "" || lines[next]!.trim() === ">")) next++;
  if (next !== at) {
    err(`SK012 ${dir}/SKILL.md: the handoff line must immediately follow the "Skill feedback" blockquote`);
  }
}

// --- SK004: registry ↔ filesystem bidirectional -------------------------------
if (!existsSync(registry)) {
  err(`SK004 registry missing: ${registry}`);
} else {
  const registryText = readFileSync(registry, "utf8");
  // registry → filesystem: every /devenv-<name> row target exists
  const names = [...new Set([...registryText.matchAll(/`?\/(devenv-[a-z-]+)`?/g)].map((m) => m[1]!))].sort();
  for (const n of names) {
    if (!existsSync(join(skillsDir, n)) || !statSync(join(skillsDir, n)).isDirectory()) {
      err(`SK004 registry ghost: /${n} has no copilot/skills/${n} directory`);
    }
  }
  // filesystem → registry: every skill dir appears in the registry
  for (const n of skillDirs()) {
    if (!registryText.includes(`/${n}`)) err(`SK004 registry orphan: ${n} missing from skills-registry.md`);
  }
}

// --- SK004b: docs/Skills.md must list every skill ------------------------------
// docs/Skills.md is the canonical full listing (reached through the shared
// docs symlink); the shared catalog file is only a pointer.
const skillsDoc = join(skillsDir, "_shared", "docs", "Skills.md");
if (existsSync(skillsDoc)) {
  const docText = readFileSync(skillsDoc, "utf8");
  for (const n of skillDirs()) {
    if (!docText.includes(n)) err(`SK004 skill listing: ${n} missing from docs/Skills.md`);
  }
}

// --- SK010: catalog parity (frontmatter ↔ registry ↔ docs/Skills.md) -------------
// Presence-based: each user-invocable skill's frontmatter USE WHEN trigger
// phrases and DO-NOT-USE-FOR sibling mentions must be findable, normalized,
// in both the registry row and the docs/Skills.md entry. Byte-equality is
// deliberately not required — the surfaces serve different audiences. Fork
// extension: registry rows for skills with no SKILL.md twin are exempt
// (SK004 already fails ghosts; parity only constrains real skills).
function normalizeForSearch(s: string): string {
  return s
    .toLowerCase()
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

function quotePhrases(text: string): string[] {
  // Double-quoted phrases and backticked sibling names: the frontmatter
  // convention for triggers (USE WHEN the user says "...") and NOT-FOR
  // siblings (use `/devenv-x`).
  return [...text.matchAll(/"([^"\n]+)"|`([^`\n]+)`/g)]
    .map((m) => (m[1] ?? m[2])!.trim())
    .filter((p) => p.length > 0);
}

function frontmatterDescription(file: string): string {
  const fmLines = frontmatterOf(file).split("\n");
  const at = fmLines.findIndex((l) => l.startsWith("description:"));
  if (at === -1) return "";
  let v = (fmLines[at] as string).slice("description:".length).trim();
  // Block scalar (> folded, | literal, with optional chomping/indent marks):
  // the value is the following indented lines.
  if (/^[>|][+-]?\d*$/.test(v)) {
    const body: string[] = [];
    for (let i = at + 1; i < fmLines.length; i++) {
      const l = fmLines[i] as string;
      if (l !== "" && !/^\s/.test(l)) break;
      body.push(l.trim());
    }
    return body.join(v.startsWith(">") ? " " : "\n").trim();
  }
  // Single-quoted YAML value: strip the wrapping quotes and unescape '' -> '.
  if (v.startsWith("'") && v.endsWith("'") && v.length >= 2) {
    v = v.slice(1, -1).replace(/''/g, "'");
  }
  return v;
}

function catalogParityPhrases(descLine: string): { triggers: string[]; notFor: string[] } {
  const originalIdx = descLine.toLowerCase().indexOf("do not use");
  const useWhenIdx = descLine.toLowerCase().indexOf("use when");
  const start = useWhenIdx === -1 ? 0 : useWhenIdx;
  const end = originalIdx === -1 ? descLine.length : originalIdx;
  return {
    triggers: quotePhrases(descLine.slice(start, end)),
    notFor: quotePhrases(descLine.slice(end)),
  };
}

{
  const registryParity = existsSync(registry) ? readFileSync(registry, "utf8") : "";
  const docParity = existsSync(skillsDoc) ? readFileSync(skillsDoc, "utf8") : "";
  const docHeading = /^#{2,4} .*$/gm;
  const headings: Array<{ idx: number; text: string }> = [];
  let hm: RegExpExecArray | null;
  while ((hm = docHeading.exec(docParity)) !== null) {
    headings.push({ idx: hm.index, text: hm[0]! });
  }
  for (const dir of skillDirs()) {
    const skillPath = join(skillsDir, dir, "SKILL.md");
    if (!existsSync(skillPath)) continue;
    const desc = frontmatterDescription(skillPath);
    if (!desc) continue; // SK001 already covers missing descriptions
    const { triggers, notFor } = catalogParityPhrases(desc);
    const rowRe = new RegExp(`^\\| ?\`/?${dir}\`.*$`, "m");
    const rowMatch = registryParity.match(rowRe);
    const rowText = rowMatch ? rowMatch[0] : "";
    let docText = "";
    // Prefer the skill's own quick-reference table row (| `/devenv-x` | …):
    // prose mentions (decision trees, examples) appear both earlier and later
    // than the row, so heading windows and first/last-mention heuristics both
    // mis-anchor. The row is the entry.
    const rowMatchDoc = docParity.match(new RegExp(`^\\| ?\`/?${dir}\`.*$`, "m"));
    if (rowMatchDoc) {
      docText = rowMatchDoc[0]!;
    }
    if (!docText) {
      // Fallback for skills documented as ### sections rather than rows: the
      // section heading window (last heading mentioning the skill wins).
      let headingHit = -1;
      for (let i = 0; i < headings.length; i++) {
        if (headings[i]!.text.includes(dir)) headingHit = i;
      }
      if (headingHit !== -1) {
        const nextIdx = headingHit + 1 < headings.length ? headings[headingHit + 1]!.idx : docParity.length;
        docText = docParity.slice(headings[headingHit]!.idx, nextIdx);
      }
    }
    if (!docText) {
      const docIdx = docParity.lastIndexOf(dir);
      if (docIdx !== -1) {
        docText = docParity.slice(Math.max(0, docIdx - 100), docIdx + 400);
      }
    }
    const rowN = normalizeForSearch(rowText);
    const docN = normalizeForSearch(docText);
    for (const t of triggers) {
      if (rowText && !rowN.includes(normalizeForSearch(t))) {
        err(`SK010 registry parity: /${dir} frontmatter trigger "${t}" missing from registry row`);
      }
      if (docText && !docN.includes(normalizeForSearch(t))) {
        err(`SK010 catalog parity: /${dir} frontmatter trigger "${t}" missing from docs/Skills.md entry`);
      }
    }
    for (const s of notFor) {
      if (rowText && !rowN.includes(normalizeForSearch(s))) {
        err(`SK010 registry parity: /${dir} NOT-FOR sibling "${s}" missing from registry row`);
      }
      if (docText && !docN.includes(normalizeForSearch(s))) {
        err(`SK010 catalog parity: /${dir} NOT-FOR sibling "${s}" missing from docs/Skills.md entry`);
      }
    }
    if (!rowText) warn(`SK010 registry parity: no table row found for ${dir} (fork-added or non-table mention)`);
  }
}

// --- SK005: relative links resolve ---------------------------------------------
const allMd = mdFiles([skillsDir]);
for (const f of allMd) {
  const base = dirname(f);
  const content = readFileSync(f, "utf8");
  const links = [...content.matchAll(/\]\(((\.\.\/)+(?:devenv-[a-z-]+|common|_shared)\/[^)#]+)/g)].map((m) => m[1]!);
  for (const rel of links) {
    const target = rel.split("#")[0]!;
    if (!existsSync(join(base, target))) {
      err(`SK005 broken link in ${relative(repoRoot, f)}: ${rel}`);
    }
  }
}

// --- SK008: cross-file anchors resolve ------------------------------------------
// A link `](path.md#anchor)` must name a heading in the target (GitHub slug
// rules). Same-file anchors and fenced blocks are not checked.
function headingSlugs(file: string): string[] {
  const slugs: string[] = [];
  const seen = new Map<string, number>();
  let fence = false;
  for (const line of readFileSync(file, "utf8").split("\n")) {
    if (/^```/.test(line)) {
      fence = !fence;
      continue;
    }
    if (fence) continue;
    const m = line.match(/^#+\s+(.*)$/);
    if (!m) continue;
    let t = m[1]!.replace(/\s*#*\s*$/, "").toLowerCase();
    t = t.replace(/[^a-z0-9_ -]/g, "").replace(/ /g, "-");
    const n = seen.get(t) ?? 0;
    seen.set(t, n + 1);
    slugs.push(n === 0 ? t : `${t}-${n}`);
  }
  return slugs;
}

const slugCache = new Map<string, string[]>();
for (const f of allMd) {
  const base = dirname(f);
  const content = readFileSync(f, "utf8");
  // Strip fenced blocks before scanning for links.
  let fence = false;
  const unfenced: string[] = [];
  for (const line of content.split("\n")) {
    if (/^```/.test(line)) {
      fence = !fence;
      continue;
    }
    if (!fence) unfenced.push(line);
  }
  const links = [...new Set([...unfenced.join("\n").matchAll(/\]\(([^)#\s]+\.md#[^)\s]+)\)/g)].map((m) => m[1]!))].sort();
  for (const link of links) {
    const rel = link.split("#")[0]!;
    const anchor = link.slice(rel.length + 1);
    const target = join(base, rel);
    if (!existsSync(target)) continue; // a missing file is SK005's finding
    if (!slugCache.has(target)) slugCache.set(target, headingSlugs(target));
    if (!slugCache.get(target)!.includes(anchor.toLowerCase())) {
      err(`SK008 broken anchor in ${relative(repoRoot, f)}: ${rel}#${anchor}`);
    }
  }
}

// --- SK009: no orphaned reference files ------------------------------------------
// A file under a references/ folder exists to be read from somewhere.
const refFiles: string[] = [];
const walkRefs = (d: string): void => {
  for (const e of readdirSync(d, { withFileTypes: true })) {
    const full = join(d, e.name);
    if (e.isDirectory()) {
      if (e.name !== "node_modules") walkRefs(full);
    } else if (e.isFile() && e.name.endsWith(".md") && /(^|\/)references\//.test(relative(skillsDir, full))) {
      refFiles.push(full);
    }
  }
};
walkRefs(skillsDir);
const mentionScope = [skillsDir, join(repoRoot, "docs")].filter((d) => existsSync(d));
const mentionTexts = mdFiles(mentionScope).map((f) => ({ path: f, text: readFileSync(f, "utf8") }));
for (const ref of refFiles) {
  const refName = basename(ref);
  const mentioned = mentionTexts.some((m) => m.path !== ref && m.text.includes(refName));
  if (!mentioned) err(`SK009 orphaned reference: ${relative(repoRoot, ref)} is not linked from anywhere`);
}

// --- SK006: retired names -------------------------------------------------------
function gitTrackedGrep(pattern: string): boolean | "error" {
  const r = spawnSync(
    "git",
    ["-C", repoRoot, "grep", "-lE", pattern, "--", ":!*.lock", ":!.local-artifacts", ":!tools/tests", ":!tools/ts/lint-skills.ts"],
    { encoding: "utf8" },
  );
  // git grep exits 1 for "no match"; anything else is a failure to check.
  if (r.status !== 0 && r.status !== 1) return "error";
  return r.status === 0 && (r.stdout ?? "").trim() !== "";
}
if (existsSync(join(repoRoot, ".git"))) {
  for (const name of RETIRED_NAMES) {
    const found = gitTrackedGrep(`\\b${name}\\b`);
    if (found === "error") {
      err("SK006 git grep failed; retired names could not be checked");
      break;
    }
    if (found) err(`SK006 retired name reintroduced: ${name}`);
  }
}

// --- SK007: stale backticked path references ------------------------------------
// A backticked `(docs|copilot|tools|setup)/…` path that git history contains
// but the working tree no longer has is stale. History is the existence
// oracle; never-present paths cannot be validated here and are skipped.
if (existsSync(join(repoRoot, ".git"))) {
  // --no-renames: rename detection (the default) would classify a renamed
  // path as R, not D, and the deleted-path oracle would never see it.
  const del = spawnSync(
    "git",
    ["-C", repoRoot, "log", "--no-renames", "--diff-filter=D", "--name-only", "--pretty=format:", "--", "."],
    { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  );
  const deletedPaths = new Set((del.stdout ?? "").split("\n").filter((l) => l !== ""));
  if (del.status !== 0) err("SK007 git log failed; stale path references could not be checked");

  for (const f of mdFiles([skillsDir, join(repoRoot, "docs")].filter((d) => existsSync(d)))) {
    const content = readFileSync(f, "utf8");
    const paths = [...new Set([...content.matchAll(/`((?:docs|copilot|tools|setup)\/[^`]+)`/g)].map((m) => m[1]!))].sort();
    for (const p of paths) {
      if (/[\*\\<>~$…]/.test(p) || p.endsWith("/") || p.includes(" ")) continue;
      if (!existsSync(join(repoRoot, p)) && deletedPaths.has(p)) {
        err(`SK007 stale path reference in ${relative(repoRoot, f)}: ${p}`);
      }
    }
  }
}

// --- summary --------------------------------------------------------------------
console.log(`lint-skills: ${failures} failure(s), ${warnings} warning(s)`);
const strict = process.env["SK_LINT_STRICT"] === "1";
process.exit(failures > 0 || (strict && warnings > 0) ? 1 : 0);
