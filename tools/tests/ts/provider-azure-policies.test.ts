// Port of tools/tests/lib/test_provider_azure_policies.bats (17 tests): azure
// policies + provisioning verbs that need multi-step transport chains (repo
// -guid resolution → create/translate). Order-sensitive multi-GET queue
// harness; per-test curl stubs record METHOD URL and serve canned bodies.
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
let BIN = "";
let DEVENV_ROOT = "";
let CALLS = "";

// load_policy_libs: core + azure http/auth/urls/repos/policies sourced.
const LIBS =
  `source '${TOOLS}/lib/providers/provider-core.bash'\n` +
  ["http", "auth", "urls", "repos", "policies"]
    .map((m) => `source '${TOOLS}/lib/providers/azure/${m}.bash'\n`)
    .join("");

// Default curl stub: status 200 to -D, logs "METHOD URL", body from CONFIGS.
const CURL_RECORDING = [
  "#!/usr/bin/env bash",
  'prev=""; method=GET; url=""; write_fmt=""; headers_file="/dev/null"',
  'for arg in "$@"; do',
  "  [[ \"$prev\" == \"-D\" ]] && printf 'HTTP/1.1 200 OK\\r\\n\\r\\n' > \"$arg\" && headers_file=\"$arg\"",
  '  [[ "$prev" == "-X" ]] && method="$arg"',
  '  [[ "$prev" == "-w" ]] && write_fmt="$arg"',
  '  prev="$arg"; url="$arg"',
  "done",
  'echo "$method $url" >> "$CALLS"',
  "emit_body() { [[ -f \"$1\" ]] || return 0; cat \"$1\"; }",
  "emit_write_out() { [[ -n \"$write_fmt\" ]] || return 0; printf '%b' \"${write_fmt//%\\{http_code\\}/200}\"; }",
  'if [[ -n "${STUB_CURL_PAGES:-}" && -f "${STUB_CURL_PAGES}" ]]; then',
  '  if [[ -s "$STUB_CURL_PAGES" ]]; then',
  '    page_file=$(head -n 1 "$STUB_CURL_PAGES")',
  '    tail -n +2 "$STUB_CURL_PAGES" > "$STUB_CURL_PAGES.tmp" && mv "$STUB_CURL_PAGES.tmp" "$STUB_CURL_PAGES"',
  '    [[ -s "$STUB_CURL_PAGES" ]] && printf "x-ms-continuationtoken: token-page-2\\r\\n" >> "$headers_file"',
  '    emit_body "$page_file"',
  "    emit_write_out",
  "    exit 0",
  "  fi",
  "  emit_write_out",
  "  exit 0",
  "fi",
  'emit_body "${STUB_CURL_RESPONSE:-$CONFIGS}"',
  "emit_write_out",
  "exit 0",
  "",
].join("\n");

// curl stub with METHOD-aware branching (POST → FORBIDDEN_JSON, else CONFIGS).
const CURL_POST_403 = [
  "#!/usr/bin/env bash",
  "prev=\"\"; method=GET",
  'for arg in "$@"; do',
  '  [[ "$prev" == "-X" ]] && method="$arg"',
  '  prev="$arg"',
  "done",
  'echo "$method" >> "$CALLS"',
  'if [[ "$method" == POST ]]; then',
  '  prev=""; for arg in "$@"; do [[ "$prev" == "-D" ]] && printf \'HTTP/1.1 403 Forbidden\\r\\n\\r\\n\' > "$arg"; prev="$arg"; done',
  "  printf '{\"message\":\"rejected\"}'",
  "else",
  "  prev=\"\"; for arg in \"$@\"; do [[ \"$prev\" == \"-D\" ]] && printf 'HTTP/1.1 200 OK\\r\\n\\r\\n' > \"$arg\"; prev=\"$arg\"; done",
  '  cat "$CONFIGS"',
  "fi",
  "",
].join("\n");

