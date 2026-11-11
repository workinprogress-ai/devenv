// Azure transport and boards: the default team comes from the project's own
// `defaultTeam` (one request per process and project), Retry-After is
// validated and capped, the failure wording names the cause, and the PAT
// rotation script passes paths as positional parameters and flags a stale
// AZURE_PAT. Azure HTTP is the stubbed global fetch; nothing leaves the
// process.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
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
   * holds a single quote, with a recording stand-in for provider-core.bash. */
  function fixtureCheckout(): { script: string; log: string; checkout: string } {
    const checkout = join(root, "it's a checkout");
    mkdirSync(join(checkout, "tools"), { recursive: true });
    cpSync(LIB, join(checkout, "tools", "lib"), { recursive: true });
    const log = join(root, "bash.log");
    writeFileSync(
      join(checkout, "tools", "lib", "providers", "provider-core.bash"),
      [
        "provider_load() { :; }",
        `provider_auth_setup_git() { echo "setup_git" >> '${log}'; }`,
        `provider_bootstrap_call() { echo "bootstrap $*" >> '${log}'; }`,
        "",
      ].join("\n"),
    );
    // Recording stand-in for the TS nuget-sources step module.
    mkdirSync(join(checkout, "tools", "ts", "setup-steps"), { recursive: true });
    writeFileSync(
      join(checkout, "tools", "ts", "setup-steps", "nuget-sources.ts"),
      [
        `import { appendFileSync } from "node:fs";`,
        `appendFileSync(${JSON.stringify(log)}, "nuget-step root=" + process.env.DEVENV_TOOLBOX_ROOT + "\\n");`,
        `process.exit(process.env.NUGET_STEP_FAIL === "1" ? 1 : 0);`,
        "",
      ].join("\n"),
    );
    return { script: join(checkout, "tools", "lib", "providers", "azure", "key-update.ts"), log, checkout };
  }

  function rotate(env: Record<string, string>): { status: number; output: string; log: string } {
    const { script, log } = fixtureCheckout();
    const home = join(root, "home");
    mkdirSync(home, { recursive: true });
    const r = spawnSync(process.execPath, [script], {
      input: `${"n".repeat(52)}\n`,
      encoding: "utf8",
      env: {
        ...process.env,
        ...canaryEnv(),
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
    };
  }

  it("runs the wiring with a tools root holding a quote (passed as a parameter, not interpolated)", () => {
    const r = rotate({});
    expect(r.output).not.toContain("syntax error");
    expect(r.status).toBe(0);
    expect(r.log).toContain("setup_git");
    expect(r.log).toMatch(/bootstrap configure_npmrc .*\.npmrc npmrc/);
    expect(r.log).not.toContain("bootstrap configure_nuget");
    expect(r.log).toContain("nuget-step root=" + join(root, "it's a checkout"));
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
