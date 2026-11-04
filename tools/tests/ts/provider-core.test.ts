// Port of tools/tests/lib/test_provider_core.bats (30 tests) — one vitest
// `it` per source `@test`. Contract tests for provider-core.bash: detection,
// dispatch guard, auth seam, capability flags, and the error contract.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const ROOT = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))));
const TOOLS = join(ROOT, "tools");
const CORE = join(TOOLS, "lib", "providers", "provider-core.bash");

let TMP = "";
let CALL_LOG = "";
let CFG = "";

// The fixture's gh stub (scaffold tests exercise the fixture itself).
const GH_STUB = [
  "#!/usr/bin/env bash",
  'echo "gh $*" >> "${STUB_CALL_LOG:?}"',
  'if [[ "${STUB_GH_FAIL:-0}" == "1" ]]; then echo "stub-gh: simulated failure" >&2; exit 1; fi',
  'if [[ "$1" == "auth" && "${2:-}" == "token" ]]; then exit 1; fi',
  'if [[ "$1" == "api" ]]; then',
  '  [[ -f "${STUB_GH_API_RESPONSE:-/nonexistent}" ]] && cat "$STUB_GH_API_RESPONSE"',
  "  exit 0",
  "fi",
  "exit 0",
  "",
].join("\n");

beforeEach(() => {
  TMP = mkdtempSync(join(tmpdir(), `pcore-${Date.now()}-${Math.random().toString(36).slice(2)}`));
  CALL_LOG = join(TMP, "stub-calls.log");
  CFG = join(TMP, "devenv.config");
  const bin = join(TMP, "stub-bin");
  mkdirSync(bin, { recursive: true });
  writeFileSync(CALL_LOG, "");
  writeFileSync(join(bin, "gh"), GH_STUB);
  chmodSync(join(bin, "gh"), 0o755);
});


const ENV = (extra: Record<string, string> = {}): Record<string, string> => ({
  ...process.env,
  TEST_TEMP_DIR: TMP,
  DEVENV_TOOLS: TOOLS,
  STUB_CALL_LOG: CALL_LOG,
  _PROVIDER_CORE_LOADED: "",
  PROVIDER_NAME: "",
  PROVIDER_CAPABILITIES: "",
  PATH: `${join(TMP, "stub-bin")}:${process.env.PATH ?? ""}`,
  ...extra,
});

// The source suite's source_core + run as a spawn.
function coreRun(call: string, extraEnv: Record<string, string> = {}, prelude = ""): { status: number; out: string } {
  const script = `${prelude}source '${CORE}'\n${call}\n`;
  const r = spawnSync("bash", ["-c", script], { encoding: "utf8", env: ENV(extraEnv) });
  return { status: r.status ?? 1, out: (r.stdout ?? "") + (r.stderr ?? "") };
}

function writeConfig(...lines: string[]): string {
  writeFileSync(CFG, lines.join("\n") + "\n");
  return CFG;
}

