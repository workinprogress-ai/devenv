// Preload (node --import) for black-box tool tests on the azure provider:
// replaces globalThis.fetch with a scripted responder. AZ_STUB_ROUTES holds a
// JSON array of {m: method, u: url substring, s: status, b: body}; the first
// matching route answers, an unmatched request gets a 404. Every request is
// appended to AZ_STUB_LOG as "METHOD url". Nothing leaves the process.
import { appendFileSync } from "node:fs";

const routes = JSON.parse(process.env.AZ_STUB_ROUTES ?? "[]");
const log = process.env.AZ_STUB_LOG ?? "";

globalThis.fetch = async (input, init) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  const method = init?.method ?? "GET";
  if (log !== "") appendFileSync(log, `${method} ${url}\n`);
  const hit = routes.find((r) => (r.m === undefined || r.m === method) && url.includes(r.u));
  if (hit === undefined) return new Response(JSON.stringify({ message: "unmatched stub route" }), { status: 404 });
  return new Response(JSON.stringify(hit.b ?? {}), { status: hit.s ?? 200 });
};