// curl stub keyed on the URL: repositories → REPO4_JSON, else 403 FORBIDDEN_JSON.
const CURL_URL_KEYED = [
  "#!/usr/bin/env bash",
  'url=""; prev=""',
  'for arg in "$@"; do',
  '  if [[ "$prev" == "-D" ]]; then headers_file="$arg"; fi',
  '  prev="$arg"',
  "done",
  'case "$*" in',
  "  *repositories*)",
  "    printf 'HTTP/1.1 200 OK\\r\\n\\r\\n' > \"${headers_file:-/dev/null}\"",
  '    cat "$REPO4_JSON"',
  "    ;;",
  "  *)",
  "    printf 'HTTP/1.1 403 Forbidden\\r\\n\\r\\n' > \"${headers_file:-/dev/null}\"",
  '    cat "$FORBIDDEN_JSON"',
  "    ;;",
  "esac",
  "exit 0",
  "",
].join("\n");

// _policy_stub_curl: write the recording stub, reset CALLS.
function policyStubCurl(): void {
  writeFileSync(join(BIN, "curl"), CURL_RECORDING);
  chmodSync(join(BIN, "curl"), 0o755);
  writeFileSync(CALLS, "");
}

function bash(script: string, extraEnv: Record<string, string> = {}): { status: number; out: string } {
  const r = spawnSync("bash", ["-c", script], {
    encoding: "utf8",
    env: {
      ...process.env,
      TEST_TEMP_DIR: TMP,
      DEVENV_TOOLS: TOOLS,
      DEVENV_ROOT,
      AZURE_PAT: "test-pat",
      STUB_CALL_LOG: join(TMP, "stub-calls.log"),
      PATH: `${BIN}:${process.env.PATH ?? ""}`,
      CALLS,
      ...extraEnv,
    },
  });
  return { status: r.status ?? 1, out: (r.stdout ?? "") + (r.stderr ?? "") };
}

function jqOk(json: string, expr: string): boolean {
  return (spawnSync("bash", ["-c", `jq -e ${JSON.stringify(expr)} >/dev/null`], { input: json, encoding: "utf8" }).status ?? 1) === 0;
}

beforeEach(() => {
  TMP = mkdtempSync(join(tmpdir(), `azpol-${Date.now()}-${Math.random().toString(36).slice(2)}`));
  BIN = join(TMP, "stub-bin");
  DEVENV_ROOT = join(TMP, "devenv-root");
  CALLS = join(TMP, "calls.log");
  mkdirSync(BIN, { recursive: true });
  mkdirSync(DEVENV_ROOT, { recursive: true });
  writeFileSync(
    join(DEVENV_ROOT, "devenv.config"),
    "[provider]\nname=azure\nazure_org=org\nazure_project=proj\n",
  );
  writeFileSync(CALLS, "");
  // default stub + baseline curl-response file
  policyStubCurl();
  writeFileSync(join(TMP, "curl-response"), "{}");
});

