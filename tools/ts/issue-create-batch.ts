#!/usr/bin/env node
// issue-create-batch.ts - Create multiple GitHub issues in one command.
// Version: 1.1.0
// Requirements: Node >= 23.6 (native type-stripping execution); issue-create
// on PATH (the workspace depth-1 tool) for --create.
//
// Run via the depth-1 bash stub: `exec node "<resolved-src>.ts" "$@"`
//
// Preview-first: the default mode prints the assembled issue-create command
// per entry without touching the provider; --create executes. Two input
// modes: repeated --issue "Title|key=value" entries, or a --file manifest.
// The manifest reader is a bounded YAML-subset parser covering the documented
// schema (maps, lists of maps, flow arrays, block scalars, quoted scalars).

import { parseArgs } from "node:util";
import { basename, join } from "node:path";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";

import { EXIT_GENERAL_ERROR } from "../lib/core/exit-codes.ts";
import { logDebug, logError, logInfo } from "../lib/core/logging.ts";
import { assertNodeFloor } from "../lib/core/node-floor.ts";
import { spawnSync } from "node:child_process";

assertNodeFloor();

const SCRIPT_VERSION = "1.1.0";
const SCRIPT_NAME = basename(process.argv[1] ?? "issue-create-batch.ts");
const TOOLS_ROOT = process.env["DEVENV_TOOLS"] ?? join(import.meta.dirname ?? ".", "..");

function showUsage(): never {
  const s = SCRIPT_NAME;
  console.log(`Usage:
        ${s} --issue "TITLE" [--issue "TITLE|key=value|..."] [OPTIONS]
        ${s} --file MANIFEST [OPTIONS]

Create multiple GitHub issues in one pass.

Input (choose one):
        -i, --issue ENTRY           Add issue entry (repeatable)
                                    ENTRY format: "Title|type=Feature|parent=123|labels=a,b"
        -f, --file FILE             Path to YAML/JSON manifest (advanced mode)

Options:
    -h, --help                  Show this help message and exit
    -v, --version               Show version information and exit
    -V, --verbose               Enable verbose output
        --create                    Create issues (default is preview only)
    -n, --dry-run               Alias for preview mode
    --continue-on-error         Continue creating remaining issues after a failure
        --type TYPE                 Default issue type
    --parent ISSUE_NUM          Default parent issue number for items missing parent
        --label LABEL               Default label (repeatable)
        --assignee USER             Default assignee (repeatable)
        --blocked-by ISSUE_NUM      Default blocker (repeatable)
        --milestone NAME            Default milestone
        --project NAME              Default project
        --body TEXT                 Default body text
        --body-file FILE            Default body file

Rules:
- Exactly one input mode: --issue entries OR --file manifest.
- Preview is the default mode. Add --create to execute.
- Each issue must resolve a type from item \`type\` or default \`--type\`.
- Command always uses non-interactive creation (--no-template).

Fast mode entry keys (optional per entry):
- type, parent, labels (csv), assignees (csv), blocked_by (csv),
- milestone, project, size, target, body, body_file

Manifest schema:

issues:
    - title: "Issue title"        # required
      type: "Feature"             # optional if defaults.type exists
      body: |                     # optional
        Markdown text
      body_file: "path/to/body.md"  # optional; wins over body
      labels: ["priority:high", "backend"]
      assignees: ["@me"]
      milestone: "Sprint 5"
      project: "Q1 2026"
      parent: 123
      blocked_by: [42, 55]
      size: "M"
      target: "deliverable scope"

defaults:
    type: "Task"
    parent: 1
    labels: ["area:example"]
    milestone: "Sprint 5"
    project: "Q3 2026"
    body: "Default body"
    body_file: "path/to/default-body.md"

Examples:
        ${s} --issue "Feature A" --type Feature
        ${s} --issue "A|size=M|target=Scope text" --issue "B|type=Task|labels=ops" --parent 1
        ${s} --file issues.yaml --create
`);
  process.exit(0);
}

// --- Bounded YAML-subset manifest parser ------------------------------------

interface Line {
  indent: number;
  text: string;
  /** Verbatim line (post-CRLF-strip): block scalars need blank lines and
   # -initial lines that the structural pass must not interpret. */
  raw: string;
  /** Structural line: false for blank/comment lines, which never match
   * keys or list items but ARE block-scalar content. */
  structural: boolean;
}

