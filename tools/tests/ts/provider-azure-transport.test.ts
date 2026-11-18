// Azure transport and boards: the default team comes from the project's own
// `defaultTeam` (one request per process and project), Retry-After is
// validated and capped, the failure wording names the cause, and the PAT
// rotation script passes paths as positional parameters and flags a stale
// AZURE_PAT. Azure HTTP is the stubbed global fetch; nothing leaves the
// process.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { canaryEnv } from "./harness/canary.ts";
import { rmrf, tmpDir } from "./harness/index.ts";

const LIB = join(import.meta.dirname, "../../lib");

let root = "";
let requests: Array<{ method: string; url: string }> = [];
let responder: (url: string, method: string) => Response = () => new Response("{}", { status: 200 });

beforeEach(() => {
  root = tmpDir("az-transport");
  requests = [];
  writeFileSync(join(root, "devenv.config"), "[provider]\nname=azure\n");
  process.env.DEVENV_ROOT = root;
  process.env.AZURE_DEVOPS_ORG = "test-org";
  process.env.AZURE_DEVOPS_PROJECT = "test-project";
  process.env.AZURE_PAT = "SECRETPAT123";
  vi.stubGlobal("fetch", async (url: string | URL | Request, init?: RequestInit) => {
    const method = String(init?.method ?? "GET");
    requests.push({ method, url: String(url) });
    return responder(String(url), method);
  });
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  rmrf(root);
  delete process.env.DEVENV_ROOT;
  delete process.env.AZURE_DEVOPS_ORG;
  delete process.env.AZURE_DEVOPS_PROJECT;
  delete process.env.AZURE_PAT;
});

const json = (body: unknown, init: ResponseInit = { status: 200 }): Response => new Response(JSON.stringify(body), init);

describe("azure boards default team", () => {
  it("uses the project's defaultTeam and fetches it once for two board verbs", async () => {
    responder = (url) => {
      if (url.includes("/_apis/projects/")) {
        return json({ id: "proj-guid", defaultTeam: { id: "team-default" } });
      }
      return json({ value: [{ id: "board-1", name: "Stories" }] });
    };
    const az = await import("../../lib/providers/azure/projects.ts");
    await az.projectsList("");
    expect(await az.projectsIdByName("o", "Stories")).toBe("board-1");

    const projectGets = requests.filter((r) => r.url.includes("/_apis/projects/"));
    expect(projectGets).toHaveLength(1);
    expect(projectGets[0]?.url).toContain("includeCapabilities=true");
    expect(requests.some((r) => r.url.includes("/teams"))).toBe(false);
    const boards = requests.filter((r) => r.url.includes("/_apis/work/boards"));
    expect(boards).toHaveLength(2);
    for (const b of boards) expect(b.url).toContain("/test-project/team-default/_apis/work/boards");
  });

  it("a project without a default team is a named error, never an empty route segment", async () => {
    responder = (url) => (url.includes("/_apis/projects/") ? json({ id: "proj-guid" }) : json({ value: [] }));
    const az = await import("../../lib/providers/azure/projects.ts");
    await expect(az.projectsList("")).rejects.toThrow(/no default team/);
    expect(requests.some((r) => r.url.includes("/_apis/work/boards"))).toBe(false);
  });
});

