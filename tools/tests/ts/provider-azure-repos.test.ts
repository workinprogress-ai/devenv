// Port of tools/tests/lib/test_provider_azure_repos.bats (42 tests) — one
// vitest `it` per source `@test`. The azure provider repos + urls domains:
// remote parsing (https + ssh), web-URL building, provider_repos_view/list
// output shapes, and org/project config resolution. Transport via stub curl.
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
let DEVENV_ROOT = "";

const CURL_STUB = [
  "#!/usr/bin/env bash",
  'url=""',
  'prev=""',
  'out_file=""',
  'write_fmt=""',
  'headers_file=""',
  'for arg in "$@"; do',
  '  if [[ "$prev" == "-D" ]]; then headers_file="$arg"; fi',
  '  [[ "$prev" == "-o" ]] && out_file="$arg"',
  '  [[ "$prev" == "-w" ]] && write_fmt="$arg"',
  '  prev="$arg"',
  "done",
  'for arg in "$@"; do [[ "$arg" == "@-" ]] && { cat > /dev/null; break; }; done',
  'for arg in "$@"; do',
  '  case "$arg" in -*) prev="$arg"; continue ;; esac',
  '  if [[ "$prev" != "-D" && "$prev" != "-o" && "$prev" != "-u" && "$prev" != "-X" && "$prev" != "-d" && "$prev" != "-H" && "$prev" != "-w" ]]; then url="$arg"; fi',
  '  prev="$arg"',
  "done",
  'echo "curl $url" >> "${STUB_CALL_LOG:?}"',
  'if [[ -n "${STUB_CURL_REQUEST_BODY:-}" ]]; then',
  '  prev=""',
  '  for arg in "$@"; do',
  "    [[ \"$prev\" == \"-d\" ]] && printf '%s\\n' \"$arg\" >> \"$STUB_CURL_REQUEST_BODY\"",
  '    prev="$arg"',
  "  done",
  "fi",
  'if [[ "${STUB_CURL_FAIL:-0}" == "1" ]]; then exit 7; fi',
  'headers_file="${headers_file:-/dev/null}"',
  'code="${STUB_CURL_HTTP_CODE:-200}"',
  "emit_body() { [[ -f \"$1\" ]] || { [[ -n \"$out_file\" ]] && : > \"$out_file\"; return 0; }; if [[ -n \"$out_file\" ]]; then cat \"$1\" > \"$out_file\"; else cat \"$1\"; fi; }",
  "emit_write_out() { [[ -n \"$write_fmt\" ]] || return 0; printf '%b' \"${write_fmt//%\\{http_code\\}/$code}\"; }",
  "{",
  "  printf 'HTTP/1.1 %s OK\\r\\n' \"$code\"",
  '  if [[ "$code" == "429" && -n "${STUB_CURL_RETRY_AFTER:-}" ]]; then',
  "    printf 'Retry-After: %s\\r\\n' \"$STUB_CURL_RETRY_AFTER\"",
  "  fi",
  "  printf '\\r\\n'",
  "} > \"$headers_file\"",
  'if [[ -n "${STUB_CURL_PAGES:-}" && -f "${STUB_CURL_PAGES}" ]]; then',
  '  if [[ -s "$STUB_CURL_PAGES" ]]; then',
  '    page_file=$(head -n 1 "$STUB_CURL_PAGES")',
  '    tail -n +2 "$STUB_CURL_PAGES" > "$STUB_CURL_PAGES.tmp" && mv "$STUB_CURL_PAGES.tmp" "$STUB_CURL_PAGES"',
  "    emit_body \"$page_file\"",
  "    emit_write_out",
  "    exit 0",
  "  fi",
  "  emit_write_out",
  "  exit 0",
  "fi",
  'emit_body "${STUB_CURL_RESPONSE:-/nonexistent}"',
  "emit_write_out",
  "exit 0",
  "",
].join("\n");

