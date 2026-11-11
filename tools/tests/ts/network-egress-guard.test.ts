// The no-network canary guards `fetch`, so regular tool and library code must use
// fetch for network access: a direct node:http/https/net/tls/dgram or undici
// client would bypass the guard silently. Only the provider smoke suites, which
// exist to exercise a live backend, may use another transport.
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const SCANNED = ["tools/ts", "tools/lib", "tools/internal"];
const DIRECT_NETWORK = /(?:from|import|require)\s*\(?\s*["'](?:node:)?(?:http|https|http2|net|tls|dgram|undici|ws)["']/;

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return sources(p);
    return name.endsWith(".ts") ? [p] : [];
  });
}

describe("regular code reaches the network only through fetch", () => {
  it("no tool or library imports a direct network client", () => {
    const offenders = SCANNED.flatMap((d) => sources(join(REPO_ROOT, d)))
      .filter((p) => !/[\\/]smoke\.ts$/.test(p))
      .filter((p) => DIRECT_NETWORK.test(readFileSync(p, "utf8")))
      .map((p) => relative(REPO_ROOT, p));
    expect(offenders).toEqual([]);
  });

  it("the pattern recognises the clients it is meant to forbid", () => {
    for (const line of ['import https from "node:https";', 'import { request } from "http";', 'const net = require("node:net");', 'import { fetch } from "undici";']) {
      expect(DIRECT_NETWORK.test(line), line).toBe(true);
    }
    expect(DIRECT_NETWORK.test('import WebSocket from "ws";')).toBe(true);
    expect(DIRECT_NETWORK.test('const r = await fetch("https://example.test");')).toBe(false);
    expect(DIRECT_NETWORK.test('const fileKind = "ws";')).toBe(false);
  });
});