describe("azure Retry-After", () => {
  it("retryAfterMs validates and caps the header", async () => {
    const { retryAfterMs } = await import("../../lib/providers/azure/http.ts");
    expect(retryAfterMs("5")).toBe(5000);
    expect(retryAfterMs("0")).toBe(0);
    expect(retryAfterMs("99999")).toBe(60_000);
    expect(retryAfterMs("abc")).toBeNull();
    expect(retryAfterMs("-3")).toBeNull();
    expect(retryAfterMs("1.5")).toBeNull();
    expect(retryAfterMs("")).toBeNull();
    expect(retryAfterMs(null)).toBeNull();
  });

  async function delaysFor(retryAfter: string | null): Promise<number[]> {
    const delays: number[] = [];
    vi.spyOn(globalThis, "setTimeout").mockImplementation(((fn: () => void, ms?: number) => {
      delays.push(ms ?? 0);
      fn();
      return 0 as unknown as NodeJS.Timeout;
    }) as typeof setTimeout);
    let calls = 0;
    responder = () => {
      calls += 1;
      if (calls === 1) {
        return new Response("slow down", {
          status: 429,
          headers: retryAfter === null ? {} : { "Retry-After": retryAfter },
        });
      }
      return json({ ok: true });
    };
    const { azureHttp } = await import("../../lib/providers/azure/http.ts");
    await azureHttp("GET", "https://dev.azure.com/test-org/_apis/x");
    return delays;
  }

  it("a garbage Retry-After falls back to the backoff (no NaN sleep)", async () => {
    expect(await delaysFor("abc")).toEqual([2000]);
  });

  it("an hour-long Retry-After is capped at 60 s", async () => {
    expect(await delaysFor("3600")).toEqual([60_000]);
  });

  it("a sane Retry-After is honoured", async () => {
    expect(await delaysFor("7")).toEqual([7000]);
  });
});

describe("azure failure wording", () => {
  it("a non-retryable POST 5xx says it was not retried (no 'gave up after N attempts')", async () => {
    responder = () => new Response("boom", { status: 500 });
    const { azureHttp } = await import("../../lib/providers/azure/http.ts");
    const err = await azureHttp("POST", "https://dev.azure.com/test-org/_apis/x", { body: "{}" }).catch((e: unknown) => e);
    expect(String((err as Error).message)).toMatch(/not retried/);
    expect(String((err as Error).message)).not.toMatch(/gave up after/);
    expect(requests).toHaveLength(1);
  });

  it("a retried GET that keeps failing says it gave up after its attempts", async () => {
    vi.spyOn(globalThis, "setTimeout").mockImplementation(((fn: () => void) => {
      fn();
      return 0 as unknown as NodeJS.Timeout;
    }) as typeof setTimeout);
    responder = () => new Response("boom", { status: 503 });
    const { azureHttp } = await import("../../lib/providers/azure/http.ts");
    const err = await azureHttp("GET", "https://dev.azure.com/test-org/_apis/x").catch((e: unknown) => e);
    expect(String((err as Error).message)).toMatch(/gave up after \d+ attempt/);
  });
});

