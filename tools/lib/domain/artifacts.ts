// artifacts.ts — the artifacts domain (artifact header parsing and
// package-type registry).
//
// Two halves:
//   1. Header parse: the DEVENV_ARTIFACT_V1 metadata block parser. The
//      marker must open within the first 1024 chars; a block closed by a
//      `-->` line reachable through key, blank and comment lines alone holds
//      every key line before it; any other block holds the leading run of
//      key lines (see headerBlock). Values are
//      collected into a flat object. Every lookup in this file reads the
//      same delimited block (headerBlock), never a fixed-length prefix.
//      Tests pin the rules.
//   2. GitHub Packages reads: the package-type registry and the paginated
//      package/version queries (transport via the provider facade).

import { readFileSync } from "node:fs";
import * as configModule from "../core/config.ts";
import * as coreModule from "../providers/provider-core.ts";
import { orgPackageScope, orgPackagesQuery, orgPackageVersionsQuery } from "../providers/facade/org.ts";
import { issuesComments } from "../providers/facade/issues.ts";
import { ProviderError } from "../providers/provider-core.ts";

// ---------------------------------------------------------------------------
// Header parse
// ---------------------------------------------------------------------------

export interface ArtifactHeader {
  [key: string]: string;
}

/** The marker must open within this many leading characters of a body. */
const MARKER_WINDOW = 1024;

/**
 * A header key name: a letter or underscore, then letters, digits, hyphens
 * and underscores. Every reader and the header rewrite tool share it.
 */
export const HEADER_KEY_PATTERN = "[A-Za-z_][A-Za-z0-9_-]*";

/** A `key: value` header line: indent and spaces before the colon tolerated. */
export const HEADER_KEY_LINE = new RegExp(`^[ \\t]*(${HEADER_KEY_PATTERN})[ \\t]*:[ \\t]*(.*)$`);

/**
 * The text of a key line with its trailing comment closer (`-->` plus the
 * whitespace around it) removed, or null when the line does not end with the
 * closer. Scans from the end only, so a very long whitespace run costs linear
 * time (an unanchored `[ \t]*-->$` pattern retries from every run position).
 */
export function stripInlineCloser(line: string): string | null {
  let end = line.length;
  while (end > 0 && (line[end - 1] === " " || line[end - 1] === "\t")) end--;
  if (end < 3 || line.slice(end - 3, end) !== "-->") return null;
  end -= 3;
  while (end > 0 && (line[end - 1] === " " || line[end - 1] === "\t")) end--;
  return line.slice(0, end);
}

/**
 * The structure of a DEVENV_ARTIFACT_V1 block with positions, as line indexes
 * into `body.split("\n")` (a CRLF body keeps its trailing carriage returns on
 * those lines; positions are identical to the CRLF-normalized text because
 * only `\r\n` pairs are normalized and `\n` count is preserved).
 *
 *  - markerLine: the line holding the marker. The rest of that line is ignored.
 *  - firstLine: the first line after the marker (markerLine + 1).
 *  - endLine: exclusive end; lines [firstLine, endLine) belong to the block.
 *    A `-->` line closer is not part of the range; an inline closer is part of
 *    the key line that carries it.
 *  - closerKind / closerLine: how and where the block closes (`line`: a line
 *    starting with `-->` after optional indent; `inline`: a key line whose
 *    value ends with `-->`), both null when the block is unclosed.
 *
 * Bounds, in order:
 *  - A key line whose value ends with `-->` closes the block at that line.
 *  - A line that starts (after optional indent) with `-->` closes the block,
 *    but only when it is reachable from the marker through key lines, blank
 *    lines and comment lines (`#` or `//`) alone.
 *  - Any other line (prose, a code fence, non-key text) met before a closer
 *    means the header is not closed: the block is then the leading run of
 *    key lines, ending at the first line that is not a key line (blank
 *    lines included). A `-->` line further down the body never extends it.
 *
 * Null when no marker opens within the first MARKER_WINDOW characters.
 */
