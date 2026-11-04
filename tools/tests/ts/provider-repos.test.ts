// Port of tools/tests/lib/test_provider_repos.bats (28 tests) — one vitest
// `it` per source `@test`. Contract tests for the github repos domain facade,
// including the targeting-normalization helper (provider_repo_target) chain,
// the URL/host seam, and the org releases verb's spec validation.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const ROOT = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))));
const TOOLS = join(ROOT, "tools");

let TMP = "";
let CALL_LOG = "";

// The fixture's gh stub: argv log, failure mode, auth token, api modes.
const GH_STUB = [
  "#!/usr/bin/env bash",
  'echo "gh $*" >> "${STUB_CALL_LOG:?}"',
  'if [[ "${STUB_GH_FAIL:-0}" == "1" ]]; then',
  '  echo "stub-gh: simulated failure" >&2',
  "  exit 1",
  "fi",
  'if [[ "$1" == "auth" && "${2:-}" == "token" ]]; then',
  '  if [[ -n "${STUB_GH_AUTH_TOKEN:-}" ]]; then',
  "    printf '%s\\n' \"$STUB_GH_AUTH_TOKEN\"",
  "    exit 0",
  "  fi",
  "  exit 1",
  "fi",
  'if [[ "$1" == "api" ]]; then',
  '  if [[ -n "${STUB_GH_PAGES:-}" && -f "${STUB_GH_PAGES}" ]]; then',
  '    if [[ -s "$STUB_GH_PAGES" ]]; then',
  '      page_file=$(head -n 1 "$STUB_GH_PAGES")',
  '      tail -n +2 "$STUB_GH_PAGES" > "${STUB_GH_PAGES}.tmp" && mv "${STUB_GH_PAGES}.tmp" "${STUB_GH_PAGES}"',
  '      [[ -f "$page_file" ]] && cat "$page_file"',
  "      exit 0",
  "    fi",
  "    exit 1",
  "  fi",
  '  if [[ "$*" == *"-X PATCH"* || "$*" == *"-X POST"* ]]; then',
  '    [[ -n "${STUB_GH_MUTATIONS:-}" ]] && echo "gh $*" >> "$STUB_GH_MUTATIONS"',
  "    printf '{\"id\": 111, \"html_url\": \"https://example.invalid/comment/111\"}'",
  "  else",
  '    [[ -f "${STUB_GH_API_RESPONSE:-/nonexistent}" ]] && cat "$STUB_GH_API_RESPONSE"',
  "  fi",
  "  exit 0",
  "fi",
  "exit 0",
  "",
].join("\n");

beforeEach(() => {
  TMP = mkdtempSync(join(tmpdir(), `repos-${Date.now()}-${Math.random().toString(36).slice(2)}`));
  CALL_LOG = join(TMP, "stub-calls.log");
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
  // Neutral env: no DEVENV_REPO / GH_REPO / GITHUB_REPO unless a test sets one.
  DEVENV_REPO: "",
  GH_REPO: "",
  GITHUB_REPO: "",
  PATH: `${join(TMP, "stub-bin")}:${process.env.PATH ?? ""}`,
  ...extra,
});

// The source suite's setup as a spawn: source core → detect (absent config) →
// source github issues + repos, then run the call.
function runRepos(call: string, extraEnv: Record<string, string> = {}): { status: number; out: string } {
  const script =
    `source '${TOOLS}/lib/providers/provider-core.bash'\n` +
    `provider_detect '${join(TMP, "absent.config")}'\n` +
    `source '${TOOLS}/lib/providers/github/issues.bash'\n` +
    `source '${TOOLS}/lib/providers/github/repos.bash'\n` +
    `${call}\n`;
  const r = spawnSync("bash", ["-c", script], { encoding: "utf8", env: ENV(extraEnv) });
  return { status: r.status ?? 1, out: (r.stdout ?? "") + (r.stderr ?? "") };
}

function ghCount(): number {
  return parseInt((spawnSync("grep", ["-c", "^gh ", CALL_LOG], { encoding: "utf8" }).stdout ?? "0").trim(), 10) || 0;
}

function logHas(pattern: string): boolean {
  return spawnSync("grep", ["-q", pattern, CALL_LOG]).status === 0;
}

// git init a directory as a tiny repo (the cwd leg's fixture).
function initRepo(dir: string): void {
  mkdirSync(dir, { recursive: true });
  spawnSync("bash", ["-c", `cd '${dir}' && git init -q && git config user.email t@t && git config user.name t`]);
}