describe("key-update-azure", () => {
  /** A fixture checkout (a copy of tools/lib) under a directory whose name
   * holds a single quote, with recording stand-ins for the setup step modules. */
  function fixtureCheckout(): { script: string; log: string; checkout: string } {
    const checkout = join(root, "it's a checkout");
    mkdirSync(join(checkout, "tools"), { recursive: true });
    cpSync(LIB, join(checkout, "tools", "lib"), { recursive: true });
    const log = join(root, "bash.log");
    // Recording stand-ins for the TS npmrc and nuget-sources step modules.
    mkdirSync(join(checkout, "tools", "ts", "setup-steps"), { recursive: true });
    for (const step of ["npmrc", "nuget"]) {
      const module = step === "npmrc" ? "npmrc.ts" : "nuget-sources.ts";
      writeFileSync(
        join(checkout, "tools", "ts", "setup-steps", module),
        [
          `import { appendFileSync } from "node:fs";`,
          `appendFileSync(${JSON.stringify(log)}, "${step}-step root=" + process.env.DEVENV_TOOLBOX_ROOT + "\\n");`,
          `process.exit(process.env.${step.toUpperCase()}_STEP_FAIL === "1" ? 1 : 0);`,
          "",
        ].join("\n"),
      );
    }
    return { script: join(checkout, "tools", "lib", "providers", "azure", "key-update.ts"), log, checkout };
  }

  const FETCH_PRELOAD = fileURLToPath(new URL("./harness/azure-fetch-preload.ts", import.meta.url));

  /** Rotate with a scripted answer for the token check (default: valid). The
   * check's requests are in `requests`. */
  function rotate(
    env: Record<string, string>,
    opts: { stub?: string; input?: string } = {},
  ): { status: number; output: string; log: string; requests: string[] } {
    const { script, log } = fixtureCheckout();
    const home = join(root, "home");
    mkdirSync(home, { recursive: true });
    const stubLog = join(root, "stub-requests.log");
    const base = canaryEnv();
    const r = spawnSync(process.execPath, [script], {
      input: opts.input ?? `${"n".repeat(52)}\n`,
      encoding: "utf8",
      env: {
        ...process.env,
        ...base,
        NODE_OPTIONS: `${base["NODE_OPTIONS"] ?? ""} --import ${FETCH_PRELOAD}`.trim(),
        AZURE_STUB_MODE: opts.stub ?? "200",
        AZURE_STUB_LOG: stubLog,
        AZURE_DEVOPS_ORG: "test-org",
        HOME: home,
        AZURE_PAT: "",
        AZURE_PAT_FILE: join(home, ".keys", "azure-devops-pat"),
        ...env,
      },
    });
    return {
      status: r.status ?? 1,
      output: `${r.stdout ?? ""}${r.stderr ?? ""}`,
      log: existsSync(log) ? readFileSync(log, "utf8") : "",
      requests: existsSync(stubLog) ? readFileSync(stubLog, "utf8").split("\n").filter(Boolean) : [],
    };
  }

  const patPath = () => join(root, "home", ".keys", "azure-devops-pat");
  function seedPat(content: string): void {
    mkdirSync(join(root, "home", ".keys"), { recursive: true });
    writeFileSync(patPath(), content, { mode: 0o600 });
  }

  it("checks the new token against connectionData before storing it", () => {
    const r = rotate({});
    expect(r.status).toBe(0);
    expect(r.requests).toEqual(["GET https://dev.azure.com/test-org/_apis/connectionData?api-version=7.1-preview"]);
    expect(readFileSync(patPath(), "utf8")).toBe(`${"n".repeat(52)}\n`);
  });

  it.each(["401", "403", "203", "302"])("a token answered %s is rejected and the stored PAT is kept", (status) => {
    seedPat("old-working-token\n");
    const r = rotate({}, { stub: status });
    expect(r.status).not.toBe(0);
    expect(r.output).toMatch(/rejected/i);
    expect(readFileSync(patPath(), "utf8")).toBe("old-working-token\n");
  });

  it.each(["500", "503", "429", "407", "network"])("an unverifiable check (%s) warns and still stores the token", (status) => {
    const r = rotate({}, { stub: status });
    expect(r.status).toBe(0);
    expect(r.output).toMatch(/could not verify/i);
    expect(readFileSync(patPath(), "utf8")).toBe(`${"n".repeat(52)}\n`);
  });

  it("skips the check with a warning when no organization is configured", () => {
    const r = rotate({ AZURE_DEVOPS_ORG: "" });
    expect(r.status).toBe(0);
    expect(r.requests).toEqual([]);
    expect(r.output).toMatch(/organization/i);
  });

  it("replaces the PAT file atomically with mode 0600 and leaves no temp file", () => {
    seedPat("old-token\n");
    const before = statSync(patPath()).ino;
    const r = rotate({});
    expect(r.status).toBe(0);
    expect(statSync(patPath()).ino).not.toBe(before);
    expect((statSync(patPath()).mode & 0o777).toString(8)).toBe("600");
    expect(readdirSync(join(root, "home", ".keys"))).toEqual(["azure-devops-pat"]);
  });

  it("rotates the target of a symlinked PAT file and keeps the link", () => {
    const real = join(root, "managed-pat");
    writeFileSync(real, "old-token\n", { mode: 0o600 });
    mkdirSync(join(root, "home", ".keys"), { recursive: true });
    symlinkSync(real, patPath());
    const r = rotate({});
    expect(r.status).toBe(0);
    expect(lstatSync(patPath()).isSymbolicLink()).toBe(true);
    expect(readFileSync(real, "utf8")).toBe(`${"n".repeat(52)}\n`);
  });

  it("creates the key directory private (0700)", () => {
    const r = rotate({});
    expect(r.status).toBe(0);
    expect((statSync(join(root, "home", ".keys")).mode & 0o777).toString(8)).toBe("700");
  });

  it("reports a failed git helper wiring and exits non-zero", () => {
    const r = rotate({ GIT_CONFIG_GLOBAL: join(root, "home") });
    expect(r.output).toContain("git credential helper wiring failed");
    expect(r.status).toBe(1);
    expect(existsSync(patPath())).toBe(true);
  });

  it("runs the wiring with a tools root holding a quote (passed as a path, not interpolated)", () => {
    const r = rotate({});
    expect(r.output).not.toContain("syntax error");
    expect(r.status).toBe(0);
    expect(readFileSync(join(root, "home", ".gitconfig"), "utf8")).toContain("credential-helper.sh'");
    expect(r.log).toContain("npmrc-step root=" + join(root, "it's a checkout"));
    expect(r.log).toContain("nuget-step root=" + join(root, "it's a checkout"));
  });

  it("a failing npm step warns and exits non-zero without undoing the rotation", () => {
    const r = rotate({ NPMRC_STEP_FAIL: "1" });
    expect(r.output).toContain("npm feed re-wiring failed");
    expect(r.status).toBe(1);
    expect(existsSync(join(root, "home", ".keys", "azure-devops-pat"))).toBe(true);
  });

  it("a failing nuget step warns and exits non-zero without undoing the rotation", () => {
    const r = rotate({ NUGET_STEP_FAIL: "1" });
    expect(r.output).toContain("NuGet feed re-wiring failed");
    expect(r.status).toBe(1);
    expect(existsSync(join(root, "home", ".keys", "azure-devops-pat"))).toBe(true);
  });

  it("warns when a stale AZURE_PAT in the environment differs from the new token", () => {
    const r = rotate({ AZURE_PAT: "stale-token-value" });
    expect(r.output).toMatch(/AZURE_PAT is set .* differs from the new token/);
  });

  it("does not warn when AZURE_PAT is unset or already equals the new token", () => {
    expect(rotate({}).output).not.toMatch(/AZURE_PAT is set/);
    expect(rotate({ AZURE_PAT: "n".repeat(52) }).output).not.toMatch(/AZURE_PAT is set/);
  });
});

