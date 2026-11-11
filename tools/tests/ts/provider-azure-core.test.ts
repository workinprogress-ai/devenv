// Port of tools/tests/lib/test_provider_azure_core.bats (13 tests): the azure
// provider foundation — PAT file lifecycle (auth module), config-driven
// provider detection, and key-update-azure. All credential tests run against
// a temp PAT file (AZURE_PAT_FILE override) — nothing here reads or writes
// the user's real devenv config area.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const ROOT = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))));
const TOOLS = join(ROOT, "tools");

let TMP = "";
let PAT_FILE = "";
let DEVENV_ROOT = "";

// The azure libs preamble: core sourced, azure selected, auth loaded.
const LIBS = `source '${TOOLS}/lib/providers/provider-core.bash'; PROVIDER_NAME=azure; provider_load auth`;

beforeEach(() => {
  TMP = mkdtempSync(join(tmpdir(), `azcore-${Date.now()}-${Math.random().toString(36).slice(2)}`));
  DEVENV_ROOT = join(TMP, "devenv-root");
  mkdirSync(DEVENV_ROOT, { recursive: true });
  PAT_FILE = join(TMP, "azure.pat");
});

function azureBash(script: string, env: Record<string, string> = {}): { status: number; out: string } {
  const r = spawnSync("bash", ["-c", script], {
    encoding: "utf8",
    env: {
      ...process.env,
      STUB_CALL_LOG: join(TMP, "stub-calls.log"),
      DEVENV_TOOLS: TOOLS,
      DEVENV_ROOT,
      AZURE_PAT_FILE: PAT_FILE,
      ...env,
    },
  });
  return { status: r.status ?? 1, out: (r.stdout ?? "") + (r.stderr ?? "") };
}

// ===========================================================================
// PAT file lifecycle
// ===========================================================================

describe("azure PAT file lifecycle", () => {
  it("azure auth: import creates 0600 PAT file and token impl reads it back", () => {
    const w = azureBash(`${LIBS}\nprintf 'my-azure-pat-abc123' | provider_auth_import_token_impl`);
    expect(w.status).toBe(0);
    expect(existsSync(PAT_FILE)).toBe(true);
    expect((readFileSync(PAT_FILE, "utf8"), spawnSync("stat", ["-c", "%a", PAT_FILE], { encoding: "utf8" }).stdout ?? "").trim()).toBe("600");
    const r = azureBash(`${LIBS}\nprovider_auth_token_impl`);
    expect(r.status).toBe(0);
    expect(r.out.trim()).toBe("my-azure-pat-abc123");
  });

  it("azure auth: import refuses an empty token", () => {
    const r = azureBash(`${LIBS}\nprintf '' | provider_auth_import_token_impl`);
    expect(r.status).not.toBe(0);
    expect(existsSync(PAT_FILE)).toBe(false);
  });

  it("azure auth: token impl refuses a PAT file with loose mode", () => {
    writeFileSync(PAT_FILE, "pat\n");
    chmodSync(PAT_FILE, 0o644);
    const r = azureBash(`${LIBS}\nprovider_auth_token_impl`);
    expect(r.status).not.toBe(0);
    expect(r.out).toContain("expected 600");
    expect(r.out).toContain("chmod 600");
  });

  it("azure auth: status succeeds with valid file, fails without", () => {
    const absent = azureBash(`${LIBS}\nprovider_auth_status_impl`);
    expect(absent.status).not.toBe(0);
    const present = azureBash(`${LIBS}\nprintf 'pat\\n' | provider_auth_import_token_impl && provider_auth_status_impl`);
    expect(present.status).toBe(0);
  });
});

// ===========================================================================
// Provider detection via devenv.config
// ===========================================================================

describe("provider detection via devenv.config", () => {
  it("provider_detect selects azure from [provider] name=azure", () => {
    writeFileSync(join(DEVENV_ROOT, "devenv.config"), "[provider]\nname=azure\nazure_org=myorg\nazure_project=myproj\n");
    const r = azureBash(
      `source '${TOOLS}/lib/providers/provider-core.bash'\nprovider_detect\necho "DETECTED=$PROVIDER_NAME"`,
    );
    expect(r.status).toBe(0);
    expect(r.out.trim()).toMatch(/DETECTED=azure$/);
  });

  it("provider_detect defaults to github when no provider key", () => {
    writeFileSync(join(DEVENV_ROOT, "devenv.config"), "[organization]\nname=test\n");
    const r = azureBash(
      `source '${TOOLS}/lib/providers/provider-core.bash'\nprovider_detect\necho "DETECTED=\${PROVIDER_NAME:-none}"`,
    );
    expect(r.status).toBe(0);
    expect(r.out.trim()).toMatch(/DETECTED=github$/);
  });

  it("provider_load skips absent azure domain modules with a warning (fails defined)", () => {
    // prs is now a TS twin (azure/prs.ts) — absent bash modules must
    // warn-and-skip, never crash; an actually-absent module exercises that,
    // and the prs twin surface is covered by its own suite.
    writeFileSync(join(DEVENV_ROOT, "devenv.config"), "[provider]\nname=azure\n");
    const r = azureBash(
      `source '${TOOLS}/lib/providers/provider-core.bash'\nprovider_detect\nprovider_load prs\ndeclare -F provider_prs_list >/dev/null && echo IMPLEMENTED || echo ABSENT`,
    );
    expect(r.status).toBe(0);
    expect(r.out).toContain("WARN");
    expect(r.out).toContain("ABSENT");
  });

  it("azure auth module is discoverable by provider_load auth", () => {
    writeFileSync(join(DEVENV_ROOT, "devenv.config"), "[provider]\nname=azure\n");
    const r = azureBash(
      `source '${TOOLS}/lib/providers/provider-core.bash'\nprovider_detect\nprovider_load auth\ndeclare -F provider_auth_token_impl >/dev/null && echo LOADED`,
    );
    expect(r.status).toBe(0);
    expect(r.out.trim()).toBe("LOADED");
  });
});

