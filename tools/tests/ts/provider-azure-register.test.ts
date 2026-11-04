// Port of tools/tests/lib/test_provider_azure_register.bats (25 tests) — one
// vitest `it` per source `@test`. Outcome tests for the Azure provider,
// written against responses RECORDED from a live Azure DevOps org
// (tools/tests/fixtures/azure/). Each asserts what the verb does with a real
// response shape, so a verb that drifts from the recorded behavior fails here
// before it reaches a live org.
//
// Not every behavior has a live recording (no pipeline definitions, no
// relations or comment pages were recorded); those tests build the response
// from the documented API shape and say so in a comment.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const ROOT = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))));
const TOOLS = join(ROOT, "tools");
const FIXTURES = join(ROOT, "tools", "tests", "fixtures", "azure");

let TMP = "";
let CALL_LOG = "";
let REQ_BODIES = "";

// The cli-stubs curl fixture: URL argv log, request-body capture, response /
// pages / http-code modes, -o/-D/-w handling, @- stdin consumption.
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
  // A credential header passed on stdin (-H @-) is consumed like curl would.
  'for arg in "$@"; do [[ "$arg" == "@-" ]] && { cat > /dev/null; break; }; done',
  // URL is the last non-flag argument.
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
  '    printf \'Retry-After: %s\\r\\n\' "$STUB_CURL_RETRY_AFTER"',
  "  fi",
  "  printf '\\r\\n'",
  "} > \"$headers_file\"",
  'if [[ -n "${STUB_CURL_PAGES:-}" && -f "${STUB_CURL_PAGES}" ]]; then',
  '  if [[ -s "$STUB_CURL_PAGES" ]]; then',
  '    page_file=$(head -n 1 "$STUB_CURL_PAGES")',
  '    tail -n +2 "$STUB_CURL_PAGES" > "$STUB_CURL_PAGES.tmp" && mv "$STUB_CURL_PAGES.tmp" "$STUB_CURL_PAGES"',
  '    emit_body "$page_file"',
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
  TMP = mkdtempSync(join(tmpdir(), `azreg-${Date.now()}-${Math.random().toString(36).slice(2)}`));
  CALL_LOG = join(TMP, "stub-calls.log");
  REQ_BODIES = join(TMP, "request-bodies.log");
  const bin = join(TMP, "stub-bin");
  mkdirSync(bin, { recursive: true });
  mkdirSync(join(TMP, "devenv-root"), { recursive: true });
  writeFileSync(CALL_LOG, "");
  writeFileSync(REQ_BODIES, "");
  writeFileSync(join(bin, "curl"), CURL_STUB);
  chmodSync(join(bin, "curl"), 0o755);
  // The transport sleeps between retries; the tests do not wait for it.
  writeFileSync(join(bin, "sleep"), "#!/usr/bin/env bash\nexit 0\n");
  chmodSync(join(bin, "sleep"), 0o755);
  writeFileSync(join(TMP, "devenv-root", "devenv.config"), "[provider]\nname=azure\nazure_org=org\nazure_project=proj\n");
  writeFileSync(join(TMP, "azure.pat"), "test-pat\n");
});

const ENV = (extra: Record<string, string> = {}): Record<string, string> => ({
  ...process.env,
  DEVENV_TOOLS: TOOLS,
  DEVENV_ROOT: join(TMP, "devenv-root"),
  AZURE_PAT: "test-pat",
  AZURE_PAT_FILE: join(TMP, "azure.pat"),
  STUB_CALL_LOG: CALL_LOG,
  STUB_CURL_RESPONSE: join(TMP, "curl-response"),
  PATH: `${join(TMP, "stub-bin")}:${process.env.PATH ?? ""}`,
  ...extra,
});

// azure_libs_source + call (the source suite's helper as a spawn). Stdin is
// closed: the transport passes the credential header to curl via -H @-, and
// an open stdin would make the stub's `cat` block. AZURE_DEVOPS_ORG/PROJECT
// are pinned: sibling suites leak them into the shared worker env, and the
// transport prefers them over config.
function azVerb(call: string, extraEnv: Record<string, string> = {}): { status: number; out: string } {
  const script =
    `source '${TOOLS}/lib/providers/provider-core.bash'\n` +
    `PROVIDER_NAME=azure\n` +
    ["http", "auth", "urls", "repos", "issues", "prs", "pipelines", "projects"]
      .map((m) => `source '${TOOLS}/lib/providers/azure/${m}.bash'\n`)
      .join("") +
    `${call}\n`;
  const r = spawnSync("bash", ["-c", script], {
    input: "",
    encoding: "utf8",
    env: ENV({ AZURE_DEVOPS_ORG: "org", AZURE_DEVOPS_PROJECT: "proj", ...extraEnv }),
  });
  return { status: r.status ?? 1, out: (r.stdout ?? "") + (r.stderr ?? "") };
}