describe("azure host guard", () => {
  it.each([
    "https://dev.azure.com/org/proj",
    "https://dev.azure.com",
    "https://DEV.AZURE.COM/org",
    "https://dev.azure.com:443/org",
    "https://vsblob.dev.azure.com/org/x",
    "https://org.visualstudio.com/proj",
    "https://dev.azure.com/org/proj/_apis/build?x=1#frag",
  ])("accepts %s", async (url) => {
    const { azureUrlIsProviderHost } = await import("../../lib/providers/azure/http.ts");
    expect(azureUrlIsProviderHost(url)).toBe(true);
  });

  it.each([
    "http://dev.azure.com/org/proj",
    "https://evil.example/x",
    "https://evil.example?x@dev.azure.com/p",
    "https://evil.example#@dev.azure.com/p",
    "https://evil.example\\@dev.azure.com/p",
    "https://evil.example\\.dev.azure.com/p",
    "https://dev.azure.com@evil.example/p",
    "https://user:pw@dev.azure.com/p",
    "https://dev.azure.com:8443/p",
    "https://dev.azure.com.evil.example/p",
    "https://notdev.azure.com/p",
    "https://evilvisualstudio.com/p",
    "https://visualstudio.com/p",
    "ftp://dev.azure.com/p",
    "//dev.azure.com/p",
    "dev.azure.com/p",
    "",
  ])("rejects %s", async (url) => {
    const { azureUrlIsProviderHost } = await import("../../lib/providers/azure/http.ts");
    expect(azureUrlIsProviderHost(url)).toBe(false);
  });

  it("never sends the PAT to a bypass URL on download", async () => {
    const { azureHttpDownload } = await import("../../lib/providers/azure/http.ts");
    await expect(
      azureHttpDownload("https://evil.example?x@dev.azure.com/p", join(root, "out.zip")),
    ).rejects.toThrow(/outside Azure DevOps/);
    expect(requests).toEqual([]);
    expect(existsSync(join(root, "out.zip"))).toBe(false);
  });
});

