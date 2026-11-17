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
// The manifest is read with a real YAML parser. With --create a manifest
// re-run skips every entry whose title already exists in the target repo, so
// repeating a run never duplicates issues.

import { basename, join } from "node:path";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";

import { load, JSON_SCHEMA } from "js-yaml";

import { EXIT_GENERAL_ERROR, EXIT_MISUSE } from "../lib/core/exit-codes.ts";
import { logDebug, logError, logInfo } from "../lib/core/logging.ts";
import { assertNodeFloor } from "../lib/core/node-floor.ts";
import { errorMessage } from "../lib/core/logging.ts";
import { toolCli, usageCommonFlags } from "../lib/core/cli.ts";
import { issueNumberFromRef } from "../lib/domain/issues/refs.ts";
import { childOfMap } from "../lib/domain/issues/types.ts";
import { providerRepoTarget, requireRepoTarget } from "../lib/providers/provider-core.ts";
import { issuesList } from "../lib/providers/facade/issues.ts";
import { spawnSync } from "node:child_process";

assertNodeFloor();

const SCRIPT_VERSION = "1.1.0";
const SCRIPT_NAME = basename(process.argv[1] ?? "issue-create-batch.ts");

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
${usageCommonFlags({ noDevenv: true })}
        --create                    Create issues (default is preview only)
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
- With --file, --create skips entries whose title already exists in the repo,
  so re-running a manifest never duplicates issues.
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

// --- Manifest reading ---------------------------------------------------------

type Doc = { [key: string]: unknown };

function parseManifest(raw: string): unknown {
  try {
    return load(raw, { schema: JSON_SCHEMA });
  } catch (err) {
    throw new Error(`Invalid manifest: ${err instanceof Error ? err.message.split("\n")[0] : String(err)}`);
  }
}

function asObject(v: unknown): Doc | null {
  return typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Doc) : null;
}

function scalarText(v: unknown): string | null {
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return null;
}

/** A scalar field as text; absent reads as empty, a non-scalar is an error. */
function str(v: unknown, field: string): string {
  if (v === undefined || v === null) return "";
  const t = scalarText(v);
  if (t === null) throw new Error(`Invalid manifest: '${field}' must be a single value`);
  return t;
}

/** A list field: a YAML list, or a comma-separated string (the fast-mode form). */
function list(v: unknown, field: string): string[] {
  if (v === undefined || v === null) return [];
  if (typeof v === "string") return splitCsv(v);
  if (Array.isArray(v)) {
    return v.map((x) => {
      const t = scalarText(x);
      if (t === null) throw new Error(`Invalid manifest: '${field}' entries must be single values`);
      return t.trim();
    }).filter((x) => x !== "");
  }
  const t = scalarText(v);
  if (t === null) throw new Error(`Invalid manifest: '${field}' must be a list`);
  return [t];
}

// --- Entry parsing and command assembly -------------------------------------

interface ParsedEntry {
  title: string;
  type: string;
  parent: string;
  labels: string[];
  assignees: string[];
  blockedBy: string[];
  milestone: string;
  project: string;
  size: string;
  target: string;
  body: string;
  bodyFile: string;
}

function emptyParsed(): ParsedEntry {
  return { title: "", type: "", parent: "", labels: [], assignees: [], blockedBy: [], milestone: "", project: "", size: "", target: "", body: "", bodyFile: "" };
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
      case "labels": p.labels = splitCsv(value); break;
      case "assignees": p.assignees = splitCsv(value); break;
      case "blocked_by": p.blockedBy = splitCsv(value); break;
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
// issueNumberFromRef lives in lib/domain/issues/refs.ts (shared with issue-create).

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
  const labels = p.labels.length > 0 ? p.labels : d.labels;
  const assignees = p.assignees.length > 0 ? p.assignees : d.assignees;
  const blocked = p.blockedBy.length > 0 ? p.blockedBy : d.blockedBy;

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
  for (const l of labels) cmd.push("--label", l);
  for (const a of assignees) cmd.push("--assignee", a);
  for (const b of blocked) cmd.push("--blocked-by", b);
  return { mode, title: p.title, cmd };
}

