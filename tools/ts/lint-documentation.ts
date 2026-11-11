// lint-documentation — run markdownlint-cli2 over the workspace docs (or
// explicit files) and check relative .md links + their in-page anchors.
// Port of lint-documentation.sh: --fix mode applies autofixes and reports
// which files changed; the link check is GitHub-anchor-shaped.

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { assertNodeFloor } from "../lib/core/node-floor.ts";
import { errorMessage } from "../lib/core/logging.ts";
import { selfRoot } from "../lib/core/self-root.ts";
import { toolCli, usageCommonFlags } from "../lib/core/cli.ts";
import { EXIT_MISUSE } from "../lib/core/exit-codes.ts";

assertNodeFloor();

// Derive the checkout root from this file's own location; an exported
// DEVENV_ROOT pointing elsewhere is ignored (self-root contract).
const devenvRoot = selfRoot(import.meta.url);

const SCRIPT_VERSION = "1.0.0";

function usage(): never {
  console.log(`Usage: lint-documentation [--fix] [file ...]

Without file arguments, lints README.md, docs/**/*.md, copilot/skills/**/*.md
and tools/**/*.md (test fixtures excluded).
Also checks relative .md links and their in-page anchors
(GitHub-style fragments) in the linted files.

Options:
    --fix                       Apply markdown autofixes where possible
${usageCommonFlags({ noDryRun: true, noDevenv: true })}`);
  process.exit(0);
}

let fixMode = false;
const files: string[] = [];

try {
  const cli = toolCli({
    name: "lint-documentation",
    version: SCRIPT_VERSION,
    argv: process.argv.slice(2),
    noDryRun: true,
    options: {
      fix: { type: "boolean", default: false },
    },
  });
  if (cli.common.help) usage();
  fixMode = cli.values["fix"] === true;
  files.push(...cli.positionals);
} catch (err) {
  console.error(errorMessage(err));
  console.error("Use --help for usage information");
  process.exit(EXIT_MISUSE);
}

function gitRoot(): string | null {
  const r = spawnSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" });
  return r.status === 0 ? (r.stdout ?? "").trim() : null;
}

function lsFiles(root: string, ...patterns: string[]): string[] {
  const r = spawnSync("git", ["-C", root, "ls-files", ...patterns], { encoding: "utf8" });
  return r.status === 0 ? (r.stdout ?? "").split("\n").filter((l) => l !== "") : [];
}

// In the devenv root: README.md, docs/**, copilot/skills/** and tools/** are
// in scope; test fixtures are deliberately malformed sample inputs.
function inDevenvScope(f: string): boolean {
  if (f.startsWith("tools/tests/fixtures/")) return false;
  return (
    f === "README.md" ||
    f.startsWith("docs/") ||
    f.startsWith("copilot/skills/") ||
    f.startsWith("tools/")
  );
}

let targetRoot: string;
if (files.length === 0) {
  // Inside a git repo under repos/, lint that repo; otherwise devenv docs.
  const gr = gitRoot();
  if (gr && gr.includes("/repos/") && resolve(gr) !== resolve(devenvRoot)) {
    targetRoot = gr;
    files.push(...lsFiles(targetRoot, "*.md"));
  } else {
    targetRoot = devenvRoot;
    files.push(
      ...lsFiles(
        targetRoot,
        "README.md", "docs/*.md", "docs/**/*.md", "copilot/skills/*.md", "copilot/skills/**/*.md",
        "tools/*.md", "tools/**/*.md",
      ).filter(inDevenvScope),
    );
  }
} else {
  targetRoot = gitRoot() ?? devenvRoot;
  // Explicit paths are resolved against the working directory and made
  // relative to the lint root, so ./docs/x.md and absolute paths match.
  const normalised = files.map((f) => {
    const rel = relative(targetRoot, resolve(f));
    return rel === "" || rel.startsWith("..") || isAbsolute(rel) ? f : rel;
  });
  files.length = 0;
  files.push(...normalised);
  if (resolve(targetRoot) === resolve(devenvRoot)) {
    const kept = files.filter(inDevenvScope);
    files.length = 0;
    files.push(...kept);
  }
}

// Session memory and plan files carry free-form AI content that does not
// conform to doc lint rules.
// TODO:DEVENV[Plan-skills-audit-remediation-001]: the Implementation_plan-*.md filename alias is legacy — see the sunset note in plan-parse.ts and drop all three carriers together.
const filtered = files.filter((f) => {
  const b = basename(f);
  return !(b.startsWith("session_") && b.includes("memory")) && !/^Plan-.*\.md$/.test(b) && !/^Implementation_plan-.*\.md$/.test(b);
});
files.length = 0;
files.push(...filtered);

if (files.length === 0) {
  console.log("No markdown files to lint.");
  process.exit(0);
}

console.log("Running markdown linting on:");
for (const f of files) console.log(` - ${f}`);
console.log("");