describe("azure empty 2xx bodies", () => {
  const noContent = (headers: Record<string, string> = {}) => new Response(null, { status: 204, headers });

  it("returns the plain call's undefined body for an empty response", async () => {
    responder = () => noContent();
    const { azureHttp } = await import("../../lib/providers/azure/http.ts");
    await expect(azureHttp("DELETE", "https://dev.azure.com/o/p/_apis/x/1")).resolves.toBeUndefined();
  });

  it("keeps the headers envelope when withHeaders is asked for", async () => {
    responder = () => noContent({ "x-ms-continuationtoken": "tok" });
    const { azureHttp } = await import("../../lib/providers/azure/http.ts");
    const r = await azureHttp<unknown>("GET", "https://dev.azure.com/o/p/_apis/x", { withHeaders: true });
    expect(r.body).toBeUndefined();
    expect(r.headers["x-ms-continuationtoken"]).toBe("tok");
  });

  it("paginates through an empty last page instead of throwing", async () => {
    responder = (url) =>
      url.includes("continuationToken=")
        ? noContent()
        : new Response(JSON.stringify({ value: [1, 2] }), {
            status: 200,
            headers: { "x-ms-continuationtoken": "next" },
          });
    const { azureHttpPaginate } = await import("../../lib/providers/azure/http.ts");
    await expect(azureHttpPaginate("https://dev.azure.com/o/p/_apis/x")).resolves.toEqual([1, 2]);
  });

  it("lists nothing for an entirely empty list endpoint", async () => {
    responder = () => noContent();
    const { azureHttpPaginate } = await import("../../lib/providers/azure/http.ts");
    await expect(azureHttpPaginate("https://dev.azure.com/o/p/_apis/x")).resolves.toEqual([]);
  });

  it("prsList treats an empty page as no pull requests", async () => {
    responder = () => noContent();
    const { prsList } = await import("../../lib/providers/azure/prs.ts");
    await expect(prsList("widgets")).resolves.toEqual([]);
  });
});

describe("azure credential encoding and redaction", () => {
  const b64 = (pat: string) => Buffer.from(`:${pat}`).toString("base64");

  function authHeaderSeen(): () => string {
    let seen = "";
    vi.stubGlobal("fetch", async (_url: string | URL | Request, init?: RequestInit) => {
      seen = String((init?.headers as Record<string, string>).Authorization);
      return new Response("{}", { status: 200 });
    });
    return () => seen;
  }

  it("encodes a PAT with characters beyond Latin-1 instead of throwing", async () => {
    process.env.AZURE_PAT = "abc​def";
    const seen = authHeaderSeen();
    const { azureHttp } = await import("../../lib/providers/azure/http.ts");
    await azureHttp("GET", "https://dev.azure.com/o/p/_apis/x");
    expect(seen()).toBe(`Basic ${b64("abc​def")}`);
  });

  it("strips a byte-order mark from a PAT file", async () => {
    delete process.env.AZURE_PAT;
    const file = join(root, "pat");
    writeFileSync(file, "﻿file-token\r\n", { mode: 0o600 });
    process.env.AZURE_PAT_FILE = file;
    const { azurePatGet } = await import("../../lib/providers/azure/http.ts");
    try {
      expect(azurePatGet()).toBe("file-token");
    } finally {
      delete process.env.AZURE_PAT_FILE;
    }
  });

  it("redacts the base64 form of the PAT wherever it appears", async () => {
    const { azureRedact } = await import("../../lib/providers/azure/http.ts");
    const out = azureRedact(`header was ${b64("SECRETPAT123")} in a log line`);
    expect(out).not.toContain(b64("SECRETPAT123"));
    expect(out).toContain("***REDACTED***");
  });

  it("redacts the PAT out of a connection-failure message", async () => {
    vi.stubGlobal("fetch", async () => {
      throw new Error("connect failed: SECRETPAT123 rejected");
    });
    const { azureHttp } = await import("../../lib/providers/azure/http.ts");
    const err = await azureHttp("POST", "https://dev.azure.com/o/p/_apis/x", { body: "{}" }).catch((e: unknown) => e as Error);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).not.toContain("SECRETPAT123");
  });
});

