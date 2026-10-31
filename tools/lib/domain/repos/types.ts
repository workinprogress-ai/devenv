// domain/repos/types.ts - Repository type configuration model (zod rewrite
// of repo-types.bash, the jq/yq-heaviest bash lib). Reads
// tools/config/repo-types.yaml through a bounded YAML-subset parser, exposes
// the typed getters, validate/detect, ruleset stamping, and the configure-*
// appliers the repo-create/repo-update-config tools consume.
//
// Dependency direction: domain → core + providers (never ui).

import { existsSync, readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { logError, logInfo, logWarn } from "../../core/logging.ts";
import { configGetRaw } from "../../core/config.ts";
import {
  orgRulesetsList,
  orgRulesetCreate,
  orgRulesetUpdate,
} from "../../providers/github/org.ts";
import {
  reposPatch,
  reposPatchWithError,
  reposEdit,
  reposTeamPut,
  reposCollaboratorPut,
} from "../../providers/github/repos.ts";

/** The repo-creation readiness decision (15.13's two-stage parity probe):
 * ready only when BOTH tree counts are known and equal — null (a truncated
 * or failed probe) never counts as ready. repo-create's waitForRepoReady
 * loops on this. */
export function repoTreeParityReady(newCount: number | null, templateCount: number | null): boolean {
  return newCount !== null && templateCount !== null && newCount === templateCount;
}

// ---------------------------------------------------------------------------
// Config model (zod)
// ---------------------------------------------------------------------------

export const AccessEntrySchema = z.object({
  name: z.string().min(1),
  type: z.enum(["team", "user"]).default("team"),
  permission: z.string().min(1),
});

export const RepoTypeSchema = z.object({
  description: z.string().default("No description"),
  template: z.string().nullish(),
  naming_pattern: z.string().default(""),
  naming_example: z.string().default("name.example"),
  isTemplate: z.boolean().default(false),
  docs_first: z.boolean().default(false),
  mainBranch: z.string().default("master"),
  rulesetConfigFile: z.string().nullish(),
  post_creation_script: z.string().nullish().default(""),
  delete_post_creation_script: z.boolean().default(true),
  post_creation_commit_handling: z.enum(["none", "amend", "new"]).default("none"),
  allowedMergeTypes: z.array(z.enum(["merge", "squash", "rebase"])).default(["merge"]),
  deletePRBranchOnMerge: z.boolean().default(true),
  hasWiki: z.boolean().default(false),
  hasIssues: z.boolean().default(true),
  hasDiscussions: z.boolean().default(false),
  hasProjects: z.boolean().default(false),
  allowAutoMerge: z.boolean().default(true),
  allowUpdateBranch: z.boolean().default(true),
  allowForking: z.boolean().default(false),
  squashMergeCommitTitle: z.string().default("PR_TITLE"),
  squashMergeCommitMessage: z.string().default("COMMIT_MESSAGES"),
  access: z.array(AccessEntrySchema).default([]),
});

export const RepoTypesConfigSchema = z.object({
  types: z.record(z.string(), RepoTypeSchema),
});

export type AccessEntry = z.infer<typeof AccessEntrySchema>;
export type RepoType = z.infer<typeof RepoTypeSchema>;
export type RepoTypesConfig = z.infer<typeof RepoTypesConfigSchema>;

// ---------------------------------------------------------------------------
// Bounded YAML-subset parser (repo-types.yaml is org-authored, fixed shape:
// nested maps, block lists of scalars and of flat maps; no anchors, no
// multi-line scalars, no flow collections beyond empty).
// ---------------------------------------------------------------------------

type YamlValue = string | boolean | number | null | YamlValue[] | { [k: string]: YamlValue };

interface Line {
  indent: number;
  text: string;
}

function yamlLines(raw: string): Line[] {
  const out: Line[] = [];
  for (const line of raw.split("\n")) {
    if (/^\s*(#|$)/.test(line)) continue;
    const indent = line.length - line.trimStart().length;
    out.push({ indent, text: stripInlineComment(line.trim()) });
  }
  return out;
}

/** Strip a trailing ` # comment` outside quotes (bash yq tolerated these
 * inline; the config carries them). */
function stripInlineComment(text: string): string {
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === "'" && !inDouble) inSingle = !inSingle;
    else if (c === '"' && !inSingle) inDouble = !inDouble;
    else if (c === "#" && !inSingle && !inDouble && i > 0 && text[i - 1] === " ") {
      return text.slice(0, i).trimEnd();
    }
  }
  return text;
}

function parseScalar(text: string): YamlValue {
  if (text === "" || text === "null" || text === "~") return null;
  if (text === "true") return true;
  if (text === "false") return false;
  if (/^-?\d+$/.test(text)) return Number(text);
  if (/^-?\d+\.\d+$/.test(text)) return Number(text);
  const q = text[0];
  if ((q === '"' || q === "'") && text.endsWith(q)) return text.slice(1, -1);
  return text;
}

function parseBlock(lines: Line[], pos: { i: number }, indent: number): YamlValue {
  if (pos.i >= lines.length) return null;
  const first = lines[pos.i];
  if (first === undefined) return null;
  if (first.text.startsWith("- ") || first.text === "-") {
    // Block list
    const arr: YamlValue[] = [];
    while (pos.i < lines.length) {
      const line = lines[pos.i];
      if (line === undefined || line.indent < indent || !(line.text.startsWith("- ") || line.text === "-")) break;
      const rest = line.text === "-" ? "" : line.text.slice(2);
      if (rest === "") {
        pos.i++;
        const next = lines[pos.i];
        arr.push(next !== undefined && next.indent > line.indent ? parseBlock(lines, pos, next.indent) : null);
      } else if (/^[^:\s]+:\s/.test(rest) || /^[^:\s]+:$/.test(rest)) {
        // Inline first key of a map item; subsequent keys sit at indent+2.
        const itemIndent = line.indent + 2;
        const map: { [k: string]: YamlValue } = {};
        const kv = rest.indexOf(":");
        const k = rest.slice(0, kv);
        const v = rest.slice(kv + 1).trim();
        if (v === "") {
          pos.i++;
          map[k] = parseBlock(lines, pos, line.indent + 2);
        } else {
          map[k] = parseScalar(v);
          pos.i++;
        }
        while (pos.i < lines.length) {
          const sub = lines[pos.i];
          if (sub === undefined || sub.indent < itemIndent) break;
          const sk = sub.text.indexOf(":");
          if (sk === -1) break;
          const key = sub.text.slice(0, sk);
          const sv = sub.text.slice(sk + 1).trim();
          if (sv === "") {
            pos.i++;
            map[key] = parseBlock(lines, pos, sub.indent + 1);
          } else {
            map[key] = parseScalar(sv);
            pos.i++;
          }
        }
        arr.push(map);
      } else {
        arr.push(parseScalar(rest));
        pos.i++;
      }
    }
    return arr;
  }
  // Map
  const map: { [k: string]: YamlValue } = {};
  while (pos.i < lines.length) {
    const line = lines[pos.i];
    if (line === undefined || line.indent < indent) break;
    const sk = line.text.indexOf(":");
    if (sk === -1) {
      pos.i++;
      continue;
    }
    const key = line.text.slice(0, sk);
    const sv = line.text.slice(sk + 1).trim();
    if (sv === "") {
      pos.i++;
      // Child block: its indent is whatever the next line actually carries
      // (2-space steps are conventional, not guaranteed).
      const next = lines[pos.i];
      map[key] = next !== undefined && next.indent > line.indent
        ? parseBlock(lines, pos, next.indent)
        : null;
    } else {
      map[key] = parseScalar(sv);
      pos.i++;
    }
  }
  return map;
}

/** Parse the bounded YAML subset; throws naming the failure on shapes the
 * parser does not cover (fail loud — the config is org-authored). */
export function parseYamlSubset(raw: string): YamlValue {
  const lines = yamlLines(raw);
  const pos = { i: 0 };
  return parseBlock(lines, pos, 0);
}

// ---------------------------------------------------------------------------
// Config loading
// ---------------------------------------------------------------------------

/** The repo-types config path: explicit override → REPO_TYPES_CONFIG →
 * the default tools/config/repo-types.yaml. */
export function repoTypesConfigPath(override?: string, devenvTools?: string): string {
  if (override !== undefined && override !== "") return override;
  const env = process.env.REPO_TYPES_CONFIG ?? "";
  if (env !== "") return env;
  return join(devenvTools ?? toolsRootFallback(), "config", "repo-types.yaml");
}

function toolsRootFallback(): string {
  // scripts/x.ts → tools (the module's own tools root, self-root contract).
  return join(import.meta.dirname ?? ".", "..", "..");
}

/** Load and validate the repo types config. Throws on a missing file or a
 * shape violation (zod names the path). `devenvTools` resolves the default
 * config location when no explicit path/env override applies. */
export function loadRepoTypesConfig(configPath?: string, devenvTools?: string): RepoTypesConfig {
  const path = repoTypesConfigPath(configPath, devenvTools);
  if (!existsSync(path)) {
    throw new Error(`Repo types config not found: ${path}`);
  }
  const parsed = RepoTypesConfigSchema.parse(parseYamlSubset(readFileSync(path, "utf8")));
  return parsed;
}

// ---------------------------------------------------------------------------
// Getters (typed over the parsed config; defaults live in the schema)
// ---------------------------------------------------------------------------

export function getType(repoType: string, config: RepoTypesConfig): RepoType | undefined {
  return config.types[repoType];
}

export const getTypeMainBranch = (t: RepoType): string => t.mainBranch;
export const getTypeTemplate = (t: RepoType): string | null => t.template ?? null;
export const getTypeRulesetConfigFile = (t: RepoType): string | null => t.rulesetConfigFile ?? null;
export const getTypeAllowedMergeTypes = (t: RepoType): string[] => t.allowedMergeTypes;
export const getTypeIsTemplate = (t: RepoType): boolean => t.isTemplate;
export const getTypeDocsFirst = (t: RepoType): boolean => t.docs_first;
export const getTypePostCreationScript = (t: RepoType): string => t.post_creation_script ?? "";
export const getTypeDeletePostCreationScript = (t: RepoType): boolean => t.delete_post_creation_script;
export const getTypePostCreationCommitHandling = (t: RepoType): string => t.post_creation_commit_handling;
export const getTypeDescription = (t: RepoType): string => t.description;
export const getTypeNamingPattern = (t: RepoType): string => t.naming_pattern;
export const getTypeNamingExample = (t: RepoType): string => t.naming_example;
export const getTypeDeletePrBranchOnMerge = (t: RepoType): boolean => t.deletePRBranchOnMerge;
export const getTypeHasWiki = (t: RepoType): boolean => t.hasWiki;
export const getTypeHasIssues = (t: RepoType): boolean => t.hasIssues;
export const getTypeHasDiscussions = (t: RepoType): boolean => t.hasDiscussions;
export const getTypeHasProjects = (t: RepoType): boolean => t.hasProjects;
export const getTypeAllowAutoMerge = (t: RepoType): boolean => t.allowAutoMerge;
export const getTypeAllowUpdateBranch = (t: RepoType): boolean => t.allowUpdateBranch;
export const getTypeAllowForking = (t: RepoType): boolean => t.allowForking;
export const getTypeSquashMergeCommitTitle = (t: RepoType): string => t.squashMergeCommitTitle;
export const getTypeSquashMergeCommitMessage = (t: RepoType): string => t.squashMergeCommitMessage;
export const getTypeAccess = (t: RepoType): AccessEntry[] => t.access;

// ---------------------------------------------------------------------------
// Validate / detect
// ---------------------------------------------------------------------------

/** Enforce a repo name against its type's naming pattern (owner/repo form is
 * accepted; the repo segment is matched). Throws naming the violation. */
export function validateRepoType(repoName: string, repoType: string, config: RepoTypesConfig): void {
  if (repoType === "none") return;
  const type = config.types[repoType];
  if (type === undefined || type.naming_pattern === "") {
    logError(`Unknown repository type '${repoType}'`);
    logInfo("Valid types:");
    for (const key of Object.keys(config.types)) console.error(`  ${key}`);
    throw new Error(`Unknown repository type '${repoType}'`);
  }
  const extracted = repoName.includes("/") ? (repoName.split("/").pop() ?? repoName) : repoName;
  if (!new RegExp(type.naming_pattern).test(extracted)) {
    logError(`Repository name '${extracted}' does not match pattern for type '${repoType}'`);
    logInfo(`Expected pattern: ${type.naming_example}`);
    throw new Error(`Repository name '${extracted}' does not match pattern for type '${repoType}'`);
  }
}

/** Detect the repo type by matching the name against each type's pattern.
 * Returns the type key, or null when nothing matches (silent mode). */
export function detectRepoType(fullName: string, config: RepoTypesConfig): string | null {
  const repoName = fullName.includes("/") ? (fullName.split("/").pop() ?? fullName) : fullName;
  for (const [key, type] of Object.entries(config.types)) {
    if (type.naming_pattern !== "" && new RegExp(type.naming_pattern).test(repoName)) return key;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Ruleset stamping
// ---------------------------------------------------------------------------

/** Token-replacement over every string in the ruleset template, one pass:
 * {{owner}}, {{repo_name}}, {{email_domain}}, {{type_name}},
 * {{type_description}}. Unknown tokens are left as written; substituted
 * values are never re-expanded. An empty email_domain drops the
 * email-pattern rules (they would read ends_with "@" and reject every
 * author). */
export function buildRulesetPayload(
  template: string,
  tokens: { repo_name: string; owner: string; email_domain: string; type_name: string; type_description: string },
): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(template);
  } catch (err) {
    logWarn(`Ruleset template did not produce valid JSON: ${err instanceof Error ? err.message : String(err)}`);
    return "{}";
  }
  const named: Record<string, string> = {
    owner: tokens.owner,
    repo_name: tokens.repo_name,
    email_domain: tokens.email_domain,
    type_name: tokens.type_name,
    type_description: tokens.type_description,
  };
  const walk = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(walk);
    if (v !== null && typeof v === "object") {
      const out: Record<string, unknown> = {};
      for (const [k, val] of Object.entries(v as Record<string, unknown>)) out[k] = walk(val);
      return out;
    }
    if (typeof v === "string") {
      return v.replace(/\{\{([a-z_]+)\}\}/g, (match, k: string) => named[k] ?? match);
    }
    return v;
  };
  const payload: unknown = walk(parsed);
  if (tokens.email_domain === "" && payload !== null && typeof payload === "object") {
    const obj = payload as { rules?: unknown };
    if (Array.isArray(obj.rules)) {
      obj.rules = obj.rules.filter((r) => {
        const ruleType = (r as { type?: unknown })?.type;
        return typeof ruleType === "string" && !ruleType.includes("email_pattern");
      });
    }
  }
  try {
    return JSON.stringify(payload);
  } catch {
    return "{}";
  }
}

