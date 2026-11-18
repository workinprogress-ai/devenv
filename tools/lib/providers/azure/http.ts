// azure/http.ts — thin HTTP transport for the Azure DevOps provider.
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
import { homedir } from "node:os";
import { ProviderError } from "../provider-core.ts";

export const AZURE_API_VERSION = "7.1";
const AZURE_HTTP_MAX_RETRIES = 3;
/** Per-request limit for JSON calls, and the longer one for artifact downloads. */
export const AZURE_HTTP_TIMEOUT_MS = 30_000;
export const AZURE_DOWNLOAD_TIMEOUT_MS = 300_000;

/** A timed-out request reads as a timeout, not as a generic transport error. */
function transportMessage(e: unknown, limitMs: number): string {
  if (e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError")) {
    return `request timed out after ${limitMs / 1000}s`;
  }
  return `request failed: ${String(e)}`;
}

// ---------------------------------------------------------------------------
// Credential resolution (the auth seam — TS mirror of _azure_pat_ensure)
// ---------------------------------------------------------------------------

/** The PAT file path (mirrors azure/auth.bash's azure_pat_file): the
 * AZURE_PAT_FILE env leg, else ~/.keys/azure-devops-pat. */
function patFile(): string {
  return process.env.AZURE_PAT_FILE || `${process.env.HOME || homedir()}/.keys/azure-devops-pat`;
}

/** The PAT reader contract, shared with auth.bash and credential-helper.sh:
 * the AZURE_PAT env var first, else the PAT file; only the first line counts,
 * trimmed of whitespace and a byte-order mark; a file whose mode is not 0600
 * is never trusted. */
function cleanPat(raw: string): string {
  return (raw.split("\n")[0] ?? "").replace(/^\uFEFF/, "").trim();
}

/** Read the stored PAT under the contract above. The credential store owns
 * the token — TS never writes or moves it. */
export function azurePatGet(): string {
  const env = cleanPat(process.env.AZURE_PAT ?? "");
  if (env !== "") return env;
  const file = patFile();
  let mode = "";
  try {
    mode = (statSync(file).mode & 0o777).toString(8).padStart(3, "0");
  } catch {
    return "";
  }
  if (mode !== "600") return "";
  try {
    return cleanPat(readFileSync(file, "utf8"));
  } catch {
    return "";
  }
}

/** The base64 Basic credential for a PAT (empty user name). */
function basicCredential(pat: string): string {
  return Buffer.from(`:${pat}`).toString("base64");
}

/** The Authorization header value. Attached on the fetch init object — the
 * PAT is never interpolated into a URL. */
function authHeader(pat: string): string {
  // Buffer encodes UTF-8; btoa throws on any character beyond Latin-1.
  return `Basic ${basicCredential(pat)}`;
}

// ---------------------------------------------------------------------------
// Redaction
// ---------------------------------------------------------------------------

/** Strip any PAT material from arbitrary text before it reaches a terminal
 * or a log (http.bash azure_redact parity). */