describe("azure request timeouts", () => {
  it("gives every JSON request an abort signal", async () => {
    let signal: AbortSignal | null | undefined;
    vi.stubGlobal("fetch", async (_url: string | URL | Request, init?: RequestInit) => {
      signal = init?.signal;
      return new Response("{}", { status: 200 });
    });
    const { azureHttp } = await import("../../lib/providers/azure/http.ts");
    await azureHttp("GET", "https://dev.azure.com/o/p/_apis/x");
    expect(signal).toBeInstanceOf(AbortSignal);
  });

  it("reports a timed-out request as a timeout, not a generic failure", async () => {
    vi.stubGlobal("fetch", async () => {
      throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
    });
    const { azureHttp } = await import("../../lib/providers/azure/http.ts");
    const err = await azureHttp("POST", "https://dev.azure.com/o/p/_apis/x", { body: "{}" }).catch((e: unknown) => e as Error);
    expect((err as Error).message).toMatch(/timed out after 30s/);
  });

  it("gives a download an abort signal and a longer limit", async () => {
    let signal: AbortSignal | null | undefined;
    vi.stubGlobal("fetch", async (_url: string | URL | Request, init?: RequestInit) => {
      signal = init?.signal;
      return new Response("zip", { status: 200 });
    });
    const { azureHttpDownload, AZURE_DOWNLOAD_TIMEOUT_MS, AZURE_HTTP_TIMEOUT_MS } = await import("../../lib/providers/azure/http.ts");
    await azureHttpDownload("https://dev.azure.com/o/p/_apis/x", join(root, "a.zip"));
    expect(signal).toBeInstanceOf(AbortSignal);
    expect(AZURE_HTTP_TIMEOUT_MS).toBe(30_000);
    expect(AZURE_DOWNLOAD_TIMEOUT_MS).toBe(300_000);
  });

  it("bounds the setup token check's curl", () => {
    const text = readFileSync(join(LIB, "providers/azure/setup.bash"), "utf8");
    expect(text).toMatch(/curl[^\n]*--connect-timeout 5 --max-time 15/);
  });
});

describe("azure DELETE retries", () => {
  function instantSleep(): void {
    vi.spyOn(globalThis, "setTimeout").mockImplementation(((fn: () => void) => {
      fn();
      return 0 as unknown as NodeJS.Timeout;
    }) as typeof setTimeout);
  }
  const URL_X = "https://dev.azure.com/o/p/_apis/x/1";
  const notFound = () => new Response(JSON.stringify({ message: "gone" }), { status: 404 });

  function sequence(...answers: Array<() => Response | Error>): void {
    let i = 0;
    vi.stubGlobal("fetch", async () => {
      const next = answers[Math.min(i++, answers.length - 1)] as () => Response | Error;
      const r = next();
      if (r instanceof Error) throw r;
      return r;
    });
  }

  it("counts a 404 after a failed attempt as success (the first attempt took effect)", async () => {
    instantSleep();
    sequence(() => new Response("{}", { status: 503 }), notFound);
    const { azureHttp } = await import("../../lib/providers/azure/http.ts");
    await expect(azureHttp("DELETE", URL_X)).resolves.toBeUndefined();
  });

  it("counts a 404 after a lost connection as success", async () => {
    instantSleep();
    sequence(() => new Error("socket hang up"), notFound);
    const { azureHttp } = await import("../../lib/providers/azure/http.ts");
    await expect(azureHttp("DELETE", URL_X)).resolves.toBeUndefined();
  });

  it("keeps a first-attempt 404 an error", async () => {
    sequence(notFound);
    const { azureHttp } = await import("../../lib/providers/azure/http.ts");
    await expect(azureHttp("DELETE", URL_X)).rejects.toThrow(/gone/);
  });

  it("keeps a 404 after a 429 an error (a 429 never acted)", async () => {
    instantSleep();
    sequence(() => new Response("{}", { status: 429, headers: { "Retry-After": "0" } }), notFound);
    const { azureHttp } = await import("../../lib/providers/azure/http.ts");
    await expect(azureHttp("DELETE", URL_X)).rejects.toThrow(/gone/);
  });

  it("applies the rule to DELETE only", async () => {
    instantSleep();
    sequence(() => new Response("{}", { status: 503 }), notFound);
    const { azureHttp } = await import("../../lib/providers/azure/http.ts");
    await expect(azureHttp("GET", URL_X)).rejects.toThrow(/gone/);
  });
});