/** Apply the type's ruleset to the repo: build the payload, update the
 * existing ruleset via PUT when one of the same name exists, else create. */
export function configureRulesetsForType(
  fullName: string,
  repoType: string,
  config: RepoTypesConfig,
  devenvTools: string,
): void {
  const type = config.types[repoType];
  if (type === undefined) return;
  const rulesetFile = getTypeRulesetConfigFile(type);
  if (rulesetFile === null || rulesetFile === "") {
    logInfo("No ruleset configured for this type");
    return;
  }
  logInfo(`Configuring repository ruleset from ${rulesetFile}...`);
  const rulesetJsonPath = join(devenvTools, "config", rulesetFile);
  if (!existsSync(rulesetJsonPath)) {
    logWarn(`Ruleset file not found: ${rulesetJsonPath}`);
    return;
  }
  const owner = fullName.includes("/") ? fullName.slice(0, fullName.indexOf("/")) : "";
  const repoName = fullName.includes("/") ? (fullName.split("/").pop() ?? "") : fullName;
  const payloadJson = buildRulesetPayload(readFileSync(rulesetJsonPath, "utf8"), {
    repo_name: repoName,
    owner,
    email_domain: readEmailDomain(),
    type_name: repoType,
    type_description: getTypeDescription(type),
  });
  if (payloadJson === "{}" || payloadJson === "") {
    logWarn(
      `Failed to generate valid ruleset payload from ${rulesetFile} for repo type '${repoType}' (type description: '${getTypeDescription(type)}')`,
    );
    return;
  }
  let rulesetName = "Unknown";
  try {
    rulesetName = (JSON.parse(payloadJson) as { name?: unknown }).name as string ?? "Unknown";
  } catch {
    // payload was valid above; keep the default name on the unlikely failure
  }

  let existingId = "";
  try {
    const list = JSON.parse(orgRulesetsList(fullName)) as Array<{ name?: unknown; id?: unknown }>;
    const found = Array.isArray(list) ? list.find((r) => r.name === rulesetName) : undefined;
    if (found !== undefined && found.id !== undefined && found.id !== null) existingId = String(found.id);
  } catch {
    existingId = "";
  }

  // Build the payload dir path explicitly: recursive mkdirSync returns
  // undefined when the directory already exists, so its return value is not
  // a usable path (a once-created stale dir would crash every later run).
  const payloadDir = join(tmpdir(), "ruleset-payload-");
  mkdirSync(payloadDir, { recursive: true });
  const tmp = join(payloadDir, `payload-${process.pid}.json`);
  writeFileSync(tmp, payloadJson);

  if (existingId !== "") {
    const updated = orgRulesetUpdate(fullName, existingId, tmp);
    if (updated.ok) {
      logInfo(`✓ Ruleset '${rulesetName}' updated`);
    } else if (updated.stderr.toLowerCase().includes("403") || updated.stderr.toLowerCase().includes("upgrade to github pro")) {
      logWarn("Rulesets require GitHub Pro or a public repository");
      logInfo("Repository created successfully - rulesets can be configured later when upgrading");
    } else {
      logWarn(`Ruleset update failed for '${rulesetName}'`);
      if (updated.stderr.trim() !== "") logWarn(`API Response: ${updated.stderr.trim()}`);
    }
  } else {
    const created = orgRulesetCreate(fullName, tmp);
    const err = created.stderr.toLowerCase();
    if (created.ok) {
      logInfo(`✓ Ruleset '${rulesetName}' configured`);
    } else if (err.includes("must be unique")) {
      logInfo(`⊘ Ruleset '${rulesetName}' already exists (skipping)`);
    } else if (err.includes("403") || err.includes("upgrade to github pro") || err.includes("make this repository public")) {
      logWarn("Rulesets require GitHub Pro or a public repository");
      logInfo("Repository created successfully - rulesets can be configured later when upgrading");
    } else {
      logWarn(`Ruleset configuration failed for '${rulesetName}'`);
      if (created.stderr.trim() !== "") logWarn(`API Response: ${created.stderr.trim()}`);
    }
  }
  try {
    rmSync(tmp);
  } catch {
    // cleanup best effort
  }
}

