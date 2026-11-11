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

import { basename, join } from "node:path";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";

import { EXIT_API_FAILURE, EXIT_GENERAL_ERROR, EXIT_MISUSE } from "../lib/core/exit-codes.ts";
import { logDebug, logError, logInfo, logWarn } from "../lib/core/logging.ts";
import { assertNodeFloor } from "../lib/core/node-floor.ts";
import { errorMessage } from "../lib/core/logging.ts";
import { toolCli, usageEnvBlock } from "../lib/core/cli.ts";
import { resolveBodySource } from "../lib/core/body-source.ts";
import { openInEditor } from "../lib/core/editor.ts";
import { isInteractive } from "../lib/ui/prompts.ts";
import { checkTargetRepo, requireRepoTarget, providerRepoSplit, providerRepoTarget } from "../lib/providers/provider-core.ts";
import { authStatusOk } from "../lib/providers/facade/urls.ts";
import { reposExists } from "../lib/providers/facade/repos.ts";
import { projectsAddIssue } from "../lib/providers/facade/projects.ts";
import { issuesCreate, issuesExists, issuesSetType, issueGraphLink, issuesView, issueWebUrl } from "../lib/providers/facade/issues.ts";
import { issueNumberFromRef } from "../lib/domain/issues/refs.ts";
import { childOfMap, issueTypeNames, resolveIssueType } from "../lib/domain/issues/types.ts";
import { writeStatus } from "../lib/domain/issues/graph.ts";

assertNodeFloor();

const SCRIPT_VERSION = "1.1.0";
const SCRIPT_NAME = basename(process.argv[1] ?? "issue-create.ts");

function showUsage(): never {
  const s = SCRIPT_NAME;
  console.log(`Usage: ${s} [OPTIONS]

Create a new GitHub issue with labels, assignees, and project assignment.

Options:
    -h, --help                  Show this help message and exit
    -v, --version               Show version information and exit
    -V, --verbose               Enable verbose output (debug logging)
    -n, --dry-run               Show what would be done without acting

Optional Flags:
    --devenv                    Allow creating issues in devenv repo itself (safety override)
Optional:
    -t, --title TITLE           Issue title (required only with --no-interactive)
    -b, --body TEXT             Issue body/description
    -f, --body-file FILE        Read issue body from file (markdown; '-' reads
                                stdin; piped stdin with no flag is auto-read)
    --type TYPE                 Issue type: a type (or alias) from issues-config.yml,
                                case-insensitive
    -l, --label LABEL           Add label (can be specified multiple times)
    -a, --assignee USER         Assign to user (can be specified multiple times)
    -m, --milestone NAME        Assign to milestone
    -p, --project NAME          Add to project (name or number)
    --parent ISSUE_NUM          Link to parent issue (any type per issues-config
                                child_of; Task-under-Task sub-issues included)
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
${usageEnvBlock()}

Examples:
    ${s} --title "Quick bug" --type Bug --body "Something is broken"

    # Create a story under an epic
    ${s} --title "Add OAuth" --type Task --parent 123 --no-interactive
`);
  process.exit(0);
}

// --- Target-repo guard (same contract as the other issue tools) -----------

// --- Body-source resolution: the shared resolver (lib/core/body-source) ---

// --- Placement ---------------------------------------------------------------

/** Placement validation: when --parent is given, the parent's type
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
 * A cross-repo parent (`owner/repo#N`) renders as the provider's work-item
 * address - a bare `Part of #N` would point into the child's own repo and mislead.
 */
