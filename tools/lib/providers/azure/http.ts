// azure/http.ts — thin HTTP transport for the Azure DevOps provider (port of
// azure/http.bash).
//
// Everything HTTP lives here once: Basic-auth header from the PAT,
// api-version injection, continuation-token pagination, 429/Retry-After and
// transient-5xx retry (idempotent requests only) with backoff, typed auth
// errors, JSON validation, and token redaction on every log/error path.
// Domain modules (providers/azure/*) call azureHttp / azureHttpPaginate /
// azureHttpDownload; they never touch fetch themselves.
//
// Contract (mirrors http.bash):
//   - The PAT travels ONLY as an Authorization header on the request object —
//     never in a URL, never in logs. Query-string tokens are forbidden.
//   - All error text passes through azureRedact, so the token can never reach
//     a terminal or a file.
//   - Failures throw ProviderError with a typed `error` code (no-credentials /
//     auth / transport / malformed-json / http / host / usage) — the caller
//     decides what is fatal, exactly as the github modules do.

import { statSync, readFileSync } from "node:fs";
import { ProviderError } from "../provider-core.ts";

export const AZURE_API_VERSION = "7.1";
const AZURE_HTTP_MAX_RETRIES = 3;

// ---------------------------------------------------------------------------
// Credential resolution (the auth seam — TS mirror of _azure_pat_ensure)
// ---------------------------------------------------------------------------

/** The PAT file path (mirrors azure/auth.bash's azure_pat_file): the
 * AZURE_PAT_FILE env leg, else ~/.keys/azure-devops-pat. */
function patFile(): string {
  const home = process.env.HOME ?? "";
  return process.env.AZURE_PAT_FILE || `${home}/.keys/azure-devops-pat`;
}

/** Read the stored PAT: the AZURE_PAT env leg first, then the 0600 PAT file
 * (the same two legs the bash seam resolves). The credential store owns the
 * token — TS never writes or moves it. */
export function azurePatGet(): string {
  const env = process.env.AZURE_PAT ?? "";
  if (env !== "") return env;
  const file = patFile();
  let mode = "";
  try {
    mode = (statSync(file).mode & 0o777).toString(8).padStart(3, "0");
  } catch {
    return "";
  }
  // auth.bash parity: a mis-modal file is refused, not trusted.
  if (mode !== "600") return "";
  try {
    return readFileSync(file, "utf8").split("\n")[0]?.trim() ?? "";
  } catch {
    return "";
  }
}

/** The Authorization header value. Attached on the fetch init object — the
 * PAT is never interpolated into a URL. */
function authHeader(pat: string): string {
  // btoa is available globally in Node >= 16.
  return `Basic ${btoa(`:${pat}`)}`;
}

// ---------------------------------------------------------------------------
// Redaction
// ---------------------------------------------------------------------------

/** Strip any PAT material from arbitrary text before it reaches a terminal
 * or a log (http.bash azure_redact parity). */
export function azureRedact(text: string): string {
  let out = text;
  const token = process.env.AZURE_PAT ?? "";
  if (token !== "") {
    out = out.split(token).join("***REDACTED***");
  }
  // Defensive: redact base64 Basic credentials if one leaks in.
  out = out.replace(
    /Authorization: Basic [A-Za-z0-9+/=]+/g,
    "Authorization: Basic ***REDACTED***",
  );
  return out;
}

// ---------------------------------------------------------------------------
// Core request
// ---------------------------------------------------------------------------