/** organization.email_domain from devenv.config; empty means "accept any
 * valid email" in the ruleset stamp. */
function readEmailDomain(): string {
  const configPath = process.env.DEVENV_ROOT !== undefined && process.env.DEVENV_ROOT !== ""
    ? join(process.env.DEVENV_ROOT, "devenv.config")
    : "devenv.config";
  return configGetRaw(configPath, "organization", "email_domain") ?? "";
}

// ---------------------------------------------------------------------------
// Configure appliers (repository settings for a type)
// ---------------------------------------------------------------------------

/** Configure allowed merge types (repo-level merge buttons). Returns false
 * when the API call fails (bash parity: failure is reported, not swallowed). */
export function configureMergeTypesForType(fullName: string, repoType: string, config: RepoTypesConfig): boolean {
  const type = config.types[repoType];
  if (type === undefined) {
    logError("Repository name and type required");
    return false;
  }
  logInfo("Configuring merge types for repository...");
  const merges = getTypeAllowedMergeTypes(type);
  const allowMerge = merges.includes("merge");
  const allowSquash = merges.includes("squash");
  const allowRebase = merges.includes("rebase");
  const ok = reposPatch(fullName, [
    "-F", `allow_merge_commit=${allowMerge}`,
    "-F", `allow_squash_merge=${allowSquash}`,
    "-F", `allow_rebase_merge=${allowRebase}`,
  ]);
  if (ok) {
    logInfo(`✓ Merge types configured (merge: ${allowMerge}, squash: ${allowSquash}, rebase: ${allowRebase})`);
    return true;
  }
  logWarn("Could not configure merge types (may require admin access or Pro account)");
  return false;
}