export interface HeaderSpan {
  markerLine: number;
  firstLine: number;
  endLine: number;
  closerKind: "line" | "inline" | null;
  closerLine: number | null;
}

export function headerSpan(body: string): HeaderSpan | null {
  const normalized = body.replaceAll("\r\n", "\n");
  const markerAt = normalized.indexOf("DEVENV_ARTIFACT_V1");
  if (markerAt < 0 || markerAt >= MARKER_WINDOW) return null;
  let markerLine = 0;
  for (let i = normalized.indexOf("\n"); i >= 0 && i < markerAt; i = normalized.indexOf("\n", i + 1)) markerLine++;
  const lines = normalized.split("\n");
  const firstLine = markerLine + 1;
  let leadingEnd: number | null = null;
  for (let i = firstLine; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (HEADER_KEY_LINE.test(line)) {
      if (stripInlineCloser(line) !== null) {
        return { markerLine, firstLine, endLine: i + 1, closerKind: "inline", closerLine: i };
      }
      continue;
    }
    if (/^[ \t]*-->/.test(line)) {
      return { markerLine, firstLine, endLine: i, closerKind: "line", closerLine: i };
    }
    if (leadingEnd === null) leadingEnd = i;
    if (/^[ \t]*$/.test(line) || /^[ \t]*(#|\/\/)/.test(line)) continue;
    break;
  }
  return { markerLine, firstLine, endLine: leadingEnd ?? lines.length, closerKind: null, closerLine: null };
}

/**
 * The `key: value` lines of the DEVENV_ARTIFACT_V1 block (see headerSpan for
 * the bounds), CRLF normalized, blank and comment lines skipped, an inline
 * closer trimmed from the value. Null when no marker opens within the first
 * MARKER_WINDOW characters.
 *
 * Every header lookup in this file reads this block, so no value is cut at a
 * character offset.
 */
function headerBlock(body: string): string[] | null {
  const span = headerSpan(body);
  if (span === null) return null;
  const lines = body.replaceAll("\r\n", "\n").split("\n");
  const keys: string[] = [];
  for (let i = span.firstLine; i < span.endLine; i++) {
    const line = lines[i] ?? "";
    if (!HEADER_KEY_LINE.test(line)) continue;
    keys.push(span.closerKind === "inline" && i === span.closerLine ? (stripInlineCloser(line) ?? line) : line);
  }
  return keys;
}

/**
 * Parse the DEVENV_ARTIFACT_V1 block from `body`. Returns null when the body has
 * no artifact header marker.
 *
 * Handles the values this header carries (machine
 * generated: doc ids, issue numbers, dates, slugs — no quotes or
 * backslashes). The marker opens the block, the first `-->` line closes it,
 * `KEY:` lines contribute `"KEY":"value"` pairs, and embedded double quotes
 * in values are unescaped. Not byte-identical to the bash engine on values
 * containing literal backslashes: bash emitted them raw into JSON and let
 * jq's escape processing reinterpret them (e.g. `a\b` read back as
 * a-backspace-b), while this port returns the literal characters. That
 * case cannot arise from the writers, so the observable behavior on real
 * headers is identical.
 */
export function parseHeaderJson(body: string): ArtifactHeader | null {
  const block = headerBlock(body);
  if (block === null) return null;
  const pairs: Record<string, string> = {};
  for (const rawLine of block) {
    const m = rawLine.match(HEADER_KEY_LINE);
    if (m === null) continue;
    const key = m[1] ?? "";
    // First occurrence wins, the same rule headerField applies. The bash
    // engine gsub-escapes `"` into `\"` and re-emits; the parsed value here
    // is the unescaped text, matching what jq read back.
    if (key in pairs) continue;
    pairs[key] = (m[2] ?? "").replace(/\\"/g, '"');
  }
  return pairs;
}

/**
 * The one header lookup rule: the value of the first `KEY:` line inside the
 * DEVENV_ARTIFACT_V1 block (CRLF-safe, indent-tolerant, spaces before the
 * colon tolerated, value trimmed). Empty string when the block or the key is
 * absent. findDocId, bodyUpsertable, the upsert tool and the artifact
 * listing all resolve fields through this function.
 */
export function headerField(body: string, key: string): string {
  const block = headerBlock(body);
  if (block === null) return "";
  for (const line of block) {
    const m = line.match(HEADER_KEY_LINE);
    if (m !== null && m[1] === key) return (m[2] ?? "").trim();
  }
  return "";
}

/**
 * Mirror of issue-artifact-upsert's resolution contract: the body must
 * carry a doc_id line inside its DEVENV_ARTIFACT_V1 block, and an issue number
 * must be resolvable from the `issue_number` metadata field (a literal
 * "none" counts as absent) or from an `issue-<N>` segment inside the
 * doc_id. A present issue_number must be all digits. Returns
 * `{ ok: true }` or `{ ok: false, reason }`.
 */
export function bodyUpsertable(body: string): { ok: true } | { ok: false; reason: string } {
  const docId = findDocId(body);
  let issueField = headerField(body, "issue_number");
  if (issueField === "none") issueField = "";
  if (issueField !== "" && !/^[0-9]+$/.test(issueField)) {
    return { ok: false, reason: `issue_number '${issueField}' is not a number (must be digits only)` };
  }
  let inferred = "";
  if (docId !== "") {
    const m = docId.match(/issue[-_:](\d+)/);
    if (m) inferred = m[1] ?? "";
  }
  if (docId === "") {
    return { ok: false, reason: "no DEVENV_ARTIFACT_V1 header (no doc_id line inside the header block)" };
  }
  if (issueField === "" && inferred === "") {
    return { ok: false, reason: "no resolvable issue number (no issue_number metadata line and no issue-<N> in the doc_id)" };
  }
  return { ok: true };
}

/** File-based form of bodyUpsertable. */
export function fileUpsertable(file: string): { ok: true } | { ok: false; reason: string } {
  return bodyUpsertable(readFileSync(file, "utf8"));
}

// ---------------------------------------------------------------------------
// Issue-comment artifacts: one doc_id rule, one enumeration
// ---------------------------------------------------------------------------

/** Characters of a comment body shown as its preview. */
const PREVIEW_CHARS = 256;

/** The doc_id carried by a comment body: the first `doc_id:` line inside the
 * header block, indent-tolerant, CRLF-safe, value trimmed. "" when absent. */
export function findDocId(body: string): string {
  return headerField(body, "doc_id");
}

/** The artifact type used for comparisons: `implementation-plan` is the
 * accepted spelling of `plan`. */
export function canonicalArtifactType(type: string): string {
  return type === "implementation-plan" ? "plan" : type;
}

export interface CommentRecord {
  id?: unknown;
  body?: unknown;
  user?: { login?: unknown };
  created_at?: unknown;
  updated_at?: unknown;
  url?: unknown;
  issue_url?: unknown;
}

export interface Artifact {
  issue_number: number | null;
  comment_id: number | null;
  doc_id: string;
  artifact_type: string | null;
  source_file: string | null;
  title: string | null;
  author: string | null;
  createdAt: unknown;
  updatedAt: unknown;
  url: unknown;
  bodyPreview: string;
  body: string;
}

/** All comments of an issue. Accepts a JSON array or a newline-delimited
 * stream of comment objects; throws a named error when the fetch fails or
 * the response is neither. */
export async function fetchIssueComments(repo: string, issue: number): Promise<CommentRecord[]> {
  let raw: string;
  try {
    raw = await issuesComments(repo, issue);
  } catch (err) {
    throw new ProviderError(`Failed to fetch comments for issue #${issue}: ${err instanceof Error ? err.message : String(err)}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    const records: CommentRecord[] = [];
    for (const line of raw.split("\n")) {
      const t = line.trim();
      if (t === "" || t === "[" || t === "]" || t === ",") continue;
      try {
        const obj = JSON.parse(t) as CommentRecord;
        if (obj !== null && typeof obj === "object") records.push(obj);
      } catch { /* not a record line */ }
    }
    if (records.length === 0) throw new ProviderError("Failed to parse issue comments");
    return records;
  }
  if (!Array.isArray(parsed)) throw new ProviderError("Failed to parse issue comments");
  return parsed as CommentRecord[];
}

function issueNumberFromUrl(url: unknown): number | null {
  if (typeof url !== "string") return null;
  const m = url.match(/\/issues\/(\d+)$/);
  return m ? Number.parseInt(m[1] as string, 10) : null;
}

/** Artifact comments of an issue (comments carrying a doc_id), newest
 * update first. `artifactTypeFilter` compares canonical types. */
export async function listArtifacts(repo: string, issue: number, artifactTypeFilter = ""): Promise<Artifact[]> {
  const comments = await fetchIssueComments(repo, issue);
  const wanted = canonicalArtifactType(artifactTypeFilter);
  const results: Artifact[] = [];
  for (const c of comments) {
    const body = typeof c.body === "string" ? c.body : "";
    const docId = findDocId(body);
    if (docId === "") continue;
    const foundType = headerField(body, "artifact_type") || null;
    if (artifactTypeFilter !== "" && canonicalArtifactType(foundType ?? "") !== wanted) continue;
    const heading = body.replaceAll("\r\n", "\n").split("\n").find((l) => l.startsWith("# "));
    results.push({
      issue_number: issueNumberFromUrl(c.issue_url),
      comment_id: typeof c.id === "number" ? c.id : null,
      doc_id: docId,
      artifact_type: foundType,
      source_file: headerField(body, "source_file") || null,
      title: heading === undefined ? null : heading.slice(2),
      author: typeof c.user?.login === "string" ? c.user.login : null,
      createdAt: c.created_at ?? null,
      updatedAt: c.updated_at ?? null,
      url: c.url ?? null,
      bodyPreview: body.slice(0, PREVIEW_CHARS),
      body,
    });
  }
  results.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  return results;
}

// ---------------------------------------------------------------------------
// Package-type registry
// ---------------------------------------------------------------------------

/** Canonical package-type ids and the aliases that normalize onto them. */
const PACKAGE_TYPE_ALIASES: Record<string, string> = {
  npm: "npm", node: "npm", javascript: "npm",
  nuget: "nuget", cs: "nuget", csharp: "nuget", dotnet: "nuget", ".net": "nuget",
  docker: "docker", container: "docker", oci: "docker",
  maven: "maven", java: "maven",
  rubygems: "rubygems", ruby: "rubygems", gems: "rubygems", gem: "rubygems",
  gradle: "gradle",
  rust: "cargo", cargo: "cargo",
  composer: "composer", php: "composer",
  conda: "conda",
};

const SUPPORTED_PACKAGE_TYPES = ["npm", "nuget", "docker", "maven", "rubygems", "gradle", "cargo", "composer", "conda"];

/** Normalized type id for filtering/matching (unknown names pass through,
 * lowercased — the bash verb's `*)` branch). */
export function packageTypeId(type: string): string {
  const lower = type.toLowerCase();
  return PACKAGE_TYPE_ALIASES[lower] ?? lower;
}

export function supportedPackageTypes(): string[] {
  return [...SUPPORTED_PACKAGE_TYPES];
}

export function isSupportedPackageType(type: string): boolean {
  return supportedPackageTypes().includes(packageTypeId(type));
}

// ---------------------------------------------------------------------------
// GitHub Packages reads (transport via the provider facade)
// ---------------------------------------------------------------------------

export interface QueryPackagesOptions {
  owner?: string;
  type?: string;
  /** Case-insensitive partial match on the package name. */
  name?: string;
  /** Scope the query to one repository. A bare name is taken relative to
   * the resolved owner; an `owner/name` pair replaces the owner. */
  repo?: string;
}

/** Resolve the org from devenv.config `[organization] org` (the bash verbs'
 * provider_org_get fallback). Throws a defined error when unconfigured. */
export function resolveOwner(explicit?: string): string {
  if (explicit !== undefined && explicit !== "") return explicit;
  const { providerConfigPath } = coreModule;
  const org = configModule.configGetRaw(providerConfigPath(), "organization", "org") ?? "";
  if (org === "") {
    throw new ProviderError("owner is required (set --owner or configure [organization] org in devenv.config)");
  }
  return org;
}

/** Flatten a paginated (`--slurp`) response into one item list. Throws a
 * named error on a failed call or an unparseable body: an empty list is only
 * ever a real empty answer. */
function packageItems(r: { stdout: string; stderr: string; status: number }, what: string): unknown[] {
  if (r.status !== 0) {
    throw new ProviderError(`Failed to list ${what}: ${(r.stderr || r.stdout).trim()}`);
  }
  let pages: unknown;
  try {
    pages = JSON.parse(r.stdout);
  } catch {
    throw new ProviderError(`Failed to parse the ${what} response`);
  }
  if (!Array.isArray(pages)) throw new ProviderError(`Failed to parse the ${what} response`);
  const flat: unknown[] = [];
  const walk = (v: unknown): void => {
    if (Array.isArray(v)) {
      for (const item of v) walk(item);
    } else {
      flat.push(v);
    }
  };
  walk(pages);
  return flat;
}

/**
 * Query GitHub Packages across every page. Returns a JSON array string of
 * package objects; an empty answer is `[]`, a failed or unparseable call
 * throws.
 */
export async function queryPackages(opts: QueryPackagesOptions = {}): Promise<string> {
  let owner = resolveOwner(opts.owner);
  const type = opts.type !== undefined ? packageTypeId(opts.type) : undefined;
  let repo: string | undefined;
  if (opts.repo !== undefined && opts.repo !== "") {
    const scoped = await orgPackageScope(owner, opts.repo);
    owner = scoped.owner;
    repo = scoped.repo;
  }
  const r = await orgPackagesQuery(owner, {
    paginate: true,
    ...(type !== undefined ? { type } : {}),
    ...(repo !== undefined ? { repo } : {}),
  });
  let items = packageItems(r, "packages");
  if (opts.name !== undefined && opts.name !== "") {
    const needle = opts.name.toLowerCase();
    items = items.filter((p) => {
      if (typeof p !== "object" || p === null) return false;
      const name = (p as Record<string, unknown>)["name"];
      return typeof name === "string" && name.toLowerCase().includes(needle);
    });
  }
  return JSON.stringify(items);
}

export interface PackageVersionsOptions {
  owner?: string;
  /** Canonical or aliased package type (required). */
  type: string;
  /** Package name (required). */
  name: string;
  /** Scope to one repository (bare name or `owner/name`, as queryPackages). */
  repo?: string;
}

/**
 * Versions for one package across every page, as a flat JSON array. An empty
 * answer is `[]`; a failed or unparseable call throws.
 */
export async function packageVersions(opts: PackageVersionsOptions): Promise<string> {
  let owner = resolveOwner(opts.owner);
  const type = packageTypeId(opts.type);
  if (opts.name === undefined || opts.name === "") {
    throw new ProviderError("owner (set --owner or configure [organization] org), type, and name are all required");
  }
  let repo: string | undefined;
  if (opts.repo !== undefined && opts.repo !== "") {
    const scoped = await orgPackageScope(owner, opts.repo);
    owner = scoped.owner;
    repo = scoped.repo;
  }
  const r = await orgPackageVersionsQuery(owner, type, opts.name, {
    paginate: true,
    ...(repo !== undefined ? { repo } : {}),
  });
  return JSON.stringify(packageItems(r, "package versions"));
}