describe("azure policies: create/translate + transport contract", () => {
  it("provider_org_ruleset_create translates pull_request to a policy", () => {
    writeFileSync(join(TMP, "rs.json"), '{"name":"rs","rules":[{"type":"pull_request","parameters":{"required_approving_review_count":2}}]}');
    writeFileSync(join(TMP, "r4.json"), '{"name":"r4","id":"g4","defaultBranch":"refs/heads/master"}');
    writeFileSync(join(TMP, "rsbody.log"), "");
    const r = bash(
      `${LIBS}\nprovider_org_ruleset_create o1/p1/r4 '${join(TMP, "rs.json")}'`,
      {
        STUB_CURL_RESPONSE: join(TMP, "r4.json"),
        STUB_CURL_REQUEST_BODY: join(TMP, "rsbody.log"),
      },
    );
    expect(r.status).toBe(0);
    const body = readFileSync(join(TMP, "rsbody.log"), "utf8");
    expect(jqOk(body, ".settings.minimumApproverCount == 2")).toBe(true);
    // the policy guards the repository's real default branch, not a hard-coded main
    expect(jqOk(body, '.settings.scope[0].refName == "refs/heads/master"')).toBe(true);
  });

  it("provider_repos_create maps --template to parentRepository", () => {
    writeFileSync(join(TMP, "tmpl.json"), '{"name":"t1","id":"tg1"}');
    writeFileSync(join(TMP, "created2.json"), '{"name":"r2","id":"g2"}');
    writeFileSync(join(TMP, "crbody2.log"), "");
    const queue = join(TMP, "tq.queue");
    writeFileSync(queue, `${join(TMP, "tmpl.json")}\n${join(TMP, "created2.json")}\n`);
    const r = bash(
      `${LIBS}\ndeclare -F provider_repos_create >/dev/null && echo "verb: loaded" >&2\n` +
      `output=$(provider_repos_create o1/p1/r2 --template o1/p1/t1); rc=$?; echo "rc=$rc" >&2; exit $rc`,
      {
        STUB_CURL_PAGES: queue,
        STUB_CURL_REQUEST_BODY: join(TMP, "crbody2.log"),
      },
    );
    expect(r.status).toBe(0);
    expect(jqOk(readFileSync(join(TMP, "crbody2.log"), "utf8"), '.parentRepository.id == "tg1"')).toBe(true);
  });

  it("provider_org_ruleset_create emits the transport error JSON on failure", () => {
    // Error-contract regression: a rejected policy POST must surface the
    // error JSON (the silent >/dev/null path made 403s look like code bugs).
    writeFileSync(join(TMP, "rs.json"), '{"rules":[{"type":"pull_request","parameters":{"required_approving_review_count":1}}]}');
    writeFileSync(join(TMP, "repo4.json"), '{"id":"guid-99","name":"r4","defaultBranch":"refs/heads/main"}');
    writeFileSync(join(TMP, "forbidden.json"), '{"error":"http","code":403,"message":"The update is rejected by policy."}');
    // URL-keyed stub: 200 for repositories, 403 for policy.
    writeFileSync(join(BIN, "curl"), CURL_URL_KEYED);
    chmodSync(join(BIN, "curl"), 0o755);
    const r = bash(
      `${LIBS}\noutput=$(provider_org_ruleset_create o1/p1/r4 '${join(TMP, "rs.json")}' 2>&1) || rc=$?\nprintf '%s\n' "$output"\nexit "\${rc:-0}"`,
      { REPO4_JSON: join(TMP, "repo4.json"), FORBIDDEN_JSON: join(TMP, "forbidden.json") },
    );
    expect(r.status).not.toBe(0);
    expect(r.out).toMatch(/rejected by policy/);
  });
});

// ---------------------------------------------------------------------------
// Branch choice, create-before-delete, names
// ---------------------------------------------------------------------------