export function azureRedact(text: string): string {
  let out = text;
  // Redact every active credential form: the env PAT and the file-based PAT
  // (azurePatGet serves the file form, whose value never reaches env, so an
  // env-only redaction would leave file-mode credentials unredacted).
  for (const token of [process.env.AZURE_PAT ?? "", azurePatGet()]) {
    if (token === "") continue;
    // The raw token and the base64 form the Authorization header carries.
    for (const form of [token, basicCredential(token)]) {
      if (out.includes(form)) out = out.split(form).join("***REDACTED***");
    }
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

/** The `{body, headers}` envelope `azureHttp` returns when callers need the
 * response headers (pagination's header-first continuation token). The
 * plain call returns the parsed body alone; the overload keeps the two
 * shapes distinct at the type level so a caller can't read `page.body` off
 * a headerless response. */
export interface AzureHttpEnvelope<T = unknown> {
  body: T;
  headers: Record<string, string>;
}

/** Headerless form: the parsed body itself. */
export async function azureHttp<T = unknown>(
  method: string,
  url: string,
  opts?: AzureHttpOptions,
): Promise<T>;
/** Envelope form (`withHeaders: true`): body + response headers. */
export async function azureHttp<T = unknown>(
  method: string,
  url: string,
  opts: AzureHttpOptions & { withHeaders: true },
): Promise<AzureHttpEnvelope<T>>;
export async function azureHttp<T = unknown>(
  method: string,
  url: string,
  opts: AzureHttpOptions & { withHeaders?: boolean } = {},
): Promise<T | AzureHttpEnvelope<T>> {
  const pat = azurePatGet();
  if (pat === "") {
    throw new ProviderError(
      "no stored azure credential — run key-update-azure",
    );
  }
  const wantHeaders = opts.withHeaders === true;
  let retryOk = ["GET", "HEAD", "PUT", "DELETE"].includes(method);
  if (opts.idempotent === true) retryOk = true;

  const fullUrl = withApiVersion(url);
  let lastError = "";
  // True once an earlier attempt of this call failed in a way that may have
  // let the server act (lost connection, 5xx). A 429 is rejected before the
  // server acts, so it does not count.
  let mayHaveActed = false;
  for (let attempt = 1; attempt <= AZURE_HTTP_MAX_RETRIES; attempt++) {
    const r = await oneAttempt(method, fullUrl, pat, opts);
    if (r.error !== undefined && r.status === 0) {
      // connection-level failure
      lastError = r.error.message;
      if (retryOk && attempt < AZURE_HTTP_MAX_RETRIES) {
        mayHaveActed = true;
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
        let parsedBody: unknown;
        try {
          parsedBody = JSON.parse(r.body) as unknown;
        } catch {
          // A sign-in page served as a 200 (unauthenticated call redirected to
          // the login form) is an auth failure, not a malformed response.
          if (/sign in|_signin|login\.microsoftonline/i.test(r.body)) {
            authError(r.status);
          }
          throw new ProviderError("response was not valid JSON");
        }
        if (wantHeaders) {
          return {
            body: parsedBody,
            headers: Object.fromEntries(r.headers.entries()),
          } as AzureHttpEnvelope<T>;
        }
        return parsedBody as T;
      }
      // 2xx with an empty body: some APIs (DELETE) answer 204/empty. The
      // envelope form still carries the headers (a continuation token can
      // arrive with no body).
      if (wantHeaders) {
        return {
          body: undefined as T,
          headers: Object.fromEntries(r.headers.entries()),
        } as AzureHttpEnvelope<T>;
      }
      return undefined as T;
    }
    if ([429, 500, 502, 503, 504].includes(r.status)) {
      const canRetry = r.status === 429 || retryOk;
      if (canRetry && attempt < AZURE_HTTP_MAX_RETRIES) {
        if (r.status !== 429) mayHaveActed = true;
        const hinted = r.status === 429 ? retryAfterMs(r.headers.get("Retry-After")) : null;
        await sleep(hinted ?? attempt * 2000);
        continue;
      }
      if (!canRetry) {
        // A POST/PATCH that may have taken effect is never re-sent, so no
        // retry was attempted: say that, not "gave up after N attempts".
        throw new ProviderError(
          `azure http ${r.status}: not retried (the ${method} request may have taken effect)` +
            buildBodySuffix(r.body),
          r.status,
        );
      }
      throw new ProviderError(
        `azure http ${r.status}: gave up after ${attempt} attempt(s)` +
          buildBodySuffix(r.body),
        r.status,
      );
    }
    // A DELETE that was retried and now finds nothing: an earlier attempt
    // took effect and only its response was lost.
    if (method === "DELETE" && r.status === 404 && mayHaveActed) {
      if (wantHeaders) {
        return {
          body: undefined as T,
          headers: Object.fromEntries(r.headers.entries()),
        } as AzureHttpEnvelope<T>;
      }
      return undefined as T;
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
    throw new ProviderError(azureRedact(message).slice(0, 500), r.status);
  }
  throw new ProviderError(lastError === "" ? "azure http: exhausted retries" : lastError);
}

// ---------------------------------------------------------------------------
// Pagination
// ---------------------------------------------------------------------------
/** Longest wait a server's Retry-After may impose. */
export const AZURE_RETRY_AFTER_CAP_MS = 60_000;

/** The delay a Retry-After header asks for, in ms, capped at one minute;
 * null when the header is absent or is neither a non-negative whole number
 * of seconds nor an HTTP date (the caller then uses its own backoff). */
export function retryAfterMs(header: string | null): number | null {
  if (header === null) return null;
  const text = header.trim();
  if (/^\d{1,9}$/.test(text)) return Math.min(Number(text) * 1000, AZURE_RETRY_AFTER_CAP_MS);
  // The other legal form is an HTTP date (IMF-fixdate): wait until then.
  if (/^[A-Za-z]{3}, \d{2} [A-Za-z]{3} \d{4} \d{2}:\d{2}:\d{2} GMT$/.test(text)) {
    const wait = Date.parse(text) - Date.now();
    // A date already past (or an unparsable one, or clock skew) gives no
    // delay to honor: the caller's own backoff applies.
    if (Number.isNaN(wait) || wait <= 0) return null;
    return Math.min(wait, AZURE_RETRY_AFTER_CAP_MS);
  }
  return null;
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
  const init: RequestInit = {
    method,
    headers,
    redirect: "follow",
    signal: AbortSignal.timeout(AZURE_HTTP_TIMEOUT_MS),
  };
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
      error: { error: "transport", message: azureRedact(transportMessage(e, AZURE_HTTP_TIMEOUT_MS)) },
    };
  }
  let body: string;
  try {
    body = await res.text();
  } catch (e) {
    return {
      ok: false,
      status: 0,
      body: "",
      headers: new Headers(),
      error: { error: "transport", message: azureRedact(transportMessage(e, AZURE_HTTP_TIMEOUT_MS)) },
    };
  }
  return { ok: res.ok, status: res.status, body, headers: res.headers };
}

function authError(code: number): never {
  throw new ProviderError(
    `Azure DevOps did not accept the stored credential (HTTP ${code}) — run key-update-azure to store a valid token`,
    code,
  );
}

/** Azure's own error message from a response body, redacted and bounded —
 * appended to thrown HTTP errors so 5xx failures name what Azure said
 * (parity with the 400-class path). */
function buildBodySuffix(body: string): string {
  try {
    const parsed = JSON.parse(body) as { message?: unknown };
    if (typeof parsed.message === "string" && parsed.message !== "") {
      return `: ${azureRedact(parsed.message).slice(0, 500)}`;
    }
  } catch {
    // non-JSON body: no message to surface
  }
  return "";
}

/** One Azure DevOps REST call; resolves with the parsed JSON body on 2xx.
 * Retries: 429 always (Azure rejected before acting; Retry-After honored);
 * 5xx/connection failure only for idempotent requests. 203/401 and sign-in
 * pages are typed auth errors. Non-retryable HTTP errors surface the Azure
 * error payload, redacted. */
/** One Azure DevOps REST call; resolves with the parsed JSON body on 2xx.
 * Retries: 429 always (Azure rejected before acting; Retry-After honored);
 * 5xx/connection failure only for idempotent requests. 203/401 and sign-in
 * pages are typed auth errors. Non-retryable HTTP errors surface the Azure
 * error payload, redacted. */

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
    // The continuation token comes from the x-ms-continuationtoken HEADER
    // first (header-only endpoints), else the body's continuationToken field.
    const page = await azureHttp<
      { value?: T[]; continuationToken?: string }
    >("GET", pageUrl, { withHeaders: true });
    const body = page.body ?? {};
    if (Array.isArray(body.value)) items.push(...body.value);
    const headerToken = Object.entries(page.headers)
      .find(([k]) => k.toLowerCase() === "x-ms-continuationtoken")?.[1] ?? "";
    continuation =
      headerToken !== ""
        ? headerToken
        : body.continuationToken && body.continuationToken !== ""
          ? body.continuationToken
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
 * hosts, with no userinfo and the default port. A download URL comes from a
 * server response, so the host is checked before the credential is attached.
 * The check parses with the same WHATWG URL parser fetch uses, so what is
 * validated is what is contacted ('?', '#' and a backslash end the authority there
 * exactly as they do for the request). */
export function azureUrlIsProviderHost(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== "https:") return false;
  if (parsed.username !== "" || parsed.password !== "" || parsed.port !== "") return false;
  const host = parsed.hostname.toLowerCase();
  return (
    host === "dev.azure.com" ||
    host.endsWith(".dev.azure.com") ||
    host.endsWith(".visualstudio.com")
  );
}

