// Port of tools/tests/lib/test_provider_auth.bats (13 tests): contract tests
// for the GitHub credential lifecycle module (auth.bash). The module is the
// single sanctioned home for gh auth CLI invocations; the import/status impls
// are verified via the shared gh stub, and the token impl must prefer the
// keychain over GH_TOKEN/GITHUB_TOKEN env vars.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const ROOT = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))));
const TOOLS = join(ROOT, "tools");

let TMP = "";
let CALL_LOG = "";

// Recording gh stub: logs argv; auth token honors STUB_GH_AUTH_TOKEN; the
// STUB_GH_FAIL=1 mode fails everything.
const GH_STUB = `#!/usr/bin/env bash
echo "gh $*" >> "\${STUB_CALL_LOG:?}"
if [[ "\${STUB_GH_FAIL:-0}" == "1" ]]; then
    echo "stub-gh: simulated failure" >&2
    exit 1
fi
if [[ "$1" == "auth" && "\${2:-}" == "token" ]]; then
    if [[ -n "\${STUB_GH_AUTH_TOKEN:-}" ]]; then
        printf '%s\\n' "$STUB_GH_AUTH_TOKEN"
        exit 0
    fi
    echo "stub-gh: not logged in (set STUB_GH_AUTH_TOKEN to simulate keychain auth)" >&2
    exit 1
fi
exit 0
`;

// gh stub that mimics gh's own env-token preference: GH_TOKEN/GITHUB_TOKEN
// beat the keychain. Used to prove the impls strip env tokens.
const GH_ENV_AWARE_STUB = `#!/usr/bin/env bash
case "$*" in
  "auth token"|"auth status")
    if [ -n "\${GH_TOKEN:-}" ] || [ -n "\${GITHUB_TOKEN:-}" ]; then
        [ "$*" = "auth token" ] && echo "\${GH_TOKEN:-$GITHUB_TOKEN}"; exit 0
    fi
    if [ -n "\${KEYCHAIN_TOKEN:-}" ]; then
        [ "$*" = "auth token" ] && echo "$KEYCHAIN_TOKEN"; exit 0
    fi
    exit 1 ;;
esac
exit 0
`;

beforeEach(() => {
  TMP = mkdtempSync(join(tmpdir(), `gauth-${Date.now()}-${Math.random().toString(36).slice(2)}`));
  const stubDir = join(TMP, "stub-bin");
  mkdirSync(stubDir, { recursive: true });
  CALL_LOG = join(TMP, "stub-calls.log");
  writeFileSync(CALL_LOG, "");
  writeFileSync(join(stubDir, "gh"), GH_STUB);
  chmodSync(join(stubDir, "gh"), 0o755);
});

const ENV = (extra: Record<string, string> = {}): Record<string, string> => ({
  TEST_TEMP_DIR: TMP,
  DEVENV_TOOLS: TOOLS,
  STUB_CALL_LOG: CALL_LOG,
  PATH: `${join(TMP, "stub-bin")}:${process.env.PATH ?? ""}`,
  ...extra,
});

// verb CALL [extraEnv]: run an auth call with core + github/auth.bash sourced.
function authCall(call: string, env: Record<string, string> = {}): { status: number; out: string } {
  const r = spawnSync(
    "bash",
    [
      "-c",
      `unset _PROVIDER_CORE_LOADED _PROVIDER_GITHUB_AUTH_LOADED PROVIDER_NAME\n` +
      `source '${TOOLS}/lib/providers/provider-core.bash'\n` +
      `provider_detect '${join(TMP, "absent.config")}'\n` +
      `source '${TOOLS}/lib/providers/github/auth.bash'\n` +
      call,
    ],
    { encoding: "utf8", env: ENV(env) },
  );
  return { status: r.status ?? 1, out: (r.stdout ?? "") + (r.stderr ?? "") };
}

// core-only call: provider-core sourced WITHOUT the auth module.
function coreOnlyCall(call: string, env: Record<string, string> = {}): { status: number; out: string } {
  const r = spawnSync(
    "bash",
    [
      "-c",
      `unset _PROVIDER_CORE_LOADED _PROVIDER_GITHUB_AUTH_LOADED\n` +
      `source '${TOOLS}/lib/providers/provider-core.bash'\n` +
      `provider_detect '${join(TMP, "absent.config")}'\n` +
      call,
    ],
    { encoding: "utf8", env: ENV(env) },
  );
  return { status: r.status ?? 1, out: (r.stdout ?? "") + (r.stderr ?? "") };
}

function logHas(substring: string): boolean {
  return readFileSync(CALL_LOG, "utf8").includes(substring);
}

describe("github auth module", () => {
  it("import impl exits 0 when gh auth login succeeds", () => {
    const r = authCall("provider_auth_import_token_impl < /dev/null");
    expect(r.status).toBe(0);
    expect(logHas("gh auth login --with-token")).toBe(true);
    expect(logHas("gh auth setup-git")).toBe(true);
  });

  it("login failure propagates", () => {
    const r = authCall("provider_auth_import_token_impl < /dev/null", { STUB_GH_FAIL: "1" });
    expect(r.status).not.toBe(0);
  });

  it("status impl exits 0 when gh auth status succeeds", () => {
    const r = authCall("provider_auth_status_impl");
    expect(r.status).toBe(0);
    expect(logHas("gh auth status")).toBe(true);
  });

  it("status impl propagates failure", () => {
    const r = authCall("provider_auth_status_impl", { STUB_GH_FAIL: "1" });
    expect(r.status).not.toBe(0);
  });
});

