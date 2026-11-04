// Port of tools/tests/lib/test_provider_bootstrap_hooks.bats (31 tests) — one
// vitest `it` per source `@test`. The per-provider bootstrap hook contract:
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

// azure_npm_hook_run: the npm hook with config_read_value answering from a
// section:key=value file and provider_secret_get from AZURE_NPM_SECRET.
function azureNpmHookRun(): { status: number; out: string } {
  return sh(
    `cfg="$AZURE_NPM_CFG_FILE"\n` +
      `source "$DEVENV_TOOLS/lib/providers/provider-core.bash"\n` +
      `PROVIDER_NAME=azure\nprovider_load bootstrap\n` +
      `config_read_value() {\n` +
      `  local section="$1" key="$2" line want\n  want="$section:$key="\n` +
      `  while IFS= read -r line; do\n    case "$line" in\n      "$want"*) printf "%s" "\${line#"$want"}"; return 0 ;;\n    esac\n  done < "$cfg"\n  return 1\n}\n` +
      `provider_secret_get() { [ -n "$AZURE_NPM_SECRET" ] && printf "%s" "$AZURE_NPM_SECRET"; }\n` +
      `provider_bootstrap_configure_npmrc "$AZURE_NPMRC"\n`,
  );
}

// setup_azure_npm SECRET "section:key=value"...
function setupAzureNpm(secret: string, ...cfgLines: string[]): void {
  const home = join(TMP, "home");
  mkdirSync(home, { recursive: true });
  writeFileSync(join(TMP, "cfg"), cfgLines.map((l) => `${l}\n`).join(""));
  process.env.AZURE_NPMRC = join(home, ".npmrc");
  process.env.AZURE_NPM_CFG_FILE = join(TMP, "cfg");
  process.env.AZURE_NPM_SECRET = secret;
}