// markdownlint-cli2 resolves config per-directory (walks up from each file),
// so per-folder .markdownlint.json overrides are honoured automatically.
const markdownlintBin = join(devenvRoot, "node_modules", ".bin", "markdownlint-cli2");
if (!existsSync(markdownlintBin)) {
  console.log(`Error: markdownlint-cli2 is not installed in devenv at ${markdownlintBin}`);
  console.log(`Install it with: pnpm install (in ${devenvRoot})`);
  process.exit(1);
}

const cmd = [markdownlintBin, ...(fixMode ? ["--fix"] : []), ...files];
const before = new Map<string, string>();
if (fixMode) {
  for (const f of files) {
    const full = join(targetRoot, f);
    if (existsSync(full)) before.set(f, createHash("md5").update(readFileSync(full)).digest("hex"));
  }
}

const lint = spawnSync(cmd[0]!, cmd.slice(1), { cwd: targetRoot, stdio: "inherit" });

let fixedAny = false;
if (fixMode) {
  for (const f of files) {
    const full = join(targetRoot, f);
    if (existsSync(full)) {
      const after = createHash("md5").update(readFileSync(full)).digest("hex");
      if (before.get(f) !== after) fixedAny = true;
    }
  }
}

const lintFailed = (lint.status ?? 1) !== 0;
if (lintFailed) {
  console.log("");
  console.log("⚠ Some linting issues could not be auto-fixed.");
  console.log("Please review the errors above and fix them manually.");
}

// ---------------------------------------------------------------------------
// Relative .md link + anchor check: for every relative .md link in the linted
// files, verify the target file exists and — when the link carries a
// #fragment — that a heading matching the anchor (GitHub-style: lowercased,
// spaces as dashes, punctuation stripped) exists in the target. External URLs
// are markdown-link-check's job (CI), not ours.
// ---------------------------------------------------------------------------

function anchorOfHeading(heading: string): string {
  let h = heading;
  h = h.replace(/\|.*$/, ""); // strip table-row remainder
  h = h.replace(/^#+\s*/, ""); // strip leading hashes + space
  h = h.replace(/^.*?\]\s*/, ""); // strip link text prefix like `[x] `
  h = h.replace(/^(?:[-*+]\s+)+/, ""); // strip list markers
  h = h.replace(/^(?:>\s*)+/, ""); // strip blockquote markers
  h = h.toLowerCase();
  h = h.replace(/ /g, "-");
  // GitHub slug rules: keep word characters (letters, digits, underscore) and
  // hyphens; strip other punctuation. Underscores are preserved in slugs.
  h = h.replace(/[`*.,:;!?()[\]&/—–“”‘’#<>]/g, "");
  return h;
}

let linkFailures = 0;
let linksChecked = 0;

for (const mdFile of files) {
  const full = join(targetRoot, mdFile);
  if (!existsSync(full)) continue;
  const fileRel = mdFile.replace(/^\.\//, "");
  const relDir = dirname(fileRel);
  let content = readFileSync(full, "utf8");
  // Skip links inside fenced code blocks and inline code spans: those are
  // teaching examples (template snippets, path conventions), not live links.
  content = content.replace(/```[\s\S]*?```/g, "");
  content = content.replace(/`[^`\n]*`/g, "");
  const links = [...new Set([...content.matchAll(/\]\(([^)\s]+\.md[^)]*)\)/g)].map((m) => m[1]!))].sort();
  for (const link of links) {
    const hash = link.indexOf("#");
    const target = hash === -1 ? link : link.slice(0, hash);
    const anchor = hash === -1 ? "" : link.slice(hash + 1);
    if (!target) continue;
    if (/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(link)) continue;
    const resolvedAbs = resolve(targetRoot, relDir, target);
    const resolved = relative(targetRoot, resolvedAbs);
    linksChecked++;
    if (!existsSync(resolvedAbs)) {
      console.error(`BROKEN LINK: ${fileRel} -> ${link} (file not found)`);
      linkFailures++;
      continue;
    }
    if (!anchor) continue;
    const headings = readFileSync(resolvedAbs, "utf8")
      .split("\n")
      .filter((l) => /^#{1,6} /.test(l))
      .map(anchorOfHeading);
    if (!headings.includes(anchor)) {
      console.error(`DANGLING ANCHOR: ${fileRel} -> ${resolved}#${anchor}`);
      linkFailures++;
    }
  }
}

console.log(`Checked ${linksChecked} relative .md link(s); ${linkFailures} failure(s).`);
if (lintFailed || linkFailures > 0) process.exit(1);

console.log("");
console.log("✓ Markdown linting completed successfully!");
if (fixMode && fixedAny) {
  console.log("");
  console.log(`Review the changes with: git -C '${targetRoot}' diff`);
  console.log(`Stage the changes with: git -C '${targetRoot}' add -A`);
}
