// urls.ts — provider URL seam for GitHub: web-URL construction, URL
// extraction from provider output, and remote-URL normalization (port of
// providers/github/urls.bash). The host literal lives here — the single
// point of definition; every derivation follows it.

import { execFileSync } from "node:child_process";

/** The provider's web host (dots escaped by callers building regexes). */
export function webHost(): string {
  return "github.com";
}

/** Web page for a repo + path. repo is owner/name. */
export function webUrl(repo: string, path: string): string {
  if (repo === "" || path === "") {
    throw new Error("provider_web_url requires repo (owner/name) and path");
  }
  return `https://github.com/${repo}/${path}`;
}

/** Web page of a pull request. spec is owner/repo. */
export function prWebUrl(spec: string, number: number): string {
  if (spec === "" || !Number.isFinite(number)) {
    throw new Error("provider_pr_web_url requires a repo spec (owner/repo) and a PR number");
  }
  return webUrl(spec, `pull/${number}`);
}

/** Web page of an issue. spec is owner/repo. */
export function issueWebUrl(spec: string, number: number): string {
  if (spec === "" || !Number.isFinite(number)) {
    throw new Error("provider_issue_web_url requires a repo spec (owner/repo) and an issue number");
  }
  return webUrl(spec, `issues/${number}`);
}

/** Extract the first host URL from provider/gh output, optionally filtered
 * to a path prefix (e.g. "issues/"). Null when none found. */
export function extractUrl(output: string, pathPrefix = ""): string | null {
  const hostRx = webHost().replace(/\./g, "\\.");
  const pattern =
    pathPrefix !== ""
      ? new RegExp(`https://${hostRx}/[^\\s]*/${pathPrefix}[^\\s]*`)
      : new RegExp(`https://${hostRx}[^\\s]+`);
  const m = pattern.exec(output);
  return m?.[0] ?? null;
}

/** Normalize a git remote URL to the provider's clean https web form:
 * SSH (git@host:owner/repo.git), https and http forms (with or without
 * .git, with embedded credentials) all collapse to https://host/owner/repo.
 * Null when the remote is not this provider's host. */
export function remoteToWeb(remote: string): string | null {
  let r = remote;
  // Credential-embedded https remotes are common and must parse like clean
  // ones: strip the userinfo segment first.
  r = r.replace(/^https:\/\/[^/@]+@/, "https://");
  r = r.replace(/^ssh:\/\/[^/@]+@/, "ssh://");
  const host = webHost();
  let rest: string | null = null;
  if (r.startsWith(`git@${host}:`)) {
    rest = r.slice(`git@${host}:`.length);
  } else if (r.startsWith(`https://${host}/`)) {
    rest = r.slice(`https://${host}/`.length);
  } else if (r.startsWith(`${host}/`)) {
    rest = r.slice(`${host}/`.length);
  } else if (r.startsWith(`http://${host}/`)) {
    rest = r.slice(`http://${host}/`.length);
  }
  if (rest === null) return null;
  rest = rest.replace(/\.git$/, "");
  return `https://${host}/${rest}`;
}

/** A git remote URL as this provider's repo spec (owner/repo), whatever the
 * transport form. Null when the remote is not this provider's host. */
export function remoteToSpec(remote: string): string | null {
  const web = remoteToWeb(remote);
  if (web === null) return null;
  return web.replace(`https://${webHost()}/`, "");
}

/** Git transport URL for a repo: https://<host>/<org>/<repo>.git. Clean —
 * credentials never embed; auth rides gh's credential helper. */
export function gitTransportUrl(org: string, repo: string): string {
  if (org === "" || repo === "") {
    throw new Error("provider_git_transport_url requires org and repo");
  }
  return `https://github.com/${org}/${repo}.git`;
}

/** This provider's authentication status (exit-code only; never emits the
 * token). gh prefers GH_TOKEN/GITHUB_TOKEN over its keychain — they are
 * stripped so an env token cannot make an empty credential store look
 * authenticated. (The auth.bash status impl.) */
export function authStatusOk(): boolean {
  try {
    execFileSync("gh", ["auth", "status"], {
      encoding: "utf8",
      stdio: ["ignore", "ignore", "ignore"],
      env: stripEnvTokens(process.env),
    });
    return true;
  } catch {
    return false;
  }
}

function stripEnvTokens(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const copy: NodeJS.ProcessEnv = { ...env };
  delete copy["GH_TOKEN"];
  delete copy["GITHUB_TOKEN"];
  return copy;
}
