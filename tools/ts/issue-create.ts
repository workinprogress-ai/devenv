#!/usr/bin/env node
// issue-create.ts - Create a new GitHub issue with labels, assignees, and
// project assignment.
// Version: 1.1.0
// Requirements: Node >= 23.6 (native type-stripping execution)
//
// Run via the depth-1 bash stub: `exec node "<resolved-src>.ts" "$@"`
//
// Creation flow: resolve the body (flag > template > piped stdin), create the
// issue, then enrich it — native type, project membership, sub-issue link,
// birth status. Every enrichment failure is reported loudly and fails the
// command; the issue URL is still printed so callers can parse it either way.
// The interactive editor/template picker surface needs a TTY and is refused
// with named errors under automation.

import { parseArgs } from "node:util";
import { basename, join } from "node:path";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { EXIT_GENERAL_ERROR, EXIT_MISUSE } from "../lib/core/exit-codes.ts";
import { logDebug, logError, logInfo, logWarn } from "../lib/core/logging.ts";
import { assertNodeFloor } from "../lib/core/node-floor.ts";
import { openInEditor } from "../lib/core/editor.ts";
import { isInteractive } from "../lib/ui/prompts.ts";
import { checkTargetRepo, requireRepoTarget, ghApiSync, providerRepoSplit, providerRepoTarget } from "../lib/providers/provider-core.ts";
import { issuesCreate, issuesSetType, issueGraphLink, issuesView } from "../lib/providers/github/issues.ts";

assertNodeFloor();

const SCRIPT_VERSION = "1.1.0";
const SCRIPT_NAME = basename(process.argv[1] ?? "issue-create.ts");
const SCRIPT_DIR = fileURLToPath(new URL(".", import.meta.url));
const TOOLS_ROOT = process.env["DEVENV_TOOLS"] ?? join(SCRIPT_DIR, "..");

function showUsage(): never {
  const s = SCRIPT_NAME;
  console.log(`Usage: ${s} [OPTIONS]

Create a new GitHub issue with labels, assignees, and project assignment.

Options:
    -h, --help                  Show this help message and exit
    -v, --version               Show version information and exit
    -V, --verbose               Enable verbose output
    -n, --dry-run               Show what would be done without creating issue

Optional Flags:
    --devenv                    Allow creating issues in devenv repo itself (safety override)
Optional:
    -t, --title TITLE           Issue title (required only with --no-interactive)
    -b, --body TEXT             Issue body/description
    -f, --body-file FILE        Read issue body from file (markdown; '-' reads
                                stdin; piped stdin with no flag is auto-read)
    --type TYPE                 Issue type: a type from issues-config.yml
    -l, --label LABEL           Add label (can be specified multiple times)
    -a, --assignee USER         Assign to user (can be specified multiple times)
    -m, --milestone NAME        Assign to milestone
    -p, --project NAME          Add to project (name or number)
    --parent ISSUE_NUM          Link to parent issue (for stories/bugs under epics)
    --blocked-by ISSUE_NUM      Mark as blocked by prerequisite issue (repeatable)
    --template FILE             Opt in to a specific template file (opens in editor;
                                without it, no template is used)
    --select-template           Opt in to interactive template selection (fzf over
                                .github/ISSUE_TEMPLATE/)
    --no-template               Accepted no-op - issues are created without a
                                template by default
    --no-interactive            Skip the editor (requires --title; template body
                                used as-is when a template is selected)

Environment Variables:
    DEVENV_REPO                 Repository in format owner/repo (default: current repo)

Examples:
    ${s} --title "Quick bug" --type Bug --body "Something is broken"

    # Create a story under an epic
    ${s} --title "Add OAuth" --type Task --parent 123 --no-interactive
`);
  process.exit(0);
}

// --- Target-repo guard (same contract as the other issue tools) -----------

// --- Body-source resolution (shared markdown-body contract) ---------------

function stdinIsTty(): boolean {
  return Boolean(process.stdin.isTTY);
}

