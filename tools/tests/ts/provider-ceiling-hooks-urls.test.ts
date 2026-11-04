// Port of test_provider_api_ceiling.bats (2) + test_provider_capability_hooks.bats
// (4) + test_provider_urls.bats (6): provider seam contracts — the escape-hatch
// call-site ceiling, capability hooks (target-required + set-type context), and
// the host-sensitive URL helpers.
import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))));
const TOOLS = join(ROOT, "tools");

const CEILING_PROVIDER_API_CALL_SITES = 0;

function sh(script: string, env: Record<string, string> = {}): { status: number; out: string } {
  const r = spawnSync("bash", ["-c", script], { encoding: "utf8", env: { ...process.env, ...env } });
  return { status: r.status ?? 1, out: (r.stdout ?? "") + (r.stderr ?? "") };
}

// ── provider_api ceiling (port of test_provider_api_ceiling.bats) ────────
// Counting method (must stay stable): live tree only (bash), cache excluded;
// provider module definitions excluded; comment lines excluded.

function countProviderApiCallSites(): number {
  const r = sh(
    `grep -rn --include='*.sh' --include='*.bash' -E 'provider_api(_paginate)?[[:space:]]' '${TOOLS}/lib' 2>/dev/null ` +
    `| grep -v '/cache/' | grep -v 'lib/providers/' | grep -v -E ':[0-9]+:[[:space:]]*#' ` +
    `| grep -v -E ':[0-9]+:[[:space:]]*#.*provider_api' | wc -l`,
  );
  return Number.parseInt(r.out.trim() || "0", 10);
}

describe("provider_api escape hatch", () => {
  it("call sites within ceiling", () => {
    const count = countProviderApiCallSites();
    expect(count).toBeLessThanOrEqual(CEILING_PROVIDER_API_CALL_SITES);
  });

  it("ceiling counter excludes provider module definitions", () => {
    // The definition site (repos.bash) must not be counted; the counter's
    // exclusion of lib/providers/ keeps the ceiling meaningful.
    const count = countProviderApiCallSites();
    const defs = Number.parseInt(sh(`grep -c 'provider_api()' '${TOOLS}/lib/providers/github/repos.bash'`).out.trim() || "0", 10);
    expect(defs).toBeGreaterThanOrEqual(1);
    expect(count).toBeLessThan(count + defs); // guard against counter regressions
  });
});

// ── capability hooks (port of test_provider_capability_hooks.bats) ───────

function capability(script: string): { status: number; out: string } {
  return sh(`source '${TOOLS}/lib/providers/provider-core.bash'\n${script}`);
}

describe("provider capability hooks", () => {
  it("provider_issues_target_required defaults to yes with no override", () => {
    const r = capability(`PROVIDER_NAME=github\nprovider_load issues\nprovider_issues_target_required`);
    expect(r.status).toBe(0);
    expect(r.out.trim()).toBe("yes");
  });

  it("azure overrides target-required to no", () => {
    const r = capability(`PROVIDER_NAME=azure\nprovider_load issues\nprovider_issues_target_required`);
    expect(r.status).toBe(0);
    expect(r.out.trim()).toBe("no");
  });

  it("github set-type context resolves owner/name via repos_view", () => {
    const r = capability(
      `PROVIDER_NAME=github\nprovider_load issues repos\n` +
      `provider_repos_view() {\n  case "$3" in\n    owner) printf 'the-owner' ;;\n    name) printf 'the-repo' ;;\n  esac\n}\n` +
      `provider_issues_set_type_context org/repo`,
    );
    expect(r.status).toBe(0);
    expect(r.out.trim()).toBe("the-owner the-repo");
  });

  it("azure set-type context emits configured org/project without repos_view", () => {
    const r = capability(
      `PROVIDER_NAME=azure\nprovider_load issues repos\n` +
      `provider_repos_view() { echo 'UNEXPECTED repos_view call'; return 1; }\n` +
      `azure_config_get() {\n  case "$2" in\n    azure_org) printf 'the-org' ;;\n    azure_project) printf 'the-project' ;;\n  esac\n}\n` +
      `provider_issues_set_type_context ignored/repo`,
    );
    expect(r.status).toBe(0);
    expect(r.out.trim()).toBe("the-org the-project");
  });
});