function manifestLines(raw: string): Line[] {
  const out: Line[] = [];
  for (const line of raw.split("\n")) {
    const noCr = line.replace(/\r$/, "");
    const indent = noCr.length - noCr.trimStart().length;
    const text = noCr.trim();
    // Blank and comment lines stay in the list (block scalars may contain
    // them verbatim) but are marked non-structural so the map/list walkers
    // never match keys or items against them.
    const structural = !(text === "" || text.startsWith("#"));
    out.push({ indent, text, raw: noCr, structural });
  }
  // Drop trailing non-structural lines (blank tail of the file).
  while (out.length > 0 && !out[out.length - 1]!.structural) out.pop();
  return out;
}

function unquote(v: string): string {
  const t = v.trim();
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) {
    return t.slice(1, -1);
  }
  return t;
}

function parseScalar(text: string): string {
  // Strip a trailing comment outside quotes.
  let inQuote: string | null = null;
  let out = "";
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (inQuote !== null) {
      out += c;
      if (c === inQuote) inQuote = null;
      continue;
    }
    if (c === '"' || c === "'") {
      inQuote = c;
      out += c;
      continue;
    }
    if (c === "#" && (i === 0 || text[i - 1] === " ")) break;
    out += c;
  }
  return unquote(out.trim());
}

type YamlValue = string | YamlValue[] | { [key: string]: YamlValue };

function isBlockScalarToken(v: string): boolean {
  return v === "|" || v === "|-" || v === ">" || v === ">-";
}

function parseBlock(lines: Line[], pos: { i: number }, indent: number): YamlValue {
  // List block: consecutive "- " items at this indent.
  if (lines[pos.i] !== undefined && lines[pos.i]!.structural && lines[pos.i]!.text.startsWith("- ") && lines[pos.i]!.indent === indent) {
    const arr: YamlValue[] = [];
    while (pos.i < lines.length && lines[pos.i]!.indent === indent && lines[pos.i]!.structural && lines[pos.i]!.text.startsWith("- ")) {
      const line = lines[pos.i]!;
      const inline = line.text.slice(2);
      const kv = /^([^:]+):(.*)$/.exec(inline);
      if (kv === null) {
        // Flow array item: "labels: [x, y]" -> the item value is the csv text.
        const flow = /^([^:]+):\s*\[(.*)\]\s*$/.exec(inline);
        if (flow !== null) {
          arr.push({ [unquote(flow[1]!.trim())]: flow[2]!.trim() });
        } else {
          arr.push(parseScalar(inline));
        }
        pos.i++;
        continue;
      }
      // Map item: the first key lives on the dash line; deeper keys follow.
      const itemIndent = indent + 2;
      const item: { [key: string]: YamlValue } = {};
      const key = unquote(kv[1]!.trim());
      const rest = kv[2]!.trim();
      pos.i++;
      if (isBlockScalarToken(rest)) {
        item[key] = readBlockScalar(lines, pos, itemIndent, rest);
      } else if (rest !== "") {
        item[key] = parseScalar(rest);
      } else {
        const deeper = pos.i < lines.length && lines[pos.i]!.indent > indent;
        item[key] = deeper ? parseBlock(lines, pos, lines[pos.i]!.indent) : "";
      }
      while (pos.i < lines.length && lines[pos.i]!.indent >= itemIndent && !lines[pos.i]!.text.startsWith("- ")) {
        Object.assign(item, parseBlock(lines, pos, lines[pos.i]!.indent) as { [key: string]: YamlValue });
      }
      arr.push(item);
    }
    return arr;
  }
  // Map block: "key: value" lines at this indent.
  const obj: { [key: string]: YamlValue } = {};
  while (pos.i < lines.length && lines[pos.i]!.indent === indent && lines[pos.i]!.structural && !lines[pos.i]!.text.startsWith("- ")) {
    // A non-structural gap (blank/comment) between keys is fine; skip it.
    if (!lines[pos.i]!.structural) {
      pos.i++;
      continue;
    }
    const line = lines[pos.i]!;
    const kv = /^([^:]+):(.*)$/.exec(line.text);
    if (kv === null) break;
    const key = unquote(kv[1]!.trim());
    const rest = kv[2]!.trim();
    pos.i++;
    // Flow array: "labels: [x, y]" — kept as a csv string so the callers'
    // `csv()` reads stay uniform.
    const flow = /^\[(.*)\]$/.exec(rest);
    if (rest.startsWith("[") && flow !== null) {
      obj[key] = flow[1]!.trim();
      continue;
    }
    if (isBlockScalarToken(rest)) {
      obj[key] = readBlockScalar(lines, pos, indent, rest);
    } else if (rest !== "") {
      obj[key] = parseScalar(rest);
    } else {
      const deeper = pos.i < lines.length && lines[pos.i]!.indent > indent;
      obj[key] = deeper ? parseBlock(lines, pos, lines[pos.i]!.indent) : "";
    }
  }
  return obj;
}