function readStdinSync(): string {
  try {
    return readFileSync(0, "utf8");
  } catch {
    return "";
  }
}

function stdinIsBlank(text: string): boolean {
  return text.replace(/\s/g, "") === "";
}

/**
 * Body-source precedence (D1): --body text > --body-file PATH ('-' = stdin) >
 * piped stdin auto-read > interactive (caller-driven). Empty or whitespace-only
 * stdin is a hard misuse error: an empty body is never valid, and silence is
 * how caller bugs hide. Returns the body text, or null for the interactive
 * outcome (no flags, TTY stdin — the caller offers its picker).
 */
function resolveBody(opts: { text?: string | undefined; file?: string | undefined }): { body: string | null } {
  if (opts.text !== undefined && opts.file !== undefined) {
    logError("Only one body source may be specified");
    process.exit(EXIT_MISUSE);
  }
  if (opts.text !== undefined) {
    // --body "" is an explicit empty body — same refusal as empty stdin
    // (an empty body is never valid; silence is how caller bugs hide).
    if (opts.text.trim() === "") {
      logError("Refusing empty --body");
      process.exit(EXIT_MISUSE);
    }
    return { body: opts.text };
  }
  if (opts.file !== undefined) {
    if (opts.file === "-") {
      if (stdinIsTty()) {
        logError("--body-file - requires piped stdin (refusing to read the terminal)");
        process.exit(EXIT_MISUSE);
      }
      const content = readStdinSync();
      if (stdinIsBlank(content)) {
        logError("Refusing empty stdin body");
        process.exit(EXIT_MISUSE);
      }
      return { body: content };
    }
    if (!existsSync(opts.file)) {
      logError(`File not found: ${opts.file}`);
      process.exit(EXIT_MISUSE);
    }
    return { body: readFileSync(opts.file, "utf8") };
  }
  if (!stdinIsTty()) {
    const content = readStdinSync();
    if (stdinIsBlank(content)) {
      logError("Refusing empty stdin body");
      process.exit(EXIT_MISUSE);
    }
    return { body: content };
  }
  return { body: null };
}

// --- Issues-config: the type vocabulary -----------------------------------

function issuesConfigPath(): string {
  const override = process.env["ISSUES_CONFIG"];
  if (override !== undefined && override !== "") return override;
  return join(TOOLS_ROOT, "config", "issues-config.yml");
}

/** The type -> allowed-parent-types map from issues-config.yml's child_of
 * keys (the org-convention hierarchy, 15.15). Missing key = no restriction. */