describe("auth seam dispatch", () => {
  it("provider_auth_import_token dispatches to impl", () => {
    const r = authCall("provider_auth_import_token < /dev/null");
    expect(r.status).toBe(0);
    expect(logHas("gh auth login")).toBe(true);
  });

  it("provider_auth_status dispatches to impl", () => {
    const r = authCall("provider_auth_status");
    expect(r.status).toBe(0);
    expect(logHas("gh auth status")).toBe(true);
  });

  it("core alone (no auth module) fails defined", () => {
    // Clean subshells drop auth.bash functions: core-only must fail defined.
    const importR = coreOnlyCall('provider_auth_import_token <<< "tok"');
    expect(importR.status).not.toBe(0);
    const statusR = coreOnlyCall("provider_auth_status");
    expect(statusR.status).not.toBe(0);
  });
});

describe("auth token impl: keychain vs env tokens", () => {
  it("provider_auth_token_impl prints the keychain token", () => {
    const r = authCall("provider_auth_token_impl", { STUB_GH_AUTH_TOKEN: "tok123" });
    expect(r.status).toBe(0);
    expect(r.out.trim()).toBe("tok123");
  });

  it("the token impl returns the keychain token even when GH_TOKEN is set", () => {
    // gh prefers GH_TOKEN over its keychain, so the impl must strip the env
    // tokens: an env token that is not on the allowlist must never come back
    // as "the keychain token".
    const stubDir = join(TMP, "envbin");
    mkdirSync(stubDir, { recursive: true });
    writeFileSync(join(stubDir, "gh"), GH_ENV_AWARE_STUB);
    chmodSync(join(stubDir, "gh"), 0o755);
    const r = authCall("provider_auth_token_impl", {
      PATH: `${stubDir}:${process.env.PATH ?? ""}`,
      GH_TOKEN: "env-token",
      KEYCHAIN_TOKEN: "keychain-token",
    });
    expect(r.status).toBe(0);
    expect(r.out.trim()).toBe("keychain-token");
  });

  it("an env GH_TOKEN alone is not a credential-store token", () => {
    const stubDir = join(TMP, "envbin2");
    mkdirSync(stubDir, { recursive: true });
    writeFileSync(join(stubDir, "gh"), GH_ENV_AWARE_STUB);
    chmodSync(join(stubDir, "gh"), 0o755);
    const gh = authCall("provider_auth_token_impl", {
      PATH: `${stubDir}:${process.env.PATH ?? ""}`,
      GH_TOKEN: "env-token",
    });
    expect(gh.status).not.toBe(0);
    expect(gh.out).not.toContain("env-token");
    const gt = authCall("provider_auth_token_impl", {
      PATH: `${stubDir}:${process.env.PATH ?? ""}`,
      GITHUB_TOKEN: "env-token",
    });
    expect(gt.status).not.toBe(0);
  });

  it("status impl does not treat an env GH_TOKEN as authenticated", () => {
    const stubDir = join(TMP, "envbin3");
    mkdirSync(stubDir, { recursive: true });
    writeFileSync(join(stubDir, "gh"), GH_ENV_AWARE_STUB);
    chmodSync(join(stubDir, "gh"), 0o755);
    const env = authCall("provider_auth_status_impl", {
      PATH: `${stubDir}:${process.env.PATH ?? ""}`,
      GH_TOKEN: "env-token",
    });
    expect(env.status).not.toBe(0);
    const keychain = authCall("provider_auth_status_impl", {
      PATH: `${stubDir}:${process.env.PATH ?? ""}`,
      KEYCHAIN_TOKEN: "keychain-token",
    });
    expect(keychain.status).toBe(0);
  });
});

describe("auth core hygiene", () => {
  it("core: token kind delegates keychain probe to the provider impl", () => {
    // With the github auth module loaded, the keychain leg is available.
    const r = spawnSync(
      "bash",
      [
        "-c",
        `unset _PROVIDER_CORE_LOADED _PROVIDER_GITHUB_AUTH_LOADED PROVIDER_NAME\n` +
        `source '${TOOLS}/lib/providers/provider-core.bash'\n` +
        `provider_detect '${join(TMP, "absent.config")}'\n` +
        `source '${TOOLS}/lib/providers/github/auth.bash'\n` +
        `declare -f provider_auth_token_impl >/dev/null || exit 1`,
      ],
      { encoding: "utf8", env: ENV({ STUB_GH_AUTH_TOKEN: "tok123" }) },
    );
    expect(r.status ?? 1).toBe(0);
  });

  it("core: no gh invocation remains in provider-core (grep gate)", () => {
    const r = spawnSync(
      "bash",
      [
        "-c",
        `grep -nE '\\bgh\\b' '${TOOLS}/lib/providers/provider-core.bash' | grep -v '^\\s*#' | grep -vE ':[0-9]+:\\s*#' || true`,
      ],
      { encoding: "utf8" },
    );
    const hits = (r.stdout ?? "").trim();
    expect(hits, `gh references in neutral core:\n${hits}`).toBe("");
  });
});