/** Mark the repository as a GitHub template when the type says so. */
export function configureTemplateSettingForType(fullName: string, repoType: string, config: RepoTypesConfig): void {
  const type = config.types[repoType];
  if (type === undefined) return;
  if (getTypeIsTemplate(type)) {
    logInfo("Marking repository as a template...");
    if (reposEdit(fullName, ["--template"])) {
      logInfo("✓ Repository marked as template");
    } else {
      logWarn("Could not mark repository as template (may require admin access)");
    }
  } else {
    logInfo("Repository template setting: not a template");
  }
}

/** Configure PR branch deletion on merge. */
export function configurePrBranchDeletionForType(fullName: string, repoType: string, config: RepoTypesConfig): void {
  const type = config.types[repoType];
  if (type === undefined) {
    logError("Repository name and type required");
    return;
  }
  const deletePrBranch = getTypeDeletePrBranchOnMerge(type);
  logInfo("Configuring PR branch deletion on merge...");
  if (reposPatch(fullName, ["-F", `delete_branch_on_merge=${deletePrBranch}`])) {
    logInfo(`✓ PR branch deletion on merge configured (enabled: ${deletePrBranch})`);
  } else {
    logWarn("Could not configure PR branch deletion (may require admin access)");
  }
}

/** Configure repository features in one PATCH (wiki/issues/discussions/
 * projects, auto-merge/update-branch/forking, squash title/message). */