// A standalone script that sources core+repos itself (the source's heredoc
// script pattern), run with a controlled env and cwd.
function targetScript(body: string, cwd: string, env: Record<string, string> = {}): { status: number; out: string } {
  const script = join(TMP, `target-${Math.random().toString(36).slice(2)}.sh`);
  writeFileSync(
    script,
    `export DEVENV_TOOLS='${TOOLS}'\n` +
      `unset _PROVIDER_CORE_LOADED PROVIDER_NAME DEVENV_REPO GH_REPO GH_ORG\n` +
      `source "$DEVENV_TOOLS/lib/providers/provider-core.bash"\n` +
      `provider_detect '${join(TMP, "absent.config")}'\n` +
      `source "$DEVENV_TOOLS/lib/providers/github/repos.bash"\n` +
      body,
  );
  const r = spawnSync("bash", [script], { encoding: "utf8", cwd, env: ENV(env) });
  return { status: r.status ?? 1, out: (r.stdout ?? "").trim() };
}

describe("provider repos (github)", () => {
  // ── Targeting normalization (provider_repo_target) ──────────────────────

  it("repo_target: GITHUB_REPO env has no effect when argument present", () => {
    const r = runRepos("GITHUB_REPO=env/repo provider_repo_target explicit/repo");
    expect(r.out.trim()).toBe("explicit/repo");
  });

  it("repo_target: GITHUB_REPO env has no effect (no devenv alias)", () => {
    // Isolate the seed path: a real DEVENV_ROOT seed would satisfy the cwd
    // leg and hide the assertion this test exists for.
    const isolatedRoot = join(TMP, "no-seed-root");
    mkdirSync(isolatedRoot, { recursive: true });
    mkdirSync(join(TMP, "nogit-a"), { recursive: true });
    const r = spawnSync(
      "bash",
      ["-c", `source '${TOOLS}/lib/providers/github/repos.bash' && provider_repo_target`],
      { encoding: "utf8", cwd: join(TMP, "nogit-a"), env: ENV({ DEVENV_ROOT: isolatedRoot, GITHUB_REPO: "env/repo", DEVENV_REPO: "" }) },
    );
    expect(r.status ?? 1).toBe(0);
    expect((r.stdout ?? "").trim()).toBe("");
  });

  it("repo_target: GH_REPO full form used as fallback", () => {
    const r = runRepos("provider_repo_target", { GH_REPO: "gh/repo" });
    expect(r.out.trim()).toBe("gh/repo");
  });

  it("repo_target: basename-only GH_REPO falls through to cwd leg", () => {
    // Basename GH_REPO is invalid for -R, so it must not be echoed as-is;
    // the full chain resolves it via the cwd leg instead.
    const repoDir = join(TMP, "t-repo");
    initRepo(repoDir);
    const r = targetScript(
      `provider_org_get() { echo cfg-org; }\nGH_REPO=justname\nexport GH_REPO\ncd '${repoDir}'\nprovider_repo_target\n`,
      repoDir,
    );
    expect(r.status).toBe(0);
    expect(r.out).toBe("cfg-org/t-repo");
  });

  it("repo_target: empty result when env empty, org unresolvable, no git root", () => {
    const nogit = join(TMP, "nogit");
    mkdirSync(nogit, { recursive: true });
    const r = targetScript(`provider_org_get() { return 1; }\ncd '${nogit}'\nprovider_repo_target\n`, nogit);
    expect(r.status).toBe(0);
    expect(r.out).toBe("");
  });

  it("repo_split: splits owner/repo; rejects bare names", () => {
    const r = runRepos("provider_repo_split org/name o n\necho \"$o|$n\"");
    expect(r.out.trim()).toBe("org|name");
    const fail = runRepos("provider_repo_split bare o n");
    expect(fail.status).not.toBe(0);
    expect(fail.out).toContain("not owner/repo form");
  });

  // ── Reads ────────────────────────────────────────────────────────────────

  it("repos view: repo passed positionally (gh 2.95 dropped -R here)", () => {
    const r = runRepos("provider_repos_view org/repo --json name");
    expect(r.status).toBe(0);
    expect(logHas("^gh repo view org/repo --json name$")).toBe(true);
    expect(logHas("^gh repo view -R")).toBe(false);
  });

  it("repos view: no -R when repo omitted (cwd resolution)", () => {
    const r = runRepos("provider_repos_view --json name");
    expect(r.status).toBe(0);
    expect(logHas("^gh repo view --json name$")).toBe(true);
  });

  it("repos list: positional org with limit", () => {
    const r = runRepos("provider_repos_list myorg --limit 10 --json name");
    expect(r.status).toBe(0);
    expect(logHas("^gh repo list myorg --limit 10 --json name$")).toBe(true);
  });

  it("repos default branch: queries the REST endpoint", () => {
    const r = runRepos("provider_repos_default_branch org/repo");
    expect(r.status).toBe(0);
    expect(logHas("^gh api repos/org/repo --jq .default_branch$")).toBe(true);
  });

  // ── Mutations ────────────────────────────────────────────────────────────

  it("repos create: name and flags pass through", () => {
    const r = runRepos("provider_repos_create newrepo --private");
    expect(r.status).toBe(0);
    expect(logHas("^gh repo create newrepo --private$")).toBe(true);
  });

  it("repos edit: template flip passes through", () => {
    const r = runRepos("provider_repos_edit org/repo --template");
    expect(r.status).toBe(0);
    expect(logHas("^gh repo edit org/repo --template$")).toBe(true);
  });

  it("repos protect branch: PUT to the protection endpoint with payload", () => {
    const payload = join(TMP, "payload.json");
    writeFileSync(payload, '{"required_status_checks":null}');
    const r = runRepos(`provider_repos_protect_branch org/repo main '${payload}'`);
    expect(r.status).toBe(0);
    expect(logHas(`^gh api -X PUT --input ${payload} repos/org/repo/branches/main/protection$`)).toBe(true);
  });

  it("repos team put: PUT to the org teams endpoint", () => {
    const r = runRepos("provider_repos_team_put myorg myteam org/repo");
    expect(r.status).toBe(0);
    expect(logHas("^gh api -X PUT orgs/myorg/teams/myteam/repos/org/repo$")).toBe(true);
  });

  it("repos collaborator put: PUT to the collaborators endpoint", () => {
    const r = runRepos("provider_repos_collaborator_put org/repo someuser");
    expect(r.status).toBe(0);
    expect(logHas("^gh api -X PUT repos/org/repo/collaborators/someuser$")).toBe(true);
  });

  it("repos patch: PATCH with field args", () => {
    const muts = join(TMP, "mutations.log");
    const r = runRepos("provider_repos_patch org/repo -f description=x", { STUB_GH_MUTATIONS: muts });
    expect(r.status).toBe(0);
    expect(spawnSync("grep", ["-q", "PATCH", muts]).status).toBe(0);
  });

  it("repos protect branch: not issued when repo spec is bare (invalid)", () => {
    // bare name would put the PUT on an unresolvable endpoint; the facade
    // validates the spec before calling gh
    const r = runRepos("provider_repos_protect_branch bare main /dev/null");
    expect(r.status).not.toBe(0);
    expect(ghCount()).toBe(0);
  });

  // ── Full-chain repo target ───────────────────────────────────────────────

  it("repo_target: org + cwd basename when env chain empty", () => {
    const repoDir = join(TMP, "cwd-repo");
    initRepo(repoDir);
    const r = targetScript(`provider_org_get() { echo cfg-org; }\ncd '${repoDir}'\nprovider_repo_target\n`, repoDir);
    expect(r.status).toBe(0);
    expect(r.out).toBe("cfg-org/cwd-repo");
  });

  it("repo_target: partial-form GH_REPO does not shadow cwd resolution", () => {
    const repoDir = join(TMP, "cwd-repo2");
    initRepo(repoDir);
    const r = targetScript(
      `provider_org_get() { echo cfg-org; }\nGH_REPO=justname\nexport GH_REPO\ncd '${repoDir}'\nprovider_repo_target\n`,
      repoDir,
    );
    expect(r.status).toBe(0);
    expect(r.out).toBe("cfg-org/cwd-repo2");
  });

  // ── URL/host seam (urls.bash) ────────────────────────────────────────────

  it("urls: transport URL is clean https org form", () => {
    let r = runRepos(`source '${TOOLS}/lib/providers/github/urls.bash'\nprovider_git_transport_url org repo`);
    expect(r.status).toBe(0);
    expect(r.out.trim()).toBe("https://github.com/org/repo.git");
    r = runRepos("provider_git_transport_url org ''");
    expect(r.status).not.toBe(0);
  });

  it("urls: web URL builds repo-relative links", () => {
    const r = runRepos(`source '${TOOLS}/lib/providers/github/urls.bash'\nprovider_web_url org/repo pull/12`);
    expect(r.status).toBe(0);
    expect(r.out.trim()).toBe("https://github.com/org/repo/pull/12");
  });

  it("urls: extract_url pulls first URL, path filter narrows", () => {
    let r = spawnSync(
      "bash",
      ["-c", `source '${TOOLS}/lib/providers/github/urls.bash'\nprintf 'junk\\nhttps://github.com/o/r/pull/9 tail\\nhttps://github.com/o/r/issues/3\\n' | provider_extract_url`],
      { encoding: "utf8", env: ENV() },
    );
    expect((r.stdout ?? "").trim()).toBe("https://github.com/o/r/pull/9");
    r = spawnSync(
      "bash",
      ["-c", `source '${TOOLS}/lib/providers/github/urls.bash'\nprintf 'x https://github.com/o/r/pull/9\\ny https://github.com/o/r/issues/3\\n' | provider_extract_url issues/`],
      { encoding: "utf8", env: ENV() },
    );
    expect((r.stdout ?? "").trim()).toBe("https://github.com/o/r/issues/3");
  });

  it("urls: extract_url returns nonzero when nothing matches", () => {
    const r = spawnSync(
      "bash",
      ["-c", `printf 'nothing\\n' | { source '${TOOLS}/lib/providers/github/urls.bash'; provider_extract_url; }`],
      { encoding: "utf8", env: ENV() },
    );
    expect(r.status ?? 1).not.toBe(0);
  });

  it("urls: remote_to_web normalizes ssh and https forms, rejects foreign hosts", () => {
    let r = runRepos(`source '${TOOLS}/lib/providers/github/urls.bash'\nprovider_remote_to_web "git@github.com:org/repo.git"`);
    expect(r.out.trim()).toBe("https://github.com/org/repo");
    r = runRepos(`source '${TOOLS}/lib/providers/github/urls.bash'\nprovider_remote_to_web "https://github.com/org/repo.git"`);
    expect(r.out.trim()).toBe("https://github.com/org/repo");
    r = runRepos(`source '${TOOLS}/lib/providers/github/urls.bash'\nprovider_remote_to_web "https://gitlab.com/org/repo.git"`);
    expect(r.status).not.toBe(0);
  });

  // ── Org releases ─────────────────────────────────────────────────────────

  it("org releases: empty repo is a defined failure (required owner/repo)", () => {
    const r = runRepos(`source '${TOOLS}/lib/providers/github/org.bash'\nprovider_org_releases_list ""`);
    expect(r.status).not.toBe(0);
    expect(r.out).toContain("owner/repo");
  });

  it("org releases: non owner/repo form is rejected", () => {
    const r = runRepos(`source '${TOOLS}/lib/providers/github/org.bash'\nprovider_org_releases_list "just-a-name"`);
    expect(r.status).not.toBe(0);
  });

  // ── Env override chain ───────────────────────────────────────────────────

  it("repo target: DEVENV_REPO is the single env override", () => {
    const r = spawnSync(
      "bash",
      ["-c", `source '${TOOLS}/lib/providers/github/repos.bash' && provider_repo_target`],
      { encoding: "utf8", env: ENV({ DEVENV_REPO: "new/repo", GITHUB_REPO: "old/repo" }) },
    );
    expect((r.stdout ?? "").trim()).toBe("new/repo");
  });

  it("repo target: GITHUB_REPO has no effect (no devenv alias exists)", () => {
    // The seed path is isolated too (a real DEVENV_ROOT seed would otherwise
    // satisfy the cwd leg and mask the assertion).
    const isolatedRoot = join(TMP, "no-seed-root-b");
    mkdirSync(isolatedRoot, { recursive: true });
    mkdirSync(join(TMP, "nogit-b"), { recursive: true });
    const r = spawnSync(
      "bash",
      ["-c", `source '${TOOLS}/lib/providers/github/repos.bash' && provider_repo_target`],
      { encoding: "utf8", cwd: join(TMP, "nogit-b"), env: ENV({ DEVENV_ROOT: isolatedRoot, GITHUB_REPO: "old/repo", DEVENV_REPO: "" }) },
    );
    expect(r.status ?? 1).toBe(0);
    expect((r.stdout ?? "").trim()).toBe("");
  });
});