describe("azure_ruleset_branches", () => {
  it("lists every explicit branch, adds the default for a keyword, skips wildcards", () => {
    const branch = (payload: string, def: string): string =>
      bash(`load() { :; }\n${LIBS}\nazure_ruleset_branches '${payload}' ${def} 2>/dev/null`, { _: "_", __x: "" }).out.trim();
    const r = (payload: string, def: string): string => {
      const res = spawnSync(
        "bash",
        ["-c", `${LIBS}\nazure_ruleset_branches '${payload}' ${def} 2>/dev/null`],
        { encoding: "utf8", env: { ...process.env, TEST_TEMP_DIR: TMP, DEVENV_ROOT, AZURE_PAT: "test-pat", PATH: `${BIN}:${process.env.PATH ?? ""}` } },
      );
      return (res.stdout ?? "").trim();
    };
    expect(r('{"conditions":{"ref_name":{"include":["refs/heads/release"]}}}', "master")).toBe("release");
    expect(r('{"conditions":{"ref_name":{"include":["refs/heads/main","refs/heads/release","refs/heads/feature/*"]}}}', "master")).toBe("main\nrelease");
    expect(r('{"conditions":{"ref_name":{"include":["~DEFAULT_BRANCH"]}}}', "master")).toBe("master");
    expect(r('{"rules":[]}', "main")).toBe("main");
    void branch;
  });

  it("a keyword next to an explicit branch protects both, and a wildcard-only list protects nothing", () => {
    const r = (payload: string, def: string): { status: number; out: string } =>
      spawnSync("bash", ["-c", `${LIBS}\nazure_ruleset_branches '${payload}' ${def}`], {
        encoding: "utf8",
        env: { ...process.env, TEST_TEMP_DIR: TMP, DEVENV_ROOT, AZURE_PAT: "test-pat", PATH: `${BIN}:${process.env.PATH ?? ""}` },
      }) as unknown as { status: number; out: string };
    const both = spawnSync("bash", ["-c", `${LIBS}\nazure_ruleset_branches '{"conditions":{"ref_name":{"include":["~DEFAULT_BRANCH","refs/heads/release"]}}}' master 2>/dev/null`], {
      encoding: "utf8",
      env: { ...process.env, TEST_TEMP_DIR: TMP, DEVENV_ROOT, AZURE_PAT: "test-pat", PATH: `${BIN}:${process.env.PATH ?? ""}` },
    });
    expect((both.stdout ?? "").trim()).toBe("release\nmaster");
    const allKw = spawnSync("bash", ["-c", `${LIBS}\nazure_ruleset_branches '{"conditions":{"ref_name":{"include":["~ALL","refs/heads/release"]}}}' master 2>/dev/null`], {
      encoding: "utf8",
      env: { ...process.env, TEST_TEMP_DIR: TMP, DEVENV_ROOT, AZURE_PAT: "test-pat", PATH: `${BIN}:${process.env.PATH ?? ""}` },
    });
    expect((allKw.stdout ?? "").trim()).toBe("release\nmaster");
    const wildOnly = r('{"conditions":{"ref_name":{"include":["refs/heads/release/*"]}}}', "master");
    expect((wildOnly as unknown as { stdout?: string }).stdout ?? "").toBe("");
    const wildErr = spawnSync("bash", ["-c", `${LIBS}\nazure_ruleset_branches '{"conditions":{"ref_name":{"include":["refs/heads/release/*"]}}}' master`], {
      encoding: "utf8",
      env: { ...process.env, TEST_TEMP_DIR: TMP, DEVENV_ROOT, AZURE_PAT: "test-pat", PATH: `${BIN}:${process.env.PATH ?? ""}` },
    });
    expect(((wildErr.stdout ?? "") + (wildErr.stderr ?? ""))).toContain("no single branch to protect");
  });
});