// b64 of a token (npmrc stores base64 passwords).
function b64(s: string): string {
  return spawnSync("bash", ["-c", `printf %s '${s}' | base64 -w0`], { encoding: "utf8" }).stdout?.trim() ?? "";
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
          `for h in provider_bootstrap_validate_token provider_bootstrap_configure_nuget provider_bootstrap_configure_npmrc; do\n` +
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

  it("azure package-feed hooks register nothing and say so without a configured feed", () => {
    const r = sh(
      `source "$DEVENV_TOOLS/lib/providers/provider-core.bash"\n` +
        `PROVIDER_NAME=azure\nprovider_load bootstrap\n` +
        `config_read_value() { echo ""; }\n` +
        `add_nuget_source_if_not_exists() { echo "UNEXPECTED nuget add: $*"; }\n` +
        `provider_bootstrap_configure_nuget\n` +
        `provider_bootstrap_configure_npmrc "$HOME/.npmrc"\n`,
    );
    expect(r.status).toBe(0);
    expect(r.out).not.toContain("UNEXPECTED");
    expect(r.out).toContain("Skipping");
  });

  it("azure configure_nuget registers the configured Azure Artifacts feed with the provider token", () => {
    const r = sh(
      `source "$DEVENV_TOOLS/lib/providers/provider-core.bash"\n` +
        `PROVIDER_NAME=azure\nprovider_load bootstrap\n` +
        `config_read_value() { [ "$2" = feed_url ] && echo "https://pkgs.dev.azure.com/o/_packaging/f/nuget/v3/index.json"; }\n` +
        `provider_secret_get() { echo "tok-123"; }\n` +
        `add_nuget_source_if_not_exists() { echo "ADD: $1|$2|$3|$4"; }\n` +
        `provider_bootstrap_configure_nuget\n`,
    );
    expect(r.status).toBe(0);
    expect(r.out).toContain("ADD: azure|https://pkgs.dev.azure.com/o/_packaging/f/nuget/v3/index.json|");
    expect(r.out).toContain("|tok-123");
  });

  it("azure configure_nuget skips without registering when the token is unavailable", () => {
    const r = sh(
      `source "$DEVENV_TOOLS/lib/providers/provider-core.bash"\n` +
        `PROVIDER_NAME=azure\nprovider_load bootstrap\n` +
        `config_read_value() { [ "$2" = feed_url ] && echo "https://pkgs.dev.azure.com/o/_packaging/f/nuget/v3/index.json"; }\n` +
        `provider_secret_get() { return 1; }\n` +
        `add_nuget_source_if_not_exists() { echo "UNEXPECTED nuget add: $*"; }\n` +
        `provider_bootstrap_configure_nuget\n`,
    );
    expect(r.status).toBe(0);
    expect(r.out).not.toContain("UNEXPECTED");
    expect(r.out).toContain("Skipping");
  });

  it("azure configure_nuget never sends the Azure token to a non-Azure feed_url", () => {
    const r = sh(
      `source "$DEVENV_TOOLS/lib/providers/provider-core.bash"\n` +
        `PROVIDER_NAME=azure\nprovider_load bootstrap\n` +
        `config_read_value() { [ "$2" = feed_url ] && echo "https://nuget.pkg.github.com/some-org/index.json"; }\n` +
        `provider_secret_get() { echo "tok-123"; }\n` +
        `add_nuget_source_if_not_exists() { echo "UNEXPECTED nuget add: $*"; }\n` +
        `provider_bootstrap_configure_nuget\n`,
    );
    expect(r.status).toBe(0);
    expect(r.out).not.toContain("UNEXPECTED");
    expect(r.out).toContain("not an Azure Artifacts URL");
  });

  // ── Azure npm hook ───────────────────────────────────────────────────────

  it("azure configure_npmrc writes the credential triple for both prefixes (scope set)", () => {
    setupAzureNpm("tok-123", "npm:feed_url=https://pkgs.dev.azure.com/o/_packaging/f/npm/registry/", "npm:scope=@acme");
    const r = azureNpmHookRun();
    expect(r.status).toBe(0);
    const npmrc = process.env.AZURE_NPMRC ?? "";
    const p1 = "//pkgs.dev.azure.com/o/_packaging/f/npm/registry/";
    const p2 = "//pkgs.dev.azure.com/o/_packaging/f/npm/";
    for (const p of [p1, p2]) {
      expect(spawnSync("grep", ["-q", `^${p}:username=`, npmrc]).status).toBe(0);
      expect(spawnSync("grep", ["-q", `^${p}:_password=${b64("tok-123")}$`, npmrc]).status).toBe(0);
      expect(spawnSync("grep", ["-q", `^${p}:email=`, npmrc]).status).toBe(0);
    }
    expect(spawnSync("grep", ["-q", "^@acme:registry=https://pkgs.dev.azure.com/o/_packaging/f/npm/registry/$", npmrc]).status).toBe(0);
  });

  it("azure configure_npmrc skips with a message when [npm] feed_url is unset", () => {
    setupAzureNpm("tok-123", "npm:feed_url=");
    const r = azureNpmHookRun();
    expect(r.status).toBe(0);
    expect(r.out).toContain("Skipping");
    expect(existsSync(process.env.AZURE_NPMRC ?? "")).toBe(false);
  });

  it("azure configure_npmrc is idempotent: a second run converges to one entry set", () => {
    setupAzureNpm("tok-123", "npm:feed_url=https://pkgs.dev.azure.com/o/_packaging/f/npm/registry/", "npm:scope=@acme");
    expect(azureNpmHookRun().status).toBe(0);
    expect(azureNpmHookRun().status).toBe(0);
    const npmrc = process.env.AZURE_NPMRC ?? "";
    expect(spawnSync("bash", ["-c", `grep -c "^//pkgs.dev.azure.com/o/_packaging/f/npm/registry/:_password=" '${npmrc}'`], { encoding: "utf8" }).stdout?.trim()).toBe("1");
    expect(spawnSync("bash", ["-c", `grep -c "^//pkgs.dev.azure.com/o/_packaging/f/npm/:_password=" '${npmrc}'`], { encoding: "utf8" }).stdout?.trim()).toBe("1");
    expect(spawnSync("bash", ["-c", `grep -c "^@acme:registry=" '${npmrc}'`], { encoding: "utf8" }).stdout?.trim()).toBe("1");
  });

  it("azure configure_npmrc rotation: a new token replaces the stored password", () => {
    setupAzureNpm("old-token", "npm:feed_url=https://pkgs.dev.azure.com/o/_packaging/f/npm/registry/");
    expect(azureNpmHookRun().status).toBe(0);
    process.env.AZURE_NPM_SECRET = "fresh-token";
    const r = azureNpmHookRun();
    expect(r.status).toBe(0);
    const npmrc = process.env.AZURE_NPMRC ?? "";
    expect(spawnSync("grep", ["-q", `_password=${b64("fresh-token")}$`, npmrc]).status).toBe(0);
    expect(spawnSync("grep", ["-q", b64("old-token"), npmrc]).status).not.toBe(0);
  });

  it("azure configure_npmrc preserves unrelated lines", () => {
    setupAzureNpm("tok-123", "npm:feed_url=https://pkgs.dev.azure.com/o/_packaging/f/npm/registry/");
    const npmrc = process.env.AZURE_NPMRC ?? "";
    writeFileSync(npmrc, "registry=https://registry.npmjs.org/\n//other.registry/:_authToken=keepme\ninit-author-name=Someone\n");
    azureNpmHookRun();
    expect(spawnSync("grep", ["-q", "^registry=https://registry.npmjs.org/$", npmrc]).status).toBe(0);
    expect(spawnSync("grep", ["-q", "^//other.registry/:_authToken=keepme$", npmrc]).status).toBe(0);
    expect(spawnSync("grep", ["-q", "^init-author-name=Someone$", npmrc]).status).toBe(0);
  });

  it("azure configure_npmrc leaves the file 0600 even when it was wider before", () => {
    setupAzureNpm("tok-123", "npm:feed_url=https://pkgs.dev.azure.com/o/_packaging/f/npm/registry/");
    const npmrc = process.env.AZURE_NPMRC ?? "";
    writeFileSync(npmrc, "init-author-name=Someone\n");
    chmodSync(npmrc, 0o644);
    azureNpmHookRun();
    expect(spawnSync("stat", ["-c", "%a", npmrc], { encoding: "utf8" }).stdout?.trim()).toBe("600");
  });

  it("azure configure_npmrc never prints the PAT", () => {
    setupAzureNpm("super-secret-pat-value", "npm:feed_url=https://pkgs.dev.azure.com/o/_packaging/f/npm/registry/");
    const r = azureNpmHookRun();
    expect(r.out).not.toContain("super-secret-pat-value");
  });

  it("azure configure_npmrc omits the scope mapping when [npm] scope is empty", () => {
    setupAzureNpm("tok-123", "npm:feed_url=https://pkgs.dev.azure.com/o/_packaging/f/npm/registry/", "npm:scope=");
    const r = azureNpmHookRun();
    expect(r.status).toBe(0);
    const npmrc = process.env.AZURE_NPMRC ?? "";
    expect(spawnSync("grep", ["-q", "^//pkgs.dev.azure.com/o/_packaging/f/npm/registry/:_password=", npmrc]).status).toBe(0);
    expect(spawnSync("grep", ["-q", ":registry=", npmrc]).status).not.toBe(0);
  });

  it("azure configure_npmrc skips a non-Azure feed_url and never reads the token", () => {
    setupAzureNpm("", "npm:feed_url=https://registry.npmjs.org/");
    const r = azureNpmHookRun();
    expect(r.status).toBe(0);
    expect(r.out).toContain("not an Azure Artifacts URL");
    expect(existsSync(process.env.AZURE_NPMRC ?? "")).toBe(false);
  });

  it("azure configure_npmrc skips when no credential is available", () => {
    setupAzureNpm("", "npm:feed_url=https://pkgs.dev.azure.com/o/_packaging/f/npm/registry/");
    const r = azureNpmHookRun();
    expect(r.status).toBe(0);
    expect(r.out).toContain("Skipping");
    expect(existsSync(process.env.AZURE_NPMRC ?? "")).toBe(false);
  });

  // ── Rotation wiring: key-update re-runs the feed wiring hooks ───────────

  it("azure key-update re-runs the feed wiring hooks after a successful import", () => {
    // Interception happens in-process: source provider-core (arming its load
    // guard), override the two seams, then SOURCE the real key-update.sh —
    // its own provider-core source becomes a no-op, so the overrides survive.
    const wiringLog = join(TMP, "keyupdate-wiring.log");
    const r = sh(
      `source "$DEVENV_TOOLS/lib/providers/provider-core.bash"\n` +
        `PROVIDER_NAME=azure\nprovider_load auth\n` +
        `provider_auth_import_token() { return 0; }\n` +
        `provider_bootstrap_call() { printf "%s %s\\n" "$1" "\${2:-}" >> '${wiringLog}'; return 0; }\n` +
        `printf "tok-rotated-value\\n" | source "$DEVENV_TOOLS/lib/providers/azure/key-update.sh"\n`,
    );
    expect(r.status).toBe(0);
    expect(spawnSync("grep", ["-q", "^configure_npmrc ", wiringLog]).status).toBe(0);
    expect(spawnSync("grep", ["-q", "^configure_nuget", wiringLog]).status).toBe(0);
  });
});
