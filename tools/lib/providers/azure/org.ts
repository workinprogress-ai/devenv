// azure/org.ts — the org surface for azure: releases (git-tag release unit),
// Artifacts feeds, and re-exports of the policy ruleset verbs (the bash org
// module is a thin loader over policies.bash + releases.bash; the TS module
// composes the same surface). Contract: throw ProviderError; never exit.

import { ProviderError, providerDeclareCapability } from "../provider-core.ts";
import { azureHttp, azureHttpPaginate } from "./http.ts";
import { azureArtifactsFeedGet, azureOrgProject, azureUri } from "./urls.ts";
import { applyListFlags } from "./repos.ts";

providerDeclareCapability("rulesets");

export {
  orgRulesetsList,
  orgRulesetGet,
  orgRulesetCreate,
  orgRulesetUpdate,
} from "./policies.ts";

// ---------------------------------------------------------------------------
// Releases (a git tag is the release unit; owner decision)
// ---------------------------------------------------------------------------

/** The annotated-tag object's taggedBy.date first; for a lightweight tag the
 * commit's committer.date. Best-effort metadata: "" when neither yields. */
async function releaseTagDate(repoUrl: string, objectId: string): Promise<string> {
  try {
    const tag = await azureHttp<{ taggedBy?: { date?: string } }>(
      "GET",
      `${repoUrl}/annotatedtags/${objectId}`,
    );
    if (tag.taggedBy?.date !== undefined) return tag.taggedBy.date;
  } catch (err) {
    rethrowAuth(err);
    // fall through to the commit-date leg
  }
  try {
    const commit = await azureHttp<{ committer?: { date?: string } }>(
      "GET",
      `${repoUrl}/commits/${objectId}`,
    );
    return commit.committer?.date ?? "";
  } catch (err) {
    rethrowAuth(err);
    return "";
  }
}

/** The date is best-effort metadata, but a missing or refused credential is
 * not a missing date: it fails the whole listing instead of printing blanks. */
function rethrowAuth(err: unknown): void {
  if (!(err instanceof ProviderError)) return;
  // 203 and a 200 sign-in page are how Azure answers an unauthenticated call;
  // the transport words them as a rejected credential.
  if (err.status === 401 || err.status === 403 || err.status === 203 || /did not accept the stored credential/.test(err.message)) {
    throw err;
  }
}

/** A version tag's parts: numeric core and the prerelease identifiers
 * (null for a release). */
function versionParts(name: string): { core: number[]; pre: string[] | null } {
  // Build metadata (+...) never affects precedence.
  const bare = (name.replace(/^refs\/tags\/v?/, "").split("+")[0] ?? "");
  const dash = bare.indexOf("-");
  const core = (dash < 0 ? bare : bare.slice(0, dash)).split(".").map((p) => {
    const n = Number(p);
    return Number.isFinite(n) ? n : -1;
  });
  return { core, pre: dash < 0 ? null : bare.slice(dash + 1).split(".") };
}

/** Semver precedence: the core first; a release above its prereleases;
 * prerelease identifiers left to right, numeric ones numerically (rc.10 above
 * rc.2) and below alphanumeric ones, a longer list above its own prefix. */
function compareVersions(a: string, b: string): number {
  const x = versionParts(a);
  const y = versionParts(b);
  for (let i = 0; i < Math.max(x.core.length, y.core.length); i++) {
    const d = (x.core[i] ?? -1) - (y.core[i] ?? -1);
    if (d !== 0) return d;
  }
  if (x.pre === null || y.pre === null) return x.pre === y.pre ? 0 : x.pre === null ? 1 : -1;
  for (let i = 0; i < Math.min(x.pre.length, y.pre.length); i++) {
    const p = x.pre[i] as string;
    const q = y.pre[i] as string;
    const pn = /^[0-9]+$/.test(p);
    const qn = /^[0-9]+$/.test(q);
    if (pn && qn) {
      const d = Number(p) - Number(q);
      if (d !== 0) return d;
    } else if (pn !== qn) {
      return pn ? -1 : 1;
    } else if (p !== q) {
      return p < q ? -1 : 1;
    }
  }
  return x.pre.length - y.pre.length;
}

