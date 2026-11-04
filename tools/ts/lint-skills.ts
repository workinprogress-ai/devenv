// lint-skills — deterministic contract checker for the copilot/skills tree.
// Port of lint-skills.sh: SK001–SK009 with the same finding codes, wording,
// and exit contract (0 clean/warnings allowed, 1 any failure; strict mode
// fails on warnings).

import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, join, relative } from "node:path";
import { assertNodeFloor } from "../lib/core/node-floor.ts";
import { selfRoot } from "../lib/core/self-root.ts";

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

const WARN_LIMIT = 1200;
const FAIL_LIMIT = 2000;

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
  SK003  description length (warn > 1200, fail > 2000 chars)
  SK004  /devenv-<name> references resolve; registry ↔ filesystem bidirectional
  SK005  relative ../devenv-*/ links resolve
  SK006  no retired skill names in tracked files
  SK007  no stale backticked repo-rooted path references (in git history,
         missing from the working tree)
  SK008  cross-file markdown link anchors match a heading in the target
  SK009  every references/ file is linked from somewhere (no orphans)

Exit 0 = clean (warnings allowed); exit 1 = any failure.`);
  process.exit(0);
}

const argv = process.argv.slice(2);
if (argv[0] === "-h" || argv[0] === "--help") usage();
const defaultRoot = selfRoot(import.meta.url);
const repoRoot = argv[0] ?? defaultRoot;

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

// --- SK001/SK002/SK003: per-skill frontmatter ---------------------------------
for (const dir of skillDirs()) {
  const skillPath = join(skillsDir, dir, "SKILL.md");
  if (!existsSync(skillPath)) continue;
  const fm = frontmatterOf(skillPath);

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

  if (descLine) {
    const dlen = descLine.length;
    if (dlen > FAIL_LIMIT) err(`SK003 ${dir}/SKILL.md: description ${dlen} chars (limit ${FAIL_LIMIT})`);
    else if (dlen > WARN_LIMIT) warn(`SK003 ${dir}/SKILL.md: description ${dlen} chars (warn at ${WARN_LIMIT})`);
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
function gitTrackedGrep(pattern: string): boolean {
  const r = spawnSync(
    "git",
    ["-C", repoRoot, "grep", "-lE", pattern, "--", ":!*.lock", ":!.local-artifacts", ":!tools/tests", ":!tools/ts/lint-skills.ts"],
    { encoding: "utf8" },
  );
  return r.status === 0 && (r.stdout ?? "").trim() !== "";
}
if (existsSync(join(repoRoot, ".git"))) {
  for (const name of RETIRED_NAMES) {
    if (gitTrackedGrep(`\\b${name}\\b`)) err(`SK006 retired name reintroduced: ${name}`);
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
if (failures === 0 && !strict) process.exit(0);
if (failures > 0) process.exit(1);
process.exit(0);