describe("provider core", () => {
  // ── Scaffold ─────────────────────────────────────────────────────────────

  it("scaffold: cli-stubs fixture loads and stub_gh serves canned api response", () => {
    const api = join(TMP, "api.json");
    writeFileSync(api, '[{"id": 1, "body": "doc_id: x"}]');
    const r = coreRun('gh api "repos/o/r/issues/1/comments"', { STUB_GH_API_RESPONSE: api });
    expect(r.status).toBe(0);
    expect(r.out).toContain('"doc_id: x"');
  });

  it("scaffold: stub_gh records invocation argv to the call log", () => {
    const r = coreRun("gh issue list --state open");
    expect(r.status).toBe(0);
    const count = parseInt((spawnSync("grep", ["-c", "^gh ", CALL_LOG], { encoding: "utf8" }).stdout ?? "0").trim(), 10) || 0;
    expect(count).toBe(1);
    expect(spawnSync("grep", ["-q", "^gh issue list --state open$", CALL_LOG]).status).toBe(0);
  });

  it("scaffold: stub_gh failure mode propagates", () => {
    const r = coreRun("gh repo view", { STUB_GH_FAIL: "1" });
    expect(r.status).not.toBe(0);
  });

  it("scaffold: providers library directory exists with expected layout", () => {
    expect(existsSync(join(TOOLS, "lib", "providers"))).toBe(true);
    expect(existsSync(join(TOOLS, "lib", "providers", "README.md"))).toBe(true);
  });

  // ── Detection ────────────────────────────────────────────────────────────

  it("detect: defaults to github when no config file exists", () => {
    const r = coreRun(`provider_detect '${join(TMP, "absent.config")}'\necho "$PROVIDER_NAME"`);
    expect(r.out.trim()).toBe("github");
  });

  it("detect: reads [provider] name from devenv.config", () => {
    const cfg = writeConfig("[provider]", "name=azure");
    const r = coreRun(`provider_detect '${cfg}'\necho "$PROVIDER_NAME"`);
    expect(r.out.trim()).toBe("azure");
  });

  it("detect: defaults to github when [provider] section is absent", () => {
    const cfg = writeConfig("[organization]", "name=foo");
    const r = coreRun(`provider_detect '${cfg}'\necho "$PROVIDER_NAME"`);
    expect(r.out.trim()).toBe("github");
  });

  it("detect: defaults to github when name key is empty", () => {
    const cfg = writeConfig("[provider]", "name=");
    const r = coreRun(`provider_detect '${cfg}'\necho "$PROVIDER_NAME"`);
    expect(r.out.trim()).toBe("github");
  });

  it("detect: tolerates comments and blank lines around the key", () => {
    const cfg = writeConfig("# comment", "", "[provider]", "# name comment", "  name = github  ", "[other]", "name=wrong");
    const r = coreRun(`provider_detect '${cfg}'\necho "$PROVIDER_NAME"`);
    expect(r.out.trim()).toBe("github");
  });

  it("module_dir: returns provider module path after detection", () => {
    const r = coreRun(`provider_detect '${join(TMP, "absent.config")}'\nprovider_module_dir`);
    expect(r.out.trim()).toBe(join(TOOLS, "lib", "providers", "github"));
  });

  it("module_dir: fails before detection has run", () => {
    const r = coreRun("provider_module_dir");
    expect(r.status).not.toBe(0);
  });

  // ── Credential lifecycle seam ────────────────────────────────────────────

  it("lifecycle: import_token fails defined when provider module is absent", () => {
    // core without any auth module loaded: the import has no implementation
    // and fails with the defined error.
    const script = `source '${CORE}'\nprovider_detect '${join(TMP, "absent.config")}'\nprovider_auth_import_token <<< "tok"\n`;
    const r = spawnSync("bash", ["-c", script], { input: "tok\n", encoding: "utf8", env: ENV() });
    expect(r.status ?? 1).not.toBe(0);
  });

  it("lifecycle: status fails defined when provider module is absent", () => {
    const r = coreRun(`provider_detect '${join(TMP, "absent.config")}'\nprovider_auth_status`);
    expect(r.status).not.toBe(0);
  });

  // ── Identity accessors ───────────────────────────────────────────────────

  const accessorEnv = (): Record<string, string> => ({
    DEVENV_ROOT: TMP,
    DEVENV_ROOT_SET: "1",
    DEVENV_TOOLS: TOOLS,
    GH_ORG: "",
    GH_USER: "",
    POLICY_ORG: "",
  });

  it("provider_org_get: GH_ORG env has no effect (no env leg)", () => {
    writeConfig("[organization]", "name=t", "org=cfg-org");
    const r = coreRun("GH_ORG=env-org provider_org_get", accessorEnv());
    expect(r.status).toBe(0);
    expect(r.out.trim()).toBe("cfg-org");
  });

  it("provider_org_get: config [organization] org resolves", () => {
    writeConfig("[organization]", "name=t", "org=cfg-org");
    const r = coreRun("provider_org_get", accessorEnv());
    expect(r.status).toBe(0);
    expect(r.out.trim()).toBe("cfg-org");
  });

  it("provider_org_get: seed file is the third leg", () => {
    mkdirSync(join(TMP, ".setup"), { recursive: true });
    writeFileSync(join(TMP, ".setup", "provider_org.txt"), "seed-org\n");
    const r = coreRun("provider_org_get", { ...accessorEnv(), GH_ORG: "" });
    expect(r.status).toBe(0);
    expect(r.out.trim()).toBe("seed-org");
  });

  it("provider_org_get: fails with config-guided error when unresolvable", () => {
    const r = coreRun("provider_org_get", accessorEnv());
    expect(r.status).not.toBe(0);
    expect(r.out).toContain("[organization] org");
  });

  it("provider_org_get: raw read does not expand templates (no recursion)", () => {
    // Raw accessor must return the value verbatim, never interpolating
    // (config-reader expansion calls back into this accessor; expansion here
    // would loop).
    writeConfig("[organization]", "name=t", "org=${GH_ORG}");
    const r = coreRun("provider_org_get", { ...accessorEnv(), GH_ORG: "" });
    expect(r.status).toBe(0);
    expect(r.out.trim()).toBe("${GH_ORG}");
  });

  it("provider_user_get: GH_USER has no effect; config then seed", () => {
    let r = coreRun("GH_USER=env-user provider_user_get", accessorEnv());
    expect(r.status).not.toBe(0);

    writeConfig("[organization]", "name=t", "user=cfg-user");
    r = coreRun("provider_user_get", accessorEnv());
    expect(r.status).toBe(0);
    expect(r.out.trim()).toBe("cfg-user");

    mkdirSync(join(TMP, ".setup"), { recursive: true });
    writeFileSync(join(TMP, ".setup", "provider_user.txt"), "seed-user\n");
    rmSync(CFG);
    r = coreRun("provider_user_get", accessorEnv());
    expect(r.status).toBe(0);
    expect(r.out.trim()).toBe("seed-user");
  });

  // ── Capabilities ─────────────────────────────────────────────────────────

  it("capability: declare validates against the canonical list", () => {
    const r = coreRun("provider_declare_capability not-a-capability");
    expect(r.status).not.toBe(0);
    expect(r.out).toContain("canonical");
  });

  it("capability: canonical declares are idempotent and queryable", () => {
    const r = coreRun(
      "provider_declare_capability pipelines\nprovider_declare_capability pipelines\nprovider_has_capability pipelines && echo HAS || echo NO-HAS\nprovider_has_capability releases && echo HAS-REL || echo NO-REL",
    );
    expect(r.out).toContain("HAS");
    expect(r.out).toContain("NO-REL");
    expect(r.out).not.toContain("HAS-REL\n");
  });

  // ── provider_load misconfiguration (F051) ────────────────────────────────

  function loadProviderInSubshell(): { status: number; out: string } {
    const script =
      `export DEVENV_TOOLS='${TOOLS}' DEVENV_ROOT='${TMP}'\n` +
      `source '${TOOLS}/lib/error-handling.bash'\n` +
      `source '${CORE}'\n` +
      `provider_load issues\n` +
      `echo "load-status=$? name=[\${PROVIDER_NAME:-}]"\n`;
    const r = spawnSync("bash", ["-c", script], { encoding: "utf8", env: ENV() });
    return { status: r.status ?? 1, out: (r.stdout ?? "") + (r.stderr ?? "") };
  }

  it("provider_load with an unshipped [provider] name fails and shows why", () => {
    writeConfig("[provider]", "name=azrue");
    const r = loadProviderInSubshell();
    expect(r.out).toContain("azrue");
    expect(r.out).toContain("not shipped");
    expect(r.out).toContain("azure");
    expect(r.out).toContain("github");
    expect(r.out).toContain("load-status=1");
    expect(r.out).toContain("name=[]");
  });

  it("provider_load does not fall back to the typo it was given", () => {
    writeConfig("[provider]", "name=azrue");
    const r = loadProviderInSubshell();
    expect(r.out).not.toContain("does not implement");
    expect(r.out).not.toContain("command not found");
  });

  it("provider_load with a shipped name still succeeds", () => {
    writeConfig("[provider]", "name=github");
    const r = loadProviderInSubshell();
    expect(r.out).toContain("load-status=0");
    expect(r.out).toContain("name=[github]");
  });

  it("provider_load with no [provider] name uses the default provider", () => {
    writeConfig("[workflows]", "status_workflow=A,B");
    const r = loadProviderInSubshell();
    expect(r.out).toContain("load-status=0");
    expect(r.out).toContain("name=[github]");
  });

  it("the default provider is not read from the configured name (no circular binding)", () => {
    writeConfig("[provider]", "name=azrue");
    const r = coreRun("policy_default_provider", { DEVENV_ROOT: TMP });
    expect(r.out.trim()).toBe("github");
  });

  it("POLICY_DEFAULT_PROVIDER still overrides the default", () => {
    writeConfig("[workflows]", "status_workflow=A,B");
    const r = coreRun("policy_default_provider", { DEVENV_ROOT: TMP, POLICY_DEFAULT_PROVIDER: "azure" });
    expect(r.out.trim()).toBe("azure");
  });

  // ── Missing verb is a defined error (F052) ───────────────────────────────

  it("calling a provider verb that is not defined returns 1 and names the provider and verb", () => {
    const r = coreRun(
      `source '${TOOLS}/lib/error-handling.bash'\nPROVIDER_NAME=github\nprovider_made_up_verb arg\necho "rc=$?"`,
    );
    expect(r.out).toContain("rc=1");
    expect(r.out).toContain("github");
    expect(r.out).toContain("provider_made_up_verb");
    expect(r.out).toContain("does not implement");
  });

  it("a missing verb does not kill a set -e script before it can report", () => {
    const r = coreRun(
      `source '${TOOLS}/lib/error-handling.bash'\nPROVIDER_NAME=azure\nif ! provider_made_up_verb; then echo 'handled'; fi`,
      {},
      "set -e\n",
    );
    expect(r.status).toBe(0);
    expect(r.out).toContain("handled");
  });

  it("an ordinary missing command is still bash's 127", () => {
    const r = coreRun("not_a_provider_command_xyz");
    expect(r.status).toBe(127);
    expect(r.out).toContain("not_a_provider_command_xyz");
  });
});
