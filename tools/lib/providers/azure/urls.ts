// azure/urls.ts — Azure DevOps URL seam (port of azure/urls.bash + the
// repo-spec helpers of repos.bash): web-URL construction, remote parsing,
// and org/project resolution. The host literal lives here — the single
// point of definition; every derivation follows it.
//
// URL forms handled:
//   https://dev.azure.com/{org}/{project}/_git/{repo}   (https remote)
//   https://{org}.visualstudio.com/{project}/_git/{repo} (org-host form)
//   git@ssh.dev.azure.com:v3/{org}/{project}/{repo}      (ssh remote)

import { configGetRaw } from "../../core/config.ts";
import { providerConfigPath } from "../provider-core.ts";

/** The provider's web host (dots escaped by callers building regexes). */
export function webHost(): string {
  return "dev.azure.com";
}

/** Percent-encode one URL component (an org, project, repo or branch name, a
 * definition name): spaces, slashes and the like in a name must not break or
 * redirect the request. */
export function azureUri(value: string): string {
  return encodeURIComponent(value);
}

/** A [provider] table value from devenv.config; "" when absent. */
function configValue(key: string): string {
  return configGetRaw(providerConfigPath(), "provider", key) ?? "";
}

/** The configured organization: AZURE_DEVOPS_ORG, else [provider] azure_org. */
export function azureOrgGet(): string {
  return process.env.AZURE_DEVOPS_ORG || configValue("azure_org");
}

/** The configured project: AZURE_DEVOPS_PROJECT, else [provider] azure_project. */
export function azureProjectGet(): string {
  return process.env.AZURE_DEVOPS_PROJECT || configValue("azure_project");
}

/** Resolve org/project for API paths. Order: explicit env overrides
 * (session-scoped) → devenv.config [provider] azure_org/azure_project.
 * Throws when either is unresolved (repos.bash azure_org_project parity). */
export function azureOrgProject(): { org: string; project: string } {
  const org = azureOrgGet();
  const project = azureProjectGet();
  if (org === "" || project === "") {
    throw new Error(
      "azure org/project unresolved — set [provider] azure_org and azure_project in devenv.config",
    );
  }
  return { org, project };
}

/** Split a repo spec into org, project and repo. Specs are org/project/repo,
 * project/repo (the canonical form) or a bare repo name; the configured org
 * and project fill whatever the spec leaves out. Throws when org or project
 * cannot be resolved (repos.bash azure_repo_parts parity). */
export function azureRepoParts(spec: string): {
  org: string;
  project: string;
  repo: string;
} {
  let org = "";
  let project = "";
  let repo = "";
  const segs = spec.split("/");
  if (segs.length >= 3) {
    org = segs[0] as string;
    project = segs[1] as string;
    repo = segs.slice(2).join("/");
  } else if (segs.length === 2) {
    project = segs[0] as string;
    repo = segs[1] as string;
  } else if (spec !== "") {
    repo = spec;
  }
  if (org === "" || project === "") {
    const resolved = azureOrgProject();
    if (org === "") org = resolved.org;
    if (project === "") project = resolved.project;
  }
  return { org, project, repo };
}

/** Git API root of a repo spec, every component encoded:
 * https://dev.azure.com/<org>/<project>/_apis/git/repositories/<repo>
 * (the repositories collection when the spec names no repo). */
export function azureGitRepoUrl(spec: string): string {
  const { org, project, repo } = azureRepoParts(spec);
  const base = `https://dev.azure.com/${azureUri(org)}/${azureUri(project)}/_apis/git/repositories`;
  return repo === "" ? base : `${base}/${azureUri(repo)}`;
}

/** Git transport URL for a repo: https://dev.azure.com/{org}/{project}/_git/
 * {repo}. Clean URL — the PAT never embeds; auth rides the transport's header
 * or the git credential helper. Accepts the 3-part form; the project/repo
 * form injects the configured project. */
export function gitTransportUrl(
  org: string,
  projectOrRepo: string,
  maybeRepo?: string,
): string {
  if (org === "") {
    throw new Error("provider_git_transport_url requires org");
  }
  let project = projectOrRepo;
  let repo = maybeRepo ?? "";
  if (repo === "") {
    repo = project;
    project = azureProjectGet();
    if (project === "") {
      throw new Error(
        "provider_git_transport_url: 2-arg form requires a configured project (AZURE_DEVOPS_PROJECT or [provider] azure_project)",
      );
    }
  }
  return `https://dev.azure.com/${azureUri(org)}/${azureUri(project)}/_git/${azureUri(repo)}`;
}

/** Org-level base URL (compatibility with the github url seam's shape). */
export function gitRemoteBase(org: string): string {
  if (org === "") throw new Error("provider_git_remote_base requires org");
  return `https://dev.azure.com/${azureUri(org)}`;
}

/** Web-UI URL. repo carries org/project/repo in the remote form (Azure nests
 * one level deeper than GitHub's owner/repo); path is repo-relative
 * ("pullrequest/12", "_workitems/edit/7"). */
export function webUrl(repo: string, path: string): string {
  if (repo === "" || path === "") {
    throw new Error("provider_web_url requires repo (org/project/repo) and path");
  }
  const encoded = repo.split("/").map(azureUri).join("/");
  return `https://dev.azure.com/${encoded}/${path}`;
}

