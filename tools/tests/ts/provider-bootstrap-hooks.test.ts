// Tests for the per-provider bootstrap hook contract:
// each provider ships bootstrap.bash (container side) and setup.bash (host
// side, bash 3.2 only); the main bootstrap and `setup` call hooks and never
// branch on the provider name.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const ROOT = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))));
const TOOLS = join(ROOT, "tools");
const PROVIDERS_DIR = join(TOOLS, "lib", "providers");

let TMP = "";
let CURL_ARGV_LOG = "";
let CURL_STDIN_LOG = "";

beforeEach(() => {
  TMP = mkdtempSync(join(tmpdir(), `hooks-${Date.now()}-${Math.random().toString(36).slice(2)}`));
  CURL_ARGV_LOG = join(TMP, "curl-argv.log");
  CURL_STDIN_LOG = join(TMP, "curl-stdin.log");
  mkdirSync(join(TMP, "bin"), { recursive: true });
  writeFileSync(CURL_ARGV_LOG, "");
  writeFileSync(CURL_STDIN_LOG, "");
  // curl stub: records argv and stdin (the header file), prints $FAKE_HTTP_CODE for -w
  writeFileSync(
    join(TMP, "bin", "curl"),
    [
      "#!/usr/bin/env bash",
      "printf '%s\\n' \"$@\" >> \"$CURL_ARGV_LOG\"",
      'cat >> "$CURL_STDIN_LOG"',
      "printf '%s' \"${FAKE_HTTP_CODE:-200}\"",
      "",
    ].join("\n"),
  );
  chmodSync(join(TMP, "bin", "curl"), 0o755);
});

const ENV = (extra: Record<string, string> = {}): Record<string, string> => ({
  ...process.env,
  DEVENV_TOOLS: TOOLS,
  CURL_ARGV_LOG,
  CURL_STDIN_LOG,
  PATH: `${join(TMP, "bin")}:${process.env.PATH ?? ""}`,
  ...extra,
});

function sh(script: string, extraEnv: Record<string, string> = {}, input?: string): { status: number; out: string } {
  const r = spawnSync("bash", ["-c", script], { input, encoding: "utf8", env: ENV(extraEnv) });
  return { status: r.status ?? 1, out: (r.stdout ?? "") + (r.stderr ?? "") };
}

// validate <provider> <org> <token>: runs the host-side validator.
function validate(provider: string, org: string, token: string, httpCode: string): { status: number; out: string } {
  return sh(
    `source "$DEVENV_TOOLS/lib/providers/provider-core.bash"\n` +
      `PROVIDER_NAME=${provider}\n` +
      `provider_load setup\n` +
      `printf '%s' '${token}' | provider_setup_validate_token "${org}"\n`,
    { FAKE_HTTP_CODE: httpCode },
    "",
  );
}