describe("provider_org_ruleset_update semantics", () => {
  it("creates the new policy before deleting the replaced one, and only that reviewers policy", () => {
    writeFileSync(join(TMP, "rs.json"), '{"rules":[{"type":"pull_request"}]}');
    writeFileSync(
      join(TMP, "configs.json"),
      '{"id":"g4","name":"r4","defaultBranch":"refs/heads/main","value":[\n' +
      ' {"id":7,"type":{"id":"fa4e907d-c16b-4a4c-9dfa-4906e5d171dd"},"settings":{"scope":[{"repositoryId":"g4"}]}},\n' +
      ' {"id":8,"type":{"id":"0609b952-1397-4640-95ec-e00a01b2c241"},"settings":{"scope":[{"repositoryId":"g4"}]}},\n' +
      ' {"id":9,"type":{"id":"fa4e907d-c16b-4a4c-9dfa-4906e5d171dd"},"settings":{"scope":[{"repositoryId":"other"}]}}]}',
    );
    policyStubCurl();
    const r = bash(`${LIBS}\nprovider_org_ruleset_update o1/p1/r4 7 '${join(TMP, "rs.json")}'`, { CONFIGS: join(TMP, "configs.json") });
    expect(r.status).toBe(0);
    const log = readFileSync(CALLS, "utf8");
    const postLine = log.split("\n").findIndex((l) => /^POST .*configurations/.test(l));
    const delLine = log.split("\n").findIndex((l) => /^DELETE /.test(l));
    expect(postLine).toBeGreaterThanOrEqual(0);
    expect(delLine).toBeGreaterThanOrEqual(0);
    expect(postLine).toBeLessThan(delLine);
    expect(log).toMatch(/DELETE .*configurations\/7/);
    expect(log).not.toMatch(/DELETE .*configurations\/8/);
    expect(log).not.toMatch(/DELETE .*configurations\/9/);
  });

  it("keeps the old policy when the new one cannot be created", () => {
    writeFileSync(join(TMP, "rs.json"), '{"rules":[{"type":"pull_request"}]}');
    writeFileSync(
      join(TMP, "configs.json"),
      '{"id":"g4","defaultBranch":"refs/heads/main","value":[{"id":7,"type":{"id":"fa4e907d-c16b-4a4c-9dfa-4906e5d171dd"},"settings":{"scope":[{"repositoryId":"g4"}]}}]}',
    );
    writeFileSync(join(BIN, "curl"), CURL_POST_403);
    chmodSync(join(BIN, "curl"), 0o755);
    writeFileSync(CALLS, "");
    const r = bash(`${LIBS}\nprovider_org_ruleset_update o1/p1/r4 "" '${join(TMP, "rs.json")}'`, { CONFIGS: join(TMP, "configs.json") });
    expect(r.status).not.toBe(0);
    expect(readFileSync(CALLS, "utf8")).not.toMatch(/^DELETE/m);
  });

  it("ruleset_list names a policy by its type, not the same word for every policy", () => {
    writeFileSync(
      join(TMP, "configs.json"),
      '{"id":"g4","value":[\n' +
      ' {"id":7,"isEnabled":true,"type":{"id":"a","displayName":"Minimum number of reviewers"},"settings":{"scope":[{"repositoryId":"g4"}]}},\n' +
      ' {"id":8,"isEnabled":false,"type":{"id":"b","displayName":"Build"},"settings":{"scope":[{"repositoryId":"g4"}]}}]}',
    );
    const r = bash(`${LIBS}\nprovider_org_rulesets_list o1/p1/r4`, { STUB_CURL_RESPONSE: join(TMP, "configs.json") });
    expect(r.status).toBe(0);
    const names = spawnSync("jq", ["-c", "[.[].name]"], { input: r.out, encoding: "utf8" }).stdout?.trim();
    expect(names).toBe('["Minimum number of reviewers","Build"]');
  });

  it("updates the policy already on the branch in place: no duplicate POST, no delete", () => {
    writeFileSync(join(TMP, "rs.json"), '{"rules":[{"type":"pull_request","parameters":{"required_approving_review_count":2}}]}');
    writeFileSync(
      join(TMP, "configs.json"),
      '{"id":"g4","name":"r4","defaultBranch":"refs/heads/main","value":[\n' +
      ' {"id":7,"type":{"id":"fa4e907d-c16b-4a4c-9dfa-4906e5d171dd"},"settings":{"scope":[{"repositoryId":"g4","refName":"refs/heads/main"}]}}]}',
    );
    policyStubCurl();
    const r = bash(`${LIBS}\nprovider_org_ruleset_update o1/p1/r4 "" '${join(TMP, "rs.json")}'`, { CONFIGS: join(TMP, "configs.json") });
    expect(r.status).toBe(0);
    const log = readFileSync(CALLS, "utf8");
    expect(log).toMatch(/^PUT .*policy\/configurations\/7/m);
    expect(log).not.toMatch(/^POST .*policy\/configurations/m);
    expect(log).not.toMatch(/^DELETE/m);
  });

  it("leaves reviewers policies on branches the payload does not name", () => {
    writeFileSync(join(TMP, "rs.json"), '{"rules":[{"type":"pull_request"}]}');
    writeFileSync(
      join(TMP, "configs.json"),
      '{"id":"g4","name":"r4","defaultBranch":"refs/heads/main","value":[\n' +
      ' {"id":7,"type":{"id":"fa4e907d-c16b-4a4c-9dfa-4906e5d171dd"},"settings":{"scope":[{"repositoryId":"g4","refName":"refs/heads/main"}]}},\n' +
      ' {"id":10,"type":{"id":"fa4e907d-c16b-4a4c-9dfa-4906e5d171dd"},"settings":{"scope":[{"repositoryId":"g4","refName":"refs/heads/release"}]}}]}',
    );
    policyStubCurl();
    const r = bash(`${LIBS}\nprovider_org_ruleset_update o1/p1/r4 "" '${join(TMP, "rs.json")}'`, { CONFIGS: join(TMP, "configs.json") });
    expect(r.status).toBe(0);
    const log = readFileSync(CALLS, "utf8");
    expect(log).not.toMatch(/^DELETE/m);
    expect(log).toMatch(/^PUT .*configurations\/7/m);
  });

  it("writes a policy for every explicit branch the payload names", () => {
    writeFileSync(
      join(TMP, "rs.json"),
      '{"conditions":{"ref_name":{"include":["refs/heads/main","refs/heads/release"]}},"rules":[{"type":"pull_request"}]}',
    );
    writeFileSync(join(TMP, "configs.json"), '{"id":"g4","defaultBranch":"refs/heads/main","value":[]}');
    policyStubCurl();
    const r = bash(`${LIBS}\nprovider_org_ruleset_update o1/p1/r4 "" '${join(TMP, "rs.json")}'`, { CONFIGS: join(TMP, "configs.json") });
    expect(r.status).toBe(0);
    expect((readFileSync(CALLS, "utf8").match(/^POST .*configurations/gm) ?? []).length).toBe(2);
  });

  it("ruleset_create can be retried: a branch that already has a policy is updated, not posted again", () => {
    writeFileSync(
      join(TMP, "rs.json"),
      '{"conditions":{"ref_name":{"include":["refs/heads/main","refs/heads/release"]}},"rules":[{"type":"pull_request"}]}',
    );
    writeFileSync(
      join(TMP, "configs.json"),
      '{"id":"g4","defaultBranch":"refs/heads/main","value":[\n' +
      ' {"id":7,"type":{"id":"fa4e907d-c16b-4a4c-9dfa-4906e5d171dd"},"settings":{"scope":[{"repositoryId":"g4","refName":"refs/heads/main"}]}}]}',
    );
    policyStubCurl();
    const r = bash(`${LIBS}\nprovider_org_ruleset_create o1/p1/r4 '${join(TMP, "rs.json")}'`, { CONFIGS: join(TMP, "configs.json") });
    expect(r.status).toBe(0);
    const log = readFileSync(CALLS, "utf8");
    expect(log).toMatch(/^PUT .*configurations\/7/m);
    expect((log.match(/^POST .*configurations/gm) ?? []).length).toBe(1);
  });

  it("fails when the ruleset names no branch a policy can protect", () => {
    writeFileSync(
      join(TMP, "rs.json"),
      '{"conditions":{"ref_name":{"include":["refs/heads/release/*"]}},"rules":[{"type":"pull_request"}]}',
    );
    writeFileSync(join(TMP, "configs.json"), '{"id":"g4","defaultBranch":"refs/heads/main","value":[]}');
    policyStubCurl();
    const r = bash(`${LIBS}\nprovider_org_ruleset_update o1/p1/r4 "" '${join(TMP, "rs.json")}'`, { CONFIGS: join(TMP, "configs.json") });
    expect(r.status).not.toBe(0);
    expect(readFileSync(CALLS, "utf8")).not.toMatch(/^(POST|PUT|DELETE)/m);
  });

  it("create and update name the problem when the payload leaves no branch to protect", () => {
    writeFileSync(join(TMP, "configs.json"), '{"id":"g4","defaultBranch":"refs/heads/main","value":[]}');
    policyStubCurl();
    for (const inc of ['["refs/tags/*"]', '["refs/tags/v1"]', '["main"]', '["~all"]', '["~ALL "]']) {
      writeFileSync(
        join(TMP, "rs.json"),
        `{"conditions":{"ref_name":{"include":${inc}}},"rules":[{"type":"pull_request"}]}`,
      );
      const create = bash(`${LIBS}\nprovider_org_ruleset_create o1/p1/r4 '${join(TMP, "rs.json")}'`, { CONFIGS: join(TMP, "configs.json") });
      expect(create.status, `create ${inc}: ${create.out}`).not.toBe(0);
      expect(create.out, `create ${inc}: ${create.out}`).toContain("names no branch an Azure policy can protect");
      const update = bash(`${LIBS}\nprovider_org_ruleset_update o1/p1/r4 "" '${join(TMP, "rs.json")}'`, { CONFIGS: join(TMP, "configs.json") });
      expect(update.status, `update ${inc}: ${update.out}`).not.toBe(0);
      expect(update.out, `update ${inc}: ${update.out}`).toContain("names no branch an Azure policy can protect");
    }
    expect(readFileSync(CALLS, "utf8")).not.toMatch(/^(POST|PUT|DELETE)/m);
  });

  it("ruleset create rejects a payload that is not JSON, as update does", () => {
    writeFileSync(join(TMP, "rs.json"), "not json");
    writeFileSync(join(TMP, "configs.json"), '{"id":"g4","defaultBranch":"refs/heads/main","value":[]}');
    policyStubCurl();
    const r = bash(`${LIBS}\nprovider_org_ruleset_create o1/p1/r4 '${join(TMP, "rs.json")}'`, { CONFIGS: join(TMP, "configs.json") });
    expect(r.status).not.toBe(0);
    expect(r.out).toContain("not valid JSON");
  });

  it("ruleset update logs the policy it retires and the branch it was on", () => {
    writeFileSync(join(TMP, "rs.json"), '{"rules":[{"type":"pull_request"}]}');
    writeFileSync(
      join(TMP, "configs.json"),
      '{"id":"g4","defaultBranch":"refs/heads/main","value":[\n' +
      ' {"id":11,"type":{"id":"fa4e907d-c16b-4a4c-9dfa-4906e5d171dd"},"settings":{"scope":[{"repositoryId":"g4","refName":"refs/heads/release/x"}]}}]}',
    );
    policyStubCurl();
    const r = bash(`${LIBS}\nprovider_org_ruleset_update o1/p1/r4 11 '${join(TMP, "rs.json")}'`, { CONFIGS: join(TMP, "configs.json") });
    expect(r.status).toBe(0);
    expect(r.out).toContain("retiring policy 11 on refs/heads/release/x");
    expect(readFileSync(CALLS, "utf8")).toMatch(/^DELETE .*configurations\/11/m);
  });

  it("~ALL is a warning that it protects the default branch only", () => {
    const r = spawnSync(
      "bash",
      ["-c", `${LIBS}\nazure_ruleset_branches '{"conditions":{"ref_name":{"include":["~ALL"]}}}' master`],
      { encoding: "utf8", env: { ...process.env, TEST_TEMP_DIR: TMP, DEVENV_ROOT, AZURE_PAT: "test-pat", PATH: `${BIN}:${process.env.PATH ?? ""}` } },
    );
    const out = (r.stdout ?? "") + (r.stderr ?? "");
    expect(out).toContain("~ALL protects the default branch only");
    expect(out).toContain("master");
  });
});
