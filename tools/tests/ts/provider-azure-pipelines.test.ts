// Port of tools/tests/lib/test_provider_azure_pipelines.bats (35 tests) — one
// vitest `it` per source `@test`. The azure provider pipelines domain: run
// list/view field mapping, workflow list, trigger (definition id or name),
// rerun/cancel, artifacts metadata, and URL-shape contracts. All transport
// via the stub curl fixture.
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

// The cli-stubs curl fixture (same as the register/workitems ports).
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
  '    # A non-empty remaining queue means more pages exist: emit a',
  '    # ContinuationToken header so the transport keeps going.',
  '    if [[ -s "$STUB_CURL_PAGES" ]]; then',
  "    printf 'x-ms-continuationtoken: token-page-2\\r\\n' >> \"$headers_file\"",
  '    fi',
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
  TMP = mkdtempSync(join(tmpdir(), `azpipe-${Date.now()}-${Math.random().toString(36).slice(2)}`));
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
  writeFileSync(join(DEVENV_ROOT, "devenv.config"), "[provider]\nname=azure\nazure_org=org\nazure_project=proj\n");
  writeFileSync(join(TMP, "azure.pat"), "test-pat\n");
});

const ENV = (extra: Record<string, string> = {}): Record<string, string> => ({
  ...process.env,
  DEVENV_TOOLS: TOOLS,
  DEVENV_ROOT,
  AZURE_PAT: "test-pat",
  AZURE_PAT_FILE: join(TMP, "azure.pat"),
  STUB_CALL_LOG: CALL_LOG,
  STUB_CURL_RESPONSE: join(TMP, "curl-response"),
  PATH: `${join(TMP, "stub-bin")}:${process.env.PATH ?? ""}`,
  ...extra,
});

// azure_libs_source + call (this suite's module list includes prs+pipelines).
function azVerb(call: string, extraEnv: Record<string, string> = {}): { status: number; out: string } {
  const script =
    `source '${TOOLS}/lib/providers/provider-core.bash'\n` +
    `PROVIDER_NAME=azure\n` +
    ["http", "urls", "repos", "issues", "prs", "pipelines"]
      .map((m) => `source '${TOOLS}/lib/providers/azure/${m}.bash'\n`)
      .join("") +
    `${call}\n`;
  const r = spawnSync("bash", ["-c", script], {
    input: "", // the transport reads the credential header via -H @-
    encoding: "utf8",
    env: ENV({ AZURE_DEVOPS_ORG: "org", AZURE_DEVOPS_PROJECT: "proj", ...extraEnv }),
  });
  return { status: r.status ?? 1, out: (r.stdout ?? "") + (r.stderr ?? "") };
}

// A list page that also carries a top-level id, so one stubbed response
// answers both the repository lookup and the builds list itself.
const BUILD_PAGE = `{"id":"guid-1234","value":[
  {"id":9001,"buildNumber":"20260927.1","status":"completed","result":"succeeded",
   "sourceBranch":"refs/heads/master","sourceVersion":"abc123","queueTime":"2026-09-27T09:00:00Z",
   "definition":{"name":"CI"},"url":"https://dev.azure.com/org/proj/_apis/build/builds/9001"},
  {"id":9002,"buildNumber":"20260927.2","status":"inProgress","result":null,
   "sourceBranch":"refs/heads/feature/x","sourceVersion":"def456","queueTime":"2026-09-27T09:05:00Z",
   "definition":{"name":"CI"},"url":"https://dev.azure.com/org/proj/_apis/build/builds/9002"}
]}
`;

function jqOut(json: string, args: string[]): string {
  return (spawnSync("jq", args, { input: json, encoding: "utf8" }).stdout ?? "").trim();
}

function jqOk(json: string, args: string[]): boolean {
  return spawnSync("jq", args, { input: json, stdio: ["pipe", "ignore", "ignore"] }).status === 0;
}

function logHas(pattern: string): boolean {
  return spawnSync("grep", ["-q", pattern, CALL_LOG]).status === 0;
}

