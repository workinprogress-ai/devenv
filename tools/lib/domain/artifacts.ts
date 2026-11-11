// artifacts.ts — the artifacts domain (merge of artifact-header.bash +
// artifact-operations.bash per the migration mapping; the bash originals
// remain until the bash retirement sweep).
//
// Two halves:
//   1. Header parse (BYTE-FAITHFUL): the DEVENV_ARTIFACT_V1 metadata block
//      parser. Artifact identity depends on this exact awk engine's
//      semantics — first-1024-char marker window, key lines inside the
//      block, first `-->` ends it, values are quoted-and-joined into a flat
//      JSON object. Do not "improve" it; parity tests pin it.
//   2. GitHub Packages reads: the package-type registry and the paginated
//      package/version queries (transport via the provider facade).

import { readFileSync } from "node:fs";
import * as configModule from "../core/config.ts";
import * as coreModule from "../providers/provider-core.ts";
import { orgPackagesQuery, orgPackageVersionsQuery } from "../providers/facade/org.ts";
import { issuesComments } from "../providers/facade/issues.ts";
import { ProviderError } from "../providers/provider-core.ts";

// ---------------------------------------------------------------------------
// Header parse — BYTE-FAITHFUL port of artifact-header.bash
// ---------------------------------------------------------------------------

export interface ArtifactHeader {
  [key: string]: string;
}

/**
 * Parse the DEVENV_ARTIFACT_V1 block from `body` (the caller scopes the
 * prefix window, e.g. first 256/1024 chars). Returns null when the body has
 * no artifact header marker.
 *
 * Port of the bash awk engine for the values this header carries (machine
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
  const prefix = body.slice(0, 1024);
  if (!prefix.includes("DEVENV_ARTIFACT_V1")) return null;

  const lines = prefix.split("\n");
  let inBlock = false;
  const pairs: Record<string, string> = {};
  for (const rawLine of lines) {
    if (rawLine.includes("DEVENV_ARTIFACT_V1")) {
      inBlock = true;
      continue;
    }
    if (!inBlock) continue;
    if (/^-->/.test(rawLine)) break;
    if (!/^[ \t]*[A-Za-z_]+[ \t]*:/.test(rawLine)) continue;
    const line = rawLine.replace(/^[ \t]+/, "");
    const colon = line.indexOf(":");
    const key = line.slice(0, colon);
    const value = line.slice(colon).replace(/^[^:]*:[ \t]*/, "");
    // The bash engine gsub-escapes `"` into `\"` and re-emits; the parsed
    // value here is the unescaped text, matching what jq read back.
    pairs[key] = value.replace(/\\"/g, '"');
  }
  return pairs;
}

/**
 * The value of KEY from the DEVENV_ARTIFACT_V1 block in body (leading and
 * trailing whitespace of the value stripped; the bash contract uses sed's
 * `[[:space:]]*KEY:[[:space:]]*` match and takes the first hit). Empty
 * string when the key is absent.
 */
export function headerField(body: string, key: string): string {
  const re = new RegExp(`^[ \\t]*${key}:[ \\t]*(.*)$`, "m");
  const m = body.match(re);
  return m?.[1]?.trim() ?? "";
}

/**
 * Mirror of issue-artifact-upsert's resolution contract: the body must
 * carry a doc_id line within the first 256 characters, and an issue number
 * must be resolvable from the `issue_number` metadata field (a literal
 * "none" counts as absent) or from an `issue-<N>` segment inside the
 * doc_id. A present issue_number must be all digits. Returns
 * `{ ok: true }` or `{ ok: false, reason }`.
 */
export function bodyUpsertable(body: string): { ok: true } | { ok: false; reason: string } {
  const prefix = body.slice(0, 256);
  const docId = findDocId(body);
  let issueField = headerField(prefix, "issue_number");
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
    return { ok: false, reason: "no DEVENV_ARTIFACT_V1 header (no doc_id line within the first 256 characters)" };
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

/** Characters of a comment body searched for header lines. */
const HEADER_WINDOW = 256;

/** The doc_id carried by a comment body: the first `doc_id:` line within the
 * header window, indent-tolerant, CRLF-safe, value trimmed. "" when absent. */
export function findDocId(body: string): string {
  return headerLine(body, "doc_id") ?? "";
}

/** The value of the first `KEY:` line within the header window (CRLF-safe,
 * indent-tolerant, trimmed), or null when the key is absent. */
function headerLine(body: string, key: string): string | null {
  const prefix = body.replaceAll("\r\n", "\n").slice(0, HEADER_WINDOW);
  for (const line of prefix.split("\n")) {
    const m = line.match(/^[ \t]*([A-Za-z_]+)[ \t]*:[ \t]*(.*)$/);
    if (m !== null && m[1] === key) return (m[2] ?? "").trim();
  }
  return null;
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
    const foundType = headerLine(body, "artifact_type");
    if (artifactTypeFilter !== "" && canonicalArtifactType(foundType ?? "") !== wanted) continue;
    const heading = body.replaceAll("\r\n", "\n").split("\n").find((l) => l.startsWith("# "));
    results.push({
      issue_number: issueNumberFromUrl(c.issue_url),
      comment_id: typeof c.id === "number" ? c.id : null,
      doc_id: docId,
      artifact_type: foundType,
      source_file: headerLine(body, "source_file"),
      title: heading === undefined ? null : heading.slice(2),
      author: typeof c.user?.login === "string" ? c.user.login : null,
      createdAt: c.created_at ?? null,
      updatedAt: c.updated_at ?? null,
      url: c.url ?? null,
      bodyPreview: body.slice(0, HEADER_WINDOW),
      body,
    });
  }
  results.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  return results;
}

// ---------------------------------------------------------------------------
// Package-type registry — faithful port of artifact-operations.bash
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

/** Normalize the `--repo` value against the resolved owner: a bare name
 * stays as-is (endpoint uses the owner), `owner/name` splits and overrides
 * the owner (the bash verbs document `owner/repo` for this flag). */
function splitRepoScope(repo: string, owner: string): { owner: string; repo: string } {
  const slash = repo.indexOf("/");
  if (slash > 0 && slash < repo.length - 1) {
    return { owner: repo.slice(0, slash), repo: repo.slice(slash + 1) };
  }
  return { owner, repo };
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
    const scoped = splitRepoScope(opts.repo, owner);
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
    const scoped = splitRepoScope(opts.repo, owner);
    owner = scoped.owner;
    repo = scoped.repo;
  }
  const r = await orgPackageVersionsQuery(owner, type, opts.name, {
    paginate: true,
    ...(repo !== undefined ? { repo } : {}),
  });
  return JSON.stringify(packageItems(r, "package versions"));
}