/** Manifest field resolution: item > manifest defaults > command-line defaults. */
function manifestEntry(item: Doc, d: Defaults): ParsedEntry {
  const own = (k: string): string => str(item[k], k);
  const pick = (k: string, fallback: string): string => (own(k) !== "" ? own(k) : fallback);
  const pickList = (k: string, fallback: string[]): string[] => {
    const v = list(item[k], k);
    return v.length > 0 ? v : fallback;
  };
  return {
    title: own("title"),
    type: pick("type", d.type),
    parent: pick("parent", d.parent),
    labels: pickList("labels", d.labels),
    assignees: pickList("assignees", d.assignees),
    blockedBy: pickList("blocked_by", d.blockedBy),
    milestone: pick("milestone", d.milestone),
    project: pick("project", d.project),
    size: own("size"),
    target: own("target"),
    body: pick("body", d.body),
    bodyFile: pick("body_file", d.bodyFile),
  };
}

function previewBatch(ctx: BatchCtx, buildEntry: (index: number) => ParsedEntry | null, count: number): number {
  console.log("index|mode|title|command");
  // Flag child_of placement violations in the preview (static
  // config check — the authoritative rejection happens inside issue-create
  // at create time, resolving the parent's live type).
  const childOf = childOfMap();
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

// The type -> allowed-parent-types map comes from the shared issues-config
// loader (one reader for the static preview check and issue-create's
// create-time check).

/** Page size of the existing-issue listing; a repo at or past it cannot be checked. */
const EXISTING_LIST_LIMIT = 1000;

/** Title -> number of every issue already in the target repo (any state); null on failure. */
async function existingIssuesByTitle(): Promise<Map<string, number> | null> {
  const spec = requireRepoTarget(providerRepoTarget(""), "issue-create-batch", "issues");
  let raw: string;
  try {
    raw = await issuesList(spec, { state: "all", json: "number,title", limit: EXISTING_LIST_LIMIT });
  } catch (err) {
    logError(`could not list existing issues: ${errorMessage(err)}`);
    return null;
  }
  let rows: Array<{ number?: unknown; title?: unknown }>;
  try {
    rows = JSON.parse(raw) as typeof rows;
  } catch {
    logError("could not list existing issues: the provider's answer is not JSON");
    return null;
  }
  if (!Array.isArray(rows) || rows.length >= EXISTING_LIST_LIMIT) {
    logError(`could not list existing issues: the repository has ${EXISTING_LIST_LIMIT} or more, so a re-run cannot be checked for duplicates`);
    return null;
  }
  const byTitle = new Map<string, number>();
  for (const r of rows) {
    if (typeof r.title === "string" && typeof r.number === "number" && !byTitle.has(r.title.trim())) byTitle.set(r.title.trim(), r.number);
  }
  return byTitle;
}

async function createBatch(ctx: BatchCtx, buildEntry: (index: number) => ParsedEntry | null, count: number): Promise<number> {
  let created = 0;
  let failed = 0;
  let skipped = 0;
  // Manifest re-runs are idempotent: an entry whose title already exists is
  // reported and skipped instead of created again.
  const existing = ctx.mode === "manifest" ? await existingIssuesByTitle() : new Map<string, number>();
  if (existing === null) return EXIT_GENERAL_ERROR;
  console.log("index|issue_number|title|url");
  for (let index = 0; index < count; index++) {
    const entry = buildEntry(index);
    const built = entry === null ? null : assemble(ctx, index, ctx.mode, entry);
    if (built === null) {
      failed++;
      if (ctx.continueOnError) continue;
      return 1;
    }
    const already = existing.get(built.title.trim());
    if (already !== undefined) {
      console.log(`${index}|${already}|${built.title}|existing`);
      skipped++;
      continue;
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
  logInfo(`Batch complete: created=${created} failed=${failed} skipped=${skipped}`);
  return failed > 0 ? 1 : 0;
}

// --- Main ---------------------------------------------------------------------

async function main(argv: string[]): Promise<number> {
  let cli: ReturnType<typeof toolCli>;
  try {
    cli = toolCli({
      name: SCRIPT_NAME,
      version: SCRIPT_VERSION,
      argv,
      allowPositionals: false,
      options: {
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
    });
  } catch (err) {
    logError(errorMessage(err));
    console.error("Use --help for usage information");
    return EXIT_MISUSE;
  }
  const values = cli.values as Record<string, string | boolean | string[] | undefined>;

  if (cli.common.help) showUsage();

  const manifestFile = ((values["file"] as string | undefined) ?? "");
  const issueEntries = (values["issue"] ?? []) as string[];

  if (manifestFile !== "" && issueEntries.length > 0) {
    logError("Use either --file or --issue, not both");
    return EXIT_MISUSE;
  }
  if (manifestFile === "" && issueEntries.length === 0) {
    logError("Provide input via --issue (repeatable) or --file");
    return EXIT_MISUSE;
  }
  const defaultBodyFile = ((values["body-file"] as string | undefined) ?? "");
  if (defaultBodyFile !== "" && !existsSync(defaultBodyFile)) {
    logError(`Default body file not found: ${defaultBodyFile}`);
    return EXIT_MISUSE;
  }

  const cliDefaults: Defaults = {
    type: ((values["type"] as string | undefined) ?? ""),
    parent: ((values["parent"] as string | undefined) ?? ""),
    milestone: ((values["milestone"] as string | undefined) ?? ""),
    project: ((values["project"] as string | undefined) ?? ""),
    body: ((values["body"] as string | undefined) ?? ""),
    bodyFile: defaultBodyFile,
    labels: (values["label"] ?? []) as string[],
    assignees: (values["assignee"] ?? []) as string[],
    blockedBy: (values["blocked-by"] ?? []) as string[],
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
    let parsed: Doc | null;
    try {
      parsed = asObject(parseManifest(readFileSync(manifestFile, "utf8")));
    } catch (err) {
      logError(errorMessage(err));
      return EXIT_GENERAL_ERROR;
    }
    const issues = parsed !== null && Array.isArray(parsed["issues"]) ? parsed["issues"] : null;
    if (issues === null) {
      logError("Invalid manifest format: expected top-level 'issues' array");
      return EXIT_GENERAL_ERROR;
    }
    if (issues.length === 0) {
      logError("Manifest has no issues to create");
      return EXIT_GENERAL_ERROR;
    }
    const md = asObject(parsed?.["defaults"] ?? {}) ?? {};
    // Field resolution order: item > manifest defaults > command-line defaults,
    // so the manifest default wins wherever it is set and the CLI value fills
    // the rest.
    try {
      const own = (k: string): string => str(md[k], `defaults.${k}`);
      const ownList = (k: string, fallback: string[]): string[] => {
        const v = list(md[k], `defaults.${k}`);
        return v.length > 0 ? v : fallback;
      };
      manifestDefaults = {
        type: own("type") !== "" ? own("type") : cliDefaults.type,
        parent: own("parent") !== "" ? own("parent") : cliDefaults.parent,
        milestone: own("milestone") !== "" ? own("milestone") : cliDefaults.milestone,
        project: own("project") !== "" ? own("project") : cliDefaults.project,
        body: own("body") !== "" ? own("body") : cliDefaults.body,
        bodyFile: own("body_file") !== "" ? own("body_file") : cliDefaults.bodyFile,
        labels: ownList("labels", cliDefaults.labels),
        assignees: ownList("assignees", cliDefaults.assignees),
        blockedBy: ownList("blocked_by", cliDefaults.blockedBy),
      };
      mode = "manifest";
      for (const item of issues) {
        const obj = asObject(item);
        if (obj === null) {
          logError("Invalid manifest format: every 'issues' entry must be a mapping");
          return EXIT_GENERAL_ERROR;
        }
        entries.push(manifestEntry(obj, manifestDefaults));
      }
    } catch (err) {
      logError(errorMessage(err));
      return EXIT_GENERAL_ERROR;
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
        labels: p.labels.length > 0 ? p.labels : manifestDefaults.labels,
        assignees: p.assignees.length > 0 ? p.assignees : manifestDefaults.assignees,
        blockedBy: p.blockedBy.length > 0 ? p.blockedBy : manifestDefaults.blockedBy,
      };
    }
    return entries[index] ?? null;
  };
  const count = mode === "fast" ? fastEntries.length : entries.length;

  const createMode = values["create"] === true && cli.common.dryRun !== true;
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
      return await createBatch(ctx, buildEntry, count);
    }
    return previewBatch(ctx, buildEntry, count);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (err: unknown) => {
    logError(errorMessage(err));
    process.exit(EXIT_GENERAL_ERROR);
  },
);
