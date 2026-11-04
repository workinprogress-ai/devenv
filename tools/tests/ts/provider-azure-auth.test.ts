// Port of tools/tests/lib/test_provider_azure_auth.bats (14 tests): Azure
// git-transport credentials — the credential helper and the
// provider_auth_setup_git seam wiring. All git-config writes happen under
// GIT_CONFIG_GLOBAL pointed at a temp file — never the executor's real global
// config. No network: the helper is exercised via `git credential fill` with a
// piped protocol query.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const ROOT = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))));
const TOOLS = join(ROOT, "tools");
const HELPER = join(TOOLS, "lib/providers/azure/credential-helper.sh");
const PAT = "azure-pat-token-abcdefghij0123456789";

let TMP = "";
let PAT_FILE = "";
let GIT_CONFIG = "";

beforeEach(() => {
  TMP = mkdtempSync(join(tmpdir(), `azauth-${Date.now()}-${Math.random().toString(36).slice(2)}`));
  PAT_FILE = join(TMP, "azure.pat");
  GIT_CONFIG = join(TMP, "gitconfig");
  writeFileSync(GIT_CONFIG, "");
  writeFileSync(PAT_FILE, PAT);
  // the helper's config starts as the github fixture; swap to azure
  const devenvRoot = join(TMP, "devenv-root");
  mkdirSync(devenvRoot, { recursive: true });
  writeFileSync(
    join(devenvRoot, "devenv.config"),
    "[provider]\nname=azure\nazure_org=test-org\nazure_project=test-proj\n[organization]\nname=t\norg=my-org\n",
  );
  chmodSync(PAT_FILE, 0o600);
});

const ENV = (extra: Record<string, string> = {}): Record<string, string> => ({
  ...process.env,
  TEST_TEMP_DIR: TMP,
  DEVENV_TOOLS: TOOLS,
  DEVENV_ROOT: join(TMP, "devenv-root"),
  AZURE_PAT_FILE: PAT_FILE,
  GIT_CONFIG_GLOBAL: GIT_CONFIG,
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_CONFIG_COUNT: "0",
  // The github.com negative probe (`git credential fill` with no matching
  // helper) must fail fast, never prompt: GIT_TERMINAL_PROMPT=0 plus a
  // no-op askpass keep VS Code's credential UI out of the test run.
  GIT_TERMINAL_PROMPT: "0",
  GIT_ASKPASS: "/bin/true",
  ...extra,
});

function bash(script: string, env: Record<string, string> = {}): { status: number; out: string } {
  const r = spawnSync("bash", ["-c", script], { encoding: "utf8", env: ENV(env) });
  return { status: r.status ?? 1, out: (r.stdout ?? "") + (r.stderr ?? "") };
}

// The setup_git preamble: core sourced, azure selected, auth loaded.
const SETUP = `source '${TOOLS}/lib/providers/provider-core.bash'\nPROVIDER_NAME=azure\nprovider_load auth\n`;

function gitCfg(args: string): { status: number; out: string } {
  const r = spawnSync("bash", ["-c", `git config ${args}`], { encoding: "utf8", env: ENV() });
  return { status: r.status ?? 1, out: (r.stdout ?? "").trim() };
}

describe("azure credential helper", () => {
  it("get emits protocol fields with the PAT", () => {
    const r = bash(
      `printf 'protocol=https\\nhost=dev.azure.com\\n\\n' | '${HELPER}' get`,
    );
    expect(r.status).toBe(0);
    expect(r.out).toContain("username=oauth");
    expect(r.out).toContain(`password=${PAT}`);
  });

  it("store/erase are refusals-by-no-op (no second copy)", () => {
    const r = bash(
      `printf 'protocol=https\\nhost=dev.azure.com\\nusername=x\\npassword=y\\n\\n' | '${HELPER}' store`,
    );
    expect(r.status).toBe(0);
    // No credential-store file may appear anywhere git would write one.
    expect(existsSync(join(TMP, ".git-credentials"))).toBe(false);
  });

  it("missing PAT file errors defined", () => {
    rmSync(PAT_FILE);
    const r = bash(`printf 'protocol=https\\nhost=dev.azure.com\\n\\n' | '${HELPER}' get`);
    expect(r.status).not.toBe(0);
    expect(r.out).toContain("PAT file not found");
  });
});