export function configureRepositoryFeaturesForType(fullName: string, repoType: string, config: RepoTypesConfig): void {
  const type = config.types[repoType];
  if (type === undefined) {
    logError("Repository name and type required");
    return;
  }
  logInfo("Configuring repository features...");
  const baseFlags = [
    "-F", `has_wiki=${getTypeHasWiki(type)}`,
    "-F", `has_issues=${getTypeHasIssues(type)}`,
    "-F", `has_discussions=${getTypeHasDiscussions(type)}`,
    "-F", `has_projects=${getTypeHasProjects(type)}`,
    "-F", `allow_auto_merge=${getTypeAllowAutoMerge(type)}`,
    "-F", `allow_update_branch=${getTypeAllowUpdateBranch(type)}`,
    "-F", `allow_forking=${getTypeAllowForking(type)}`,
    "-f", `squash_merge_commit_title=${getTypeSquashMergeCommitTitle(type)}`,
    "-f", `squash_merge_commit_message=${getTypeSquashMergeCommitMessage(type)}`,
  ];
  // One rejected field kills the whole PATCH, and GitHub rejects
  // allow_forking on org-owned PUBLIC repositories. Probe with the full
  // set; on failure retry without allow_forking so the other flags still
  // land, and report exactly what was skipped (and why, quoting the API).
  let result = reposPatchWithError(fullName, baseFlags);
  let forkSkipped = false;
  if (!result.ok) {
    // baseFlags is a flat [flag, value, ...] array: dropping only the value
    // would orphan its -F and corrupt the argv (gh: "accepts 1 arg(s),
    // received 2"). Drop the flag token and its value as a pair.
    const withoutFork = baseFlags.filter((f, i) => {
      if (f === "-F" && baseFlags[i + 1]?.startsWith("allow_forking=")) return false;
      return f !== "allow_forking=false";
    });
    const retry = reposPatchWithError(fullName, withoutFork);
    if (retry.ok) {
      forkSkipped = true;
      result = retry;
    } else {
      result = retry.error !== "" ? retry : result;
    }
  }
  if (result.ok) {
    logInfo("✓ Repository features configured:");
    logInfo(`  - Wiki: ${getTypeHasWiki(type)}, Issues: ${getTypeHasIssues(type)}, Discussions: ${getTypeHasDiscussions(type)}, Projects: ${getTypeHasProjects(type)}`);
    if (forkSkipped) {
      logWarn(`  - Forking: NOT applied — allow_forking cannot be set on this repository (org-owned public repos reject it)`);
    } else {
      logInfo(`  - Auto-merge: ${getTypeAllowAutoMerge(type)}, Update branch: ${getTypeAllowUpdateBranch(type)}, Forking: ${getTypeAllowForking(type)}`);
    }
    logInfo(`  - Squash merge: title=${getTypeSquashMergeCommitTitle(type)}, message=${getTypeSquashMergeCommitMessage(type)}`);
  } else {
    const why = result.error !== "" ? ` GitHub said: ${result.error}` : "";
    logWarn(`Could not configure repository features${why}`);
  }
}