function jqRead(file: string, args: string[]): string {
  return (spawnSync("jq", args, { input: file, encoding: "utf8" }).stdout ?? "").trim();
}

// jq -s -e over the request-body log: pass when every line parses and any/all
// matches. Mirrors the source's `jq -s -e ... "$REQ_BODIES"` assertions.
function reqBodyAny(expr: string): boolean {
  const body = spawnSync("cat", [REQ_BODIES], { encoding: "utf8" }).stdout ?? "";
  return spawnSync("jq", ["-s", "-e", expr], { input: body, stdio: ["pipe", "ignore", "ignore"] }).status === 0;
}

function logHas(pattern: string): boolean {
  return spawnSync("grep", ["-q", pattern, CALL_LOG]).status === 0;
}

describe("provider azure register (recorded fixtures)", () => {
  // ── Pull requests ────────────────────────────────────────────────────────

  it("provider_prs_merge --rebase --delete-branch sends completionOptions with the strategy and branch deletion", () => {
    const r = azVerb("provider_prs_merge repo1 12 --rebase --delete-branch", {
      STUB_CURL_RESPONSE: join(FIXTURES, "pullrequest.completed.json"),
      STUB_CURL_REQUEST_BODY: REQ_BODIES,
    });
    expect(r.status).toBe(0);
    expect(
      reqBodyAny('any(.[]; .completionOptions.mergeStrategy == "rebase" and .completionOptions.deleteSourceBranch == true)'),
    ).toBe(true);
  });

  it("provider_prs_list --state merged queries completed PRs (verified live)", () => {
    const r = azVerb("provider_prs_list repo1 --state merged", {
      STUB_CURL_RESPONSE: join(FIXTURES, "pullrequests.list.all.json"),
    });
    expect(r.status).toBe(0);
    expect(logHas("status=completed")).toBe(true);
  });

  it("provider_prs_list --state closed also covers abandoned PRs", () => {
    const r = azVerb("provider_prs_list repo1 --state closed", {
      STUB_CURL_RESPONSE: join(FIXTURES, "pullrequests.list.all.json"),
    });
    expect(r.status).toBe(0);
    expect(spawnSync("grep", ["-qE", "status=(all|abandoned)", CALL_LOG]).status).toBe(0);
  });

  it("provider_prs_threads_page maps the recorded comment text and author", () => {
    const r = azVerb("provider_prs_threads_page org/proj/repo1 12", {
      STUB_CURL_RESPONSE: join(FIXTURES, "pullrequest.threads.json"),
    });
    expect(r.status).toBe(0);
    const expected = jqRead(
      spawnSync("cat", [join(FIXTURES, "pullrequest.threads.json")], { encoding: "utf8" }).stdout ?? "",
      ["-r", ".value[0].comments[0].content"],
    );
    const ok = spawnSync(
      "jq",
      ["-e", "--arg", "c", expected, ".data.repository.pullRequest.reviewThreads.nodes[0].comments.nodes[0].body == $c"],
      { input: r.out, stdio: ["pipe", "ignore", "ignore"] },
    );
    expect(ok.status).toBe(0);
  });

  it("provider_prs_threads_page emits each thread under its real id, <pr>/<thread>", () => {
    const r = azVerb("provider_prs_threads_page org/proj/repo1 12", {
      STUB_CURL_RESPONSE: join(FIXTURES, "pullrequest.threads.json"),
    });
    expect(r.status).toBe(0);
    const tid = jqRead(
      spawnSync("cat", [join(FIXTURES, "pullrequest.threads.json")], { encoding: "utf8" }).stdout ?? "",
      [".value[0].id"],
    );
    const ok = spawnSync(
      "jq",
      ["-e", "--arg", "id", `12/${tid}`, ".data.repository.pullRequest.reviewThreads.nodes[0].id == $id"],
      { input: r.out, stdio: ["pipe", "ignore", "ignore"] },
    );
    expect(ok.status).toBe(0);
  });

  it("provider_prs_threads_page reports an active thread unresolved and a fixed thread resolved", () => {
    const resolvedList = join(TMP, "resolved-list.json");
    writeFileSync(
      resolvedList,
      jqRead(spawnSync("cat", [join(FIXTURES, "pullrequest.thread.resolved.json")], { encoding: "utf8" }).stdout ?? "", ["{value: [.]}"]),
    );
    let r = azVerb("provider_prs_threads_page org/proj/repo1 12", { STUB_CURL_RESPONSE: resolvedList });
    expect(r.status).toBe(0);
    expect(
      spawnSync("jq", ["-e", ".data.repository.pullRequest.reviewThreads.nodes[0].isResolved == true"], {
        input: r.out,
        stdio: ["pipe", "ignore", "ignore"],
      }).status,
    ).toBe(0);
    r = azVerb("provider_prs_threads_page org/proj/repo1 12", {
      STUB_CURL_RESPONSE: join(FIXTURES, "pullrequest.threads.json"),
    });
    expect(
      spawnSync("jq", ["-e", ".data.repository.pullRequest.reviewThreads.nodes[0].isResolved == false"], {
        input: r.out,
        stdio: ["pipe", "ignore", "ignore"],
      }).status,
    ).toBe(0);
  });

  it("provider_prs_thread_resolve accepts the recorded response, whose status is a string", () => {
    const tid = jqRead(
      spawnSync("cat", [join(FIXTURES, "pullrequest.thread.resolved.json")], { encoding: "utf8" }).stdout ?? "",
      [".id"],
    );
    const r = azVerb(`provider_prs_thread_resolve "o1/p1/r1" "12/${tid}"`, {
      STUB_CURL_RESPONSE: join(FIXTURES, "pullrequest.thread.resolved.json"),
    });
    expect(r.status).toBe(0);
    expect(r.out).not.toContain("unknown");
  });

  // ── Work items: tags ─────────────────────────────────────────────────────

  it("provider_issues_view trims the space Azure puts after each tag separator", () => {
    // recorded System.Tags is "smoke-tag; smoke-tag-2"
    const r = azVerb('provider_issues_view "" 101', {
      STUB_CURL_RESPONSE: join(FIXTURES, "workitem.tags.two.json"),
    });
    expect(r.status).toBe(0);
    expect(
      spawnSync("jq", ["-e", '[.labels[].name] == ["smoke-tag","smoke-tag-2"]'], {
        input: r.out,
        stdio: ["pipe", "ignore", "ignore"],
      }).status,
    ).toBe(0);
  });

  it("provider_issues_add_tag is a no-op for a tag already present in the recorded tag string", () => {
    const r = azVerb("provider_issues_add_tag 101 smoke-tag-2", {
      STUB_CURL_RESPONSE: join(FIXTURES, "workitem.tags.two.json"),
      STUB_CURL_REQUEST_BODY: REQ_BODIES,
    });
    expect(r.status).toBe(0);
    expect(spawnSync("test", ["-s", REQ_BODIES]).status).not.toBe(0);
  });

  it("provider_issues_edit --remove-label removes only that tag", () => {
    const r = azVerb('provider_issues_edit "" 101 --remove-label smoke-tag-2', {
      STUB_CURL_RESPONSE: join(FIXTURES, "workitem.tags.two.json"),
      STUB_CURL_REQUEST_BODY: REQ_BODIES,
    });
    expect(r.status).toBe(0);
    expect(reqBodyAny('any(.[][]?; .path == "/fields/System.Tags" and .value == "smoke-tag")')).toBe(true);
  });

  it("provider_issues_edit --add-label sends an add op on System.Tags, which Azure appends to the existing tags (verified live)", () => {
    const r = azVerb('provider_issues_edit "" 101 --add-label extra-tag', {
      STUB_CURL_RESPONSE: join(FIXTURES, "workitem.tags.two.json"),
      STUB_CURL_REQUEST_BODY: REQ_BODIES,
    });
    expect(r.status).toBe(0);
    expect(reqBodyAny('any(.[][]?; .op == "add" and .path == "/fields/System.Tags" and (.value | contains("extra-tag")))')).toBe(true);
  });

  // ── Work items: batching, comments, relations (documented API shape) ────

  it("provider_issues_list sends at most 200 ids per workitemsbatch request", () => {
    // 450 ids from the WIQL step; the batch endpoint accepts at most 200 per call.
    const wiql450 = join(TMP, "wiql450.json");
    writeFileSync(wiql450, spawnSync("jq", ["-n", "{workItems: [range(1; 451) | {id: .}], value: []}"], { encoding: "utf8" }).stdout ?? "");
    azVerb("provider_issues_list --state all --limit 1000", {
      STUB_CURL_RESPONSE: wiql450,
      STUB_CURL_REQUEST_BODY: REQ_BODIES,
    });
    expect(reqBodyAny("all(.[]; ((.ids // []) | length) <= 200)")).toBe(true);
  });

  it("provider_issue_graph_unlink removes the child by its index in the full relations array", () => {
    // a commit ArtifactLink at index 0, the child at index 1: the index must be 1
    const parentRels = join(TMP, "parent-rels.json");
    writeFileSync(
      parentRels,
      '{"id":100,"relations":[\n' +
        ' {"rel":"ArtifactLink","url":"vstfs:///Git/Commit/aaaa%2Fbbbb%2Fcccc"},\n' +
        ' {"rel":"System.LinkTypes.Hierarchy-Forward","url":"https://dev.azure.com/o/p/_apis/wit/workItems/101"}]}\n',
    );
    const r = azVerb('provider_issue_graph_unlink "" 100 101', {
      STUB_CURL_RESPONSE: parentRels,
      STUB_CURL_REQUEST_BODY: REQ_BODIES,
    });
    expect(r.status).toBe(0);
    expect(reqBodyAny('any(.[][]?; .op == "remove" and .path == "/relations/1")')).toBe(true);
  });

  // ── Status: the board Kanban column is the status (verified live) ───────

  it("provider_projects_for_issue reads the status from the Kanban column, not System.State", () => {
    // recorded: System.State "Active", Kanban column "Review"
    const r = azVerb('provider_projects_for_issue "https://dev.azure.com/org/proj/_workitems/edit/101" ""', {
      STUB_CURL_RESPONSE: join(FIXTURES, "kanban.column.Review.json"),
    });
    expect(r.status).toBe(0);
    expect((r.out.trim().split("\t")[2] ?? "").trim()).toBe("Review");
  });

  it("provider_projects_field_option_ids accepts every status_workflow word", () => {
    for (const word of ["TBD", "To-Groom", "Ready", "Implementing", "Review", "Merged", "Staging", "Production"]) {
      const r = azVerb(`provider_projects_field_option_ids proj Status "${word}"`, {
        STUB_CURL_RESPONSE: join(FIXTURES, "workitemtypes.user-story.states.json"),
      });
      expect(r.status, `word '${word}' rejected: ${r.out}`).toBe(0);
    }
  });

  it("provider_projects_field_set writes the item's Kanban column field", () => {
    const r = azVerb("provider_projects_field_set proj 101 Status Review", {
      STUB_CURL_RESPONSE: join(FIXTURES, "kanban.column.Review.json"),
      STUB_CURL_REQUEST_BODY: REQ_BODIES,
    });
    expect(r.status).toBe(0);
    expect(reqBodyAny('any(.[][]?; (.path | test("^/fields/WEF_.*_Kanban\\\\.Column$")) and .value == "Review")')).toBe(true);
  });

  // ── Transport ────────────────────────────────────────────────────────────

  it("azure-http: a 203 sign-in page is a typed auth error that names key-update-azure", () => {
    const signin = join(TMP, "signin.html");
    writeFileSync(signin, "<html><body>Sign in to your account</body></html>");
    const r = azVerb('azure_http_request GET "https://dev.azure.com/org/_apis/projects"', {
      STUB_CURL_HTTP_CODE: "203",
      STUB_CURL_RESPONSE: signin,
    });
    expect(r.status).not.toBe(0);
    expect(r.out).toContain("key-update-azure");
  });

  it("azure-http: a 401 names key-update-azure", () => {
    const r401 = join(TMP, "401.json");
    writeFileSync(r401, '{"message":"unauthorized"}');
    const r = azVerb('azure_http_request GET "https://dev.azure.com/org/_apis/projects"', {
      STUB_CURL_HTTP_CODE: "401",
      STUB_CURL_RESPONSE: r401,
    });
    expect(r.status).not.toBe(0);
    expect(r.out).toContain("key-update-azure");
  });

  it("azure-http: a failing POST is not retried, a failing GET is", () => {
    const r503 = join(TMP, "503.json");
    writeFileSync(r503, '{"message":"unavailable"}');
    writeFileSync(CALL_LOG, "");
    azVerb('azure_http_request POST "https://dev.azure.com/org/proj/_apis/wit/workitems/\\$Issue" \'{"a":1}\'', {
      STUB_CURL_HTTP_CODE: "503",
      STUB_CURL_RESPONSE: r503,
    });
    const postCalls = parseInt((spawnSync("grep", ["-c", "^curl ", CALL_LOG], { encoding: "utf8" }).stdout ?? "0").trim(), 10) || 0;
    writeFileSync(CALL_LOG, "");
    azVerb('azure_http_request GET "https://dev.azure.com/org/_apis/projects"', {
      STUB_CURL_HTTP_CODE: "503",
      STUB_CURL_RESPONSE: r503,
    });
    const getCalls = parseInt((spawnSync("grep", ["-c", "^curl ", CALL_LOG], { encoding: "utf8" }).stdout ?? "0").trim(), 10) || 0;
    expect(postCalls).toBe(1);
    expect(getCalls).toBeGreaterThanOrEqual(2);
  });

  it("azure-http: the Authorization header does not ride curl's argv", () => {
    const argvCurl = join(TMP, "curl-argv.log");
    writeFileSync(
      join(TMP, "stub-bin", "curl"),
      [
        "#!/usr/bin/env bash",
        "printf '%s\\n' \"$@\" > \"$TEST_TEMP_DIR/curl-argv.log\"",
        'prev=""',
        'for arg in "$@"; do',
        '  if [[ "$prev" == "-D" ]]; then printf \'HTTP/1.1 200 OK\\r\\n\\r\\n\' > "$arg"; fi',
        '  prev="$arg"',
        "done",
        "printf '{\"value\":[]}'",
        "",
      ].join("\n"),
    );
    const r = azVerb('azure_http_request GET "https://dev.azure.com/org/_apis/projects"', {
      TEST_TEMP_DIR: TMP,
    });
    expect(r.status).toBe(0);
    expect(spawnSync("grep", ["-qi", "^Authorization:", argvCurl]).status).not.toBe(0);
  });

  // ── Pipelines (documented API shape; the test project has no definitions) ─

  it("provider_pipelines_run_list --repo sends the repository GUID, not the name", () => {
    const repo = join(TMP, "repo.json");
    const builds = join(TMP, "builds.json");
    const queue = join(TMP, "queue");
    writeFileSync(repo, '{"id":"guid-1234","name":"r1"}');
    writeFileSync(builds, '{"value":[]}');
    writeFileSync(queue, `${repo}\n${builds}\n`);
    const r = azVerb('provider_pipelines_run_list "o1/p1/r1"', { STUB_CURL_PAGES: queue });
    expect(r.status).toBe(0);
    expect(logHas("repositoryId=guid-1234")).toBe(true);
  });

  it("provider_pipelines_run_list --workflow NAME does not send the name as a definitions id", () => {
    const empty = join(TMP, "empty.json");
    writeFileSync(empty, '{"value":[]}');
    azVerb("provider_pipelines_run_list --workflow ci.yml", { STUB_CURL_RESPONSE: empty });
    expect(logHas("definitions=ci.yml")).toBe(false);
  });

  it("provider_pipelines_run_rerun retries the build with ?retry=true", () => {
    const rerun = join(TMP, "rerun.json");
    writeFileSync(rerun, '{"id":9001}');
    const r = azVerb('provider_pipelines_run_rerun "" 9001', { STUB_CURL_RESPONSE: rerun });
    expect(r.status).toBe(0);
    expect(logHas("retry=true")).toBe(true);
  });

  // ── Recorded after bugs-as-requirements and a nested reply ──────────────

  it("provider_projects_for_issue reads a Bug's status from its Kanban column, on the Stories board", () => {
    const r = azVerb('provider_projects_for_issue "https://dev.azure.com/org/proj/_workitems/edit/101" ""', {
      STUB_CURL_RESPONSE: join(FIXTURES, "workitem.bug.json"),
    });
    expect(r.status).toBe(0);
    const cols = r.out.trim().split("\t");
    expect(cols[0] ?? "").toBe("Stories");
    expect(cols[2] ?? "").toBe("TBD");
  });

  it("provider_prs_threads_page lists the recorded reply under its thread, addressed <thread>/<comment>", () => {
    const afterReply = join(TMP, "after-reply.json");
    writeFileSync(
      afterReply,
      jqRead(spawnSync("cat", [join(FIXTURES, "pullrequest.thread.after-reply.json")], { encoding: "utf8" }).stdout ?? "", ["{value: [.]}"]),
    );
    const r = azVerb("provider_prs_threads_page org/proj/repo1 12", { STUB_CURL_RESPONSE: afterReply });
    expect(r.status).toBe(0);
    const tid = jqRead(
      spawnSync("cat", [join(FIXTURES, "pullrequest.thread.after-reply.json")], { encoding: "utf8" }).stdout ?? "",
      [".id"],
    );
    const ids = spawnSync(
      "jq",
      ["-c", "[.data.repository.pullRequest.reviewThreads.nodes[0].comments.nodes[].id]"],
      { input: r.out, encoding: "utf8" },
    ).stdout?.trim() ?? "";
    expect(ids).toBe(`["${tid}/1","${tid}/2"]`);
  });
});