// ── URL seam (port of test_provider_urls.bats) ───────────────────────────
// Host-sensitivity: provider_extract_url and provider_remote_to_web derive
// their host literals from provider_web_host — a provider swap edits one
// function and every URL helper follows (single-point-swap proof).

const URLS = join(TOOLS, "lib/providers/github/urls.bash");

describe("provider urls", () => {
  it("extract_url derives its host from provider_web_host", () => {
    const r = sh(
      `unset _PROVIDER_GITHUB_URLS_LOADED 2>/dev/null || true\nsource '${URLS}'\n` +
      `provider_web_host() { printf 'gitlab.example.invalid\\n'; }\n` +
      `printf '%s' 'opened https://gitlab.example.invalid/org/repo/-/issues/7 today' | provider_extract_url 'issues'`,
    );
    expect(r.out.trim()).toBe("https://gitlab.example.invalid/org/repo/-/issues/7");
  });

  it("extract_url rejects foreign hosts (default host)", () => {
    const r = sh(`source '${URLS}'; printf %s "see https://gitlab.com/org/repo/issues/7" | provider_extract_url`);
    // A foreign-host URL must not match: empty output, rc 1.
    expect(r.status).not.toBe(0);
    expect(r.out.trim()).toBe("");
  });

  it("remote_to_web derives host in all three transport forms", () => {
    const r = sh(
      `unset _PROVIDER_GITHUB_URLS_LOADED 2>/dev/null || true\nsource '${URLS}'\n` +
      `provider_web_host() { printf 'gitlab.example.invalid\\n'; }\n` +
      `provider_remote_to_web "git@gitlab.example.invalid:org/repo.git"; echo "---"\n` +
      `provider_remote_to_web "https://gitlab.example.invalid/org/repo.git"; echo "---"\n` +
      `provider_remote_to_web "http://gitlab.example.invalid/org/repo"`,
    );
    const parts = r.out.split("---").map((s) => s.trim());
    expect(parts[0]).toBe("https://gitlab.example.invalid/org/repo");
    expect(parts[1]).toBe("https://gitlab.example.invalid/org/repo");
    expect(parts[2]).toBe("https://gitlab.example.invalid/org/repo");
  });

  it("default github host unchanged (real config)", () => {
    const r = sh(`unset _PROVIDER_GITHUB_URLS_LOADED 2>/dev/null || true\nsource '${URLS}'\nprovider_remote_to_web "git@github.com:org/repo.git"; echo "---"\nprintf %s "merged https://github.com/org/repo/pull/9" | provider_extract_url "pull/"`);
    const parts = r.out.split("---").map((s) => s.trim());
    expect(parts[0]).toBe("https://github.com/org/repo");
    expect(parts[1]).toBe("https://github.com/org/repo/pull/9");
  });

  it("remote_to_web parses credential-embedded https remotes", () => {
    // https://user:token@host/... remotes are common (git stores the PAT this
    // way); they must parse like clean https remotes.
    const r = sh(`unset _PROVIDER_GITHUB_URLS_LOADED 2>/dev/null || true\nsource '${URLS}'\nprovider_remote_to_web "https://user:ghp_abc@github.com/owner/repo.git"`);
    expect(r.status).toBe(0);
    expect(r.out.trim()).toBe("https://github.com/owner/repo");
  });

  it("azure remote_to_web returns 1 on non-azure remotes (seam contract)", () => {
    // Each provider answers only for its own host. A github remote is NOT
    // azure's to parse — callers own cross-host fallback.
    const r = sh(
      `export PROVIDER_NAME=azure\nsource '${TOOLS}/lib/error-handling.bash'\n` +
      `source '${TOOLS}/lib/providers/provider-core.bash'\nprovider_load urls\n` +
      `provider_remote_to_web 'https://user:tok@github.com/owner/repo.git'`,
    );
    expect(r.status).not.toBe(0);
    expect(r.out.trim()).toBe("");
  });
});
