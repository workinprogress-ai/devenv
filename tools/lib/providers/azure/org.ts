// azure/org.ts — the org surface for azure: releases (git-tag release unit),
// Artifacts feeds, and re-exports of the policy ruleset verbs (the bash org
// module is a thin loader over policies.bash + releases.bash; the TS module
// composes the same surface). Contract: throw ProviderError; never exit.

import { ProviderError } from "../provider-core.ts";
import { azureHttp, azureHttpPaginate } from "./http.ts";
import { azureOrgProject, azureUri } from "./urls.ts";
import { applyListFlags } from "./repos.ts";

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
  } catch {
    // fall through to the commit-date leg
  }
  try {
    const commit = await azureHttp<{ committer?: { date?: string } }>(
      "GET",
      `${repoUrl}/commits/${objectId}`,
    );
    return commit.committer?.date ?? "";
  } catch {
    return "";
  }
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
  const semverCore = (name: string): number[] => {
    const core = name.replace(/^refs\/tags\/v?/, "").split("-")[0] ?? "";
    return core.split(".").map((p) => {
      const n = Number(p);
      return Number.isFinite(n) ? n : -1;
    });
  };
  const isVersion = (name: string): boolean =>
    /^refs\/tags\/v?[0-9]+(\.[0-9]+)*(-|$)/.test(name);
  const sorted = [...refs]
    .map((r) => ({ ...r, _ver: isVersion(r.name ?? "") }))
    .sort((a, b) => {
      const av = a._ver ? 1 : 0;
      const bv = b._ver ? 1 : 0;
      if (av !== bv) return av - bv;
      const ac = semverCore(a.name ?? "");
      const bc = semverCore(b.name ?? "");
      for (let i = 0; i < Math.max(ac.length, bc.length); i++) {
        const d = (ac[i] ?? -1) - (bc[i] ?? -1);
        if (d !== 0) return d;
      }
      const aPre = (a.name ?? "").includes("-") ? 1 : 0;
      const bPre = (b.name ?? "").includes("-") ? 1 : 0;
      if (aPre !== bPre) return bPre - aPre; // release above its prereleases
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

/** List org-level Artifacts feeds (the packaging surface). */
export async function orgFeedsList(): Promise<string> {
  const { org } = azureOrgProject();
  const r = await azureHttp<{ value?: Array<{ name?: string; id?: string; url?: string }> }>(
    "GET",
    `https://feeds.dev.azure.com/${azureUri(org)}/_apis/packaging/feeds?api-version=7.1-preview.1`,
  );
  return JSON.stringify(
    (r.value ?? []).map((f) => ({ name: f.name ?? "", id: f.id ?? "", url: f.url ?? "" })),
  );
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