export interface AzureHttpOptions {
  /** Request body (JSON string). Implies a Content-Type. */
  body?: string;
  /** application/json (default) or application/json-patch+json — work-item
   * create/edit APIs reject plain application/json with a 400. */
  contentType?: string;
  /** Mark a read-only POST (a WIQL query) retryable on 5xx, like bash's
   * "idempotent" flag. A POST/PATCH that may have taken effect is never
   * re-sent without this. */
  idempotent?: boolean;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

interface AttemptResult {
  ok: boolean;
  status: number;
  body: string;
  headers: Headers;
  /** Set when ok=false: the typed error already rendered (thrown by caller). */
  error?: { error: string; code?: number; message: string };
  retryAfterMs?: number;
}

/** Append the default api-version unless the URL pins its own (preview
 * resources like work-item comments require a -preview version). */
function withApiVersion(url: string): string {
  if (url.includes("api-version=")) return url;
  return url + (url.includes("?") ? "&" : "?") + `api-version=${AZURE_API_VERSION}`;
}

async function oneAttempt(
  method: string,
  url: string,
  pat: string,
  opts: AzureHttpOptions,
): Promise<AttemptResult> {
  const headers: Record<string, string> = {
    Authorization: authHeader(pat),
  };
  const init: RequestInit = { method, headers, redirect: "follow" };
  if (opts.body !== undefined) {
    headers["Content-Type"] = opts.contentType ?? "application/json";
    init.body = opts.body;
  }
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch (e) {
    return {
      ok: false,
      status: 0,
      body: "",
      headers: new Headers(),
      error: { error: "transport", message: `request failed: ${String(e)}` },
    };
  }
  const body = await res.text();
  return { ok: res.ok, status: res.status, body, headers: res.headers };
}

function authError(code: number): never {
  throw new ProviderError(
    `Azure DevOps did not accept the stored credential (HTTP ${code}) — run key-update-azure to store a valid token`,
  );
}

/** One Azure DevOps REST call; resolves with the parsed JSON body on 2xx.
 * Retries: 429 always (Azure rejected before acting; Retry-After honored);
 * 5xx/connection failure only for idempotent requests. 203/401 and sign-in
 * pages are typed auth errors. Non-retryable HTTP errors surface the Azure
 * error payload, redacted. */
export async function azureHttp<T = unknown>(
  method: string,
  url: string,
  opts: AzureHttpOptions = {},
): Promise<T> {
  const pat = azurePatGet();
  if (pat === "") {
    throw new ProviderError(
      "no stored azure credential — run key-update-azure",
    );
  }
  let retryOk = ["GET", "HEAD", "PUT", "DELETE"].includes(method);
  if (opts.idempotent === true) retryOk = true;

  const fullUrl = withApiVersion(url);
  let lastError = "";
  for (let attempt = 1; attempt <= AZURE_HTTP_MAX_RETRIES; attempt++) {
    const r = await oneAttempt(method, fullUrl, pat, opts);
    if (r.error !== undefined && r.status === 0) {
      // connection-level failure
      lastError = r.error.message;
      if (retryOk && attempt < AZURE_HTTP_MAX_RETRIES) {
        await sleep(attempt * 2000);
        continue;
      }
      throw new ProviderError(
        `curl-equivalent request failed after ${attempt} attempt(s): ${lastError}`,
      );
    }
    if (r.status === 203 || r.status === 401) authError(r.status);
    if (r.status >= 200 && r.status < 300) {
      if (r.body.trim() !== "") {
        try {
          return JSON.parse(r.body) as T;
        } catch {
          // A sign-in page served as a 200 (unauthenticated call redirected to
          // the login form) is an auth failure, not a malformed response.
          if (/sign in|_signin|login\.microsoftonline/i.test(r.body)) {
            authError(r.status);
          }
          throw new ProviderError("response was not valid JSON");
        }
      }
      // 2xx with an empty body: some APIs (DELETE) answer 204/empty.
      return undefined as T;
    }
    if ([429, 500, 502, 503, 504].includes(r.status)) {
      const canRetry = r.status === 429 || retryOk;
      if (canRetry && attempt < AZURE_HTTP_MAX_RETRIES) {
        const ra = r.headers.get("Retry-After");
        if (ra !== null && r.status === 429) {
          await sleep(Number(ra) * 1000);
        } else {
          await sleep(attempt * 2000);
        }
        continue;
      }
      throw new ProviderError(
        `azure http ${r.status}: gave up after ${attempt} attempt(s)`,
      );
    }
    // Non-retryable HTTP error (400/403/404...). Surface the Azure error
    // payload when present; redact regardless (server-controlled text).
    let message = `HTTP ${r.status}`;
    try {
      const parsed = JSON.parse(r.body) as { message?: string };
      if (typeof parsed.message === "string" && parsed.message !== "") {
        message = parsed.message;
      }
    } catch {
      // keep the HTTP-code fallback
    }
    throw new ProviderError(azureRedact(message).slice(0, 500));
  }
  throw new ProviderError(lastError === "" ? "azure http: exhausted retries" : lastError);
}

// ---------------------------------------------------------------------------
// Pagination
// ---------------------------------------------------------------------------

/** Fetch the pages of a list endpoint and return one combined array
 * (http.bash azure_http_paginate parity). The continuation token comes from
 * the x-ms-continuationtoken response header, else the body's
 * continuationToken field; it is appended URL-encoded as pages are consumed.
 * maxItems stops paging once that many items are in hand. */
export async function azureHttpPaginate<T = unknown>(
  url: string,
  maxItems?: number,
): Promise<T[]> {
  const pat = azurePatGet();
  if (pat === "") {
    throw new ProviderError("no stored azure credential — run key-update-azure");
  }
  const items: T[] = [];
  let continuation = "";
  for (;;) {
    let pageUrl = url;
    if (continuation !== "") {
      const enc = encodeURIComponent(continuation);
      pageUrl += (pageUrl.includes("?") ? "&" : "?") + `continuationToken=${enc}`;
    }
    // Pagination is a GET — idempotent, retryable by the transport's rules.
    const page = await azureHttp<{ value?: T[]; continuationToken?: string }>(
      "GET",
      pageUrl,
    );
    if (Array.isArray(page.value)) items.push(...page.value);
    continuation =
      page.continuationToken && page.continuationToken !== ""
        ? page.continuationToken
        : "";
    if (continuation === "") break;
    if (maxItems !== undefined && items.length >= maxItems) break;
  }
  return maxItems !== undefined ? items.slice(0, maxItems) : items;
}

// ---------------------------------------------------------------------------
// Binary download
// ---------------------------------------------------------------------------

/** Whether a URL is one the PAT may be sent to: https on Azure DevOps' own
 * hosts. A download URL comes from a server response, so the host is checked
 * before the credential is attached (http.bash azure_url_is_provider_host). */
export function azureUrlIsProviderHost(url: string): boolean {
  if (!url.startsWith("https://")) return false;
  const rest = url.slice("https://".length);
  const host = rest.split("/")[0]?.split("@").pop()?.split(":")[0]?.toLowerCase() ?? "";
  return (
    host === "dev.azure.com" ||
    host.endsWith(".dev.azure.com") ||
    host.endsWith(".visualstudio.com")
  );
}

/** Download a binary resource (a build artifact zip) to a file, with the same
 * auth and api-version rules as every other call. The JSON transport cannot
 * carry a zip, so this bypasses body validation; the status is still checked,
 * and a failed download leaves no partial file. */
export async function azureHttpDownload(url: string, dest: string): Promise<void> {
  if (url === "" || dest === "") {
    throw new ProviderError("azureHttpDownload needs a URL and a destination");
  }
  if (!azureUrlIsProviderHost(url)) {
    throw new ProviderError("refusing to send the PAT to a host outside Azure DevOps");
  }
  const pat = azurePatGet();
  if (pat === "") {
    throw new ProviderError("no stored azure credential — run key-update-azure");
  }
  const fullUrl = withApiVersion(url);
  const { writeFileSync, rmSync } = await import("node:fs");
  let res: Response;
  try {
    res = await fetch(fullUrl, { headers: { Authorization: authHeader(pat) }, redirect: "follow" });
  } catch (e) {
    rmSync(dest, { force: true });
    throw new ProviderError(`artifact download failed: ${String(e)}`);
  }
  if (res.status === 203 || res.status === 401) {
    rmSync(dest, { force: true });
    authError(res.status);
  }
  if (!res.ok) {
    rmSync(dest, { force: true });
    throw new ProviderError(`artifact download failed (HTTP ${res.status})`);
  }
  const buf = new Uint8Array(await res.arrayBuffer());
  writeFileSync(dest, buf);
}
