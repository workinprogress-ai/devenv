// spec-dependency-check — validate Specifications-*.md dependency graph.
// Port of spec-dependency-check.sh: unknown deps, cycles (DFS with colors),
// group-order violations (same-file), and anchor-link warnings.

import { readFileSync, existsSync } from "node:fs";
import { assertNodeFloor } from "../lib/core/node-floor.ts";
import { invalidArgs } from "../lib/core/args.ts";

assertNodeFloor();

function usage(): never {
  console.log(`Usage: spec-dependency-check FILE [FILE...]

Validate Specifications-*.md documents (pass multiple files for cross-doc
edge checking — cross-file edges are informational, not violations).

Checks:
    unknown      A Depends on: references a SPEC-ID not defined in any input
    cycle        Dependency cycles (including transitive)
    group-order  A specification item depends on one in a LATER priority group
    links        A [SPEC-NNN](#anchor) link whose anchor does not match any
                 heading in the document

Output: JSON {"errors": [...], "warnings": [...], "edges": N, "ok": bool}
Warnings never affect exit status; errors set exit 1.

Exit Codes:
    0 no errors (warnings allowed)
    1 validation errors found
    2 invalid arguments`);
  process.exit(0);
}

interface Spec {
  id: string; group: string; deps: string[]; file: string;
}

const argv = process.argv.slice(2);
if (argv.includes("-h") || argv.includes("--help")) usage();
if (argv.includes("-v") || argv.includes("--version")) {
  console.log("1.0.0");
  process.exit(0);
}

const files: string[] = [];
for (const a of argv) {
  if (a === "-V" || a === "--verbose") continue;
  if (a.startsWith("--")) invalidArgs(`Unknown option: ${a}`);
  if (!existsSync(a)) invalidArgs(`File not found: ${a}`);
  files.push(a);
}
if (files.length === 0) invalidArgs("At least one Specifications file is required");

// Pass 1: per-file extraction (id, group, deps).
const specs: Spec[] = [];
for (const f of files) {
  const lines = readFileSync(f, "utf8").split("\n");
  let cur: Spec | null = null;
  const inOrder: Spec[] = [];
  for (const raw of lines) {
    const h = raw.match(/^#+\s+(SPEC-\d+)/);
    if (h) {
      cur = { id: h[1] as string, group: "", deps: [], file: f };
      inOrder.push(cur);
      continue;
    }
    if (!cur) continue;
    const d = raw.match(/^[ \t]*\*?_*Dependencies:\**[ \t]*(.*)$/);
    if (d) {
      cur.deps = (d[1] ?? "").replace(/\s+/g, "").replace(/,$/, "").split(",").filter((x) => x !== "");
      continue;
    }
    const g = raw.match(/^[ \t]*\*?_*Group:\**[ \t]*(.*)$/);
    if (g) cur.group = g[1] ?? "";
  }
  specs.push(...inOrder);
}

if (specs.length === 0) {
  console.log(JSON.stringify({
    errors: [{ type: "no-spec-ids", detail: "No SPEC-NNN headings found in input" }],
    warnings: [], edges: 0, ok: false,
  }));
  process.exit(1);
}

const index = new Map(specs.map((s) => [s.id, s]));
const edges = specs.flatMap((s) => s.deps.map((d) => ({ from: s.id, to: d })));

const errors: { type: string; detail: string }[] = [];

// Unknown references.
for (const e of edges) {
  if (!index.has(e.to)) {
    errors.push({ type: "unknown", detail: `${e.from} depends on ${e.to} which is not defined` });
  }
}

// Group-order violations (same-file edges only; string compare like jq `>`).
for (const s of specs) {
  if (s.group === "") continue;
  for (const d of s.deps) {
    const dep = index.get(d);
    if (dep && dep.file === s.file && dep.group !== "" && dep.group > s.group) {
      errors.push({ type: "group-order", detail: `${s.id} (group ${s.group}) depends on ${d} in a later group (${dep.group})` });
    }
  }
}

// Cycle detection: DFS with colors (1=in-stack, 2=done).
const color = new Map<string, number>();
let stack: string[] = [];
function visit(id: string): void {
  const c = color.get(id) ?? 0;
  if (c === 1) {
    errors.push({ type: "cycle", detail: [...stack, id].join(" -> ") });
    return;
  }
  if (c === 2 || !index.has(id)) return;
  color.set(id, 1);
  stack.push(id);
  for (const dep of index.get(id)?.deps ?? []) visit(dep);
  stack = stack.slice(0, -1);
  color.set(id, 2);
}
for (const s of specs) visit(s.id);

// Pass 3 (warnings): anchor links per file. Heading slugs the way GitHub
// generates them: lowercase, punctuation dropped, spaces to hyphens, -N on
// the Nth repeat.
const warnings: string[] = [];
for (const f of files) {
  const content = readFileSync(f, "utf8");
  const slugs: string[] = [];
  const seen = new Map<string, number>();
  for (const line of content.split("\n")) {
    const h = line.match(/^#+\s+(.*)$/);
    if (!h) continue;
    const t = (h[1] as string).toLowerCase().replace(/[^a-z0-9 _-]/g, "").replace(/ /g, "-");
    const n = seen.get(t) ?? 0;
    seen.set(t, n + 1);
    slugs.push(n === 0 ? t : `${t}-${n}`);
  }
  const links = [...new Set(content.match(/\[SPEC-\d+\]\(#[^)]+\)/g) ?? [])];
  for (const link of links) {
    const m = link.match(/^\[([^\]]+)\]\(#([^)]+)\)$/);
    if (!m) continue;
    const label = m[1] as string, anchor = m[2] as string;
    const headRe = new RegExp(`^#+.*${label}`, "i");
    if (!content.split("\n").some((l) => headRe.test(l))) {
      warnings.push(`link target heading for ${label} not found in ${f}`);
      console.error(`warning: link target heading for ${label} not found in ${f}`);
    } else if (!slugs.includes(anchor.toLowerCase())) {
      warnings.push(`link anchor #${anchor} for ${label} does not match any heading in ${f}`);
      console.error(`warning: link anchor #${anchor} for ${label} does not match any heading in ${f}`);
    }
  }
}

const ok = errors.length === 0;
console.log(JSON.stringify({ errors, warnings, edges: edges.length, ok }));
process.exit(ok ? 0 : 1);