/** Extract the first web URL from provider output, optionally filtered to a
 * path prefix. Mirrors the github seam's derivation: host from webHost (the
 * single point of definition). Null when none found. */
export function extractUrl(output: string, pathPrefix = ""): string | null {
  const hostRx = webHost().replace(/\./g, "\\.");
  const pattern =
    pathPrefix !== ""
      ? new RegExp(`https://${hostRx}/[^\\s]*/${pathPrefix}[^\\s]*`)
      : new RegExp(`https://${hostRx}[^\\s]+`);
  const m = pattern.exec(output);
  return m?.[0] ?? null;
}

/** Decode %XX escapes in a URL path segment (a remote carries "My%20Project"
 * where the name is "My Project"). Only well-formed %XX sequences are
 * decoded; request builders percent-encode the name again themselves. */
export function azureUriDecode(text: string): string {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}

export interface AzureRemote {
  org: string;
  project: string;
  repo: string;
}

/** Parse an Azure DevOps git remote URL into org/project/repo (decoded).
 * Accepts https and ssh forms (with or without a .git suffix), including the
 * organization-host form:
 *   https://dev.azure.com/org/project/_git/repo
 *   https://org.visualstudio.com/project/_git/repo
 *   git@ssh.dev.azure.com:v3/org/project/repo
 * Null when the URL is not a recognized Azure remote. */
export function azureParseRemote(url: string): AzureRemote | null {
  let m: RegExpExecArray | null;
  m = /^https:\/\/dev\.azure\.com\/([^/]+)\/([^/]+)\/_git\/(.+?)(?:\.git)?$/.exec(url);
  if (m) {
    return { org: azureUriDecode(m[1] as string), project: azureUriDecode(m[2] as string), repo: azureUriDecode(m[3] as string) };
  }
  m = /^https:\/\/[^/@]+@([^/]+)\.visualstudio\.com\/([^/]+)\/_git\/(.+?)(?:\.git)?$/.exec(url);
  if (m) {
    return { org: azureUriDecode(m[1] as string), project: azureUriDecode(m[2] as string), repo: azureUriDecode(m[3] as string) };
  }
  m = /^https:\/\/([^/.]+)\.visualstudio\.com\/([^/]+)\/_git\/(.+?)(?:\.git)?$/.exec(url);
  if (m) {
    return { org: azureUriDecode(m[1] as string), project: azureUriDecode(m[2] as string), repo: azureUriDecode(m[3] as string) };
  }
  m = /^git@ssh\.dev\.azure\.com:v3\/([^/]+)\/([^/]+)\/(.+?)(?:\.git)?$/.exec(url);
  if (m) {
    return { org: azureUriDecode(m[1] as string), project: azureUriDecode(m[2] as string), repo: azureUriDecode(m[3] as string) };
  }
  return null;
}

/** Normalize a git remote URL to the provider's clean https web form:
 * https://dev.azure.com/{org}/{project}/_git/{repo}. Null when the remote is
 * not an Azure remote (the seam contract: the caller falls back). */
export function remoteToWeb(remote: string): string | null {
  const parsed = azureParseRemote(remote);
  if (parsed === null) return null;
  return `https://dev.azure.com/${azureUri(parsed.org)}/${azureUri(parsed.project)}/_git/${azureUri(parsed.repo)}`;
}

/** A git remote URL as this provider's repo spec: project/repo (the
 * organization comes from config). Null when the remote is not an Azure
 * remote. */
export function remoteToSpec(remote: string): string | null {
  const parsed = azureParseRemote(remote);
  if (parsed === null) return null;
  return `${parsed.project}/${parsed.repo}`;
}

/** Resolve org/project/repo from a SPEC that is project/repo (org comes from
 * config) or org/project/repo. Throws when the spec shape or the org is
 * unresolved. */
function specToOpr(spec: string): AzureRemote {
  const segs = spec.split("/");
  let org: string;
  let project: string;
  let repo: string;
  if (segs.length >= 3) {
    org = segs[0] as string;
    project = segs[1] as string;
    repo = segs.slice(2).join("/");
  } else if (segs.length === 2) {
    org = azureOrgGet();
    project = segs[0] as string;
    repo = segs[1] as string;
  } else {
    throw new Error(`spec '${spec}' is not project/repo`);
  }
  if (org === "") {
    throw new Error(
      "organization unresolved — set [provider] azure_org in devenv.config",
    );
  }
  return { org, project, repo };
}

/** Web page of a pull request. SPEC is project/repo (org from config) or
 * org/project/repo. */
export function prWebUrl(spec: string, number: number): string {
  if (spec === "" || !Number.isFinite(number)) {
    throw new Error("provider_pr_web_url requires a repo spec (project/repo) and a PR number");
  }
  const { org, project, repo } = specToOpr(spec);
  return `https://dev.azure.com/${azureUri(org)}/${azureUri(project)}/_git/${azureUri(repo)}/pullrequest/${number}`;
}

/** Web page of a work item. SPEC is project/repo (org from config) or
 * org/project/repo; a work item belongs to the project, not the repo. */
export function issueWebUrl(spec: string, number: number): string {
  if (spec === "" || !Number.isFinite(number)) {
    throw new Error("provider_issue_web_url requires a repo spec (project/repo) and a work item number");
  }
  const { org, project } = specToOpr(spec);
  return `https://dev.azure.com/${azureUri(org)}/${azureUri(project)}/_workitems/edit/${number}`;
}