export interface OrgReleasesListOptions {
  limit?: number;
  json?: string;
  jq?: string;
}

/** List releases, newest first. The azure release unit is a git tag; the
 * seam's --json fields map: tagName/name <- tag name, publishedAt <-
 * annotated-tag date (lightweight: commit date; empty when unavailable — one
 * extra request per tag, only when the field is visible), isPrerelease <- a
 * semver prerelease suffix, isDraft <- false (no draft tag). The refs API
 * returns tags alphabetically, so every tag is fetched and ordered by version
 * (1.10.0 above 1.9.0; a release above its own prereleases) before --limit. */
export async function orgReleasesList(
  repo: string,
  opts: OrgReleasesListOptions = {},
): Promise<string> {
  if (repo === "") throw new ProviderError("repo required");
  const repoUrl = gitRepoUrl(repo);
  const refs = await azureHttpPaginate<{ name?: string; objectId?: string }>(
    `${repoUrl}/refs?filter=tags/`,
  );
  const wantDates = opts.json === undefined || opts.json.split(",").includes("publishedAt");
  const isVersion = (name: string): boolean =>
    /^refs\/tags\/v?[0-9]+(\.[0-9]+)*(-|\+|$)/.test(name);
  const sorted = [...refs]
    .map((r) => ({ ...r, _ver: isVersion(r.name ?? "") }))
    .sort((a, b) => {
      const av = a._ver ? 1 : 0;
      const bv = b._ver ? 1 : 0;
      if (av !== bv) return av - bv;
      if (a._ver) {
        const d = compareVersions(a.name ?? "", b.name ?? "");
        if (d !== 0) return d;
      }
      return (a.name ?? "").localeCompare(b.name ?? "");
    })
    .reverse()
    .slice(0, opts.limit ?? 30);
  const dates: Record<string, string> = {};
  if (wantDates) {
    for (const tag of sorted) {
      const oid = tag.objectId ?? "";
      if (oid === "") continue;
      const date = await releaseTagDate(repoUrl, oid);
      if (date !== "") dates[tag.name ?? ""] = date;
    }
  }
  const mapped = sorted.map((tag) => {
    const tagName = (tag.name ?? "").replace(/^refs\/tags\//, "");
    return {
      tagName,
      name: tagName,
      publishedAt: dates[tag.name ?? ""] ?? "",
      isPrerelease: /^v?[0-9]+(\.[0-9]+)*-[0-9A-Za-z]/.test(tagName),
      isDraft: false,
    };
  });
  return applyListFlags(mapped, opts);
}

/** List the Artifacts feeds the project can use: the organization's own feeds
 * and the project's, each once. */
export async function orgFeedsList(): Promise<string> {
  const { org, project } = azureOrgProject();
  const query = "_apis/packaging/feeds?api-version=7.1-preview.1";
  type Feed = { name?: string; id?: string; url?: string };
  const orgFeeds = await azureHttp<{ value?: Feed[] }>("GET", `https://feeds.dev.azure.com/${azureUri(org)}/${query}`);
  // The project endpoint is an addition: a refused or missing one (Artifacts
  // off for the project, a PAT without the scope) leaves the org feeds.
  let projectFeeds: { value?: Feed[] } = {};
  try {
    projectFeeds = await azureHttp<{ value?: Feed[] }>(
      "GET",
      `https://feeds.dev.azure.com/${azureUri(org)}/${azureUri(project)}/${query}`,
    );
  } catch (err) {
    if (!(err instanceof ProviderError) || (err.status !== 403 && err.status !== 404)) throw err;
  }
  const seen = new Set<string>();
  const feeds: Feed[] = [];
  for (const f of [...(orgFeeds.value ?? []), ...(projectFeeds.value ?? [])]) {
    const key = f.id ?? f.name ?? "";
    if (seen.has(key)) continue;
    seen.add(key);
    feeds.push(f);
  }
  return JSON.stringify(feeds.map((f) => ({ name: f.name ?? "", id: f.id ?? "", url: f.url ?? "" })));
}

/** Result shape the facade hands the domain layer: a status, and the records
 * as one JSON array on stdout (the same envelope the GitHub verbs return). */
export interface PackagesQueryResult {
  stdout: string;
  stderr: string;
  status: number;
}

/** Artifacts protocol names by the package-type ids of the provider-neutral
 * vocabulary (the GitHub ids the domain normalizes to); a type Azure Artifacts
 * does not serve is absent. */
const FEED_PROTOCOLS: Record<string, string> = {
  nuget: "NuGet",
  npm: "Npm",
  maven: "Maven",
};

const FEEDS_PREVIEW_VERSION = "api-version=7.1-preview.1";

interface FeedRecord {
  name: string;
  id: string;
  url: string;
}

interface FeedPackage {
  id?: string;
  name?: string;
  normalizedName?: string;
  protocolType?: string;
  url?: string;
  versions?: Array<{ version?: string; normalizedVersion?: string; publishDate?: string; isLatest?: boolean }>;
}

/** The feeds a query covers: the project's and the organization's own (each
 * once), narrowed to the configured default feed (`azure_artifacts_feed`, a
 * name or id, case-insensitive) when one is set. */
async function queryFeeds(): Promise<FeedRecord[]> {
  const feeds = JSON.parse(await orgFeedsList()) as FeedRecord[];
  const feed = azureArtifactsFeedGet();
  if (feed === "") return feeds;
  const wanted = feed.toLowerCase();
  const picked = feeds.filter((f) => f.name.toLowerCase() === wanted || f.id.toLowerCase() === wanted);
  if (picked.length === 0) {
    throw new ProviderError(
      `configured azure_artifacts_feed '${feed}' not found (feeds available: ${feeds.map((f) => f.name).join(", ") || "none"})`,
    );
  }
  return picked;
}

/** The protocol filter for a package type id; an unknown one is an error. */
function feedProtocol(type: string | undefined): string | undefined {
  if (type === undefined || type === "") return undefined;
  const protocol = FEED_PROTOCOLS[type.toLowerCase()];
  if (protocol === undefined) {
    throw new ProviderError(
      `package type '${type}' is not served by Azure Artifacts (served: ${Object.keys(FEED_PROTOCOLS).join(", ")})`,
    );
  }
  return protocol;
}

/** One feed's packages (every page), with every version of each. A refused
 * call is a permission error naming the scope, never an empty list. */
async function feedPackages(feed: FeedRecord, protocol: string | undefined, nameQuery: string | undefined): Promise<FeedPackage[]> {
  const { org } = azureOrgProject();
  const base = feed.url !== "" ? feed.url : `https://feeds.dev.azure.com/${azureUri(org)}/_apis/packaging/Feeds/${azureUri(feed.id)}`;
  const pageSize = 100;
  const all: FeedPackage[] = [];
  for (let skip = 0; ; skip += pageSize) {
    let query = `${base}/packages?${FEEDS_PREVIEW_VERSION}&includeAllVersions=true&$top=${pageSize}&$skip=${skip}`;
    if (protocol !== undefined) query += `&protocolType=${azureUri(protocol)}`;
    if (nameQuery !== undefined && nameQuery !== "") query += `&packageNameQuery=${azureUri(nameQuery)}`;
    let page: { value?: FeedPackage[] };
    try {
      page = await azureHttp<{ value?: FeedPackage[] }>("GET", query);
    } catch (err) {
      if (err instanceof ProviderError && (err.status === 401 || err.status === 403)) {
        throw new ProviderError(
          `access to feed '${feed.name}' was refused (HTTP ${err.status}): the stored credential needs the Packaging (Read) scope`,
          err.status,
        );
      }
      throw err;
    }
    const rows = page.value ?? [];
    all.push(...rows);
    if (rows.length < pageSize) return all;
  }
}

/** Query the packages of the project's and the organization's Artifacts feeds
 * (or only the configured default feed), mapped onto the GitHub package
 * record: `name`, `package_type`, `url`, the latest `version` and
 * `updated_at`. `opts.name` is passed to the feed as a name query; the caller
 * narrows it further. */
export async function orgPackagesQuery(
  opts: { type?: string; name?: string } = {},
): Promise<PackagesQueryResult> {
  const protocol = feedProtocol(opts.type);
  const records: Array<Record<string, unknown>> = [];
  for (const feed of await queryFeeds()) {
    for (const p of await feedPackages(feed, protocol, opts.name)) {
      const latest = (p.versions ?? []).find((v) => v.isLatest === true) ?? (p.versions ?? [])[0];
      records.push({
        name: p.name ?? p.normalizedName ?? "",
        package_type: (p.protocolType ?? "").toLowerCase(),
        url: p.url ?? "",
        version: latest?.version ?? "",
        updated_at: latest?.publishDate ?? "",
      });
    }
  }
  return { stdout: JSON.stringify(records), stderr: "", status: 0 };
}

/** Query the versions of one package (matched by exact name, case-insensitive)
 * across the searched feeds, newest first, mapped onto the GitHub version
 * record (`version`, `created_at`, `updated_at`). A package no feed holds is
 * an error. */
export async function orgPackageVersionsQuery(
  type: string,
  name: string,
): Promise<PackagesQueryResult> {
  const protocol = feedProtocol(type);
  const wanted = name.toLowerCase();
  const records: Array<Record<string, unknown>> = [];
  const searched: string[] = [];
  for (const feed of await queryFeeds()) {
    searched.push(feed.name);
    for (const p of await feedPackages(feed, protocol, name)) {
      if ((p.name ?? "").toLowerCase() !== wanted && (p.normalizedName ?? "").toLowerCase() !== wanted) continue;
      for (const v of p.versions ?? []) {
        records.push({
          version: v.version ?? v.normalizedVersion ?? "",
          created_at: v.publishDate ?? "",
          updated_at: v.publishDate ?? "",
        });
      }
    }
  }
  if (records.length === 0) {
    throw new ProviderError(`package '${name}' (${type}) not found (feeds searched: ${searched.join(", ") || "none"})`);
  }
  // Newest first, as the GitHub versions answer is.
  records.sort((a, b) => String(b["created_at"]).localeCompare(String(a["created_at"])));
  return { stdout: JSON.stringify(records), stderr: "", status: 0 };
}

/** List org packages: azure Artifacts is feed-centric — org packages surface
 * through the packaging feeds API (the endpoint argument mirrors the github
 * verb's contract for call-shape parity; advisory only). */
export async function orgPackagesList(): Promise<string> {
  return orgFeedsList();
}

/** Package versions: azure packages versioning is feed-scoped — the
 * GitHub-shaped endpoint has no Azure analog: fail defined. */
export async function orgPackageVersions(): Promise<never> {
  throw new ProviderError(
    "azure packages versioning is feed-scoped; the GitHub-shaped endpoint has no Azure analog",
  );
}

// kept local to avoid a repos-module cycle for one helper
import { azureRepoParts } from "./urls.ts";
function gitRepoUrl(spec: string): string {
  const { org, project, repo } = azureRepoParts(spec);
  const base = `https://dev.azure.com/${azureUri(org)}/${azureUri(project)}/_apis/git/repositories`;
  return repo === "" ? base : `${base}/${azureUri(repo)}`;
}
