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
    // prs is implemented for azure — absent modules must warn-and-skip, never
    // crash, but this one must actually load.
    writeFileSync(join(DEVENV_ROOT, "devenv.config"), "[provider]\nname=azure\n");
    const r = azureBash(
      `source '${TOOLS}/lib/providers/provider-core.bash'\nprovider_detect\nprovider_load prs\ndeclare -F provider_prs_list >/dev/null && echo IMPLEMENTED || echo ABSENT`,
    );
    expect(r.status).toBe(0);
    expect(r.out).toContain("IMPLEMENTED");
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
  const KEY_UPDATE = join(TOOLS, "lib/providers/azure/key-update.sh");

  it("--help explains usage and never prompts", () => {
    const r = azureBash(`bash '${KEY_UPDATE}' --help < /dev/null`);
    expect(r.status).toBe(0);
    expect(r.out).toContain("Usage: key-update-azure");
    expect(r.out).toContain("Azure DevOps personal access token");
  });

  it("stores a token piped on stdin", () => {
    const r = azureBash(`printf 'stdin-pat-xyz\\n' | bash '${KEY_UPDATE}'`);
    expect(r.status).toBe(0);
    expect(existsSync(PAT_FILE)).toBe(true);
    expect(spawnSync("stat", ["-c", "%a", PAT_FILE], { encoding: "utf8" }).stdout?.trim()).toBe("600");
    expect(readFileSync(PAT_FILE, "utf8")).toContain("stdin-pat-xyz");
  });

  it("refuses a token passed as an argument and stores nothing", () => {
    const r = azureBash(`bash '${KEY_UPDATE}' 'arg-pat-xyz' < /dev/null`);
    expect(r.status).not.toBe(0);
    expect(r.out).toContain("stdin");
    expect(existsSync(PAT_FILE)).toBe(false);
  });

  it("rejects an empty token", () => {
    const r = azureBash(`bash '${KEY_UPDATE}' < /dev/null`);
    expect(r.status).not.toBe(0);
  });
});

describe("azure releases projection", () => {
  it("provider_org_releases_list emits one JSON array and honors --json", () => {
    // minimal curl stub mirroring the fixture: -D headers + body from file
    const bin = join(TMP, "bin");
    mkdirSync(bin, { recursive: true });
    writeFileSync(
      join(bin, "curl"),
      [
        "#!/usr/bin/env bash",
        'prev=""; out_file=""; write_fmt=""; headers_file="/dev/null"',
        'for arg in "$@"; do',
        '  [[ "$prev" == "-D" ]] && headers_file="$arg"',
        '  [[ "$prev" == "-o" ]] && out_file="$arg"',
        '  [[ "$prev" == "-w" ]] && write_fmt="$arg"',
        '  prev="$arg"',
        "done",
        'for arg in "$@"; do [[ "$arg" == "@-" ]] && { cat > /dev/null; break; }; done',
        'echo "curl" >> "${STUB_CALL_LOG:?}"',
        'code="${STUB_CURL_HTTP_CODE:-200}"',
        'emit_body() { [[ -f "$1" ]] || { [[ -n "$out_file" ]] && : > "$out_file"; return 0; }; if [[ -n "$out_file" ]]; then cat "$1" > "$out_file"; else cat "$1"; fi; }',
        'emit_write_out() { [[ -n "$write_fmt" ]] || return 0; printf \'%b\' "${write_fmt//%\\{http_code\\}/$code}"; }',
        '{ printf \'HTTP/1.1 %s OK\\r\\n\\r\\n\' "$code"; } > "$headers_file"',
        'emit_body "${STUB_CURL_RESPONSE:-/nonexistent}"',
        "emit_write_out",
        "exit 0",
        "",
      ].join("\n"),
    );
    chmodSync(join(bin, "curl"), 0o755);
    writeFileSync(PAT_FILE, "test-pat\n");
    chmodSync(PAT_FILE, 0o600);
    writeFileSync(
      join(TMP, "tags.json"),
      '{"value":[{"name":"refs/tags/v1.0.0","objectId":"A1","creator":{"displayName":"Tagger"}},{"name":"refs/tags/v2.0.0-beta.1","objectId":"B2","creator":{"displayName":"Tagger"}}]}',
    );
    const r = azureBash(
      `${LIBS}; provider_load repos releases; provider_org_releases_list o1/p1/r1 --json tagName,isPrerelease`,
      {
        STUB_CALL_LOG: join(TMP, "stub-calls.log"),
        STUB_CURL_RESPONSE: join(TMP, "tags.json"),
        AZURE_DEVOPS_ORG: "o1",
        AZURE_DEVOPS_PROJECT: "p1",
        PATH: `${bin}:${process.env.PATH ?? ""}`,
      },
    );
    expect(r.status).toBe(0);
    // One JSON array; the projection keeps exactly the requested fields;
    // newest first: the 2.0.0 prerelease comes before 1.0.0.
    const ok = spawnSync(
      "jq",
      [
        "-e",
        'length == 2 and .[1].tagName == "v1.0.0" and .[1].isPrerelease == false and .[0].isPrerelease == true and (.[0] | keys | sort) == ["isPrerelease","tagName"]',
      ],
      { input: r.out, stdio: "ignore" },
    );
    expect(ok.status ?? 1).toBe(0);
  });
});
