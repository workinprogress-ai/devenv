// harness/azure-stub.ts — an in-process Azure DevOps stub for provider and
// consumer tests. It replaces globalThis.fetch, records every request (method,
// full URL, parsed JSON body), and answers from an explicit route table so a
// test asserts the EXACT URL a verb requested. A request no route matches is
// answered 418 with a distinctive message and listed by `unmatched()`, so a
// wrong URL fails loudly instead of being absorbed by a permissive default.
// Nothing here reaches the network or reads the PAT file.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { onTestFinished, vi } from "vitest";

export interface AzureReq {
  method: string;
  url: string;
  body: unknown;
}

export interface AzureRoute {
  /** HTTP method; omitted matches any method. */
  method?: string;
  /** An exact URL (string equality) or a pattern for URLs with variable parts. */
  url: string | RegExp;
  respond: Response | ((req: AzureReq) => Response);
}

export interface AzureStub {
  requests: AzureReq[];
  /** Requests no route matched (each was answered 418). */
  unmatched(): AzureReq[];
}

const FIXTURE_DIR = join(import.meta.dirname, "../../fixtures/azure");

/** A recorded Azure response body from tools/tests/fixtures/azure. */
export function azureFixture<T = unknown>(name: string): T {
  return JSON.parse(readFileSync(join(FIXTURE_DIR, name), "utf8")) as T;
}

/** A JSON response. Statuses that forbid a body (101, 204, 205, 304) get a
 * bodyless Response, since the Response constructor rejects a body there. */
export function azureJson(body: unknown, status = 200): Response {
  if (status === 101 || status === 204 || status === 205 || status === 304) {
    return new Response(null, { status });
  }
  return new Response(JSON.stringify(body), { status });
}

const ENV_KEYS = ["AZURE_DEVOPS_ORG", "AZURE_DEVOPS_PROJECT", "AZURE_PAT"] as const;

/** Point the provider at a fake org/project with a fake PAT. Returns the
 * restore function; call it in afterEach. */
export function useAzureEnv(org = "test-org", project = "test-project"): () => void {
  const saved: Record<string, string | undefined> = {};
  for (const k of ENV_KEYS) saved[k] = process.env[k];
  process.env["AZURE_DEVOPS_ORG"] = org;
  process.env["AZURE_DEVOPS_PROJECT"] = project;
  process.env["AZURE_PAT"] = "test-pat";
  return () => {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k] as string;
    }
  };
}

function matches(route: AzureRoute, req: AzureReq): boolean {
  if (route.method !== undefined && route.method.toUpperCase() !== req.method.toUpperCase()) return false;
  return typeof route.url === "string" ? route.url === req.url : route.url.test(req.url);
}

export interface AzureStubOptions {
  /** Do not fail the test when a request matched no route. The default is
   * strict: an unrouted request fails the test when it finishes, even if the
   * code under test swallowed the 418 answer. */
  allowUnmatched?: boolean;
}

/** Install the stub. Routes are tried in order; the first match answers.
 * Call vi.unstubAllGlobals() in afterEach to remove it. Must be called from
 * inside a test or a beforeEach hook (the strict check registers with
 * onTestFinished). */
export function stubAzureFetch(routes: AzureRoute[], opts: AzureStubOptions = {}): AzureStub {
  const requests: AzureReq[] = [];
  const miss: AzureReq[] = [];
  if (opts.allowUnmatched !== true) {
    onTestFinished(() => {
      if (miss.length > 0) {
        throw new Error(`azure-stub: ${miss.length} unrouted request(s): ${miss.map((r) => `${r.method} ${r.url}`).join(", ")}`);
      }
    });
  }
  vi.stubGlobal("fetch", (async (url: string | URL | Request, init?: RequestInit) => {
    const raw = init?.body === undefined ? undefined : String(init.body);
    let body: unknown = raw;
    if (raw !== undefined) {
      try {
        body = JSON.parse(raw) as unknown;
      } catch {
        body = raw;
      }
    }
    const req: AzureReq = { method: String(init?.method ?? "GET"), url: String(url), body };
    requests.push(req);
    const route = routes.find((r) => matches(r, req));
    if (route === undefined) {
      miss.push(req);
      return azureJson({ message: `azure-stub: no route for ${req.method} ${req.url}` }, 418);
    }
    return typeof route.respond === "function" ? route.respond(req) : route.respond.clone();
  }) as unknown as typeof fetch);
  return { requests, unmatched: () => miss };
}