/** Configure team/user access entries (idempotent PUTs). */
export function configureRepositoryPermissionsForType(fullName: string, repoType: string, config: RepoTypesConfig): void {
  const type = config.types[repoType];
  if (type === undefined) {
    logError("Repository name and type required");
    return;
  }
  logInfo("Configuring repository permissions...");
  const access = getTypeAccess(type);
  if (access.length === 0) {
    logInfo("No access configuration specified");
    return;
  }
  const owner = fullName.includes("/") ? fullName.slice(0, fullName.indexOf("/")) : "";
  let success = 0;
  let skipped = 0;
  let failed = 0;
  for (const entry of access) {
    if (entry.name === "" || entry.permission === "") {
      logWarn(`  ⊘ Skipping invalid access entry: name=${entry.name}, permission=${entry.permission}`);
      skipped++;
      continue;
    }
    if (entry.type === "team") {
      if (reposTeamPut(owner, entry.name, fullName, entry.permission)) {
        logInfo(`  ✓ Team '${entry.name}' granted '${entry.permission}' permission`);
        success++;
      } else {
        logWarn(`  ✗ Failed to grant team '${entry.name}' permission (may not exist or lack admin access)`);
        failed++;
      }
    } else if (entry.type === "user") {
      if (reposCollaboratorPut(fullName, entry.name, entry.permission)) {
        logInfo(`  ✓ User '${entry.name}' granted '${entry.permission}' permission`);
        success++;
      } else {
        logWarn(`  ✗ Failed to grant user '${entry.name}' permission (may not exist or lack admin access)`);
        failed++;
      }
    } else {
      logWarn(`  ⊘ Unknown access type '${entry.type}' for '${entry.name}'`);
      skipped++;
    }
  }
  logInfo(`✓ Permission configuration complete: ${success} succeeded, ${failed} failed, ${skipped} skipped`);
}