/** What the service said about a token. */
export type AzureTokenCheck = "valid" | "rejected" | "unreachable";

/** Ask the organization whether TOKEN is accepted (connectionData, the same
 * probe and the same classification as setup.bash): 200 is "valid"; no answer
 * (a lost connection, a timeout), a server-side failure (5xx), throttling
 * (429) or a proxy demanding its own sign-in (407) leave the answer unknown,
 * so "unreachable" — an offline user is never trapped; anything else (401/403,
 * a 203 sign-in page, a redirect to sign-in, or a 404 for a mistyped
 * organization) is "rejected". */
export async function azureValidateToken(org: string, token: string): Promise<AzureTokenCheck> {
  if (org === "" || token === "") return "rejected";
  let res: Response;
  try {
    res = await fetch(
      `https://dev.azure.com/${encodeURIComponent(org)}/_apis/connectionData?api-version=7.1-preview`,
      {
        headers: { Authorization: `Basic ${basicCredential(token)}` },
        redirect: "manual",
        signal: AbortSignal.timeout(15_000),
      },
    );
  } catch {
    return "unreachable";
  }
  // Only the status matters: release the connection without reading the body.
  await res.body?.cancel().catch(() => undefined);
  if (res.status === 200) return "valid";
  if (res.status === 429 || res.status === 407 || res.status >= 500) return "unreachable";
  return "rejected";
}

