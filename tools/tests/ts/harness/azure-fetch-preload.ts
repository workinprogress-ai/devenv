// harness/azure-fetch-preload.ts — preloaded with `node --import` into a child
// process (after the canary guard) to replace `fetch` with a scripted answer, so
// a tool that validates a token over HTTP can be run end to end. Nothing
// reaches the network.
//   AZURE_STUB_MODE   an HTTP status to answer (default 200), or "network" to
//                     fail the request like a lost connection
//   AZURE_STUB_LOG    file that receives one "METHOD URL" line per request
//   AZURE_STUB_BODY_LOG optional file that receives one "METHOD URL BODY" line
//                     per request that carries a body
//   AZURE_STUB_ROUTES optional JSON file: [{ "method"?, "url" (regex source),
//                     "status"?, "body"? }]. The first route whose method and
//                     URL pattern match answers with its status (default 200)
//                     and JSON body; unmatched requests fall back to
//                     AZURE_STUB_MODE with an empty body.
import { appendFileSync, readFileSync } from "node:fs";

interface StubRoute {
  method?: string;
  url: string;
  status?: number;
  body?: unknown;
}

const mode = process.env["AZURE_STUB_MODE"] ?? "200";
const log = process.env["AZURE_STUB_LOG"];
const bodyLog = process.env["AZURE_STUB_BODY_LOG"];
const routesFile = process.env["AZURE_STUB_ROUTES"];
const routes: StubRoute[] = routesFile !== undefined ? (JSON.parse(readFileSync(routesFile, "utf8")) as StubRoute[]) : [];

globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
  const method = init?.method ?? "GET";
  if (log !== undefined) appendFileSync(log, `${method} ${String(url)}\n`);
  if (bodyLog !== undefined && typeof init?.body === "string") {
    appendFileSync(bodyLog, `${method} ${String(url)} ${init.body}\n`);
  }
  const route = routes.find(
    (r) => (r.method === undefined || r.method === method) && new RegExp(r.url).test(String(url)),
  );
  if (route !== undefined) {
    // A string body is served as plain text (build logs); anything else as JSON.
    if (typeof route.body === "string") {
      return new Response(route.body, { status: route.status ?? 200, headers: { "content-type": "text/plain" } });
    }
    return new Response(route.body === undefined ? null : JSON.stringify(route.body), {
      status: route.status ?? 200,
      headers: { "content-type": "application/json" },
    });
  }
  if (mode === "network") throw new TypeError("fetch failed");
  return new Response(null, { status: Number(mode) });
}) as typeof fetch;
