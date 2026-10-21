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
//      package/version queries (transport via the provider facade's gh).

import { readFileSync } from "node:fs";
import * as configModule from "../core/config.ts";
import * as coreModule from "../providers/provider-core.ts";
import { ghApi } from "../providers/provider-core.ts";
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
  const docId = headerField(prefix, "doc_id");
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
// Package-type registry — faithful port of artifact-operations.bash
// ---------------------------------------------------------------------------

/** Canonical package-type ids and the aliases that normalize onto them. */
const PACKAGE_TYPE_ALIASES: Record<string, string> = {
  npm: "npm", node: "npm", javascript: "npm",
  nuget: "nuget", cs: "nuget", csharp: "nuget", dotnet: "nuget", ".net": "nuget",
  docker: "docker", container: "docker", oci: "docker",
  maven: "maven", java: "maven",
  rubygems: "rubygems", ruby: "rubygems", gems: "rubygems",
  gradle: "gradle",
  rust: "cargo", cargo: "cargo",
};

const SUPPORTED_PACKAGE_TYPES = ["npm", "nuget", "docker", "maven", "rubygems", "gradle", "cargo"];

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
// GitHub Packages reads (transport via the facade's gh)
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

/**
 * Query GitHub Packages. Returns a JSON array string of package objects.
 * Empty results are `[]`, never an error; transport failures with an
 * error-shaped body throw.
 */
export async function queryPackages(opts: QueryPackagesOptions = {}): Promise<string> {
  let owner = resolveOwner(opts.owner);
  const type = opts.type !== undefined ? packageTypeId(opts.type) : undefined;
  let endpoint = `/users/${owner}/packages`;
  if (opts.repo !== undefined && opts.repo !== "") {
    const scoped = splitRepoScope(opts.repo, owner);
    owner = scoped.owner;
    endpoint = `/repos/${owner}/${scoped.repo}/packages`;
  }
  const args = ["api", endpoint, "--method", "GET"];
  if (type !== undefined && type !== "") args.push("-f", `package_type=${type}`);
  const r = await ghApi(args, { tolerateFailure: true });
  if (r.status !== 0) {
    if (/HTTP|error|Error/.test(r.stdout + r.stderr)) {
      throw new ProviderError(`GitHub API error: ${(r.stderr || r.stdout).trim()}`);
    }
    return "[]";
  }
  let items: unknown[] = [];
  try {
    const parsed: unknown = JSON.parse(r.stdout);
    if (Array.isArray(parsed)) items = parsed;
  } catch {
    return "[]";
  }
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
 * Versions for one package, as a flat JSON array (the paginated response is
 * flattened exactly as the bash verb's `jq -s 'flatten'`). Empty results
 * are `[]`; transport failures with an error-shaped body throw.
 */
export async function packageVersions(opts: PackageVersionsOptions): Promise<string> {
  let owner = resolveOwner(opts.owner);
  const type = packageTypeId(opts.type);
  if (opts.name === undefined || opts.name === "") {
    throw new ProviderError("owner (set --owner or configure [organization] org), type, and name are all required");
  }
  let endpoint = `/users/${owner}/packages/${type}/${opts.name}/versions`;
  if (opts.repo !== undefined && opts.repo !== "") {
    const scoped = splitRepoScope(opts.repo, owner);
    owner = scoped.owner;
    endpoint = `/repos/${owner}/${scoped.repo}/packages/${type}/${opts.name}/versions`;
  }
  const r = await ghApi(["api", endpoint, "--paginate"], { tolerateFailure: true });
  if (r.status !== 0) {
    if (/HTTP|error|Error/.test(r.stdout + r.stderr)) {
      throw new ProviderError(`GitHub API error: ${(r.stderr || r.stdout).trim()}`);
    }
    return "[]";
  }
  let pages: unknown;
  try {
    pages = JSON.parse(r.stdout);
  } catch {
    return "[]";
  }
  if (!Array.isArray(pages)) return "[]";
  // flatten: pages are arrays of version objects; nested arrays flatten one
  // level deep, mirroring `jq -s 'flatten'` (fully recursive).
  const flat: unknown[] = [];
  const walk = (v: unknown): void => {
    if (Array.isArray(v)) {
      for (const item of v) walk(item);
    } else {
      flat.push(v);
    }
  };
  walk(pages);
  return JSON.stringify(flat);
}