function curlCount(): number {
  return parseInt((spawnSync("grep", ["-c", "^curl ", CALL_LOG], { encoding: "utf8" }).stdout ?? "0").trim(), 10) || 0;
}

// builds_url_for [repo-args...]: the URL the verb requested (first builds call).
function buildsUrlFor(...args: string[]): string {
  writeFileSync(join(TMP, "builds.json"), BUILD_PAGE);
  writeFileSync(CALL_LOG, "");
  azVerb(`provider_pipelines_run_list ${args.map((a) => `'${a}'`).join(" ")}`, {
    STUB_CURL_RESPONSE: join(TMP, "builds.json"),
  });
  const r = spawnSync("bash", ["-c", `grep -m1 '_apis/build/builds' '${CALL_LOG}'`], { encoding: "utf8" });
  return (r.stdout ?? "").trim();
}

function pageQueue(name: string, ...files: string[]): string {
  const queue = join(TMP, name);
  writeFileSync(queue, files.map((f) => `${f}\n`).join(""));
  return queue;
}

describe("provider azure pipelines", () => {
  it("provider_pipelines_run_list maps builds to the seam run shape (one JSON array)", () => {
    writeFileSync(join(TMP, "builds.json"), BUILD_PAGE);
    const r = azVerb("provider_pipelines_run_list proj/repo1 --branch feature/x --limit 5", {
      STUB_CURL_RESPONSE: join(TMP, "builds.json"),
    });
    expect(r.status).toBe(0);
    const mapped = r.out;
    expect(jqOut(mapped, ["length"])).toBe("2");
    expect(jqOk(mapped, ["-e", '.[0].id == 9001 and .[0].status == "completed" and .[0].conclusion == "success" and .[0].headBranch == "master"'])).toBe(true);
    expect(jqOk(mapped, ["-e", '.[1].id == 9002 and .[1].status == "in_progress" and .[1].conclusion == null and .[1].headBranch == "feature/x"'])).toBe(true);
    expect(logHas("branchName=refs%2Fheads%2Ffeature%2Fx")).toBe(true);
    expect(logHas("top=5")).toBe(true);
  });

  it("provider_pipelines_run_list --json projects only the requested fields", () => {
    writeFileSync(join(TMP, "builds.json"), BUILD_PAGE);
    const r = azVerb("provider_pipelines_run_list proj/repo1 --json url,status", {
      STUB_CURL_RESPONSE: join(TMP, "builds.json"),
    });
    expect(r.status).toBe(0);
    expect(jqOk(r.out, ["-e", 'length == 2 and (.[0] | keys | sort) == ["status","url"]'])).toBe(true);
  });

  it("provider_pipelines_run_list -q applies once over the whole array (gh list semantics)", () => {
    writeFileSync(join(TMP, "builds.json"), BUILD_PAGE);
    const r = azVerb("provider_pipelines_run_list proj/repo1 -q '[.[] | .url]'", {
      STUB_CURL_RESPONSE: join(TMP, "builds.json"),
    });
    expect(r.status).toBe(0);
    expect(jqOk(r.out, ["-e", 'length == 2 and .[0] == "https://dev.azure.com/org/proj/_apis/build/builds/9001"'])).toBe(true);
  });

  it("provider_pipelines_run_list -q list-level select/count works (wait_for_workflow_runs shape)", () => {
    // provider-loader passes list-level programs like
    // '[.[] | select(.status == "queued")] | length' — per-record
    // application made every record yield 0 and the waiter time out.
    writeFileSync(join(TMP, "builds.json"), BUILD_PAGE);
    const r = azVerb(`provider_pipelines_run_list proj/repo1 -q '[.[] | select(.status == "in_progress")] | length'`, {
      STUB_CURL_RESPONSE: join(TMP, "builds.json"),
    });
    expect(r.status).toBe(0);
    expect(r.out.trim()).toBe("1");
  });

  it("provider_pipelines_run_view maps a single build", () => {
    const one = join(TMP, "one.json");
    writeFileSync(one, '{"id":9001,"buildNumber":"b1","status":"completed","result":"failed","sourceBranch":"refs/heads/master","sourceVersion":"abc","queueTime":"t","definition":{"name":"CI"},"url":"u"}');
    const r = azVerb('provider_pipelines_run_view "" 9001', { STUB_CURL_RESPONSE: one });
    expect(r.status).toBe(0);
    expect(jqOk(r.out, ["-e", ".id == 9001 and .conclusion == \"failure\""])).toBe(true);
  });

  it("provider_pipelines_workflow_list maps definitions", () => {
    const defs = join(TMP, "defs.json");
    writeFileSync(defs, '{"value":[{"id":7,"name":"CI","path":"ci"},{"id":8,"name":"Release","path":"release"}]}');
    const r = azVerb("provider_pipelines_workflow_list proj/repo1", { STUB_CURL_RESPONSE: defs });
    expect(r.status).toBe(0);
    expect(jqOk(r.out, ["-e", 'length == 2 and .[0].id == "7" and .[0].name == "CI"'])).toBe(true);
    expect(logHas("build/definitions")).toBe(true);
  });

  it("provider_pipelines_workflow_run queues a build by definition id", () => {
    const queued = join(TMP, "queued.json");
    writeFileSync(queued, '{"id":9010}');
    const r = azVerb('provider_pipelines_workflow_run "" 7 --ref master', { STUB_CURL_RESPONSE: queued });
    expect(r.status).toBe(0);
    expect(r.out.trim()).toBe("9010");
    expect(logHas("_apis/build/builds")).toBe(true);
  });

  it("provider_pipelines_workflow_run without --ref resolves the default branch", () => {
    // No hard-coded master: the default ref comes from the repo view (a
    // main-default repo must queue on main).
    const repo = join(TMP, "repo.json");
    const queued = join(TMP, "queued.json");
    const runbody = join(TMP, "runbody.log");
    writeFileSync(repo, '{"defaultBranch":"refs/heads/main","name":"r1","project":{"name":"p1"}}');
    writeFileSync(queued, '{"id":9011}');
    writeFileSync(runbody, "");
    const queue = pageQueue("run.queue", repo, queued);
    const r = azVerb("provider_pipelines_workflow_run repo1 7", {
      STUB_CURL_PAGES: queue,
      STUB_CURL_REQUEST_BODY: runbody,
    });
    expect(r.status).toBe(0);
    expect(spawnSync("grep", ["-q", '"refs/heads/main"', runbody]).status).toBe(0);
  });

  it("provider_pipelines_workflow_run forwards --field inputs as parameters", () => {
    const repo = join(TMP, "repo.json");
    const queued = join(TMP, "queued.json");
    const fbody = join(TMP, "fbody.log");
    writeFileSync(repo, '{"defaultBranch":"refs/heads/main","name":"r1","project":{"name":"p1"}}');
    writeFileSync(queued, '{"id":9012}');
    writeFileSync(fbody, "");
    const queue = pageQueue("f.queue", repo, queued);
    const r = azVerb("provider_pipelines_workflow_run repo1 7 --field environment=staging --field dry-run=true", {
      STUB_CURL_PAGES: queue,
      STUB_CURL_REQUEST_BODY: fbody,
    });
    expect(r.status).toBe(0);
    // parameters is a STRING holding serialized JSON (the REST Build
    // contract's typing) — parse it back to verify the inputs, including a
    // dash-spelled key.
    const body = spawnSync("cat", [fbody], { encoding: "utf8" }).stdout ?? "";
    expect(jqOk(body, ["-e", "(.parameters | fromjson).environment == \"staging\" and (.parameters | fromjson)[\"dry-run\"] == \"true\""])).toBe(true);
  });

  it("provider_pipelines_run_list --status becomes a statusFilter query param", () => {
    writeFileSync(join(TMP, "builds.json"), BUILD_PAGE);
    const r = azVerb("provider_pipelines_run_list repo1 --status in_progress --limit 5", {
      STUB_CURL_RESPONSE: join(TMP, "builds.json"),
    });
    expect(r.status).toBe(0);
    expect(logHas("statusFilter=inProgress")).toBe(true);
  });

  it("provider_pipelines_workflow_run without a workflow fails defined", () => {
    const r = azVerb('provider_pipelines_workflow_run "" ""');
    expect(r.status).not.toBe(0);
    expect(r.out).toMatch(/definition/);
  });

  it("provider_pipelines_run_rerun PATCHes the build with retry=true", () => {
    const rerun = join(TMP, "rerun.json");
    const rerunBody = join(TMP, "rerun.body");
    writeFileSync(rerun, '{"id":9001}');
    writeFileSync(rerunBody, "");
    const r = azVerb('provider_pipelines_run_rerun "" 9001', {
      STUB_CURL_RESPONSE: rerun,
      STUB_CURL_REQUEST_BODY: rerunBody,
    });
    expect(r.status).toBe(0);
    expect(logHas("builds/9001?retry=true")).toBe(true);
  });

  it("provider_pipelines_run_cancel patches status=cancelling", () => {
    const cancel = join(TMP, "cancel.json");
    writeFileSync(cancel, '{"id":9002,"status":"cancelling"}');
    const r = azVerb("provider_pipelines_run_cancel org/proj/repo1 9002", { STUB_CURL_RESPONSE: cancel });
    expect(r.status).toBe(0);
  });

  it("provider_pipelines_run_artifacts maps artifact metadata", () => {
    const arts = join(TMP, "arts.json");
    writeFileSync(arts, '{"value":[{"id":3,"name":"drop","resource":{"downloadUrl":"https://dev.azure.com/org/abc","properties":{"file Size":4096}}} ]}');
    const r = azVerb("provider_pipelines_run_artifacts org/proj/repo1 9001", { STUB_CURL_RESPONSE: arts });
    expect(r.status).toBe(0);
    expect(jqOk(r.out, ["-e", 'length == 1 and .[0].id == "3" and .[0].name == "drop" and .[0].size_in_bytes == 4096 and .[0].url == "https://dev.azure.com/org/abc"'])).toBe(true);
    expect(logHas("builds/9001/artifacts")).toBe(true);
  });

  it("azure_build_root is the project's build API root, with the org and project of the spec, encoded", () => {
    const checks: Array<[string, string]> = [
      ['', "https://dev.azure.com/org/proj/_apis/build"],
      ["o1/p1/r1", "https://dev.azure.com/o1/p1/_apis/build"],
      ["my proj/r1", "https://dev.azure.com/org/my%20proj/_apis/build"],
    ];
    for (const [spec, expected] of checks) {
      const script =
        `source '${TOOLS}/lib/providers/provider-core.bash'\n` +
        `PROVIDER_NAME=azure\n` +
        ["http", "urls", "repos", "issues", "prs", "pipelines"].map((m) => `source '${TOOLS}/lib/providers/azure/${m}.bash'\n`).join("") +
        `azure_build_root '${spec}'\n`;
      const r = spawnSync("bash", ["-c", script], { input: "", encoding: "utf8", env: ENV({ AZURE_DEVOPS_ORG: "org", AZURE_DEVOPS_PROJECT: "proj" }) });
      expect((r.stdout ?? "").trim()).toBe(expected);
    }
  });

  it("provider_pipelines_run_list composes the project-scoped URL without '?&'", () => {
    // Live-verified: 'builds?&$top=…' is rejected 400 by Azure.
    const empty = join(TMP, "empty-builds.json");
    writeFileSync(empty, '{"value":[]}');
    azVerb('provider_pipelines_run_list ""', { STUB_CURL_RESPONSE: empty });
    expect(logHas("builds?$top=")).toBe(true);
    expect(logHas("builds?&")).toBe(false);
  });

  it("provider_pipelines_run_list emits the transport error JSON on failure", () => {
    // Error-contract regression: paginate's error JSON lands on stdout — the
    // verb must not swallow it (rc=1 with empty output was the old bug).
    const err = join(TMP, "err.json");
    writeFileSync(err, '{"error":"http","code":404,"message":"list request failed"}');
    const r = azVerb('provider_pipelines_run_list ""', {
      STUB_CURL_RESPONSE: err,
      STUB_CURL_HTTP_CODE: "404",
    });
    expect(r.status).not.toBe(0);
    expect(r.out).toMatch('"error":"http"');
  });

  it("provider_pipelines_workflow_list resolves the repo filter to a GUID", () => {
    // F-SMOKE-7 regression: the definitions filter takes a repository GUID,
    // not the bare name.
    const repo = join(TMP, "repo.json");
    const defs = join(TMP, "defs.json");
    writeFileSync(repo, '{"id":"guid-1234","name":"r1"}');
    writeFileSync(defs, '{"value":[]}');
    const queue = pageQueue("wf.queue", repo, defs);
    const r = azVerb('provider_pipelines_workflow_list "o1/p1/r1"', { STUB_CURL_PAGES: queue });
    expect(r.status).toBe(0);
    expect(logHas("repositoryId=guid-1234")).toBe(true);
  });

  it("run_list with no repo requests builds?$top=… (separator '?', never 'builds&')", () => {
    const url = buildsUrlFor("--limit", "7");
    expect(url).toContain("/_apis/build/builds?$top=7&queryOrder=queueTimeDescending");
    expect(url).not.toContain("builds&");
  });

  it("run_list with a repo filters by the repository's GUID, joined to the query with '&'", () => {
    const url = buildsUrlFor("proj/repo1", "--limit", "7");
    expect(url).toContain("/_apis/build/builds?$top=7&queryOrder=queueTimeDescending&repositoryId=guid-1234&repositoryType=TfsGit");
  });

  it("run_list URLs contain exactly one '?' before the api-version is appended", () => {
    const argSets = [["--limit", "3"], ["proj/repo1", "--limit", "3"], ["--branch", "main", "--limit", "3"], ["proj/repo1", "--branch", "main", "--status", "in_progress"]];
    for (const args of argSets) {
      const url = buildsUrlFor(...args);
      const base = url.split("&api-version")[0] ?? url;
      const qCount = (base.match(/\?/g) ?? []).length;
      expect(qCount, `url: ${url}`).toBe(1);
    }
  });

  it("run_list --workflow NAME looks the definition up and filters by its id", () => {
    const defs = join(TMP, "defs.json");
    const builds = join(TMP, "builds.json");
    writeFileSync(defs, '{"value":[{"id":42,"name":"CI"},{"id":43,"name":"CI-nightly"}]}');
    writeFileSync(builds, BUILD_PAGE);
    const queue = pageQueue("queue", defs, builds);
    const r = azVerb("provider_pipelines_run_list --workflow CI", { STUB_CURL_PAGES: queue });
    expect(r.status).toBe(0);
    expect(logHas("definitions?name=CI")).toBe(true);
    expect(spawnSync("grep", ["-qE", "definitions=42(&| |$)", CALL_LOG]).status).toBe(0);
    expect(logHas("definitions=43")).toBe(false);
  });

  it("run_list --workflow with a numeric id uses it directly", () => {
    const builds = join(TMP, "builds.json");
    writeFileSync(builds, BUILD_PAGE);
    const r = azVerb("provider_pipelines_run_list --workflow 42", { STUB_CURL_RESPONSE: builds });
    expect(r.status).toBe(0);
    expect(spawnSync("grep", ["-qE", "definitions=42(&|$| )", CALL_LOG]).status).toBe(0);
    expect(logHas("definitions?name")).toBe(false);
  });

  it("run_list --workflow with an unknown name fails and says so", () => {
    const none = join(TMP, "none.json");
    writeFileSync(none, '{"value":[]}');
    const r = azVerb("provider_pipelines_run_list --workflow nope", { STUB_CURL_RESPONSE: none });
    expect(r.status).not.toBe(0);
    expect(r.out).toContain("no pipeline named 'nope'");
  });

  it("run_list stops paging at --limit instead of reading the whole history", () => {
    const files: string[] = [];
    for (const i of [1, 2, 3, 4, 5]) {
      const f = join(TMP, `b${i}.json`);
      writeFileSync(f, `{"value":[{"id":${i},"status":"completed","result":"succeeded","sourceBranch":"refs/heads/m","definition":{"name":"CI"}}]}`);
      files.push(f);
    }
    const queue = pageQueue("queue", ...files);
    const r = azVerb("provider_pipelines_run_list --limit 2", { STUB_CURL_PAGES: queue });
    expect(r.status).toBe(0);
    expect(jqOut(r.out, ["length"])).toBe("2");
    expect(curlCount()).toBe(2);
  });

  it("run_download fetches each artifact through the transport's download helper", () => {
    const arts = join(TMP, "arts.json");
    const zip = join(TMP, "zip.bin");
    const dl = join(TMP, "dl");
    writeFileSync(arts, '{"value":[{"name":"drop","resource":{"downloadUrl":"https://dev.azure.com/org/proj/_apis/build/builds/9/artifacts?artifactName=drop&%24format=zip"}}]}');
    writeFileSync(zip, "PKzip");
    const queue = pageQueue("queue", arts, zip);
    const r = azVerb(`provider_pipelines_run_download "" 9 -D '${dl}'`, { STUB_CURL_PAGES: queue });
    expect(r.status).toBe(0);
    expect(spawnSync("cat", [join(dl, "drop.zip")], { encoding: "utf8" }).stdout?.trim()).toBe("PKzip");
  });

  it("provider_pipelines_run_list maps the gh conclusions onto Azure's status and result filters", () => {
    writeFileSync(join(TMP, "builds.json"), BUILD_PAGE);
    const pairs: Array<[string, string]> = [["failure", "failed"], ["success", "succeeded"], ["cancelled", "canceled"]];
    for (const [word, expectResult] of pairs) {
      writeFileSync(CALL_LOG, "");
      const r = azVerb(`provider_pipelines_run_list proj/repo1 --status ${word}`, {
        STUB_CURL_RESPONSE: join(TMP, "builds.json"),
      });
      expect(r.status).toBe(0);
      expect(logHas("statusFilter=completed")).toBe(true);
      expect(logHas(`resultFilter=${expectResult}`)).toBe(true);
    }
  });

  it("provider_pipelines_run_list rejects a status word with no Azure analog", () => {
    writeFileSync(join(TMP, "builds.json"), BUILD_PAGE);
    const r = azVerb("provider_pipelines_run_list proj/repo1 --status banana", {
      STUB_CURL_RESPONSE: join(TMP, "builds.json"),
    });
    expect(r.status).not.toBe(0);
    expect(r.out.includes("--status 'banana'") || r.out.includes("status 'banana'")).toBe(true);
  });

  it("run_download fails when no artifact has the requested name", () => {
    const arts = join(TMP, "arts.json");
    writeFileSync(arts, '{"value":[{"name":"drop","resource":{"downloadUrl":"https://dev.azure.com/org/proj/_apis/build/builds/9/artifacts?artifactName=drop&%24format=zip"}}]}');
    const r = azVerb(`provider_pipelines_run_download "" 9 -n missing -D '${join(TMP, "dl2")}'`, {
      STUB_CURL_RESPONSE: arts,
    });
    expect(r.status).not.toBe(0);
    expect(r.out).toContain("no artifact named 'missing'");
  });

  it("run_download fails when the run has no artifacts at all", () => {
    const none = join(TMP, "none.json");
    writeFileSync(none, '{"value":[]}');
    const r = azVerb(`provider_pipelines_run_download "" 9 -D '${join(TMP, "dl3")}'`, { STUB_CURL_RESPONSE: none });
    expect(r.status).not.toBe(0);
    expect(r.out).toContain("no artifacts");
  });

  it("run_download never sends the PAT to a host outside Azure DevOps", () => {
    const evil = join(TMP, "evil.json");
    writeFileSync(evil, '{"value":[{"name":"drop","resource":{"downloadUrl":"https://evil.example.com/steal.zip"}}]}');
    const queue = pageQueue("queue2", evil);
    writeFileSync(CALL_LOG, "");
    const r = azVerb(`provider_pipelines_run_download "" 9 -D '${join(TMP, "dl4")}'`, { STUB_CURL_PAGES: queue });
    expect(r.status).not.toBe(0);
    expect(logHas("evil.example.com")).toBe(false);
  });

  it("azure_url_is_provider_host accepts only https on Azure DevOps hosts", () => {
    const script =
      `source '${TOOLS}/lib/error-handling.bash'\n` +
      `source '${TOOLS}/lib/providers/azure/http.bash'\n`;
    const run = (call: string): { status: number; out: string } => {
      const r = spawnSync("bash", ["-c", `${script}${call}\n`], { input: "", encoding: "utf8", env: ENV() });
      return { status: r.status ?? 1, out: (r.stdout ?? "") + (r.stderr ?? "") };
    };
    expect(run(`azure_url_is_provider_host "https://dev.azure.com/o/p"`).status).toBe(0);
    expect(run(`azure_url_is_provider_host "https://vsblob.dev.azure.com/x"`).status).toBe(0);
    expect(run(`azure_url_is_provider_host "https://acme.visualstudio.com/p"`).status).toBe(0);
    expect(run(`azure_url_is_provider_host "http://dev.azure.com/o/p"`).status).not.toBe(0);
    expect(run(`azure_url_is_provider_host "https://dev.azure.com.evil.example/o"`).status).not.toBe(0);
    expect(run(`azure_url_is_provider_host "https://evil.example/dev.azure.com/o"`).status).not.toBe(0);
    expect(run(`azure_url_is_provider_host "https://dev.azure.com@evil.example/o"`).status).not.toBe(0);
  });

  it("run_list rejects an unknown, malformed or trailing-comma --json field by name instead of returning []", () => {
    writeFileSync(join(TMP, "builds.json"), BUILD_PAGE);
    for (const bad of ["id,bogus", "id-x", "id,", ",id"]) {
      const r = azVerb(`provider_pipelines_run_list proj/repo1 --json '${bad}'`, {
        STUB_CURL_RESPONSE: join(TMP, "builds.json"),
      });
      expect(r.status, `accepted --json '${bad}'`).not.toBe(0);
      expect(r.out.includes("--json") || r.out.includes("JSON field"), `no named error for '${bad}': ${r.out}`).toBe(true);
    }
  });

  it("run_view rejects an unknown --json field, and treats a null -q result as empty", () => {
    const b1 = join(TMP, "b1.json");
    writeFileSync(b1, '{"id":9001,"status":"completed","result":"succeeded","sourceBranch":"refs/heads/m","definition":{"name":"ci"}}');
    let r = azVerb("provider_pipelines_run_view proj/repo1 9001 --json id,bogus", { STUB_CURL_RESPONSE: b1 });
    expect(r.status).not.toBe(0);
    expect(r.out).toContain("unknown JSON field 'bogus'");
    r = azVerb("provider_pipelines_run_view proj/repo1 9001 --json conclusion -q '.nothing'", { STUB_CURL_RESPONSE: b1 });
    expect(r.status).toBe(0);
    expect(r.out.trim()).toBe("");
  });

  it("the run fields the tools ask for are all accepted", () => {
    writeFileSync(join(TMP, "builds.json"), BUILD_PAGE);
    const r = azVerb("provider_pipelines_run_list proj/repo1 --json workflowName,status,conclusion,headBranch,updatedAt,url,id", {
      STUB_CURL_RESPONSE: join(TMP, "builds.json"),
    });
    expect(r.status).toBe(0);
  });
});