function childOfMap(): Map<string, string[]> {
  const path = issuesConfigPath();
  const map = new Map<string, string[]>();
  if (!existsSync(path)) return map;
  let inTypes = false;
  let current = "";
  let inChildOf = false;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (/^types:\s*$/.test(line)) {
      inTypes = true;
      continue;
    }
    if (inTypes && /^\S/.test(line) && !/^types:/.test(line)) {
      inTypes = false;
      inChildOf = false;
    }
    if (!inTypes) continue;
    const name = /^\s*-\s*name:\s*(.+)$/.exec(line);
    if (name?.[1] !== undefined) {
      current = name[1].replace(/^["']|["']$/g, "").trim();
      continue;
    }
    if (/^\s*child_of:\s*\[/.test(line)) {
      const list = /\[(.*)\]/.exec(line)?.[1] ?? "";
      map.set(
        current,
        list.split(",").map((x) => x.replace(/^["'\s]+|["'\s]+$/g, "")).filter((x) => x !== ""),
      );
      inChildOf = false;
      continue;
    }
    if (/^\s*child_of:\s*$/.test(line)) {
      inChildOf = true;
      continue;
    }
    if (inChildOf && /^\s*-\s*\S/.test(line)) {
      const item = map.get(current) ?? [];
      item.push(line.replace(/^\s*-\s*/, "").replace(/^["']|["']$/g, "").trim());
      map.set(current, item);
      continue;
    }
    if (inChildOf && /^\s*\S/.test(line)) inChildOf = false;
  }
  return map;
}

/** 15.15 placement validation: when --parent is given, the parent's type
 * must appear in the requested type's child_of list (org convention from
 * issues-config.yml). Rejects BEFORE any create, naming the tool, the
 * parent type, the requested type, and the rule. */
async function validatePlacement(
  spec: string,
  parentNumber: string,
  requestedType: string,
  parentSpec?: string,
): Promise<void> {
  const allowed = childOfMap().get(requestedType);
  if (allowed === undefined) return; // no rule for this type
  const parentTypeRaw = await issuesView(parentSpec ?? spec, Number.parseInt(parentNumber, 10), {
    json: "issueType",
    jq: ".issueType.name // empty",
  });
  const parentType = parentTypeRaw.trim();
  if (parentType !== "" && !allowed.includes(parentType)) {
    logError(
      `issue-create: a ${requestedType} cannot be parented under a ${parentType} — ` +
        `child_of rule for ${requestedType} allows: [${allowed.join(", ")}] ` +
        `(issues-config.yml)`,
    );
    process.exit(EXIT_MISUSE);
  }
}

/** Minimal `types[].name` reader for the config's flat list shape. */
function issueTypeNames(): string[] {
  const path = issuesConfigPath();
  if (!existsSync(path)) {
    logError(`Issues config not found: ${path}`);
    process.exit(EXIT_GENERAL_ERROR);
  }
  const names: string[] = [];
  let inTypes = false;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (/^types:\s*$/.test(line)) {
      inTypes = true;
      continue;
    }
    if (inTypes && /^\S/.test(line) && !/^types:/.test(line)) inTypes = false;
    if (inTypes) {
      const m = /^\s*-\s*name:\s*(.+)$/.exec(line);
      if (m?.[1] !== undefined) names.push(m[1].replace(/^["']|["']$/g, "").trim());
    }
  }
  return names;
}

// --- Templates -------------------------------------------------------------

function findTemplates(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const name of readdirSync(dir).sort()) {
    const p = join(dir, name);
    if (statSync(p).isFile() && /\.(md|yml|yaml)$/.test(name)) out.push(p);
  }
  return out;
}

function parseFrontmatterTitle(content: string): string {
  if (!content.startsWith("---")) return "";
  const end = content.indexOf("\n---", 3);
  const block = end === -1 ? content : content.slice(0, end);
  for (const line of block.split("\n")) {
    if (line.startsWith("title:")) {
      return line.slice("title:".length).replace(/^["']|["']$/g, "").trim();
    }
  }
  return "";
}

/** Strip a leading frontmatter block; the remainder is the template body. */
function templateBody(content: string): string {
  if (!content.startsWith("---")) return content;
  const end = content.indexOf("\n---", 3);
  if (end === -1) return content;
  const rest = content.slice(end + 4);
  return rest.startsWith("\n") ? rest.slice(1) : rest;
}

/**
 * Interactive template selection needs fzf + a terminal; under automation it
 * refuses with guidance and the caller continues without a template.
 */
function selectTemplateInteractive(dir: string): string | null {
  const templates = findTemplates(dir);
  if (templates.length === 0) {
    logWarn("No templates found in .github/ISSUE_TEMPLATE/");
    return null;
  }
  if (!isInteractive()) {
    logError("--select-template requires an interactive terminal (no TTY detected).");
    logInfo("Use --template FILE to pick a template directly, or drop the flag to create without a template.");
    return null;
  }
  logError("fzf-based template selection is not available in this build; use --template FILE");
  return null;
}

// --- Creation flow ---------------------------------------------------------

/** Parent and blocked-by references become real body lines before the content.
 * A cross-repo parent (`owner/repo#N`) renders as a fully-qualified work-item
 * URL - a bare `Part of #N` would point into the child's own repo and mislead.
 */
function buildBody(
  refs: { parent?: string | undefined; parentSpec?: string | undefined; blockedBy: string[] },
  content: string,
): string {
  let body = "";
  if (refs.parent !== undefined && refs.parent !== "") {
    if (refs.parentSpec !== undefined && refs.parentSpec !== "") {
      body += `Part of https://github.com/${refs.parentSpec}/issues/${refs.parent}\n\n`;
    } else {
      body += `Part of #${refs.parent}\n\n`;
    }
  }
  for (const blocker of refs.blockedBy) {
    body += `Blocked by #${blocker}\n`;
  }
  if (refs.blockedBy.length > 0) body += "\n";
  return body + content;
}

/** A --parent reference: bare `N` (same repo) or `owner/repo#N` (cross-repo
 * sub-issue parenting — the API takes global node IDs, verified live). */
interface ParentRef {
  number: number;
  repoSpec?: string | undefined;
}

function parseParentRef(raw: string): ParentRef | null {
  const trimmed = raw.trim();
  if (/^[0-9]+$/.test(trimmed)) {
    return { number: Number.parseInt(trimmed, 10) };
  }
  const m = /^([A-Za-z0-9-]+)\/([A-Za-z0-9._-]+)#([0-9]+)$/.exec(trimmed);
  if (m?.[1] !== undefined && m[2] !== undefined && m[3] !== undefined) {
    return { number: Number.parseInt(m[3], 10), repoSpec: `${m[1]}/${m[2]}` };
  }
  return null;
}

/** Bare id (Azure shape) or the trailing number of an issue/work-item URL. */
function issueNumberFromRef(ref: string): number | null {
  const trimmed = ref.trim();
  if (/^[0-9]+$/.test(trimmed)) return Number.parseInt(trimmed, 10);
  const m = /^https?:\/\/[^?#]*\/([0-9]+)\/?([?#].*)?$/.exec(trimmed);
  return m?.[1] !== undefined ? Number.parseInt(m[1], 10) : null;
}

function checkAuth(): void {
  if (ghApiSync(["auth", "status"], { tolerateFailure: true }).status !== 0) {
    logError("Not authenticated with the active provider");
    logInfo("Run: key-update-provider");
    process.exit(EXIT_GENERAL_ERROR);
  }
}

/** Fail fast on a wrong or unreachable target, before any prompt. */
function probeTargetRepo(): void {
  const spec = requireRepoTarget(providerRepoTarget(""), "issue-create", "issues");
  if (spec === "") return;
  if (ghApiSync(["repo", "view", spec, "--json", "name", "-q", ".name"], { tolerateFailure: true }).status !== 0) {
    logError(`Target repository not found or inaccessible: ${spec}`);
    logInfo("Check the DEVENV_REPO value and your provider access");
    process.exit(EXIT_GENERAL_ERROR);
  }
}

interface CreateState {
  title: string;
  body: string;
  type: string;
  labels: string[];
  assignees: string[];
  milestone: string;
  project: string;
  parent?: string | undefined;
  parentSpec?: string | undefined;
  blockedBy: string[];
  dryRun: boolean;
}

/** Project membership via the provider CLI's project verbs (name -> number). */
function addToProject(issueUrl: string, project: string): boolean {
  // Titles are interpolated into a jq select program downstream — a quote
  // would break out of the literal (the projectsNumberByName facade rejects
  // them for the same reason).
  if (project.includes('"')) {
    logError(`--project: title must not contain double quotes ('${project}')`);
    process.exit(EXIT_MISUSE);
  }
  const { owner } = providerRepoSplit("");
  let projectNumber = project;
  if (!/^[0-9]+$/.test(projectNumber)) {
    const r = ghApiSync(
      ["project", "list", "--owner", owner, "--format", "json", "--jq", `.projects[] | select(.title == "${project}") | .number`],
      { tolerateFailure: true },
    );
    const first = (r.stdout ?? "").trim().split("\n")[0] ?? "";
    if (first === "") {
      logError(`Issue created but could not be added to project: project '${project}' not found`);
      logError("Remediation: verify the project name, then add the issue manually");
      return false;
    }
    projectNumber = first;
    logDebug(`Resolved project '${project}' to number ${projectNumber}`);
  }
  const add = ghApiSync(["project", "item-add", projectNumber, issueUrl, "--owner", owner], { tolerateFailure: true });
  if (add.status !== 0) {
    logError(`Issue created but could not be added to project: ${project} (project may not exist or you may lack permissions)`);
    logError("Remediation: verify project name and permissions, then add the issue manually");
    return false;
  }
  logInfo(`Added to project: ${project}`);
  return true;
}

/**
 * Birth-status write through the project-update-issue fan-out wrapper (the
 * workflow choke point). Best-effort: a refused write never blocks creation.
 */
function applyBirthStatus(issue: number, status: string): void {
  const toolsRoot = process.env["WORKFLOW_CORE_TOOLS"] ?? TOOLS_ROOT;
  const wrapper = join(toolsRoot, "project-update-issue");
  if (!existsSync(wrapper)) {
    logWarn(`workflow write '${status}' skipped: wrapper not found at ${wrapper}`);
    return;
  }
  // The wrapper's contract sets no DEVENV_REPO: fired from the devenv checkout
  // the write targets devenv itself on purpose, so it needs --devenv there.
  const override = process.env["DEVENV_REPO"] === undefined || process.env["DEVENV_REPO"] === "" ? ["--devenv"] : [];
  const r = spawnSync("bash", [wrapper, String(issue), "--status", status, "--all-projects", "--safe", ...override], {
    stdio: ["ignore", "ignore", "inherit"],
  });
  if (r.status !== 0) {
    logWarn(`workflow write '${status}' failed for issue #${issue} (best-effort, continuing)`);
  }
}

async function createIssue(st: CreateState): Promise<number> {
  const spec = requireRepoTarget(providerRepoTarget(""), "issue-create", "issues");
  const finalBody = buildBody({ parent: st.parent, parentSpec: st.parentSpec, blockedBy: st.blockedBy }, st.body);

  if (st.dryRun) {
    logInfo("[DRY RUN] Would create issue via provider_issues_create:");
    const parts = ["provider_issues_create", spec, "--title", st.title, "--body", finalBody];
    for (const l of st.labels) parts.push("--label", l);
    for (const a of st.assignees) parts.push("--assignee", a);
    if (st.milestone !== "") parts.push("--milestone", st.milestone);
    console.log(parts.join(" "));
    return 0;
  }

  const issueUrl = (
    await issuesCreate(spec, {
      title: st.title,
      body: finalBody,
      label: st.labels,
      assignee: st.assignees,
      ...(st.milestone !== "" ? { milestone: st.milestone } : {}),
    })
  ).trim();
  if (issueUrl === "") {
    logError("Failed to create issue");
    return 1;
  }
  logInfo(`Created issue: ${issueUrl}`);

  const issueNumber = issueNumberFromRef(issueUrl);
  if (issueNumber === null) {
    logError(`Issue created, but its number could not be read from the provider's answer: ${issueUrl}`);
    return 1;
  }

  let enrichFailed = 0;

  // Native type-set. Owner/name come from the same spec the create used —
  // never re-derived from the cwd, so create and type-set cannot disagree.
  try {
    const { owner, name } = providerRepoSplit(spec);
    await issuesSetType(owner, name, issueNumber, st.type);
  } catch (err) {
    logError("Issue created but type could not be set");
    logError(`Remediation: issue-update ${issueNumber} --type ${st.type}`);
    logDebug(err instanceof Error ? err.message : String(err));
    enrichFailed = 1;
  }

  if (st.project !== "") {
    logDebug(`Adding issue #${issueNumber} to project: ${st.project}`);
    if (!addToProject(issueUrl, st.project)) enrichFailed = 1;
  }

  // Workflow integration: sub-issue link + birth-status write. All
  // best-effort; failures never block creation. Parent rollup is recomputed
  // by the wrapper's own child-write path.
  if (st.parent !== undefined && st.parent !== "") {
    try {
      await issueGraphLink(spec, Number.parseInt(st.parent, 10), issueNumber, st.parentSpec);
      logDebug(`Linked sub-issue #${issueNumber} -> #${st.parent}`);
    } catch (err) {
      logDebug(`sub-issue link failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  // Birth rule: a Task under a parent is born Ready (its planning is part of
  // implementation); standalone issues and deliverables start at TBD.
  applyBirthStatus(issueNumber, st.type === "Task" && st.parent !== undefined && st.parent !== "" ? "Ready" : "TBD");

  console.log(issueUrl);
  return enrichFailed;
}

// --- Main -------------------------------------------------------------------

async function main(argv: string[]): Promise<number> {
  const { values } = parseArgs({
    args: argv,
    options: {
      help: { type: "boolean", short: "h", default: false },
      version: { type: "boolean", short: "v", default: false },
      verbose: { type: "boolean", short: "V", default: false },
      "dry-run": { type: "boolean", short: "n", default: false },
      devenv: { type: "boolean", default: false },
      title: { type: "string", short: "t" },
      body: { type: "string", short: "b" },
      "body-file": { type: "string", short: "f" },
      type: { type: "string" },
      label: { type: "string", short: "l", multiple: true },
      assignee: { type: "string", short: "a", multiple: true },
      milestone: { type: "string", short: "m" },
      project: { type: "string", short: "p" },
      parent: { type: "string" },
      "blocked-by": { type: "string", multiple: true },
      template: { type: "string" },
      "select-template": { type: "boolean", default: false },
      "no-template": { type: "boolean", default: false },
      "no-interactive": { type: "boolean", default: false },
    },
    allowPositionals: false,
    strict: true,
  });

  if (values["help"]) showUsage();
  if (values["version"]) {
    console.log(SCRIPT_VERSION);
    return 0;
  }

  let title = values["title"] ?? "";
  let body = "";
  const labels = values["label"] ?? [];
  const assignees = values["assignee"] ?? [];
  const blockedBy = values["blocked-by"] ?? [];
  const issueType = values["type"] ?? "";
  const useEditor = !values["no-interactive"];
  const useTemplate = values["template"] !== undefined || values["select-template"] === true;

  // --body / --body-file go through the shared body-source resolver (one
  // implementation of "which source wins and what is an error").
  if (values["body"] !== undefined || values["body-file"] !== undefined) {
    const resolved = resolveBody({ text: values["body"], file: values["body-file"] });
    if (resolved.body !== null) body = resolved.body;
  }

  if (!useEditor && title === "") {
    logError("Issue title is required when using --no-interactive (use --title)");
    return EXIT_MISUSE;
  }

  checkAuth();
  checkTargetRepo(values["devenv"] === true);
  probeTargetRepo();

  // 15.15 placement validation: --parent must satisfy the requested type's
  // child_of rule (org hierarchy from issues-config.yml) BEFORE any create.
  const parentValue = values["parent"];
  let parentRef: ParentRef | null = null;
  if (typeof parentValue === "string" && parentValue !== "") {
    parentRef = parseParentRef(parentValue);
    if (parentRef === null) {
      logError(`Invalid --parent reference: ${parentValue} (expected N or owner/repo#N)`);
      return EXIT_MISUSE;
    }
    if (issueType !== "") {
      // Cross-repo parents validate against their own repo (issuesView
      // takes a spec; the child_of rule still applies — the parent's type
      // is a process fact, not a repo-local one).
      await validatePlacement(
        requireRepoTarget(providerRepoTarget(""), "issue-create", "issues"),
        String(parentRef.number),
        issueType,
        parentRef.repoSpec,
      );
    }
  }

  // Type selection: deterministic mode errors on a missing type; interactive
  // mode picks from the config vocabulary (needs a terminal under this build).
  // F21: --select-template is an explicit opt-in to interactive selection —
  // when it cannot be honored, refuse (a plain create would silently degrade
  // the requested behavior).
  if (useTemplate && values["select-template"] === true && !isInteractive()) {
    logError("--select-template requires an interactive terminal (use --template FILE or drop the flag)");
    return EXIT_MISUSE;
  }

  if (issueType === "") {
    if (!useEditor) {
      logError("Issue type is required when using --no-interactive (use --type)");
      return EXIT_MISUSE;
    }
    if (!isInteractive()) {
      logError("Issue type selection requires an interactive terminal (use --type)");
      return EXIT_MISUSE;
    }
    logError("Interactive type selection is not available in this build; use --type");
    return EXIT_MISUSE;
  }
  const validTypes = issueTypeNames();
  if (!validTypes.includes(issueType)) {
    logError(`Invalid issue type: ${issueType}`);
    logInfo(`Valid types: ${validTypes.join(" ")}`);
    return EXIT_GENERAL_ERROR;
  }

  // Piped-stdin capture happens BEFORE template work so a piped body is never
  // eaten by the editor. Precedence: --body/--body-file > template > stdin.
  let pipedStdinBody: string | null = null;
  if (body === "" && !stdinIsTty()) {
    const content = readStdinSync();
    if (content === "") {
      // Zero bytes + EOF: no pipe was attached (parallel runners, `</dev/null`)
      // — "no source", not an empty body. The capture is skipped entirely;
      // the empty-body refusal stays reserved for a pipe that delivered bytes.
    } else if (stdinIsBlank(content)) {
      logError("Refusing empty piped stdin body");
      console.log("Use --help for usage information");
      return EXIT_MISUSE;
    } else {
      pipedStdinBody = content;
      logDebug("Piped stdin captured as body candidate");
    }
  }

  if (useTemplate) {
    let templateFile = values["template"] ?? "";
    if (templateFile === "") {
      templateFile = selectTemplateInteractive(join(process.cwd(), ".github", "ISSUE_TEMPLATE")) ?? "";
    }
    if (templateFile !== "") {
      if (!existsSync(templateFile)) {
        logError(`Template file not found: ${templateFile}`);
        return 1;
      }
      const raw = readFileSync(templateFile, "utf8");
      const frontmatterTitle = parseFrontmatterTitle(raw);
      const tmpl = templateBody(raw);
      if (useEditor) {
        const tmp = mkdtempSync(join(tmpdir(), "gh-issue."));
        const tmpFile = join(tmp, "issue.md");
        writeFileSync(tmpFile, `${title !== "" ? title : frontmatterTitle}\n---\n${tmpl}`);
        logDebug(`Opening template in editor: ${process.env["EDITOR"] ?? "nano"}`);
        const ed = openInEditor(tmpFile);
        if (!ed.ok) {
          logError("Editor exited with error");
          return 1;
        }
        const edited = readFileSync(tmpFile, "utf8");
        const sep = edited.indexOf("\n---\n");
        if (sep !== -1) {
          title = edited.slice(0, sep);
          body = edited.slice(sep + 5);
        } else {
          const nl = edited.indexOf("\n");
          title = nl === -1 ? edited : edited.slice(0, nl);
          body = nl === -1 ? "" : edited.slice(nl + 1);
        }
        rmSync(tmp, { recursive: true, force: true });
      } else {
        body = tmpl;
        if (title === "") title = frontmatterTitle;
      }
      logDebug(`Template loaded - Title: '${title}' (${body.length} bytes of body)`);
    }
  }

  // The captured stdin body is used only when nothing else produced one; an
  // empty captured body is a hard error (silence hides caller bugs).
  if (body === "" && pipedStdinBody !== null) {
    body = pipedStdinBody;
    logDebug("No body flag and no template body; issue body from piped stdin");
  }

  return await createIssue({
    title,
    body,
    type: issueType,
    labels,
    assignees,
    milestone: values["milestone"] ?? "",
    project: values["project"] ?? "",
    parent: parentRef === null ? values["parent"] : String(parentRef.number),
    parentSpec: parentRef?.repoSpec,
    blockedBy,
    dryRun: values["dry-run"] === true,
  });
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (err: unknown) => {
    logError(err instanceof Error ? err.message : String(err));
    process.exit(EXIT_GENERAL_ERROR);
  },
);