describe("provider bootstrap hooks", () => {
  // ── provider_bootstrap_call: the one dispatch point ─────────────────────

  it("provider_bootstrap_call runs a defined hook with its arguments and returns its status", () => {
    const r = sh(
      `source "$DEVENV_TOOLS/lib/providers/provider-core.bash"\nprovider_bootstrap_demo() { echo "args: $*"; return 3; }\nprovider_bootstrap_call demo a b\n`,
    );
    expect(r.status).toBe(3);
    expect(r.out).toContain("args: a b");
  });

  it("provider_bootstrap_call is a no-op success for a hook the provider does not define", () => {
    const r = sh(
      `source "$DEVENV_TOOLS/lib/providers/provider-core.bash"\nprovider_bootstrap_call no_such_hook x\n`,
    );
    expect(r.status).toBe(0);
  });

  it("provider_bootstrap_call requires a hook name", () => {
    const r = sh(`source "$DEVENV_TOOLS/lib/providers/provider-core.bash"\nprovider_bootstrap_call\n`);
    expect(r.status).not.toBe(0);
  });

  // ── Every shipped provider implements the documented hooks ──────────────

  it("github and azure ship bootstrap.bash and setup.bash", () => {
    for (const p of ["github", "azure"]) {
      expect(existsSync(join(PROVIDERS_DIR, p, "bootstrap.bash"))).toBe(true);
      expect(existsSync(join(PROVIDERS_DIR, p, "setup.bash"))).toBe(true);
    }
  });

  it("provider_load bootstrap defines the container-side hooks for each provider", () => {
    for (const p of ["github", "azure"]) {
      const r = sh(
        `source "$DEVENV_TOOLS/lib/providers/provider-core.bash"\n` +
          `PROVIDER_NAME=${p}\nprovider_load bootstrap\n` +
          `for h in provider_bootstrap_validate_token provider_bootstrap_git_auth_header; do\n` +
          `  declare -F "$h" >/dev/null || { echo "${p} is missing $h"; exit 1; }\ndone\n`,
      );
      expect(r.status, r.out).toBe(0);
    }
  });

  it("provider_load setup defines the host-side validator for each provider", () => {
    for (const p of ["github", "azure"]) {
      const r = sh(
        `source "$DEVENV_TOOLS/lib/providers/provider-core.bash"\nPROVIDER_NAME=${p}\nprovider_load setup\ndeclare -F provider_setup_validate_token >/dev/null\n`,
      );
      expect(r.status, `${p}: ${r.out}`).toBe(0);
    }
  });

  // ── setup.bash runs on the host (macOS bash 3.2): no bash 4+ features ───

  // bash4_features: code lines (comments excluded) using bash 4+ features.
  function bash4Features(file: string): { status: number; out: string } {
    const r = spawnSync(
      "bash",
      [
        "-c",
        `grep -vE '^[[:space:]]*#' "$1" | grep -nE 'declare -A|local -n|declare -n|\\$\\{[A-Za-z_]+(,,|\\^\\^|@[QEPAa])\\}|mapfile|readarray|&>>|;&|\\|&|coproc|\\[\\[ -v '`,
        "_",
        file,
      ],
      { encoding: "utf8" },
    );
    return { status: r.status ?? 1, out: (r.stdout ?? "") + (r.stderr ?? "") };
  }

  it("setup.bash files use no bash 4+ features (host bash may be 3.2)", () => {
    for (const p of ["github", "azure"]) {
      const f = join(PROVIDERS_DIR, p, "setup.bash");
      expect(existsSync(f)).toBe(true);
      const r = bash4Features(f);
      expect(r.status, `bash 4+ feature in ${p}/setup.bash:\n${r.out}`).not.toBe(0);
    }
  });

  it("the bash 4+ guard is not vacuous: it flags associative arrays and case conversion", () => {
    const bad = join(TMP, "bad.bash");
    writeFileSync(bad, 'declare -A m\necho "${x,,}"\n');
    const r = bash4Features(bad);
    expect(r.status).toBe(0);
    expect(r.out).toContain("declare -A");
  });

  it("setup.bash files parse under a strict POSIX-ish bash syntax check", () => {
    for (const p of ["github", "azure"]) {
      expect(spawnSync("bash", ["-n", join(PROVIDERS_DIR, p, "setup.bash")]).status).toBe(0);
    }
  });

  // ── provider_setup_validate_token ────────────────────────────────────────

  it("github validator: HTTP 200 accepts, 401 rejects (1), no status means unreachable (2)", () => {
    expect(validate("github", "my-org", "tok-abc", "200").status).toBe(0);
    expect(validate("github", "my-org", "tok-abc", "401").status).toBe(1);
    expect(validate("github", "my-org", "tok-abc", "000").status).toBe(2);
  });

  it("azure validator: HTTP 200 accepts, 401 and the 203 sign-in page reject (1), no status means unreachable (2)", () => {
    expect(validate("azure", "my-org", "tok-abc", "200").status).toBe(0);
    expect(validate("azure", "my-org", "tok-abc", "401").status).toBe(1);
    expect(validate("azure", "my-org", "tok-abc", "203").status).toBe(1);
    expect(validate("azure", "my-org", "tok-abc", "000").status).toBe(2);
  });

  it("azure validator targets the org's connectionData endpoint and needs an org", () => {
    validate("azure", "my-org", "tok-abc", "200");
    expect(spawnSync("grep", ["-q", "dev.azure.com/my-org/_apis/connectionData", CURL_ARGV_LOG]).status).toBe(0);
    expect(validate("azure", "", "tok-abc", "200").status).not.toBe(0);
  });

  it("validators keep the token out of curl's arguments (the header rides stdin)", () => {
    validate("github", "my-org", "supersecret-token-1", "200");
    validate("azure", "my-org", "supersecret-token-2", "200");
    expect(spawnSync("grep", ["-q", "supersecret", CURL_ARGV_LOG]).status).not.toBe(0);
    expect(spawnSync("grep", ["-q", "Authorization: Bearer supersecret-token-1", CURL_STDIN_LOG]).status).toBe(0);
    expect(spawnSync("grep", ["-q", "Authorization: Basic ", CURL_STDIN_LOG]).status).toBe(0);
  });

  it("validators reject an empty token without calling curl", () => {
    expect(validate("github", "my-org", "", "200").status).not.toBe(0);
    expect(validate("azure", "my-org", "", "200").status).not.toBe(0);
    expect(spawnSync("test", ["-s", CURL_ARGV_LOG]).status).not.toBe(0);
  });

  // ── Container-side validation delegates to the host-side validator ──────

  it("provider_bootstrap_validate_token delegates to provider_setup_validate_token", () => {
    for (const p of ["github", "azure"]) {
      const r = sh(
        `source "$DEVENV_TOOLS/lib/providers/provider-core.bash"\n` +
          `PROVIDER_NAME=${p}\nprovider_load bootstrap\n` +
          `config_read_value() { echo my-org; }\n` +
          `printf tok | provider_bootstrap_validate_token\n`,
        { FAKE_HTTP_CODE: "401" },
        "",
      );
      expect(r.status, `${p}: rc ${r.status}`).toBe(1);
    }
  });

  it("azure provider_bootstrap_validate_token validates against the configured azure_org", () => {
    const r = sh(
      `source "$DEVENV_TOOLS/lib/providers/provider-core.bash"\n` +
        `PROVIDER_NAME=azure\nprovider_load bootstrap\n` +
        `config_read_value() { [ "$2" = azure_org ] && echo the-azure-org; }\n` +
        `printf tok | provider_bootstrap_validate_token\n`,
      { FAKE_HTTP_CODE: "200" },
      "",
    );
    expect(r.status).toBe(0);
    expect(spawnSync("grep", ["-q", "dev.azure.com/the-azure-org/_apis/connectionData", CURL_ARGV_LOG]).status).toBe(0);
  });

  // ── Azure nuget feed ─────────────────────────────────────────────────────

  it("neither provider ships a bash feed hook: the setup steps own NuGet and npm registration", () => {
    for (const p of ["github", "azure"]) {
      const r = sh(
        `source "$DEVENV_TOOLS/lib/providers/provider-core.bash"\n` +
          `PROVIDER_NAME=${p}\nprovider_load bootstrap\n` +
          `declare -F provider_bootstrap_configure_nuget provider_bootstrap_configure_npmrc provider_bootstrap_apt_packages\n`,
      );
      expect(r.status, p).not.toBe(0);
      expect(r.out, p).toBe("");
    }
  });

  // ── Rotation wiring: key-update re-runs the feed wiring hooks ───────────

  it("azure key-update re-runs the feed wiring hooks after a successful import", () => {
    // The rotation entry point (azure/key-update.ts) re-runs the npm and NuGet
    // step modules against a scratch HOME: the wiring side effects are the log.
    // The nuget step shells out to dotnet; a stub keeps it off the real sources.
    writeFileSync(join(TMP, "bin", "dotnet"), "#!/usr/bin/env bash\nexit 0\n");
    chmodSync(join(TMP, "bin", "dotnet"), 0o755);
    mkdirSync(join(TMP, "devenv-root"), { recursive: true });
    writeFileSync(join(TMP, "devenv-root", "devenv.config"), "[provider]\nname=azure\n");
    const r = spawnSync(
      "node",
      [join(TOOLS, "lib/providers/azure/key-update.ts")],
      {
        input: "tok-rotated-value\n",
        encoding: "utf8",
        env: ENV({
          AZURE_PAT_FILE: join(TMP, "azure.pat"),
          GIT_CONFIG_GLOBAL: join(TMP, "gitconfig"),
          HOME: TMP,
          DEVENV_ROOT: join(TMP, "devenv-root"),
          DEVENV_TOOLBOX_ROOT: join(TMP, "toolbox"),
          PATH: `${join(TMP, "bin")}:${process.env.PATH ?? ""}`,
        }),
      },
    );
    expect(r.status, `${r.stdout}${r.stderr}`).toBe(0);
    // The rotation completed and re-ran the feed wiring steps (an absent feed
    // URL is a clean skip).
    expect(r.stdout ?? r.stderr ?? "").toContain("Refreshing package feed credentials");
    expect(existsSync(join(TMP, "azure.pat"))).toBe(true);
  });
});