beforeEach(() => {
  TMP = mkdtempSync(join(tmpdir(), `azrepos-${Date.now()}-${Math.random().toString(36).slice(2)}`));
  CALL_LOG = join(TMP, "stub-calls.log");
  DEVENV_ROOT = join(TMP, "devenv-root");
  mkdirSync(DEVENV_ROOT, { recursive: true });
  writeFileSync(CALL_LOG, "");
  const bin = join(TMP, "stub-bin");
  mkdirSync(bin, { recursive: true });
  writeFileSync(join(bin, "curl"), CURL_STUB);
  chmodSync(join(bin, "curl"), 0o755);
  writeFileSync(join(bin, "sleep"), "#!/usr/bin/env bash\nexit 0\n");
  chmodSync(join(bin, "sleep"), 0o755);
  writeFileSync(join(TMP, "azure.pat"), "test-pat\n");
});

const ENV = (extra: Record<string, string> = {}): Record<string, string> => {
  // Config-driven suite: strip sibling-suite AZURE_DEVOPS_* leaks so the
  // per-test devenv.config (not a stale env override) resolves org/project.
  const { AZURE_DEVOPS_ORG: _o, AZURE_DEVOPS_PROJECT: _p, ...cleanEnv } = process.env;
  return {
    ...cleanEnv,
    DEVENV_TOOLS: TOOLS,
    DEVENV_ROOT,
    AZURE_PAT: "test-pat",
    AZURE_PAT_FILE: join(TMP, "azure.pat"),
    STUB_CALL_LOG: CALL_LOG,
    STUB_CURL_RESPONSE: join(TMP, "curl-response"),
    PATH: `${join(TMP, "stub-bin")}:${cleanEnv.PATH ?? ""}`,
    ...extra,
  };
};

function writeOrgProjectConfig(org: string, project: string): void {
  writeFileSync(join(DEVENV_ROOT, "devenv.config"), `[provider]\nname=azure\nazure_org=${org}\nazure_project=${project}\n`);
}

// azure_libs_source + call. Stdin closed (credential header rides -H @-).
// Org/project pinned from config per test — most tests write devenv.config
// themselves; this defaults to org/proj for the pure-parser tests.
function azVerb(call: string, extraEnv: Record<string, string> = {}): { status: number; out: string } {
  const script =
    `source '${TOOLS}/lib/providers/provider-core.bash'\n` +
    `PROVIDER_NAME=azure\n` +
    ["http", "urls", "repos"].map((m) => `source '${TOOLS}/lib/providers/azure/${m}.bash'\n`).join("") +
    `${call}\n`;
  const r = spawnSync("bash", ["-c", script], {
    input: "",
    encoding: "utf8",
    env: ENV(extraEnv),
  });
  return { status: r.status ?? 1, out: (r.stdout ?? "") + (r.stderr ?? "") };
}

function logHas(pattern: string): boolean {
  return spawnSync("grep", ["-q", pattern, CALL_LOG]).status === 0;
}

function jqOk(json: string, args: string[]): boolean {
  return spawnSync("jq", args, { input: json, stdio: ["pipe", "ignore", "ignore"] }).status === 0;
}

