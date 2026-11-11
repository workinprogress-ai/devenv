// harness/canary-fetch.ts — fetch canary, preloaded with `node --import` into
// every node process a test spawns (and called directly in the test worker).
//
// A regular test run must never reach a real provider host. Loopback and data:
// URLs stay allowed (local fixtures); any other request is recorded in the
// canary log and rejected, so the test that escaped fails loudly.
import { appendFileSync } from "node:fs";

const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

const INSTALLED = Symbol.for("devenv.test.fetchCanary");

export function installFetchCanary(logPath: string): void {
  const real = globalThis.fetch;
  if (typeof real !== "function") return;
  if ((real as unknown as Record<symbol, unknown>)[INSTALLED] === true) return;
  const guarded: typeof fetch = (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : (input as Request).url;
    let blocked = true;
    try {
      const parsed = new URL(url);
      blocked = parsed.protocol !== "data:" && !LOOPBACK.has(parsed.hostname);
    } catch {
      blocked = true;
    }
    if (!blocked) return real(input, init);
    try {
      appendFileSync(logPath, `fetch ${url}\n`);
    } catch {
      // the rejection below still fails the call even when the log cannot be written
    }
    return Promise.reject(
      new TypeError(`devenv test canary: fetch to ${url} was not mocked — the regular test run must not reach a network host`),
    );
  };
  (guarded as unknown as Record<symbol, unknown>)[INSTALLED] = true;
  globalThis.fetch = guarded;
}

const logPath = process.env["DEVENV_TEST_CANARY_LOG"];
if (logPath !== undefined && logPath !== "") installFetchCanary(logPath);
