// live-guards.ts — small pure helpers the GitHub smoke suite uses for its
// token scrubbing, cleanup matching and scope preflight. They live apart from
// the suite so they can be unit-tested without importing it (the suite runs
// its gate and its flow at import time).

/** The slice of a gh result the matchers read. */
export interface CleanupResult {
  status: number;
  stderr: string;
}

/** Strip anything shaped like a GitHub token (and the literal env tokens)
 * from text before it reaches the console or the report. */
export function scrubTokens(text: string, env: Record<string, string | undefined> = process.env): string {
  let out = text.replace(/(gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})/g, "[redacted]");
  for (const name of ["GH_TOKEN", "GITHUB_TOKEN"]) {
    const value = env[name];
    if (value !== undefined && value.length >= 8) out = out.split(value).join("[redacted]");
  }
  return out;
}

/** Only a real not-found response counts as "already cleaned": success, or an
 * HTTP 404 / "Not Found" message. A validation failure (422) or any message
 * that merely contains a word like "already" is a failed cleanup. Used for
 * items that nothing else removes (the repository, the team, the project). */
export function notFoundOk(r: CleanupResult): boolean {
  return r.status === 0 || /\bHTTP 404\b|\bNot Found\b/i.test(r.stderr);
}

/** The broader tolerance for items that live inside the throwaway repository,
 * where the repository delete is the backstop: not-found, a validation
 * response (422) or an "already ..." state also count as cleaned. */
export function absentOk(r: CleanupResult): boolean {
  return r.status === 0 || /not found|404|does not exist|422|already/i.test(r.stderr);
}

/** The token scopes named by an `X-OAuth-Scopes` header in `gh api -i`
 * output. null when the header is absent (fine-grained and app tokens expose
 * none), so "unknown" is never confused with "empty". */
export function parseOAuthScopes(headerText: string): string[] | null {
  const headerBlock = headerText.split(/\r?\n\r?\n/, 1)[0] ?? "";
  for (const line of headerBlock.split(/\r?\n/)) {
    const m = /^x-oauth-scopes:(.*)$/i.exec(line.trim());
    if (m !== null) {
      return (m[1] ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s !== "");
    }
  }
  return null;
}

/** True only when the scope list is known and lacks `delete_repo`. */
export function lacksDeleteRepo(scopes: string[] | null): boolean {
  return scopes !== null && !scopes.includes("delete_repo");
}