// A curl that answers by URL/method: repository, policy list, project guid,
// graph identities and the ACE POST (the source's policy_curl fixture).
function policyCurl(): string {
  writeFileSync(
    join(TMP, "stub-bin", "curl"),
    [
      "#!/usr/bin/env bash",
      'method=GET; url=""; prev=""',
      'for arg in "$@"; do',
      '  [[ "$prev" == "-D" ]] && printf \'HTTP/1.1 200 OK\\r\\n\\r\\n\' > "$arg"',
      '  [[ "$prev" == "-X" ]] && method="$arg"',
      '  prev="$arg"; url="$arg"',
      "done",
      'echo "$method $url" >> "$CALLS"',
      'case "$url" in',
      '  *policy/configurations*) cat "$CONFIGS" ;;',
      '  *graph/groups*) cat "$GROUPS_JSON" ;;',
      "  *_apis/projects/*) printf '{\"id\":\"proj-guid\"}' ;;",
      "  *accesscontrolentries*) printf '{\"value\":[]}' ;;",
      "  *repositories*) printf '{\"id\":\"g3\",\"name\":\"r3\",\"defaultBranch\":\"refs/heads/master\"}' ;;",
      "  *) printf '{}' ;;",
      "esac",
      "",
    ].join("\n"),
  );
  chmodSync(join(TMP, "stub-bin", "curl"), 0o755);
  const calls = join(TMP, "calls.log");
  writeFileSync(calls, "");
  return calls;
}