describe("provider_auth_setup_git wiring", () => {
  it("registers canonical and organization-scoped helpers", () => {
    const r = bash(`${SETUP}provider_auth_setup_git`);
    expect(r.status).toBe(0);
    const cfg = readFileSync(GIT_CONFIG, "utf8");
    // git writes URL-scoped helpers as a [credential "URL"] section.
    expect(cfg).toMatch(/credential "https:\/\/dev\.azure\.com"[\s\S]*?helper/);
    expect(cfg).toMatch(/credential "https:\/\/test-org\.visualstudio\.com"[\s\S]*?helper/);
    expect(cfg).not.toContain('credential "https://github.com"');
  });

  it("git credential fill yields the PAT for dev.azure.com and not github.com", () => {
    const fill = bash(`${SETUP}provider_auth_setup_git\nprintf 'protocol=https\\nhost=dev.azure.com\\n\\n' | git credential fill`);
    expect(fill.status).toBe(0);
    expect(fill.out).toContain(`password=${PAT}`);
    // github.com query must not resolve through the azure helper.
    const gh = spawnSync("bash", ["-c", `printf 'protocol=https\\nhost=github.com\\n\\n' | git credential fill`], {
      encoding: "utf8",
      env: ENV(),
    });
    const ghOut = (gh.stdout ?? "") + (gh.stderr ?? "");
    expect(ghOut).not.toContain("username=oauth");
    expect(ghOut).not.toContain("azure-pat-token");
  });

  it("visualstudio.com host credential query returns the synthetic PAT", () => {
    const r = bash(
      `${SETUP}provider_auth_setup_git\nprintf 'protocol=https\\nhost=test-org.visualstudio.com\\n\\n' | git credential fill`,
    );
    expect(r.status).toBe(0);
    expect(r.out).toContain("username=oauth");
    expect(r.out).toContain(`password=${PAT}`);
  });

  it("unrelated visualstudio.com hosts never receive Azure credentials", () => {
    const r = bash(
      `${SETUP}provider_auth_setup_git\n` +
      `printf 'protocol=https\\nhost=other-org.visualstudio.com\\n\\n' | git credential fill\n` +
      `printf 'protocol=https\\nhost=test-org.visualstudio.com.example.com\\n\\n' | git credential fill`,
    );
    expect(r.out).not.toContain("username=oauth");
    expect(r.out).not.toContain("azure-pat-token");
  });

  it("configured organization casing is normalized", () => {
    // rewrite azure_org in the config to a mixed-case value
    const cfgPath = join(TMP, "devenv-root/devenv.config");
    writeFileSync(
      cfgPath,
      "[provider]\nname=azure\nazure_org=MiXeD-OrG\nazure_project=test-proj\n[organization]\nname=t\norg=my-org\n",
    );
    const r = bash(
      `${SETUP}provider_auth_setup_git\ngit config --get-urlmatch credential.helper https://mixed-org.visualstudio.com/`,
    );
    expect(r.status).toBe(0);
    expect(r.out).toContain("azure/credential-helper.sh get");
  });

  it("repeated registration preserves unrelated configuration", () => {
    gitCfg("--global credential.https://example.com.username unrelated-user");
    const r = bash(`${SETUP}provider_auth_setup_git\nprovider_auth_setup_git`);
    expect(r.status).toBe(0);
    expect(gitCfg("--get-all credential.https://dev.azure.com.helper").out.split("\n").filter(Boolean).length).toBe(1);
    expect(gitCfg("--get-all credential.https://test-org.visualstudio.com.helper").out.split("\n").filter(Boolean).length).toBe(1);
    expect(gitCfg("--get credential.https://example.com.username").out).toBe("unrelated-user");
  });

  it("missing azure_org keeps canonical support and warns", () => {
    const cfgPath = join(TMP, "devenv-root/devenv.config");
    writeFileSync(
      cfgPath,
      "[provider]\nname=azure\nazure_project=test-proj\n[organization]\nname=t\norg=my-org\n",
    );
    const r = bash(`${SETUP}provider_auth_setup_git`);
    expect(r.status).toBe(0);
    expect(r.out).toContain("visualstudio.com host");
    expect(gitCfg("--get credential.https://dev.azure.com.helper").status).toBe(0);
    expect(readFileSync(GIT_CONFIG, "utf8")).not.toContain("visualstudio.com");
  });

  it("wildcard organization never broadens credential scope", () => {
    const cfgPath = join(TMP, "devenv-root/devenv.config");
    writeFileSync(
      cfgPath,
      "[provider]\nname=azure\nazure_org=test*\nazure_project=test-proj\n[organization]\nname=t\norg=my-org\n",
    );
    const r = bash(`${SETUP}provider_auth_setup_git`);
    expect(r.status).toBe(0);
    expect(r.out).toContain("invalid organization identity");
    expect(gitCfg("--get credential.https://dev.azure.com.helper").status).toBe(0);
    expect(readFileSync(GIT_CONFIG, "utf8")).not.toContain("visualstudio.com");
  });

  it("the visualstudio.com host derives from azure_org, not [organization] org", () => {
    const cfgPath = join(TMP, "devenv-root/devenv.config");
    writeFileSync(
      cfgPath,
      "[provider]\nname=azure\nazure_org=test-org\nazure_project=test-proj\n[organization]\nname=t\norg=display-org\n",
    );
    const r = bash(`${SETUP}provider_auth_setup_git`);
    expect(r.status).toBe(0);
    expect(gitCfg("--get credential.https://test-org.visualstudio.com.helper").status).toBe(0);
    expect(gitCfg("--get credential.https://display-org.visualstudio.com.helper").status).not.toBe(0);
  });
});

describe("auth import + key-update seam", () => {
  it("provider_auth_import_token wires the git credential helper after storing the PAT", () => {
    rmSync(PAT_FILE);
    const r = bash(`${SETUP}printf 'imported-pat-0123456789' | provider_auth_import_token`);
    expect(r.status).toBe(0);
    expect(spawnSync("stat", ["-c", "%a", PAT_FILE], { encoding: "utf8" }).stdout?.trim()).toBe("600");
    expect(gitCfg("--get credential.https://dev.azure.com.helper").status).toBe(0);
    expect(gitCfg("--get credential.https://test-org.visualstudio.com.helper").status).toBe(0);
  });

  it("key-update-azure leaves the git helper wiring to the credential import", () => {
    // The import verb wires the helper (see the import test above); the
    // rotation script must not wire it a second time.
    const keyUpdate = readFileSync(join(TOOLS, "lib/providers/azure/key-update.sh"), "utf8");
    expect(keyUpdate).not.toContain("provider_auth_setup_git");
  });
});