// ===========================================================================
// key-update-azure
// ===========================================================================

describe("key-update-azure", () => {
  const KEY_UPDATE = join(TOOLS, "lib/providers/azure/key-update.ts");
  const keyUpdateRun = (args: string[], input?: string) => {
    // The rotation also re-wires the NuGet source through dotnet: a stub on
    // PATH and a scratch HOME keep it off the real sources and dotfiles.
    const scratch = mkdtempSync(join(tmpdir(), "key-update-azure-"));
    mkdirSync(join(scratch, "bin"));
    writeFileSync(join(scratch, "bin", "dotnet"), "#!/usr/bin/env bash\nexit 0\n");
    chmodSync(join(scratch, "bin", "dotnet"), 0o755);
    const r = spawnSync("node", [KEY_UPDATE, ...args], {
      encoding: "utf8",
      input: input ?? "",
      env: {
        ...process.env,
        DEVENV_ROOT,
        AZURE_PAT_FILE: PAT_FILE,
        HOME: scratch,
        PATH: `${join(scratch, "bin")}:${process.env.PATH ?? ""}`,
      },
    });
    return { status: r.status, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
  };

  it("--help explains usage and never prompts", () => {
    const r = keyUpdateRun(["--help"]);
    expect(r.status).toBe(0);
    expect(r.out).toContain("Usage: key-update-azure");
    expect(r.out).toContain("Azure DevOps personal access token");
  });

  it("stores a token piped on stdin", () => {
    const r = keyUpdateRun([], "stdin-pat-xyz\n");
    expect(r.status).toBe(0);
    expect(existsSync(PAT_FILE)).toBe(true);
    expect(spawnSync("stat", ["-c", "%a", PAT_FILE], { encoding: "utf8" }).stdout?.trim()).toBe("600");
    expect(readFileSync(PAT_FILE, "utf8")).toContain("stdin-pat-xyz");
  });

  it("refuses a token passed as an argument and stores nothing", () => {
    const r = keyUpdateRun(["arg-pat-xyz"]);
    expect(r.status).not.toBe(0);
    expect(r.out).toContain("stdin");
    expect(existsSync(PAT_FILE)).toBe(false);
  });

  it("rejects an empty token", () => {
    const r = keyUpdateRun([]);
    expect(r.status).not.toBe(0);
  });
});

describe("azure releases projection", () => {
  it("provider_org_releases_list emits one JSON array and honors --json", async () => {
    // The releases projection is TS now (azure/org.ts orgReleasesList over
    // the http.ts transport): stub the fetch layer by pointing the module at
    // a stub http module via a fetch-spy harness — the transport contract
    // (one JSON array, projected fields, newest first) is identical.
    const { orgReleasesList } = await import(join(TOOLS, "lib/providers/azure/org.ts"));
    // The transport resolves the credential before any fetch: supply the
    // env PAT leg (never a URL rider — asserted below).
    process.env.AZURE_PAT = "test-pat";
    const tags = [
      { name: "refs/tags/v1.0.0", objectId: "A1" },
      { name: "refs/tags/v2.0.0-beta.1", objectId: "B2" },
    ];
    const calls: string[] = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (url: string | URL) => {
      calls.push(String(url));
      return new Response(JSON.stringify({ value: tags }), { status: 200 });
    }) as typeof fetch;
    try {
      const out = await orgReleasesList("o1/p1/r1", { json: "tagName,isPrerelease" });
      const arr = JSON.parse(out);
      expect(Array.isArray(arr)).toBe(true);
      expect(arr).toHaveLength(2);
      // newest first: the 2.0.0 prerelease comes before 1.0.0
      expect(arr[0].tagName).toBe("v2.0.0-beta.1");
      expect(arr[0].isPrerelease).toBe(true);
      expect(arr[1].tagName).toBe("v1.0.0");
      expect(arr[1].isPrerelease).toBe(false);
      // projection keeps exactly the requested fields
      expect(Object.keys(arr[0]).sort()).toEqual(["isPrerelease", "tagName"]);
      // the PAT never rides the URL
      expect(calls.every((u) => !u.includes("test-pat"))).toBe(true);
    } finally {
      globalThis.fetch = realFetch;
      delete process.env.AZURE_PAT;
    }
  });
});