describe("provider azure repos", () => {
  // ── Remote URL parsing ───────────────────────────────────────────────────

  it("azure_parse_remote handles https form with .git suffix", () => {
    const r = azVerb("azure_parse_remote 'https://dev.azure.com/myorg/myproj/_git/myrepo.git'");
    expect(r.status).toBe(0);
    expect(r.out.trim()).toBe("myorg/myproj/myrepo");
  });

  it("azure_parse_remote decodes percent-escapes so a name with a space is encoded exactly once", () => {
    const r = azVerb("azure_parse_remote 'https://dev.azure.com/myorg/My%20Project/_git/r%C3%A9po'");
    expect(r.status).toBe(0);
    expect(r.out.trim()).toBe("myorg/My Project/répo");
    // The request builders encode the decoded name once.
    const r2 = azVerb("provider_remote_to_spec 'https://dev.azure.com/myorg/My%20Project/_git/myrepo'\nazure_uri 'My Project'");
    const lines = r2.out.trim().split("\n");
    expect(lines[0]).toBe("My Project/myrepo");
    expect(lines[1]).toBe("My%20Project");
  });

  it("provider_remote_to_web re-encodes a decoded name for the web form", () => {
    const r = azVerb("provider_remote_to_web 'https://dev.azure.com/myorg/My%20Project/_git/myrepo'");
    expect(r.out.trim()).toBe("https://dev.azure.com/myorg/My%20Project/_git/myrepo");
  });

  it("azure_uri_decode leaves a stray percent sign alone", () => {
    let r = azVerb("azure_uri_decode '100%'");
    expect(r.out.trim()).toBe("100%");
    r = azVerb("azure_uri_decode 'a%2Fb%zz'");
    expect(r.out.trim()).toBe("a/b%zz");
  });

  it("azure_parse_remote handles https form without suffix", () => {
    const r = azVerb("azure_parse_remote 'https://dev.azure.com/myorg/myproj/_git/myrepo'");
    expect(r.status).toBe(0);
    expect(r.out.trim()).toBe("myorg/myproj/myrepo");
  });

  it("azure_parse_remote handles ssh v3 form", () => {
    const r = azVerb("azure_parse_remote 'git@ssh.dev.azure.com:v3/myorg/myproj/myrepo'");
    expect(r.status).toBe(0);
    expect(r.out.trim()).toBe("myorg/myproj/myrepo");
  });

  it("azure_parse_remote rejects a github remote", () => {
    const r = azVerb("azure_parse_remote 'https://github.com/org/repo.git'");
    expect(r.status).not.toBe(0);
    expect(r.out).toMatch(/not a recognized Azure DevOps remote/);
  });

  // ── Web URLs ─────────────────────────────────────────────────────────────

  it("provider_web_host reports dev.azure.com", () => {
    const r = azVerb("provider_web_host");
    expect(r.out.trim()).toBe("dev.azure.com");
  });

  it("provider_web_url builds org/project/repo/path links", () => {
    const r = azVerb("provider_web_url 'myorg/myproj/myrepo' 'pullrequest/12'");
    expect(r.status).toBe(0);
    expect(r.out.trim()).toBe("https://dev.azure.com/myorg/myproj/myrepo/pullrequest/12");
  });

  it("provider_web_url requires repo and path", () => {
    const r = azVerb("provider_web_url 'myorg/myproj/myrepo'");
    expect(r.status).not.toBe(0);
  });

  it("provider_extract_url finds azure pull request URLs", () => {
    const r = azVerb(
      `printf '%s' "created https://dev.azure.com/myorg/myproj/myrepo/pullrequest/12 today" | provider_extract_url 'pullrequest'`,
    );
    expect(r.status).toBe(0);
    expect(r.out.trim()).toBe("https://dev.azure.com/myorg/myproj/myrepo/pullrequest/12");
  });

  // ── provider_repos_view / list ───────────────────────────────────────────

  it("provider_repos_view returns repoSpec in project/repo form", () => {
    const resp = join(TMP, "resp.json");
    writeFileSync(resp, '{"name":"myrepo","project":{"name":"myproj"},"isPrivate":true}');
    writeOrgProjectConfig("myorg", "myproj");
    const r = azVerb("provider_repos_view myorg/myproj/myrepo --json repoSpec", { STUB_CURL_RESPONSE: resp });
    expect(r.status).toBe(0);
    expect(r.out.trim()).toBe("myproj/myrepo");
    expect(logHas("dev.azure.com/myorg/myproj/_apis/git/repositories/myrepo")).toBe(true);
    expect(logHas("api-version=7.1")).toBe(true);
  });

  it("provider_repos_view maps gh name field to azure .name", () => {
    const resp = join(TMP, "resp.json");
    writeFileSync(resp, '{"name":"myrepo","project":{"name":"myproj"},"defaultBranch":"refs/heads/main"}');
    writeOrgProjectConfig("myorg", "myproj");
    const r = azVerb("provider_repos_view myorg/myproj/myrepo --json name", { STUB_CURL_RESPONSE: resp });
    expect(r.status).toBe(0);
    expect(r.out.trim()).toBe("myrepo");
  });

  it("provider_repos_view maps defaultBranchRef via refs-stripping projection", () => {
    const resp = join(TMP, "resp.json");
    writeFileSync(resp, '{"name":"myrepo","project":{"name":"myproj"},"defaultBranch":"refs/heads/main"}');
    writeOrgProjectConfig("myorg", "myproj");
    const r = azVerb("provider_repos_view myrepo --json defaultBranchRef", { STUB_CURL_RESPONSE: resp });
    expect(r.status).toBe(0);
    expect(r.out.trim()).toBe("refs/heads/main");
  });

  it("provider_repos_view comma field list emits one gh-shaped object", () => {
    const resp = join(TMP, "resp.json");
    writeFileSync(resp, '{"name":"myrepo","project":{"name":"myproj"},"defaultBranch":"refs/heads/dev"}');
    writeOrgProjectConfig("myorg", "myproj");
    const r = azVerb("provider_repos_view myrepo --json name,repoSpec,defaultBranchRef", { STUB_CURL_RESPONSE: resp });
    expect(r.status).toBe(0);
    expect(jqOk(r.out, ["-e", "."])).toBe(true);
    const composed = spawnSync("jq", ["-r", '.name + "|" + .repoSpec + "|" + .defaultBranchRef.name'], {
      input: r.out,
      encoding: "utf8",
    }).stdout ?? "";
    expect(composed.trim()).toBe("myrepo|myproj/myrepo|refs/heads/dev");
  });

  it("provider_repos_default_branch strips refs/heads prefix", () => {
    const resp = join(TMP, "resp.json");
    writeFileSync(resp, '{"name":"myrepo","project":{"name":"myproj"},"defaultBranch":"refs/heads/main"}');
    writeOrgProjectConfig("myorg", "myproj");
    const r = azVerb("provider_repos_default_branch myrepo", { STUB_CURL_RESPONSE: resp });
    expect(r.status).toBe(0);
    expect(r.out.trim()).toBe("main");
  });

  it("provider_remote_to_web normalizes both azure remote forms", () => {
    let r = azVerb("provider_remote_to_web 'https://dev.azure.com/myorg/myproj/_git/myrepo.git'");
    expect(r.status).toBe(0);
    expect(r.out.trim()).toBe("https://dev.azure.com/myorg/myproj/_git/myrepo");
    r = azVerb("provider_remote_to_web 'git@ssh.dev.azure.com:v3/myorg/myproj/myrepo'");
    expect(r.status).toBe(0);
    expect(r.out.trim()).toBe("https://dev.azure.com/myorg/myproj/_git/myrepo");
    r = azVerb("provider_remote_to_web 'git@github.com:other/repo.git'");
    expect(r.status).not.toBe(0);
  });

  it("repo-target cwd hook composes the two-part project/basename", () => {
    writeOrgProjectConfig("myorg", "myproj");
    // Simulate a git root: run inside a git-init'd fixture dir.
    const cwd = join(TMP, "azure-cwd");
    mkdirSync(cwd, { recursive: true });
    spawnSync("git", ["-C", cwd, "init", "-q"]);
    const script =
      `source '${TOOLS}/lib/providers/provider-core.bash'\n` +
      `PROVIDER_NAME=azure\nsource '${TOOLS}/lib/providers/azure/repos.bash'\n` +
      `provider_repo_target\n`;
    const r = spawnSync("bash", ["-c", script], { input: "", encoding: "utf8", cwd, env: ENV() });
    expect(r.status ?? 1).toBe(0);
    expect((r.stdout ?? "").trim()).toBe("myproj/azure-cwd");
  });

  it("provider_repo_args passes an explicit spec through untouched", () => {
    const r = azVerb(
      `declare -a args\nprovider_repo_args args "myorg/myproj/myrepo"\necho "\${#args[@]}|\${args[0]}"`,
    );
    expect(r.status).toBe(0);
    expect(r.out.trim()).toBe("1|myorg/myproj/myrepo");
  });

  it("provider_repo_args with no spec yields an empty arg list", () => {
    const r = azVerb(`declare -a args=(sentinel)\nprovider_repo_args args ""\necho "\${#args[@]}"`);
    expect(r.status).toBe(0);
    expect(r.out.trim()).toBe("0");
  });

  it("repo_split splits a three-part azure spec at the first slash (generic contract)", () => {
    const r = azVerb(`provider_repo_split 'myorg/myproj/myrepo' HEAD TAIL\necho "$HEAD|$TAIL"`);
    expect(r.status).toBe(0);
    expect(r.out.trim()).toBe("myorg|myproj/myrepo");
  });

  it("repo_split fails defined when the spec has no separator", () => {
    const r = azVerb("provider_repo_split SPEC 'plainrepo' HEAD TAIL");
    expect(r.status).not.toBe(0);
    expect(r.out).toMatch(/owner\/repo/);
  });

  it("provider_repos_view resolves bare repo name from config", () => {
    const resp = join(TMP, "resp.json");
    writeFileSync(resp, '{"name":"cfgrepo","project":{"name":"cfgproj"}}');
    writeOrgProjectConfig("cfgorg", "cfgproj");
    const r = azVerb("provider_repos_view cfgrepo --json repoSpec", { STUB_CURL_RESPONSE: resp });
    expect(r.status).toBe(0);
    expect(r.out.trim()).toBe("cfgproj/cfgrepo");
  });

  it("provider_repos_view without org/project config fails with guidance", () => {
    writeFileSync(join(DEVENV_ROOT, "devenv.config"), "[provider]\nname=azure\n");
    const r = azVerb("provider_repos_view solo");
    expect(r.status).not.toBe(0);
    expect(r.out).toMatch(/azure_org/);
  });

  it("provider_repos_list returns gh-shaped name/repoSpec entries", () => {
    const resp = join(TMP, "resp.json");
    writeFileSync(resp, '{"value":[{"name":"r1","project":{"name":"p1"}},{"name":"r2","project":{"name":"p1"}}]}');
    writeOrgProjectConfig("org", "p1");
    const r = azVerb("provider_repos_list org/p1", { STUB_CURL_RESPONSE: resp });
    expect(r.status).toBe(0);
    expect(logHas("dev.azure.com/org/p1/_apis/git/repositories")).toBe(true);
  });

  it("provider_repos_list --json/-q yield one repo name per line (org-sweep iteration shape)", () => {
    // pipelines-status/list iterate `while read -r repo` over the output —
    // the whole array on one line would iterate once with a JSON blob.
    const resp = join(TMP, "resp.json");
    writeFileSync(resp, '{"value":[{"name":"r1","project":{"name":"p1"}},{"name":"r2","project":{"name":"p1"}}]}');
    writeOrgProjectConfig("org", "p1");
    const r = azVerb("provider_repos_list org --json name -q '.[].name'", { STUB_CURL_RESPONSE: resp });
    expect(r.status).toBe(0);
    const lines = r.out.split("\n").filter((l) => l.trim() !== "");
    expect(lines[0]).toBe("r1");
    expect(lines[1]).toBe("r2");
    expect(lines.length).toBe(2);
  });

  it("provider_repos_list fails typed when the API errors", () => {
    writeOrgProjectConfig("o", "p");
    const err = join(TMP, "err401.json");
    writeFileSync(err, '{"message":"TF401: unauthorized"}');
    const r = azVerb("provider_repos_list o/p", {
      STUB_CURL_HTTP_CODE: "401",
      STUB_CURL_RESPONSE: err,
    });
    expect(r.status).not.toBe(0);
  });

  // ── provider_repos_commits_count ─────────────────────────────────────────

  it("provider_repos_commits_count succeeds when the repo has commits", () => {
    const commits = join(TMP, "commits.json");
    writeFileSync(commits, '{"count":1,"value":[{"commitId":"abc"}]}');
    writeOrgProjectConfig("o1", "p1");
    const r = azVerb("provider_repos_commits_count o1/p1/r1", { STUB_CURL_RESPONSE: commits });
    expect(r.status).toBe(0);
  });

  it("provider_repos_commits_count fails defined on an empty repo", () => {
    const nocommits = join(TMP, "nocommits.json");
    writeFileSync(nocommits, '{"count":0,"value":[]}');
    writeOrgProjectConfig("o1", "p1");
    const r = azVerb("provider_repos_commits_count o1/p1/r1", { STUB_CURL_RESPONSE: nocommits });
    expect(r.status).not.toBe(0);
  });

  // ── Provisioning verbs ───────────────────────────────────────────────────

  it("provider_repos_create POSTs the repo document", () => {
    writeOrgProjectConfig("o1", "p1");
    const created = join(TMP, "created.json");
    const crbody = join(TMP, "crbody.log");
    writeFileSync(created, '{"name":"r1","id":"g1"}');
    writeFileSync(crbody, "");
    const r = azVerb('provider_repos_create o1/p1/r1 --description "d"', {
      STUB_CURL_RESPONSE: created,
      STUB_CURL_REQUEST_BODY: crbody,
    });
    expect(r.status).toBe(0);
    const body = spawnSync("cat", [crbody], { encoding: "utf8" }).stdout ?? "";
    expect(jqOk(body, ["-e", '.name == "r1" and .description == "d"'])).toBe(true);
  });

  it("provider_repos_patch skips merge-strategy knobs with a warning", () => {
    writeOrgProjectConfig("o1", "p1");
    const r = azVerb("provider_repos_patch o1/p1/r1 -F allow_squash_merge=true -F description=x");
    expect(r.status).toBe(0);
    expect(r.out).toMatch(/merge strategies are project-policy/);
  });

  it("provider_repos_protect_branch posts a minimum-reviewers policy", () => {
    writeOrgProjectConfig("o1", "p1");
    const r3 = join(TMP, "r3.json");
    const protection = join(TMP, "protection.json");
    const pbbody = join(TMP, "pbbody.log");
    writeFileSync(r3, '{"name":"r3","id":"g3"}');
    writeFileSync(protection, '{"required_pull_request_reviews":{"required_approving_review_count":2}}');
    writeFileSync(pbbody, "");
    const queue = join(TMP, "pb.queue");
    writeFileSync(queue, `${r3}\n`);
    const r = azVerb(`provider_repos_protect_branch o1/p1/r3 main '${protection}'`, {
      STUB_CURL_PAGES: queue,
      STUB_CURL_REQUEST_BODY: pbbody,
    });
    expect(r.status).toBe(0);
    const body = spawnSync("cat", [pbbody], { encoding: "utf8" }).stdout ?? "";
    expect(jqOk(body, ["-e", '.settings.minimumApproverCount == 2 and .settings.scope[0].refName == "refs/heads/main"'])).toBe(true);
  });

  it("azure_identity_sddl decodes the URL-safe base64 descriptor", () => {
    const r = azVerb("azure_identity_sddl 'vssgp.dGVzdC1pZGVudGl0eQ'");
    expect(r.out.startsWith("Microsoft.TeamFoundation.Identity;")).toBe(true);
    expect(r.out).toContain("test-identity");
  });

  it("azure_grant_bits maps the GH vocabulary", () => {
    const bits = (word: string): { out: string; status: number } => {
      const r = azVerb(`azure_grant_bits ${word}`);
      return { out: r.out.trim(), status: r.status };
    };
    expect(bits("pull").out).toBe("2");
    expect(bits("push").out).toBe("54");
    expect(bits("maintain").out).toBe("2230");
    expect(bits("admin").out).toBe("3967");
    expect(bits("owner").status).not.toBe(0);
  });

  // ── protect_branch idempotence, ACL identity match, repos_view -q ───────

  it("provider_repos_protect_branch updates the policy already on that branch instead of creating a duplicate", () => {
    const protection = join(TMP, "protection.json");
    const configs = join(TMP, "configs.json");
    writeFileSync(protection, '{"required_pull_request_reviews":{"required_approving_review_count":2}}');
    writeFileSync(configs, '{"value":[{"id":11,"type":{"id":"fa4e907d-c16b-4a4c-9dfa-4906e5d171dd"},"settings":{"scope":[{"repositoryId":"g3","refName":"refs/heads/main"}]}}]}');
    const calls = policyCurl();
    const r = azVerb(`provider_repos_protect_branch o1/p1/r3 main '${protection}'`, {
      CONFIGS: configs,
      CALLS: calls,
    });
    expect(r.status).toBe(0);
    expect(spawnSync("grep", ["-q", "-e", "PUT .*policy/configurations/11", calls]).status).toBe(0);
    expect(spawnSync("grep", ["-qE", "^POST .*policy/configurations", calls]).status).not.toBe(0);
  });

  it("provider_repos_protect_branch creates the policy when the branch has none", () => {
    const protection = join(TMP, "protection2.json");
    const configs = join(TMP, "configs2.json");
    writeFileSync(protection, "{}");
    writeFileSync(configs, '{"value":[]}');
    const calls = policyCurl();
    const r = azVerb(`provider_repos_protect_branch o1/p1/r3 main '${protection}'`, {
      CONFIGS: configs,
      CALLS: calls,
    });
    expect(r.status).toBe(0);
    expect(spawnSync("grep", ["-qE", "^POST .*policy/configurations", calls]).status).toBe(0);
  });

  it("azure_acl_grant matches a group by its project-scoped principal name, not by display name alone", () => {
    const groups = join(TMP, "groups.json");
    const configs = join(TMP, "configs3.json");
    writeFileSync(
      groups,
      '{"value":[\n {"displayName":"Contributors","principalName":"[other]\\\\Contributors","descriptor":"vssgp.OTHER"},\n {"displayName":"Contributors","principalName":"[p1]\\\\Contributors","descriptor":"vssgp.MINE"}]}',
    );
    writeFileSync(configs, '{"value":[]}');
    const calls = policyCurl();
    const r = azVerb("azure_acl_grant groups Contributors o1/p1/r3 push", {
      GROUPS_JSON: groups,
      CONFIGS: configs,
      CALLS: calls,
    });
    expect(r.status).toBe(0);
    // The ACE is written for the descriptor of the matching project's group.
    expect(spawnSync("grep", ["-q", "-e", "POST .*accesscontrolentries", calls]).status).toBe(0);
  });

  it("azure_acl_grant refuses a name that matches more than one identity", () => {
    const groups = join(TMP, "groups2.json");
    writeFileSync(
      groups,
      '{"value":[\n {"displayName":"Readers","principalName":"[p1]\\\\Readers","descriptor":"vssgp.A"},\n {"displayName":"Readers","principalName":"[p1]\\\\Readers","descriptor":"vssgp.B"}]}',
    );
    const calls = policyCurl();
    const r = azVerb("azure_acl_grant groups Readers o1/p1/r3 push", {
      GROUPS_JSON: groups,
      CONFIGS: groups,
      CALLS: calls,
    });
    expect(r.status).not.toBe(0);
    expect(r.out).toContain("more than one identity");
  });

  it("azure_acl_grant fails when no identity matches", () => {
    const groups = join(TMP, "groups3.json");
    writeFileSync(groups, '{"value":[{"displayName":"Other","principalName":"[p1]\\\\Other","descriptor":"vssgp.X"}]}');
    const calls = policyCurl();
    const r = azVerb("azure_acl_grant groups Missing o1/p1/r3 push", {
      GROUPS_JSON: groups,
      CONFIGS: groups,
      CALLS: calls,
    });
    expect(r.status).not.toBe(0);
    expect(r.out).toContain("not found");
  });

  it("provider_repos_view applies -q to the projected object", () => {
    const repo = join(TMP, "repo.json");
    writeFileSync(repo, '{"name":"r1","project":{"name":"p1"},"defaultBranch":"refs/heads/main"}');
    const r = azVerb("provider_repos_view o1/p1/r1 --json name,defaultBranchRef -q '.defaultBranchRef.name'", {
      STUB_CURL_RESPONSE: repo,
    });
    expect(r.status).toBe(0);
    expect(r.out.trim()).toBe("refs/heads/main");
  });

  it("provider_repos_view of an empty repository (no default branch) fails instead of printing null", () => {
    const emptyRepo = join(TMP, "empty-repo.json");
    writeFileSync(emptyRepo, '{"name":"r1","project":{"name":"p1"}}');
    const r = azVerb("provider_repos_view o1/p1/r1 --json defaultBranchRef", { STUB_CURL_RESPONSE: emptyRepo });
    expect(r.status).not.toBe(0);
    expect(r.out).not.toContain("null");
  });

  it("provider_repos_view takes the two-part project/repo spec, the org coming from config", () => {
    writeOrgProjectConfig("org", "cfgproj");
    const repo = join(TMP, "repo2.json");
    writeFileSync(repo, '{"name":"r1","project":{"name":"p1"}}');
    const r = azVerb("provider_repos_view p1/r1 --json name", { STUB_CURL_RESPONSE: repo });
    expect(r.status).toBe(0);
    expect(r.out.trim()).toBe("r1");
    expect(logHas("org/p1/_apis/git/repositories/r1")).toBe(true);
  });
});
