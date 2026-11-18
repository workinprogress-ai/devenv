// harness/azure-fetch-preload.ts — preloaded with `node --import` into a child
// process (after the canary guard) to replace `fetch` with a scripted answer, so
// a tool that validates a token over HTTP can be run end to end. Nothing
// reaches the network.
//   AZURE_STUB_MODE   an HTTP status to answer (default 200), or "network" to
//                     fail the request like a lost connection
//   AZURE_STUB_LOG    file that receives one "METHOD URL" line per request
import { appendFileSync } from "node:fs";

const mode = process.env["AZURE_STUB_MODE"] ?? "200";
const log = process.env["AZURE_STUB_LOG"];

globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
  if (log !== undefined) appendFileSync(log, `${init?.method ?? "GET"} ${String(url)}\n`);
  if (mode === "network") throw new TypeError("fetch failed");
  return new Response(null, { status: Number(mode) });
}) as typeof fetch;