async function buildBody(
  refs: { parent?: string | undefined; parentSpec?: string | undefined; blockedBy: string[] },
  content: string,
): Promise<string> {
  let body = "";
  if (refs.parent !== undefined && refs.parent !== "") {
    if (refs.parentSpec !== undefined && refs.parentSpec !== "") {
      body += `Part of ${await issueWebUrl(refs.parentSpec, Number.parseInt(refs.parent, 10))}\n\n`;
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

/** Fail fast when the active provider has no usable credential — through
 * the facade's provider-neutral authStatusOk (gh path scrubs env tokens;
 * azure path checks the PAT file) rather than a gh-only probe. */
async function checkAuth(): Promise<void> {
  if (!(await authStatusOk())) {
    logError("Not authenticated with the active provider");
    logInfo("Run: key-update-provider");
    process.exit(EXIT_GENERAL_ERROR);
  }
}

/** Fail fast on a wrong or unreachable target, before any prompt. */
async function probeTargetRepo(): Promise<void> {
  const spec = requireRepoTarget(providerRepoTarget(""), "issue-create", "issues");
  if (spec === "") return;
  if (!(await reposExists(spec))) {
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

/** Project membership through the provider facade (title or number). */
async function addToProject(issueUrl: string, project: string): Promise<boolean> {
  const { owner } = providerRepoSplit("");
  try {
    await projectsAddIssue(owner, project, issueUrl);
  } catch (err) {
    logError(`Issue created but could not be added to project: ${project} (${errorMessage(err)})`);
    logError("Remediation: verify project name and permissions, then add the issue manually");
    return false;
  }
  logInfo(`Added to project: ${project}`);
  return true;
}

/**
 * Birth-status write through the workflow choke point (writeStatus fans the
 * status out to every board holding the issue and rolls the parent up).
 * Best-effort: a refused write is a warning and never blocks creation.
 */
async function applyBirthStatus(issue: number, status: string): Promise<void> {
  const ok = await writeStatus(issue, status, {
    onWarning: (m) => logWarn(m.replace(/^WARNING: /, "")),
  });
  if (!ok) logWarn(`birth status '${status}' was not written for issue #${issue}`);
}

/** POSIX single-quote quoting; plain words stay bare. */
function shellQuote(arg: string): string {
  return /^[A-Za-z0-9_@%+=:,./#-]+$/.test(arg) ? arg : `'${arg.replaceAll("'", "'\\''")}'`;
}

async function createIssue(st: CreateState): Promise<number> {
  const spec = requireRepoTarget(providerRepoTarget(""), "issue-create", "issues");
  const finalBody = await buildBody({ parent: st.parent, parentSpec: st.parentSpec, blockedBy: st.blockedBy }, st.body);

  if (st.dryRun) {
    logInfo(`[DRY RUN] Would create issue in ${spec} with body:\n${finalBody}`);
    const parts = ["issue-create", "--no-interactive", "--title", st.title, "--type", st.type];
    if (st.body !== "") parts.push("--body", st.body);
    for (const l of st.labels) parts.push("--label", l);
    for (const a of st.assignees) parts.push("--assignee", a);
    if (st.milestone !== "") parts.push("--milestone", st.milestone);
    if (st.project !== "") parts.push("--project", st.project);
    if (st.parent !== undefined && st.parent !== "") {
      parts.push("--parent", st.parentSpec !== undefined && st.parentSpec !== "" ? `${st.parentSpec}#${st.parent}` : st.parent);
    }
    for (const b of st.blockedBy) parts.push("--blocked-by", b);
    console.log(parts.map(shellQuote).join(" "));
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
    await issuesSetType(spec, issueNumber, st.type);
  } catch (err) {
    logError("Issue created but type could not be set");
    logError(`Remediation: issue-update ${issueNumber} --type ${st.type}`);
    logDebug(errorMessage(err));
    enrichFailed = 1;
  }

  if (st.project !== "") {
    logDebug(`Adding issue #${issueNumber} to project: ${st.project}`);
    if (!(await addToProject(issueUrl, st.project))) enrichFailed = 1;
  }

  // Workflow integration: sub-issue link + birth-status write. Failures
  // never block creation; a failed link is reported and exits non-zero, and
  // a failed birth status is a warning.
  if (st.parent !== undefined && st.parent !== "") {
    try {
      await issueGraphLink(spec, Number.parseInt(st.parent, 10), issueNumber, st.parentSpec);
      logDebug(`Linked sub-issue #${issueNumber} -> #${st.parent}`);
    } catch (err) {
      logWarn(`sub-issue link failed: ${errorMessage(err)}`);
      logWarn(`Remediation: link #${issueNumber} under parent ${st.parent} manually`);
      enrichFailed = 1;
    }
  }
  // Birth rule: a Task under a parent is born Ready (its planning is part of
  // implementation); standalone issues and deliverables start at TBD.
  await applyBirthStatus(issueNumber, st.type === "Task" && st.parent !== undefined && st.parent !== "" ? "Ready" : "TBD");

  console.log(issueUrl);
  return enrichFailed;
}

// --- Main -------------------------------------------------------------------

async function main(argv: string[]): Promise<number> {
  let cli: ReturnType<typeof toolCli>;
  try {
    cli = toolCli({
      rejectEmptyValues: true,
      name: SCRIPT_NAME,
      version: SCRIPT_VERSION,
      argv,
      allowPositionals: false,
      options: {
        "dry-run": { type: "boolean", short: "n", default: false },
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
    });
  } catch (err) {
    logError(errorMessage(err));
    console.error("Use --help for usage information");
    return EXIT_MISUSE;
  }
  const values = cli.values as Record<string, string | boolean | string[] | undefined>;

  if (cli.common.help) showUsage();

  let title = ((values["title"] as string | undefined) ?? "");
  let body = "";
  const labels = values["label"] ?? [];
  const assignees = values["assignee"] ?? [];
  const blockedBy = values["blocked-by"] ?? [];
  const issueType = ((values["type"] as string | undefined) ?? "");
  const useEditor = values["no-interactive"] !== true;
  const useTemplate = values["template"] !== undefined || values["select-template"] === true;

  // --body / --body-file go through the shared body-source resolver (one
  // implementation of "which source wins and what is an error"). The
  // interactive outcome is issue-create's own: no flags + TTY means the
  // template picker (further down), never an auto-read.
  if (values["body"] !== undefined || values["body-file"] !== undefined) {
    const resolved = resolveBodySource({ text: values["body"] as string | undefined, file: values["body-file"] as string | undefined });
    if (!resolved.ok) {
      logError(resolved.error.message);
      // A missing --body-file was always a usage error (exit 2) in this
      // tool — preserved against the resolver's API-failure default.
      return EXIT_MISUSE;
    }
    if (resolved.source !== "interactive") body = resolved.body;
  }

  if (!useEditor && title === "") {
    logError("Issue title is required when using --no-interactive (use --title)");
    return EXIT_MISUSE;
  }

  // The type is validated against the local config before any provider call:
  // a bad value exits 2 without touching the network.
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
  let validTypes: string[];
  let resolvedType: string | null;
  try {
    validTypes = issueTypeNames();
    resolvedType = resolveIssueType(issueType);
  } catch (err) {
    logError(errorMessage(err));
    return EXIT_GENERAL_ERROR;
  }
  if (resolvedType === null) {
    logError(`Invalid issue type: ${issueType}`);
    logInfo(`Valid types: ${validTypes.join(" ")}`);
    return EXIT_MISUSE;
  }

  for (const b of blockedBy as string[]) {
    if (!/^[0-9]+$/.test(b)) {
      logError(`Invalid --blocked-by reference: ${b} (expected an issue number)`);
      return EXIT_MISUSE;
    }
  }

  await checkAuth();
  checkTargetRepo(cli.common.devenv);
  await probeTargetRepo();

  if (!cli.common.dryRun) {
    const spec = requireRepoTarget(providerRepoTarget(""), "issue-create", "issues");
    for (const b of blockedBy as string[]) {
      if (!(await issuesExists(spec, Number.parseInt(b, 10)))) {
        logError(`Blocked-by target #${b} not found`);
        return EXIT_API_FAILURE;
      }
    }
  }

  // Placement validation: --parent must satisfy the requested type's
  // child_of rule (org hierarchy from issues-config.yml) BEFORE any create.
  const parentValue = values["parent"];
  let parentRef: ParentRef | null = null;
  if (typeof parentValue === "string" && parentValue !== "") {
    parentRef = parseParentRef(parentValue);
    if (parentRef === null) {
      logError(`Invalid --parent reference: ${parentValue} (expected N or owner/repo#N)`);
      return EXIT_MISUSE;
    }
    // Cross-repo parents validate against their own repo (issuesView
    // takes a spec; the child_of rule still applies — the parent's type
    // is a process fact, not a repo-local one).
    await validatePlacement(
      requireRepoTarget(providerRepoTarget(""), "issue-create", "issues"),
      String(parentRef.number),
      resolvedType,
      parentRef.repoSpec,
    );
  }

  // Piped-stdin capture happens BEFORE template work so a piped body is never
  // eaten by the editor. Precedence: --body/--body-file > template > stdin.
  // Zero bytes + EOF reads as "no source" here (parallel runners,
  // `</dev/null`): the empty-body refusal stays reserved for a pipe that
  // delivered bytes — the same read/validate split the resolver's stdin
  // leg performs, kept local because the no-vs-empty distinction is
  // issue-create's (template precedence sits between them).
  let pipedStdinBody: string | null = null;
  if (body === "" && !Boolean(process.stdin.isTTY)) {
    let content = "";
    try {
      content = readFileSync(0, "utf8");
    } catch {
      content = "";
    }
    if (content === "") {
      // Zero bytes + EOF: no pipe was attached — "no source", not an empty
      // body. The capture is skipped entirely.
    } else if (content.replace(/\s/g, "") === "") {
      logError("Refusing empty piped stdin body");
      console.error("Use --help for usage information");
      return EXIT_MISUSE;
    } else {
      pipedStdinBody = content;
      logDebug("Piped stdin captured as body candidate");
    }
  }

  if (useTemplate) {
    let templateFile = ((values["template"] as string | undefined) ?? "");
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
    type: resolvedType,
    labels: labels as string[],
    assignees: assignees as string[],
    milestone: ((values["milestone"] as string | undefined) ?? ""),
    project: ((values["project"] as string | undefined) ?? ""),
    parent: parentRef === null ? ((values["parent"] as string | undefined) ?? "") : String(parentRef.number),
    parentSpec: parentRef?.repoSpec,
    blockedBy: blockedBy as string[],
    dryRun: cli.common.dryRun,
  });
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (err: unknown) => {
    logError(errorMessage(err));
    process.exit(EXIT_GENERAL_ERROR);
  },
);