function readBlockScalar(lines: Line[], pos: { i: number }, keyIndent: number, token: string): string {
  const collected: string[] = [];
  let contentIndent: number | null = null;
  // Block-scalar content = every line (verbatim, including blanks and
  // #-initial lines) indented deeper than the key, until the first line at
  // or below the key's indent. Indentation relative to the first content
  // line is preserved; the common indent itself is stripped.
  while (pos.i < lines.length) {
    const line = lines[pos.i]!;
    if (line.structural && line.indent <= keyIndent) break;
    if (!line.structural && line.raw.trim() === "") {
      // Blank line: content if more indented lines follow, else trailing.
      collected.push("");
      pos.i++;
      continue;
    }
    if (contentIndent === null) contentIndent = line.indent;
    if (line.indent < contentIndent) break;
    collected.push(line.raw.slice(contentIndent));
    pos.i++;
  }
  // Trim trailing blank lines (they carry no content); blank lines between
  // content lines are kept.
  while (collected.length > 0 && collected[collected.length - 1]!.trim() === "") collected.pop();
  const body = collected.join("\n");
  return token.endsWith("-") ? body : `${body}\n`;
}

function parseManifest(raw: string): YamlValue {
  return parseBlock(manifestLines(raw), { i: 0 }, 0);
}

function asObject(v: YamlValue): { [key: string]: YamlValue } | null {
  return typeof v === "object" && !Array.isArray(v) ? (v as { [key: string]: YamlValue }) : null;
}

function str(v: YamlValue | undefined): string {
  return typeof v === "string" ? v : "";
}

function csv(v: YamlValue | undefined): string {
  if (v === undefined) return "";
  if (typeof v === "string") return v;
  if (Array.isArray(v)) return v.map((x) => (typeof x === "string" ? x : JSON.stringify(x))).join(",");
  return "";
}

// --- Entry parsing and command assembly -------------------------------------

interface ParsedEntry {
  title: string;
  type: string;
  parent: string;
  labels: string;
  assignees: string;
  blockedBy: string;
  milestone: string;
  project: string;
  size: string;
  target: string;
  body: string;
  bodyFile: string;
}

function emptyParsed(): ParsedEntry {
  return { title: "", type: "", parent: "", labels: "", assignees: "", blockedBy: "", milestone: "", project: "", size: "", target: "", body: "", bodyFile: "" };
}

function parseFastIssue(entry: string): ParsedEntry | null {
  const p = emptyParsed();
  const segments = entry.split("|");
  p.title = segments[0]?.trim() ?? "";
  for (const pair of segments.slice(1)) {
    const eq = pair.indexOf("=");
    const key = (eq === -1 ? pair : pair.slice(0, eq)).trim();
    const value = eq === -1 ? "" : pair.slice(eq + 1).trim();
    switch (key) {
      case "type": p.type = value; break;
      case "parent": p.parent = value; break;
      case "labels": p.labels = value; break;
      case "assignees": p.assignees = value; break;
      case "blocked_by": p.blockedBy = value; break;
      case "milestone": p.milestone = value; break;
      case "project": p.project = value; break;
      case "size": p.size = value; break;
      case "target": p.target = value; break;
      case "body": p.body = value; break;
      case "body_file": p.bodyFile = value; break;
      case "": break;
      default:
        logError(`Unsupported key in --issue entry: ${key}`);
        return null;
    }
  }
  if (p.title === "") {
    logError("--issue entry must include a title");
    return null;
  }
  return p;
}

function splitCsv(raw: string): string[] {
  return raw.split(",").map((s) => s.trim()).filter((s) => s !== "");
}