/** Download a binary resource (a build artifact zip) to a file with the same
 * auth as every other call, but the URL exactly as the API returned it (no
 * api-version is added). The JSON transport cannot carry a zip, so this
 * bypasses body validation; the status is still checked, and a failed download
 * leaves the destination as it was. */
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
  // The URL is used exactly as the API returned it: a PipelineArtifact's
  // download URL is on another host that refuses an added api-version.
  const fullUrl = url;
  const { writeFileSync, renameSync, rmSync } = await import("node:fs");
  // Written beside the destination and renamed over it, so a failed download
  // never deletes or truncates a file that was already there.
  const tmp = `${dest}.${process.pid}.tmp`;
  const signal = AbortSignal.timeout(AZURE_DOWNLOAD_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(fullUrl, {
      headers: { Authorization: authHeader(pat) },
      redirect: "follow",
      signal,
    });
  } catch (e) {
    throw new ProviderError(azureRedact(`artifact download ${transportMessage(e, AZURE_DOWNLOAD_TIMEOUT_MS)}`));
  }
  if (res.status === 203 || res.status === 401) authError(res.status);
  if (!res.ok) {
    throw new ProviderError(`artifact download failed (HTTP ${res.status})`, res.status);
  }
  let buf: Uint8Array;
  try {
    buf = new Uint8Array(await res.arrayBuffer());
  } catch (e) {
    throw new ProviderError(azureRedact(`artifact download ${transportMessage(e, AZURE_DOWNLOAD_TIMEOUT_MS)}`));
  }
  try {
    writeFileSync(tmp, buf);
    renameSync(tmp, dest);
  } catch (e) {
    rmSync(tmp, { force: true });
    throw e;
  }
}