describe("azure Retry-After as an HTTP date", () => {
  it("waits until the date, capped at one minute", async () => {
    const { retryAfterMs } = await import("../../lib/providers/azure/http.ts");
    const soon = retryAfterMs(new Date(Date.now() + 10_000).toUTCString());
    expect(soon).toBeGreaterThan(7_000);
    expect(soon).toBeLessThanOrEqual(10_000);
    expect(retryAfterMs(new Date(Date.now() + 3_600_000).toUTCString())).toBe(60_000);
  });

  it("still rejects text that is neither seconds nor a date", async () => {
    const { retryAfterMs } = await import("../../lib/providers/azure/http.ts");
    expect(retryAfterMs("soon")).toBeNull();
    expect(retryAfterMs("2026-13-45")).toBeNull();
  });
});

describe("azureValidateToken", () => {
  function answer(status: number | "network" | "timeout"): { seen: () => { url: string; auth: string; redirect: string | undefined } } {
    let seen = { url: "", auth: "", redirect: undefined as string | undefined };
    vi.stubGlobal("fetch", async (url: string | URL | Request, init?: RequestInit) => {
      seen = {
        url: String(url),
        auth: String((init?.headers as Record<string, string>).Authorization),
        redirect: init?.redirect,
      };
      if (status === "network") throw new TypeError("fetch failed");
      if (status === "timeout") throw new DOMException("timed out", "TimeoutError");
      return new Response(null, { status });
    });
    return { seen: () => seen };
  }

  it("asks connectionData with the Basic credential and never puts the token in the URL", async () => {
    const probe = answer(200);
    const { azureValidateToken } = await import("../../lib/providers/azure/http.ts");
    await expect(azureValidateToken("acme", "SECRETPAT123")).resolves.toBe("valid");
    expect(probe.seen().url).toBe("https://dev.azure.com/acme/_apis/connectionData?api-version=7.1-preview");
    expect(probe.seen().url).not.toContain("SECRETPAT123");
    expect(probe.seen().auth).toBe(`Basic ${Buffer.from(":SECRETPAT123").toString("base64")}`);
    expect(probe.seen().redirect).toBe("manual");
  });

  it.each([401, 403, 203, 302, 400, 404, 410])("treats %i as a refusal (matches setup.bash)", async (status) => {
    answer(status);
    const { azureValidateToken } = await import("../../lib/providers/azure/http.ts");
    await expect(azureValidateToken("acme", "tok")).resolves.toBe("rejected");
  });

  it.each([429, 407, 500, 502, 503, 504, "network", "timeout"] as const)("treats %s as unverifiable", async (status) => {
    answer(status);
    const { azureValidateToken } = await import("../../lib/providers/azure/http.ts");
    await expect(azureValidateToken("acme", "tok")).resolves.toBe("unreachable");
  });

  it("refuses an empty organization or token without a request", async () => {
    const probe = answer(200);
    const { azureValidateToken } = await import("../../lib/providers/azure/http.ts");
    await expect(azureValidateToken("", "tok")).resolves.toBe("rejected");
    await expect(azureValidateToken("acme", "")).resolves.toBe("rejected");
    expect(probe.seen().url).toBe("");
  });

  it("encodes the organization into the URL path", async () => {
    const probe = answer(200);
    const { azureValidateToken } = await import("../../lib/providers/azure/http.ts");
    await azureValidateToken("my org/../x", "tok");
    expect(probe.seen().url).toBe("https://dev.azure.com/my%20org%2F..%2Fx/_apis/connectionData?api-version=7.1-preview");
  });
});

describe("azure Retry-After HTTP date in the past", () => {
  it("gives no delay so the caller backs off itself (a skewed clock cannot burn the attempts)", async () => {
    const { retryAfterMs } = await import("../../lib/providers/azure/http.ts");
    expect(retryAfterMs(new Date(Date.now() - 5_000).toUTCString())).toBeNull();
  });
});