function generatedBody(title: string, size: string, target: string): string {
  let out = "## Context\n";
  out += `Batch-generated issue for: ${title}\n`;
  if (target !== "") out += `\n## Scope\n${target}\n`;
  if (size !== "") out += `\n## Size\n${size}\n`;
  return out;
}

interface Defaults {
  type: string;
  parent: string;
  milestone: string;
  project: string;
  body: string;
  bodyFile: string;
  labels: string[];
  assignees: string[];
  blockedBy: string[];
}

interface BatchCtx {
  defaults: Defaults;
  tempDir: string;
  createMode: boolean;
  continueOnError: boolean;
  mode: "fast" | "manifest";
}

interface Built {
  mode: "fast" | "manifest";
  title: string;
  cmd: string[];
}

/** Bare id (Azure shape) or the trailing number of an issue/work-item URL. */
function issueNumberFromRef(ref: string): number | null {
  const trimmed = ref.trim();
  if (/^[0-9]+$/.test(trimmed)) return Number.parseInt(trimmed, 10);
  const m = /^https?:\/\/[^?#]*\/([0-9]+)\/?([?#].*)?$/.exec(trimmed);
  return m?.[1] !== undefined ? Number.parseInt(m[1], 10) : null;
}

/**
 * The one place an issue entry becomes an `issue-create` command, shared by
 * the manifest and fast builders. Applies the command-line list defaults when
 * the entry has none, validates body_file with fields fully resolved, and
 * writes the body file (inline body, else a generated one).
 */
function assemble(ctx: BatchCtx, index: number, mode: Built["mode"], p: ParsedEntry): Built | null {
  const d = ctx.defaults;
  if (p.type === "") {
    logError(`Issue[${index}] missing type (item, manifest defaults, or --type)`);
    return null;
  }
  if (mode === "manifest" && p.title === "") {
    logError(`Issue[${index}] missing title`);
    return null;
  }
  const labels = p.labels !== "" ? p.labels : d.labels.join(",");
  const assignees = p.assignees !== "" ? p.assignees : d.assignees.join(",");
  const blocked = p.blockedBy !== "" ? p.blockedBy : d.blockedBy.join(",");

  let bodyFile = p.bodyFile;
  if (bodyFile !== "" && !existsSync(bodyFile)) {
    logError(`Issue[${index}] body_file not found: ${bodyFile}`);
    return null;
  }
  if (bodyFile === "") {
    bodyFile = join(ctx.tempDir, `issue-${index}-body.md`);
    writeFileSync(bodyFile, p.body !== "" ? `${p.body}\n` : generatedBody(p.title, p.size, p.target));
  }

  const cmd = ["issue-create", "--title", p.title, "--type", p.type, "--body-file", bodyFile, "--no-template"];
  const parent = p.parent !== "" ? p.parent : d.parent;
  const milestone = p.milestone !== "" ? p.milestone : d.milestone;
  const project = p.project !== "" ? p.project : d.project;
  if (parent !== "") cmd.push("--parent", parent);
  if (milestone !== "") cmd.push("--milestone", milestone);
  if (project !== "") cmd.push("--project", project);
  for (const l of splitCsv(labels)) cmd.push("--label", l);
  for (const a of splitCsv(assignees)) cmd.push("--assignee", a);
  for (const b of splitCsv(blocked)) cmd.push("--blocked-by", b);
  return { mode, title: p.title, cmd };
}

function entryFromManifestItem(item: { [key: string]: YamlValue }, d: Defaults): ParsedEntry {
  return {
    title: str(item["title"]),
    type: str(item["type"]),
    parent: str(item["parent"]),
    labels: csv(item["labels"]),
    assignees: csv(item["assignees"]),
    blockedBy: csv(item["blocked_by"]),
    milestone: str(item["milestone"]),
    project: str(item["project"]),
    size: str(item["size"]),
    target: str(item["target"]),
    body: str(item["body"]),
    bodyFile: str(item["body_file"]),
    ...{},
  } satisfies ParsedEntry as ParsedEntry;
  // Manifest defaults per scalar field are applied by the caller chain below.
  void d;
}

/** Manifest field resolution: item > manifest defaults > command-line defaults. */
function manifestEntry(item: { [key: string]: YamlValue }, d: Defaults): ParsedEntry {
  const base = entryFromManifestItem(item, d);
  return {
    ...base,
    type: base.type !== "" ? base.type : d.type,
    parent: base.parent !== "" ? base.parent : d.parent,
    milestone: base.milestone !== "" ? base.milestone : d.milestone,
    project: base.project !== "" ? base.project : d.project,
    body: base.body !== "" ? base.body : d.body,
    bodyFile: base.bodyFile !== "" ? base.bodyFile : d.bodyFile,
    labels: base.labels !== "" ? base.labels : d.labels.join(","),
    assignees: base.assignees !== "" ? base.assignees : d.assignees.join(","),
    blockedBy: base.blockedBy !== "" ? base.blockedBy : d.blockedBy.join(","),
  };
}

function previewBatch(ctx: BatchCtx, buildEntry: (index: number) => ParsedEntry | null, count: number): number {
  console.log("index|mode|title|command");
  // 15.15: flag child_of placement violations in the preview (static
  // config check — the authoritative rejection happens inside issue-create
  // at create time, resolving the parent's live type).
  const childOf = childOfMapFrom(
    process.env.ISSUES_CONFIG ?? join(TOOLS_ROOT, "config", "issues-config.yml"),
  );
  for (let index = 0; index < count; index++) {
    const entry = buildEntry(index);
    if (entry === null) return 1;
    const built = assemble(ctx, index, ctx.mode, entry);
    if (built === null) return 1;
    console.log(`${index}|${built.mode}|${built.title}|${built.cmd.join(" ")}`);
    const rowType = (entry.type !== "" ? entry.type : ctx.defaults.type).trim();
    const rowParent = (entry.parent !== "" ? entry.parent : ctx.defaults.parent).trim();
    if (rowType !== "" && rowParent !== "" && /^\d+$/.test(rowParent)) {
      const allowed = childOf.get(rowType);
      if (allowed !== undefined) {
        console.log(`${index}|WARN|child_of: ${rowType} may only be parented under [${allowed.join(", ")}] — placement validated against the live parent type at create time`);
      }
    }
  }
  return 0;
}

/** The type -> allowed-parent-types map from an issues-config.yml (the
 * static preview check; issue-create's create-time check is authoritative). */
function childOfMapFrom(path: string): Map<string, string[]> {
  const map = new Map<string, string[]>();
  let inTypes = false;
  let current = "";
  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (/^types:\s*$/.test(line)) {
      inTypes = true;
      continue;
    }
    if (inTypes && /^\S/.test(line) && !/^types:/.test(line)) inTypes = false;
    if (!inTypes) continue;
    const name = /^\s*-\s*name:\s*(.+)$/.exec(line);
    if (name?.[1] !== undefined) {
      current = name[1].replace(/^["']|["']$/g, "").trim();
      continue;
    }
    const list = /^\s*child_of:\s*\[(.*)\]/.exec(line);
    if (list?.[1] !== undefined) {
      map.set(
        current,
        list[1].split(",").map((x) => x.replace(/^["'\s]+|["'\s]+$/g, "")).filter((x) => x !== ""),
      );
    }
  }
  return map;
}

function createBatch(ctx: BatchCtx, buildEntry: (index: number) => ParsedEntry | null, count: number): number {
  let created = 0;
  let failed = 0;
  console.log("index|issue_number|title|url");
  for (let index = 0; index < count; index++) {
    const entry = buildEntry(index);
    const built = entry === null ? null : assemble(ctx, index, ctx.mode, entry);
    if (built === null) {
      failed++;
      if (ctx.continueOnError) continue;
      return 1;
    }
    logDebug(`Creating issue[${index}] from ${built.mode} mode: ${built.title}`);
    const r = spawnSync(built.cmd[0]!, built.cmd.slice(1), { encoding: "utf8" });
    const output = `${r.stdout ?? ""}${r.stderr ?? ""}`;
    if (r.status !== 0) {
      logError(`Issue[${index}] failed: ${built.title}`);
      process.stderr.write(output);
      failed++;
      if (ctx.continueOnError) continue;
      return 1;
    }
    // The creation result is the LAST non-empty line of the child's STDOUT:
    // a URL on some providers, a bare issue id on others. Stdout is parsed
    // BEFORE stderr — issue-create logs its progress lines to stderr, so the
    // joined stream's last line is a timestamped log record, not the result
    // (the parse miss that aborted batches after row 1). Stderr is only
    // consulted when stdout yields nothing (provider result-on-stderr shapes).
    const resultNumber = (stream: string | undefined): number | null => {
      const lines = (stream ?? "").split("\n").filter((l) => l.trim() !== "");
      for (let i = lines.length - 1; i >= 0; i--) {
        const candidate = (lines[i] ?? "").replace(/\r$/, "");
        const n = issueNumberFromRef(candidate);
        if (n !== null) return n;
      }
      return null;
    };
    const number = resultNumber(r.stdout) ?? resultNumber(r.stderr);
    // The result REF for the report line: the stdout line that yielded the
    // number (URL or bare id), so the table echoes what the provider said.
    const resultRef = ((): string => {
      const stdoutLines = (r.stdout ?? "").split("\n").filter((l) => l.trim() !== "");
      const stderrLines = (r.stderr ?? "").split("\n").filter((l) => l.trim() !== "");
      for (const line of [...stdoutLines].reverse()) {
        if (issueNumberFromRef(line.replace(/\r$/, "")) !== null) return line.replace(/\r$/, "");
      }
      for (const line of [...stderrLines].reverse()) {
        if (issueNumberFromRef(line.replace(/\r$/, "")) !== null) return line.replace(/\r$/, "");
      }
      return "";
    })();
    if (number === null) {
      logError(`Issue[${index}] created but could not parse URL/number`);
      console.log(output);
      failed++;
      if (ctx.continueOnError) continue;
      return 1;
    }
    console.log(`${index}|${number}|${built.title}|${resultRef}`);
    created++;
  }
  logInfo(`Batch complete: created=${created} failed=${failed}`);
  return failed > 0 ? 1 : 0;
}

// --- Main ---------------------------------------------------------------------

async function main(argv: string[]): Promise<number> {
  const { values } = parseArgs({
    args: argv,
    options: {
      help: { type: "boolean", short: "h", default: false },
      version: { type: "boolean", short: "v", default: false },
      verbose: { type: "boolean", short: "V", default: false },
      create: { type: "boolean", default: false },
      "dry-run": { type: "boolean", short: "n", default: false },
      "continue-on-error": { type: "boolean", default: false },
      type: { type: "string" },
      parent: { type: "string" },
      label: { type: "string", multiple: true },
      assignee: { type: "string", multiple: true },
      "blocked-by": { type: "string", multiple: true },
      milestone: { type: "string" },
      project: { type: "string" },
      body: { type: "string" },
      "body-file": { type: "string" },
      file: { type: "string", short: "f" },
      issue: { type: "string", short: "i", multiple: true },
    },
    allowPositionals: false,
    strict: true,
  });

  if (values["help"]) showUsage();
  if (values["version"]) {
    console.log(SCRIPT_VERSION);
    return 0;
  }

  const manifestFile = values["file"] ?? "";
  const issueEntries = values["issue"] ?? [];

  if (manifestFile !== "" && issueEntries.length > 0) {
    logError("Use either --file or --issue, not both");
    return EXIT_GENERAL_ERROR;
  }
  if (manifestFile === "" && issueEntries.length === 0) {
    logError("Provide input via --issue (repeatable) or --file");
    return EXIT_GENERAL_ERROR;
  }
  const defaultBodyFile = values["body-file"] ?? "";
  if (defaultBodyFile !== "" && !existsSync(defaultBodyFile)) {
    logError(`Default body file not found: ${defaultBodyFile}`);
    return EXIT_GENERAL_ERROR;
  }

  const cliDefaults: Defaults = {
    type: values["type"] ?? "",
    parent: values["parent"] ?? "",
    milestone: values["milestone"] ?? "",
    project: values["project"] ?? "",
    body: values["body"] ?? "",
    bodyFile: defaultBodyFile,
    labels: values["label"] ?? [],
    assignees: values["assignee"] ?? [],
    blockedBy: values["blocked-by"] ?? [],
  };

  const entries: ParsedEntry[] = [];
  const fastEntries: string[] = [];
  let manifestDefaults: Defaults = cliDefaults;
  let mode: Built["mode"] = "fast";

  if (manifestFile !== "") {
    if (!existsSync(manifestFile)) {
      logError(`Manifest file not found: ${manifestFile}`);
      return EXIT_GENERAL_ERROR;
    }
    const parsed = asObject(parseManifest(readFileSync(manifestFile, "utf8")));
    const issues = parsed !== null && Array.isArray(parsed["issues"]) ? parsed["issues"] : null;
    if (issues === null) {
      logError("Invalid manifest format: expected top-level 'issues' array");
      return EXIT_GENERAL_ERROR;
    }
    if (issues.length === 0) {
      logError("Manifest has no issues to create");
      return EXIT_GENERAL_ERROR;
    }
    const parsedDefaults = parsed === null ? null : asObject(parsed["defaults"] ?? {});
    const md = parsedDefaults ?? {};
    // Field resolution order: item > manifest defaults > command-line defaults,
    // so the manifest default wins wherever it is set and the CLI value fills
    // the rest.
    manifestDefaults = {
      type: str(md["type"]) !== "" ? str(md["type"]) : cliDefaults.type,
      parent: str(md["parent"]) !== "" ? str(md["parent"]) : cliDefaults.parent,
      milestone: str(md["milestone"]) !== "" ? str(md["milestone"]) : cliDefaults.milestone,
      project: str(md["project"]) !== "" ? str(md["project"]) : cliDefaults.project,
      body: str(md["body"]) !== "" ? str(md["body"]) : cliDefaults.body,
      bodyFile: str(md["body_file"]) !== "" ? str(md["body_file"]) : cliDefaults.bodyFile,
      labels: splitCsv(csv(md["labels"])).length > 0 ? splitCsv(csv(md["labels"])) : cliDefaults.labels,
      assignees: splitCsv(csv(md["assignees"])).length > 0 ? splitCsv(csv(md["assignees"])) : cliDefaults.assignees,
      blockedBy: splitCsv(csv(md["blocked_by"])).length > 0 ? splitCsv(csv(md["blocked_by"])) : cliDefaults.blockedBy,
    };
    mode = "manifest";
    for (const item of issues) {
      const obj = asObject(item);
      if (obj === null) {
        logError("Invalid manifest format: expected top-level 'issues' array");
        return EXIT_GENERAL_ERROR;
      }
      entries.push(manifestEntry(obj, manifestDefaults));
    }
  } else {
    // Fast-mode entries parse lazily, per index, inside the batch loop — a
    // malformed entry is that entry's failure (skippable with
    // --continue-on-error), not an abort of the whole run.
    fastEntries.push(...issueEntries);
  }

  const buildEntry = (index: number): ParsedEntry | null => {
    if (mode === "fast") {
      const raw = fastEntries[index];
      if (raw === undefined) return null;
      const p = parseFastIssue(raw);
      if (p === null) return null;
      return {
        ...p,
        type: p.type !== "" ? p.type : manifestDefaults.type,
        parent: p.parent !== "" ? p.parent : manifestDefaults.parent,
        milestone: p.milestone !== "" ? p.milestone : manifestDefaults.milestone,
        project: p.project !== "" ? p.project : manifestDefaults.project,
        body: p.body !== "" ? p.body : manifestDefaults.body,
        bodyFile: p.bodyFile !== "" ? p.bodyFile : manifestDefaults.bodyFile,
        labels: p.labels !== "" ? p.labels : manifestDefaults.labels.join(","),
        assignees: p.assignees !== "" ? p.assignees : manifestDefaults.assignees.join(","),
        blockedBy: p.blockedBy !== "" ? p.blockedBy : manifestDefaults.blockedBy.join(","),
      };
    }
    return entries[index] ?? null;
  };
  const count = mode === "fast" ? fastEntries.length : entries.length;

  const createMode = values["create"] === true && values["dry-run"] !== true;
  const tempDir = mkdtempSync(join(tmpdir(), "issue-create-batch."));
  const ctx: BatchCtx = {
    defaults: manifestDefaults,
    tempDir,
    createMode,
    continueOnError: values["continue-on-error"] === true,
    mode,
  };
  try {
    if (createMode) {
      // --create needs the child creator findable on PATH (workspace depth-1
      // tool). Executed lazily per entry by spawnSync below.
      if (spawnSync("bash", ["-c", "command -v issue-create >/dev/null"]).status !== 0) {
        logError("issue-create is required but not found in PATH");
        return EXIT_GENERAL_ERROR;
      }
      return createBatch(ctx, buildEntry, count);
    }
    return previewBatch(ctx, buildEntry, count);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (err: unknown) => {
    logError(err instanceof Error ? err.message : String(err));
    process.exit(EXIT_GENERAL_ERROR);
  },
);
