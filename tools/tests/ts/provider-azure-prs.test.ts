// Port of tools/tests/lib/test_provider_azure_prs.bats (64 tests) — one
// vitest `it` per source `@test`. The azure provider PR domain: list/view
// field mapping, create (draft + reviewers + labels + long-body comment),
// the merge two-step with polling, diff paging, comment, and the
// review-thread verbs. All transport via stub curl.
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
let PAGES_QUEUE = "";

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
  'for arg in "$@"; do [[ "$arg" == "@-" ]] && { cat > /dev/null; break; }; done\n',
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
  "  printf '\\r\\n'",
  "} > \"$headers_file\"",
  'if [[ -n "${STUB_CURL_PAGES:-}" && -f "${STUB_CURL_PAGES}" ]]; then',
  '  if [[ -s "$STUB_CURL_PAGES" ]]; then',
  '    page_file=$(head -n 1 "$STUB_CURL_PAGES")',
  '    tail -n +2 "$STUB_CURL_PAGES" > "$STUB_CURL_PAGES.tmp" && mv "$STUB_CURL_PAGES.tmp" "$STUB_CURL_PAGES"',
  '    if [[ -s "$STUB_CURL_PAGES" ]]; then',
  '    printf \'x-ms-continuationtoken: token-page-2\\r\\n\' >> "$headers_file"',
  "    fi",
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
  TMP = mkdtempSync(join(tmpdir(), `azprs-${Date.now()}-${Math.random().toString(36).slice(2)}`));
  CALL_LOG = join(TMP, "stub-calls.log");
  DEVENV_ROOT = join(TMP, "devenv-root");
  PAGES_QUEUE = join(TMP, "pages.queue");
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

// DEVENV_REPO is stripped from the inherited env: the source suite only ever
// sets it explicitly (and unsets it for the no-repo failure test).
const { DEVENV_REPO: _dr, ...procEnv } = process.env;

const ENV = (extra: Record<string, string> = {}): Record<string, string> => ({
  ...procEnv,
  DEVENV_TOOLS: TOOLS,
  DEVENV_ROOT,
  AZURE_PAT: "test-pat",
  AZURE_PAT_FILE: join(TMP, "azure.pat"),
  STUB_CALL_LOG: CALL_LOG,
  STUB_CURL_RESPONSE: join(TMP, "curl-response"),
  PATH: `${join(TMP, "stub-bin")}:${procEnv.PATH ?? ""}`,
  ...extra,
});

// azure_libs_source + call (this suite's module list: http/urls/repos/issues/prs).
function azVerb(
  call: string,
  extraEnv: Record<string, string> = {},
  cwd?: string,
): { status: number; out: string } {
  const script =
    `source '${TOOLS}/lib/providers/provider-core.bash'\n` +
    `PROVIDER_NAME=azure\n` +
    ["http", "urls", "repos", "issues", "prs"]
      .map((m) => `source '${TOOLS}/lib/providers/azure/${m}.bash'\n`)
      .join("") +
    `${call}\n`;
  const r = spawnSync("bash", ["-c", script], {
    input: "",
    encoding: "utf8",
    cwd,
    env: ENV({ AZURE_DEVOPS_ORG: "org", AZURE_DEVOPS_PROJECT: "proj", ...extraEnv }),
  });
  return { status: r.status ?? 1, out: (r.stdout ?? "") + (r.stderr ?? "") };
}

// pr_payload: a single-PR payload shaped like Azure's get response.
function prPayload(): string {
  return [
    '{"pullRequestId":12,"title":"Add feature","description":"body text","status":"active","isDraft":true,"mergeStatus":"succeeded",',
    ' "sourceRefName":"refs/heads/feature/x","targetRefName":"refs/heads/master",',
    ' "createdBy":{"displayName":"Alice"},',
    ' "lastMergeSourceCommit":{"commitId":"abc123def456"},',
    ' "repository":{"webUrl":"https://dev.azure.com/org/proj/_git/repo1"}}',
  ].join("\n");
}

function pageQueue(...files: string[]): string {
  writeFileSync(PAGES_QUEUE, files.map((f) => `${f}\n`).join(""));
  return PAGES_QUEUE;
}

function writeTmp(name: string, content: string): string {
  const f = join(TMP, name);
  writeFileSync(f, content);
  return f;
}

function jqOut(json: string, args: string[]): string {
  return (spawnSync("jq", args, { input: json, encoding: "utf8" }).stdout ?? "").trim();
}

function jqOk(json: string, args: string[]): boolean {
  return spawnSync("jq", args, { input: json, stdio: ["pipe", "ignore", "ignore"] }).status === 0;
}

function reqBodyAny(file: string, expr: string, extraArgs: string[] = []): boolean {
  const body = spawnSync("cat", [file], { encoding: "utf8" }).stdout ?? "";
  return spawnSync("jq", ["-s", "-e", ...extraArgs, expr], { input: body, stdio: ["pipe", "ignore", "ignore"] }).status === 0;
}

function bodyCount(file: string, expr: string): string {
  const body = spawnSync("cat", [file], { encoding: "utf8" }).stdout ?? "";
  return jqOut(body, ["-s", expr]);
}

function logHas(pattern: string): boolean {
  return spawnSync("grep", ["-q", pattern, CALL_LOG]).status === 0;
}

function bodyHas(file: string, pattern: string): boolean {
  return spawnSync("grep", ["-q", pattern, file]).status === 0;
}

describe("provider azure prs", () => {
  it("provider_prs_list maps fields and filters into Azure criteria", () => {
    const prs = writeTmp(
      "prs.json",
      '{"value":[{"pullRequestId":12,"title":"t","status":"active","isDraft":false,"sourceRefName":"refs/heads/f","targetRefName":"refs/heads/m","repository":{"webUrl":"https://dev.azure.com/org/proj/_git/r"}}]}',
    );
    const r = azVerb("provider_prs_list proj/repo1 --state open --head f --base m", { STUB_CURL_RESPONSE: prs });
    expect(r.status).toBe(0);
    expect(
      jqOk(r.out, ["-e", '.[0].number == 12 and .[0].state == "OPEN" and .[0].headRefName == "f" and .[0].baseRefName == "m"']),
    ).toBe(true);
    expect(logHas("status=active")).toBe(true);
    expect(logHas("sourceRefName=refs%2Fheads%2Ff")).toBe(true);
    expect(logHas("targetRefName=refs%2Fheads%2Fm")).toBe(true);
  });

  it("provider_prs_list --json/--jq apply gh list semantics (scalar select over the array)", () => {
    // pr-create relies on --jq '.[0].url' returning
    // a scalar (empty for no match, the url string for a match).
    const prs = writeTmp(
      "prs.json",
      '{"value":[{"pullRequestId":12,"title":"t","status":"active","isDraft":false,"sourceRefName":"refs/heads/f","targetRefName":"refs/heads/m","repository":{"webUrl":"https://dev.azure.com/org/proj/_git/r"}}]}',
    );
    const r = azVerb('provider_prs_list "" --state open --json url --jq ".[0].url"', { STUB_CURL_RESPONSE: prs });
    expect(r.status).toBe(0);
    expect(r.out.trim()).toBe("https://dev.azure.com/org/proj/_git/r/pullrequest/12");
  });

  it("provider_prs_list --jq over an empty result is empty output, not the string null", () => {
    // gh suppresses null jq results; consumers gate on [ -n "$url" ] to
    // decide whether an open PR exists — "null" would short-circuit creation.
    const none = writeTmp("none.json", '{"value":[]}');
    const r = azVerb('provider_prs_list "" --state open --json url --jq ".[0].url"', { STUB_CURL_RESPONSE: none });
    expect(r.status).toBe(0);
    expect(r.out).toBe("");
  });

  it("provider_prs_list --state closed returns completed and abandoned PRs but not active ones", () => {
    const all = writeTmp(
      "all.json",
      '{"value":[{"pullRequestId":1,"status":"active","sourceRefName":"refs/heads/a","targetRefName":"refs/heads/m"},{"pullRequestId":2,"status":"abandoned","sourceRefName":"refs/heads/b","targetRefName":"refs/heads/m"},{"pullRequestId":3,"status":"completed","sourceRefName":"refs/heads/c","targetRefName":"refs/heads/m"}]}',
    );
    const r = azVerb("provider_prs_list proj/repo1 --state closed", { STUB_CURL_RESPONSE: all });
    expect(r.status).toBe(0);
    expect(jqOut(r.out, ["-c", "[.[].number]"])).toBe("[2,3]");
  });

  it("provider_prs_list pages with $skip until a short page, so a long list is not cut at the server default", () => {
    const mk = (n: number) =>
      `{"pullRequestId":${n},"status":"active","sourceRefName":"refs/heads/a","targetRefName":"refs/heads/m"}`;
    const p1 = writeTmp("p1.json", `{"value":[${mk(1)},${mk(2)}]}`);
    const p2 = writeTmp("p2.json", `{"value":[${mk(3)}]}`);
    const queue = pageQueue(p1, p2);
    const r = azVerb("provider_prs_list proj/repo1 --state open", {
      AZURE_PR_PAGE_SIZE: "2",
      STUB_CURL_PAGES: queue,
    });
    expect(r.status).toBe(0);
    expect(jqOut(r.out, ["-c", "[.[].number]"])).toBe("[1,2,3]");
    expect(logHas("skip=0")).toBe(true);
    expect(logHas("skip=2")).toBe(true);
  });

  it("provider_prs_list --limit caps the result and asks for no more than the limit", () => {
    const mk = (n: number) =>
      `{"pullRequestId":${n},"status":"active","sourceRefName":"refs/heads/a","targetRefName":"refs/heads/m"}`;
    const p1 = writeTmp("p1.json", `{"value":[${mk(1)},${mk(2)}]}`);
    const p2 = writeTmp("p2.json", `{"value":[${mk(3)}]}`);
    const queue = pageQueue(p1, p2);
    const r = azVerb("provider_prs_list proj/repo1 --state open --limit 3", {
      AZURE_PR_PAGE_SIZE: "2",
      STUB_CURL_PAGES: queue,
    });
    expect(r.status).toBe(0);
    expect(jqOut(r.out, ["length"])).toBe("3");
    expect(logHas("top=1&")).toBe(true);
  });

  it("provider_prs_list with an unknown state fails instead of listing everything", () => {
    const r = azVerb("provider_prs_list proj/repo1 --state bogus");
    expect(r.status).not.toBe(0);
    expect(r.out).toContain("unknown state");
  });

  it("provider_prs_list surfaces a transport failure", () => {
    const r = azVerb("provider_prs_list proj/repo1 --state open", { STUB_CURL_FAIL: "1" });
    expect(r.status).not.toBe(0);
  });

  it("provider_prs_view maps the gh-dialect field set callers consume", () => {
    const pr = writeTmp("pr.json", prPayload());
    const r = azVerb('provider_prs_view "" 12 --json title,body,isDraft,state,author --jq .', { STUB_CURL_RESPONSE: pr });
    expect(r.status).toBe(0);
    expect(
      jqOk(r.out, ["-e", '.title == "Add feature" and .body == "body text" and .isDraft == true and .state == "OPEN" and .author.login == "Alice"']),
    ).toBe(true);
  });

  it("provider_prs_view -q headRefOid returns the source commit", () => {
    const pr = writeTmp("pr.json", prPayload());
    const r = azVerb('provider_prs_view "" 12 --json headRefOid -q .headRefOid', { STUB_CURL_RESPONSE: pr });
    expect(r.status).toBe(0);
    expect(r.out.trim()).toBe("abc123def456");
  });

  it("provider_prs_create posts refs/heads-qualified refs and prints the web URL", () => {
    const created = writeTmp("created.json", '{"pullRequestId":15,"repository":{"webUrl":"https://dev.azure.com/org/proj/_git/repo1"}}');
    const r = azVerb("provider_prs_create repo1 --title 'New PR' --body desc --head feature/y --base master --draft", {
      STUB_CURL_RESPONSE: created,
    });
    expect(r.status).toBe(0);
    expect(r.out.trim()).toBe("https://dev.azure.com/org/proj/_git/repo1/pullrequest/15");
    // The POST body carried refs/heads-qualified branch names (jq via the
    // request payload is not logged; assert the endpoint was hit).
    expect(logHas("repositories/repo1/pullrequests?api-version")).toBe(true);
  });

  // --reviewer takes a person (email, account or display name), which Azure only
  // accepts as an identity id: a GUID is used as is, anything else is looked up.
  it("provider_prs_create looks a named reviewer up as an identity and adds that id", () => {
    const created = writeTmp("created.json", '{"pullRequestId":15,"repository":{"webUrl":"https://dev.azure.com/org/proj/_git/repo1"}}');
    const identity = writeTmp("identity.json", '{"count":1,"value":[{"id":"11111111-2222-4333-8444-555555555555","providerDisplayName":"Ann"}]}');
    const added = writeTmp("added.json", "[]");
    const createBody = join(TMP, "create.body");
    writeFileSync(createBody, "");
    const queue = pageQueue(created, identity, added);
    const r = azVerb(
      "provider_prs_create repo1 --title T --body B --head f --base m --reviewer ann@example.test",
      { STUB_CURL_PAGES: queue, STUB_CURL_REQUEST_BODY: createBody },
    );
    expect(r.status).toBe(0);
    expect(logHas("vssps.dev.azure.com/org/_apis/identities")).toBe(true);
    expect(logHas("filterValue=ann%40example.test")).toBe(true);
    expect(reqBodyAny(createBody, 'any(.[]; type == "array" and .[0].id == "11111111-2222-4333-8444-555555555555")')).toBe(true);
  });

  it("provider_prs_create uses a GUID reviewer as is, without a lookup", () => {
    const created = writeTmp("created.json", '{"pullRequestId":15,"repository":{"webUrl":"https://dev.azure.com/org/proj/_git/repo1"}}');
    const r = azVerb(
      "provider_prs_create repo1 --title T --body B --head f --base m --reviewer 11111111-2222-4333-8444-555555555555",
      { STUB_CURL_RESPONSE: created },
    );
    expect(r.status).toBe(0);
    expect(logHas("identities")).toBe(false);
  });

  it("provider_prs_create still creates the PR when a reviewer cannot be found, and says so", () => {
    const created = writeTmp("created.json", '{"pullRequestId":15,"repository":{"webUrl":"https://dev.azure.com/org/proj/_git/repo1"}}');
    const noone = writeTmp("noone.json", '{"count":0,"value":[]}');
    const queue = pageQueue(created, noone);
    const r = azVerb(
      "provider_prs_create repo1 --title T --body B --head f --base m --reviewer nobody",
      { STUB_CURL_PAGES: queue },
    );
    expect(r.status).toBe(0);
    expect(r.out).toContain("https://dev.azure.com/org/proj/_git/repo1/pullrequest/15");
    expect(r.out).toContain("reviewer 'nobody'");
  });

  it("provider_prs_create sends --label values as PR labels", () => {
    const created = writeTmp("created.json", '{"pullRequestId":15,"repository":{"webUrl":"https://dev.azure.com/org/proj/_git/repo1"}}');
    const createBody = join(TMP, "create.body");
    writeFileSync(createBody, "");
    const r = azVerb(
      "provider_prs_create repo1 --title T --body B --head f --base m --label bug --label review",
      { STUB_CURL_RESPONSE: created, STUB_CURL_REQUEST_BODY: createBody },
    );
    expect(r.status).toBe(0);
    expect(reqBodyAny(createBody, 'any(.[]; (.labels // []) | map(.name) == ["bug","review"])')).toBe(true);
  });

  it("provider_prs_create keeps a description over Azure's 4000-character limit whole, as a PR comment", () => {
    const long = "x".repeat(4500);
    const created = writeTmp("created.json", '{"pullRequestId":15,"repository":{"webUrl":"https://dev.azure.com/org/proj/_git/repo1"}}');
    const thread = writeTmp("thread.json", '{"id":9}');
    const createBody = join(TMP, "create.body");
    writeFileSync(createBody, "");
    const queue = pageQueue(created, thread);
    const r = azVerb(
      `provider_prs_create repo1 --title T --body '${long}' --head f --base m`,
      { STUB_CURL_PAGES: queue, STUB_CURL_REQUEST_BODY: createBody },
    );
    expect(r.status).toBe(0);
    expect(reqBodyAny(createBody, 'any(.[]; has("description") and (.description | length) <= 4000)')).toBe(true);
    expect(
      reqBodyAny(createBody, "any(.[]; (.comments // [])[0].content == $l)", ["--arg", "l", long]),
    ).toBe(true);
  });

  it("provider_prs_view and list project the PR's own labels", () => {
    const labelled = writeTmp(
      "labelled.json",
      '{"pullRequestId":12,"title":"t","status":"active","sourceRefName":"refs/heads/f","targetRefName":"refs/heads/m","labels":[{"id":"1","name":"bug","active":true},{"id":"2","name":"old","active":false}],"reviewers":[{"displayName":"Rev"}],"repository":{"webUrl":"https://dev.azure.com/org/proj/_git/r"}}',
    );
    let r = azVerb("provider_prs_view repo1 12", { STUB_CURL_RESPONSE: labelled });
    expect(r.status).toBe(0);
    expect(jqOut(r.out, ["-c", "[.labels[].name]"])).toBe('["bug"]');
    const labelledList = writeTmp("labelled-list.json", `{"value":[${spawnSync("cat", [labelled], { encoding: "utf8" }).stdout?.trim() ?? ""}]}`);
    r = azVerb("provider_prs_list repo1 --state open", { STUB_CURL_RESPONSE: labelledList });
    expect(r.status).toBe(0);
    expect(jqOut(r.out, ["-c", "[.[0].labels[].name]"])).toBe('["bug"]');
  });

  it("provider_prs_diff without --name-only emits one {path, changeType} object per changed file", () => {
    const iters = writeTmp("iters.json", '{"value":[{"id":3}]}');
    const changes = writeTmp(
      "changes.json",
      '{"changes":[{"changeType":"edit","item":{"path":"/src/a.cs"}},{"changeType":"add","item":{"path":"/src/b.cs"}}]}',
    );
    const queue = pageQueue(iters, changes);
    const r = azVerb('provider_prs_diff "" 12', { STUB_CURL_PAGES: queue });
    expect(r.status).toBe(0);
    expect(jqOut(r.out, ["-s", "-c", "map(.path)"])).toBe('["/src/a.cs","/src/b.cs"]');
    expect(jqOut(r.out, ["-r", 'select(.path=="/src/b.cs") | .changeType'])).toBe("add");
  });

  it("provider_prs_create without a repository fails defined", () => {
    const r = azVerb('provider_prs_create "" --title \'New PR\' --head feature/y --base master');
    expect(r.status).not.toBe(0);
    expect(r.out).toContain("repository is required");
  });

  it("provider_prs_create requires title, head and base", () => {
    const r = azVerb('provider_prs_create "" --title "only title"');
    expect(r.status).not.toBe(0);
    expect(r.out).toContain("--head");
  });

  it("provider_prs_merge completes with one PATCH whose completionOptions carry strategy and branch deletion", () => {
    const merged = writeTmp("merged.json", '{"pullRequestId":12,"status":"completed","lastMergeSourceCommit":{"commitId":"abc123"}}');
    const mergeBody = join(TMP, "merge.body");
    writeFileSync(mergeBody, "");
    const r = azVerb("provider_prs_merge repo1 12 --rebase --delete-branch", {
      STUB_CURL_RESPONSE: merged,
      STUB_CURL_REQUEST_BODY: mergeBody,
    });
    expect(r.status).toBe(0);
    // exactly one body carries a status: the completion PATCH (no separate strategy PATCH)
    expect(bodyCount(mergeBody, '[.[] | select(has("status"))] | length')).toBe("1");
    expect(
      reqBodyAny(
        mergeBody,
        'any(.[]; .status == "completed" and .lastMergeSourceCommit.commitId == "abc123"\n        and .completionOptions.mergeStrategy == "rebase" and .completionOptions.deleteSourceBranch == true)',
      ),
    ).toBe(true);
  });

  it("provider_prs_merge puts subject and body into one mergeCommitMessage and --admin into bypassPolicy", () => {
    const merged = writeTmp("merged.json", '{"pullRequestId":12,"status":"completed","lastMergeSourceCommit":{"commitId":"abc123"}}');
    const mergeBody = join(TMP, "merge.body");
    writeFileSync(mergeBody, "");
    const r = azVerb('provider_prs_merge repo1 12 --merge --admin --subject Title --body Details', {
      STUB_CURL_RESPONSE: merged,
      STUB_CURL_REQUEST_BODY: mergeBody,
    });
    expect(r.status).toBe(0);
    expect(
      reqBodyAny(
        mergeBody,
        'any(.[]; .completionOptions.mergeStrategy == "noFastForward" and .completionOptions.bypassPolicy == true\n        and .completionOptions.mergeCommitMessage == "Title\\n\\nDetails")',
      ),
    ).toBe(true);
  });

  // Completion is asynchronous: right after the PATCH the PR is still active with
  // mergeStatus queued. The verb polls until it is completed.
  it("provider_prs_merge polls a queued completion until the PR is completed", () => {
    const active = writeTmp("active.json", '{"pullRequestId":12,"status":"active","mergeStatus":"succeeded","lastMergeSourceCommit":{"commitId":"abc123"}}');
    const queued = writeTmp("queued.json", '{"pullRequestId":12,"status":"active","mergeStatus":"queued","lastMergeSourceCommit":{"commitId":"abc123"}}');
    const done = writeTmp("done.json", '{"pullRequestId":12,"status":"completed","mergeStatus":"succeeded","lastMergeSourceCommit":{"commitId":"abc123"}}');
    // GET (commit id), PATCH response, poll, poll
    const queue = pageQueue(active, queued, queued, done);
    const r = azVerb("provider_prs_merge repo1 12 --rebase", {
      AZURE_PR_MERGE_POLL_INTERVAL: "0",
      STUB_CURL_PAGES: queue,
    });
    expect(r.status).toBe(0);
    expect(jqOut(r.out, ["-r", ".status"])).toBe("completed");
  });

  it("provider_prs_merge reports mergeFailureMessage when the completion fails", () => {
    const active = writeTmp("active.json", '{"pullRequestId":12,"status":"active","mergeStatus":"succeeded","lastMergeSourceCommit":{"commitId":"abc123"}}');
    const queued = writeTmp("queued.json", '{"pullRequestId":12,"status":"active","mergeStatus":"queued","lastMergeSourceCommit":{"commitId":"abc123"}}');
    const failed = writeTmp(
      "failed.json",
      '{"pullRequestId":12,"status":"active","mergeStatus":"conflicts","mergeFailureType":"caseSensitivityConflict","mergeFailureMessage":"File a.txt conflicts","lastMergeSourceCommit":{"commitId":"abc123"}}',
    );
    const queue = pageQueue(active, queued, failed);
    const r = azVerb("provider_prs_merge repo1 12 --rebase", {
      AZURE_PR_MERGE_POLL_INTERVAL: "0",
      STUB_CURL_PAGES: queue,
    });
    expect(r.status).not.toBe(0);
    expect(r.out).toContain("File a.txt conflicts");
  });

  it("provider_prs_merge fails with the PR's state when completion never lands", () => {
    const queued = writeTmp("queued.json", '{"pullRequestId":12,"status":"active","mergeStatus":"queued","lastMergeSourceCommit":{"commitId":"abc123"}}');
    const r = azVerb("provider_prs_merge repo1 12 --rebase", {
      AZURE_PR_MERGE_POLL_ATTEMPTS: "2",
      AZURE_PR_MERGE_POLL_INTERVAL: "0",
      STUB_CURL_RESPONSE: queued,
    });
    expect(r.status).not.toBe(0);
    expect(r.out).toContain("not completed");
    expect(r.out).toContain("queued");
  });

  it("provider_prs_merge fails when the PR was abandoned instead of completed", () => {
    const ab = writeTmp("ab.json", '{"pullRequestId":12,"status":"abandoned","lastMergeSourceCommit":{"commitId":"abc123"}}');
    const r = azVerb("provider_prs_merge repo1 12 --rebase", { STUB_CURL_RESPONSE: ab });
    expect(r.status).not.toBe(0);
    expect(r.out).toContain("abandoned");
  });

  it("provider_prs_merge --squash maps to the squash strategy", () => {
    const m2 = writeTmp("m2.json", '{"pullRequestId":12,"status":"completed","lastMergeSourceCommit":{"commitId":"abc123"}}');
    const r = azVerb("provider_prs_merge repo1 12 --squash", { STUB_CURL_RESPONSE: m2 });
    expect(r.status).toBe(0);
  });

  it("provider_prs_merge without a repository fails defined", () => {
    const r = azVerb('provider_prs_merge "" 12 --rebase');
    expect(r.status).not.toBe(0);
    expect(r.out).toContain("repository is required");
  });

  it("provider_prs_comment creates a thread with no status, so it can neither block a comment-resolution policy nor read as resolved", () => {
    const c = writeTmp("c.json", '{"id":900}');
    const cbody = join(TMP, "cbody.log");
    writeFileSync(cbody, "");
    const r = azVerb('provider_prs_comment "" 12 --body fyi', {
      STUB_CURL_RESPONSE: c,
      STUB_CURL_REQUEST_BODY: cbody,
    });
    expect(r.status).toBe(0);
    expect(bodyHas(cbody, '"status"')).toBe(false);
  });

  it("a plain pr-comment thread (no status, no file) is not a review thread; status-bearing and inline threads are", () => {
    const thMix = writeTmp(
      "th-mix.json",
      [
        '{"value":[',
        ' {"id":1,"comments":[{"id":1,"content":"plain comment","author":{"displayName":"a"}}]},',
        ' {"id":2,"status":"unknown","comments":[{"id":1,"content":"unknown status","author":{"displayName":"a"}}]},',
        ' {"id":3,"status":"active","comments":[{"id":1,"content":"general review thread","author":{"displayName":"a"}}]},',
        ' {"id":4,"comments":[{"id":1,"content":"inline, no status","author":{"displayName":"a"}}],"threadContext":{"filePath":"/a.cs","rightFileStart":{"line":3,"offset":1}}},',
        ' {"id":5,"status":"fixed","comments":[{"id":1,"content":"done","author":{"displayName":"a"}}]}]}',
      ].join("\n"),
    );
    const r = azVerb("provider_prs_threads_page o1/p1/r1 12", { STUB_CURL_RESPONSE: thMix });
    expect(r.status).toBe(0);
    expect(
      jqOut(r.out, ["-r", "[.data.repository.pullRequest.reviewThreads.nodes[].id] | join(\",\")"]),
    ).toBe("12/3,12/4,12/5");
    expect(
      jqOut(r.out, ["-r", '[.data.repository.pullRequest.reviewThreads.nodes[] | select(.id == "12/5") | .isResolved][0]']),
    ).toBe("true");
    expect(
      jqOut(r.out, ["-r", '[.data.repository.pullRequest.reviewThreads.nodes[] | select(.id == "12/3") | .isResolved][0]']),
    ).toBe("false");
  });

  it("a thread created by provider_prs_comment is absent from the review threads", () => {
    const thComment = writeTmp(
      "th-comment.json",
      '{"value":[{"id":900,"comments":[{"id":1,"content":"fyi","author":{"displayName":"a"}}]}]}',
    );
    const r = azVerb("provider_prs_threads_page o1/p1/r1 12", { STUB_CURL_RESPONSE: thComment });
    expect(r.status).toBe(0);
    expect(jqOut(r.out, ["-r", ".data.repository.pullRequest.reviewThreads.nodes | length"])).toBe("0");
  });

  it("provider_prs_comment posts a thread and prints its bare thread id", () => {
    const thread = writeTmp("thread.json", '{"id":77,"status":1}');
    const r = azVerb('provider_prs_comment "" 12 --body "ship it"', { STUB_CURL_RESPONSE: thread });
    expect(r.status).toBe(0);
    expect(r.out.trim()).toBe("77");
    expect(logHas("pullrequests/12/threads")).toBe(true);
  });

  it("provider_prs_diff lists changed paths with --name-only", () => {
    const iters = writeTmp("iters.json", '{"value":[{"id":3}]}');
    const changes = writeTmp("changes.json", '{"changes":[{"item":{"path":"/src/a.cs"}},{"item":{"path":"/src/b.cs"}}]}');
    const queue = pageQueue(iters, changes);
    const r = azVerb('provider_prs_diff "" 12 --name-only', { STUB_CURL_PAGES: queue });
    expect(r.status).toBe(0);
    expect(r.out).toContain("/src/a.cs");
    expect(r.out).toContain("/src/b.cs");
  });

  // Thread shapes as Azure returns them: id, a string status, threadContext (null for a
  // general thread), commentType "text" for people and "system" for Azure's own notes.
  it("provider_prs_threads_page maps an inline thread's file and line from threadContext", () => {
    const inline = writeTmp(
      "inline.json",
      [
        '{"value":[{"id":7,"status":"active","isDeleted":false,',
        '  "threadContext":{"filePath":"/src/a.cs","rightFileStart":{"line":12,"offset":1},"rightFileEnd":{"line":12,"offset":5}},',
        '  "comments":[{"id":1,"parentCommentId":0,"content":"nit","commentType":"text","author":{"displayName":"Ann"}}]}]}',
      ].join("\n"),
    );
    const r = azVerb("provider_prs_threads_page org/proj/repo1 12", { STUB_CURL_RESPONSE: inline });
    expect(r.status).toBe(0);
    expect(
      jqOk(r.out, ["-e", '.data.repository.pullRequest.reviewThreads.nodes[0] | .id == "12/7" and .path == "/src/a.cs" and .line == 12']),
    ).toBe(true);
  });

  it("provider_prs_threads_page maps a left-side inline thread's line", () => {
    const left = writeTmp(
      "left.json",
      [
        '{"value":[{"id":8,"status":"active","isDeleted":false,',
        '  "threadContext":{"filePath":"/src/a.cs","leftFileStart":{"line":4,"offset":1}},',
        '  "comments":[{"id":1,"parentCommentId":0,"content":"old line","commentType":"text","author":{"displayName":"Ann"}}]}]}',
      ].join("\n"),
    );
    const r = azVerb("provider_prs_threads_page org/proj/repo1 12", { STUB_CURL_RESPONSE: left });
    expect(r.status).toBe(0);
    expect(jqOk(r.out, ["-e", ".data.repository.pullRequest.reviewThreads.nodes[0].line == 4"])).toBe(true);
  });

  it("provider_prs_threads_page drops system threads and deleted threads", () => {
    const mixed = writeTmp(
      "mixed.json",
      [
        '{"value":[',
        ' {"id":1,"status":"active","isDeleted":false,"threadContext":null,',
        '  "comments":[{"id":1,"parentCommentId":0,"content":"Ann updated the PR","commentType":"system","author":{"displayName":"Ann"}}]},',
        ' {"id":2,"status":"active","isDeleted":true,"threadContext":null,',
        '  "comments":[{"id":1,"parentCommentId":0,"content":"gone","commentType":"text","author":{"displayName":"Ann"}}]},',
        ' {"id":3,"status":"closed","isDeleted":false,"threadContext":null,',
        '  "comments":[{"id":1,"parentCommentId":0,"content":"kept","commentType":"text","author":{"displayName":"Ann"}}]}]}',
      ].join("\n"),
    );
    const r = azVerb("provider_prs_threads_page org/proj/repo1 12", { STUB_CURL_RESPONSE: mixed });
    expect(r.status).toBe(0);
    expect(
      jqOut(r.out, ["-c", "[.data.repository.pullRequest.reviewThreads.nodes[].id]"]),
    ).toBe('["12/3"]');
    expect(jqOk(r.out, ["-e", ".data.repository.pullRequest.reviewThreads.nodes[0].isResolved == true"])).toBe(true);
  });

  it("provider_prs_threads_page treats every status other than active and pending as resolved", () => {
    const threadWith = (status: string) =>
      writeTmp(
        "st.json",
        `{"value":[{"id":1,"status":"${status}","isDeleted":false,"threadContext":null,"comments":[{"id":1,"parentCommentId":0,"content":"c","commentType":"text","author":{"displayName":"A"}}]}]}`,
      );
    for (const st of ["fixed", "wontFix", "closed", "byDesign"]) {
      const stJson = threadWith(st);
      const r = azVerb("provider_prs_threads_page org/proj/repo1 12", { STUB_CURL_RESPONSE: stJson });
      expect(
        jqOk(r.out, ["-e", ".data.repository.pullRequest.reviewThreads.nodes[0].isResolved == true"]),
        `not resolved: ${st}`,
      ).toBe(true);
    }
    for (const st of ["active", "pending"]) {
      const stJson = threadWith(st);
      const r = azVerb("provider_prs_threads_page org/proj/repo1 12", { STUB_CURL_RESPONSE: stJson });
      expect(
        jqOk(r.out, ["-e", ".data.repository.pullRequest.reviewThreads.nodes[0].isResolved == false"]),
        `resolved: ${st}`,
      ).toBe(true);
    }
  });

  it("provider_prs_threads_page with a cursor emits an empty final page", () => {
    const r = azVerb("provider_prs_threads_page org/proj/repo1 12 CURSOR");
    expect(r.status).toBe(0);
    expect(jqOk(r.out, ["-e", ".data.repository.pullRequest.reviewThreads.pageInfo.hasNextPage == false"])).toBe(true);
  });

  it("provider_prs_thread_resolve without a repo fails defined when none can be resolved (routes are repositories-qualified)", () => {
    const r = azVerb("provider_prs_thread_resolve 12/5", { DEVENV_REPO: "" }, TMP);
    expect(r.status).not.toBe(0);
    expect(r.out).toContain("repositories-qualified");
  });

  it("provider_prs_thread_resolve without a composite ref fails with guidance", () => {
    const r = azVerb("provider_prs_thread_resolve o1/p1/r1 5");
    expect(r.status).not.toBe(0);
    expect(r.out).toContain("pr-threads-get");
  });

  it("provider_prs_thread_resolve builds a repositories-qualified route", () => {
    // F-SMOKE-5 regression, live-corrected: thread routes are
    // repositories-qualified — the project-git base (no repositories
    // segment) is an MVC 404. Repo form: <repo>/<pr>/<thread>.
    const resolved2 = writeTmp("resolved2.json", '{"id":5,"status":2}');
    const resolve2Body = join(TMP, "resolve2.body");
    writeFileSync(resolve2Body, "");
    const r = azVerb("provider_prs_thread_resolve o1/p1/r1 12/5", {
      STUB_CURL_RESPONSE: resolved2,
      STUB_CURL_REQUEST_BODY: resolve2Body,
    });
    expect(r.status).toBe(0);
    expect(logHas("dev.azure.com/o1/p1/_apis/git/repositories/r1/pullrequests/12/threads/5")).toBe(true);
    // Live-verified: the status PATCH takes the thread object {status: 2} —
    // a JSON-Patch array fails with "Parameter name: commentThread".
    expect(bodyHas(resolve2Body, '"status"')).toBe(true);
    expect(bodyHas(resolve2Body, '"op"')).toBe(false);
  });

  it("provider_prs_thread_resolve takes the <pr>/<thread> ref from pr-threads-get and routes it to the resolved repo", () => {
    const fixed = writeTmp("fixed.json", '{"id":5,"status":"fixed"}');
    const r = azVerb("provider_prs_thread_resolve 12/5", {
      DEVENV_REPO: "p1/r1",
      STUB_CURL_RESPONSE: fixed,
    });
    expect(r.status).toBe(0);
    expect(r.out.trim()).toBe("true");
    expect(logHas("dev.azure.com/org/p1/_apis/git/repositories/r1/pullrequests/12/threads/5")).toBe(true);
  });

  it("provider_prs_thread_resolve reports unknown when the thread is still active after the PATCH", () => {
    const still = writeTmp("still.json", '{"id":5,"status":"active"}');
    const r = azVerb("provider_prs_thread_resolve o1/p1/r1 12/5", { STUB_CURL_RESPONSE: still });
    expect(r.status).toBe(0);
    expect(r.out.trim()).toBe("unknown");
  });

  it("provider_prs_thread_resolve sets the thread status by name, which Azure accepts as a string", () => {
    const fixed = writeTmp("fixed.json", '{"id":5,"status":"fixed"}');
    const resolveBody = join(TMP, "resolve.body");
    writeFileSync(resolveBody, "");
    azVerb("provider_prs_thread_resolve o1/p1/r1 12/5", {
      STUB_CURL_RESPONSE: fixed,
      STUB_CURL_REQUEST_BODY: resolveBody,
    });
    expect(reqBodyAny(resolveBody, 'any(.[]; .status == "fixed")')).toBe(true);
  });

  it("provider_prs_thread_reply replies under the named comment: <thread>/<comment> sets parentCommentId", () => {
    const reply = writeTmp("reply.json", '{"id":3}');
    const replyBody = join(TMP, "reply.body");
    writeFileSync(replyBody, "");
    const r = azVerb("provider_prs_thread_reply o1/p1/r1 12 62644/2 'reply text'", {
      STUB_CURL_RESPONSE: reply,
      STUB_CURL_REQUEST_BODY: replyBody,
    });
    expect(r.status).toBe(0);
    expect(logHas("pullrequests/12/threads/62644/comments")).toBe(true);
    expect(reqBodyAny(replyBody, 'any(.[]; .parentCommentId == 2 and .content == "reply text")')).toBe(true);
  });

  it("provider_prs_thread_reply with a bare thread id replies under the thread's first comment", () => {
    const reply = writeTmp("reply.json", '{"id":3}');
    const replyBody = join(TMP, "reply.body");
    writeFileSync(replyBody, "");
    const r = azVerb("provider_prs_thread_reply o1/p1/r1 12 5 'reply text'", {
      STUB_CURL_RESPONSE: reply,
      STUB_CURL_REQUEST_BODY: replyBody,
    });
    expect(r.status).toBe(0);
    expect(reqBodyAny(replyBody, "any(.[]; .parentCommentId == 1)")).toBe(true);
  });

  it("provider_prs_thread_reply refuses a comment ref that is not <thread> or <thread>/<comment>", () => {
    const r = azVerb('provider_prs_thread_reply o1/p1/r1 12 abc "reply text"');
    expect(r.status).not.toBe(0);
    expect(r.out).toContain("pr-threads-get");
  });

  it("provider_prs_thread_reply posts a bare comment object (no threads envelope)", () => {
    // F-SMOKE-4 regression: the comments endpoint takes {content,...} —
    // the threads envelope made the store read empty content.
    const reply = writeTmp("reply.json", '{"id":77}');
    const rreqbody = join(TMP, "rreqbody.log");
    writeFileSync(rreqbody, "");
    const r = azVerb("provider_prs_thread_reply o1/p1/r1 12 5 'reply text'", {
      STUB_CURL_RESPONSE: reply,
      STUB_CURL_REQUEST_BODY: rreqbody,
    });
    expect(r.status).toBe(0);
    expect(bodyHas(rreqbody, '"content"')).toBe(true);
    expect(bodyHas(rreqbody, '"comments"')).toBe(false);
  });

  it("provider_prs_diff returns empty (not a jq crash) when .changes is null", () => {
    const nochanges = writeTmp("nochanges.json", '{"value":[{"id":1,"changes":null}]}');
    const r = azVerb("provider_prs_diff o1/p1/r1 12", { STUB_CURL_RESPONSE: nochanges });
    expect(r.status).toBe(0);
    expect(r.out).toBe("");
  });

  // ============================================================================
  // provider_prs_thread_create (contract verb)
  // ============================================================================

  it("provider_prs_thread_create posts a general thread and emits gh-shaped JSON", () => {
    const thread = writeTmp("thread.json", '{"id":555,"status":1}');
    const r = azVerb("provider_prs_thread_create o1/p1/r1 12 --body note", { STUB_CURL_RESPONSE: thread });
    expect(r.status).toBe(0);
    expect(jqOut(r.out, ["-r", ".thread.id"])).toBe("12/555");
    // the contract's output: a URL (the PR page at the discussion)
    expect(jqOut(r.out, ["-r", ".thread.url"])).toBe("https://dev.azure.com/o1/p1/_git/r1/pullrequest/12?discussionId=555");
  });

  it("provider_prs_thread_create output satisfies what pr-review-comment reads (.thread.url)", () => {
    const thread4 = writeTmp("thread4.json", '{"id":558,"status":1}');
    const r = azVerb("provider_prs_thread_create o1/p1/r1 12 --body note --path a.cs --line 3", {
      STUB_CURL_RESPONSE: thread4,
    });
    expect(r.status).toBe(0);
    // The TS pr-review-comment reads parsed.thread?.url (optional-chained,
    // empty-string default) — the provider JSON's .thread.url satisfies it.
    const src = spawnSync("cat", [join(TOOLS, "ts", "pr-review-comment.ts")], { encoding: "utf8" }).stdout ?? "";
    expect(src).toContain("thread?: { url?: string }");
    expect(jqOut(r.out, ["-r", ".thread.url // empty"])).not.toBe("");
  });

  it("provider_prs_thread_create output carries a URL even when the repository is unnamed", () => {
    const thread3 = writeTmp("thread3.json", '{"id":557,"status":1}');
    const r = azVerb('provider_prs_thread_create "" 12 --body note', { STUB_CURL_RESPONSE: thread3 });
    expect(r.status).toBe(0);
    expect(jqOut(r.out, ["-r", ".thread.url"])).toContain("/pullrequests/12/threads/557");
  });

  it("provider_prs_thread_create includes threadContext for inline threads", () => {
    const thread2 = writeTmp("thread2.json", '{"id":556,"status":1}');
    const treqbody = join(TMP, "treqbody.log");
    writeFileSync(treqbody, "");
    const r = azVerb("provider_prs_thread_create o1/p1/r1 12 --body inline --path src/x.cs --line 42", {
      STUB_CURL_RESPONSE: thread2,
      STUB_CURL_REQUEST_BODY: treqbody,
    });
    expect(r.status).toBe(0);
    expect(jqOut(r.out, ["-r", ".thread.id"])).toBe("12/556");
    // Live-verified shape: offset >= 1 is mandatory (0 draws a 400 range error).
    // The payload is pretty-printed JSON — assert field-wise, not byte-wise.
    const body = spawnSync("cat", [treqbody], { encoding: "utf8" }).stdout ?? "";
    const ok =
      jqOk(body, ["-e", '.threadContext.rightFileStart == {"line": 42, "offset": 1}']) ||
      /"offset": *1/.test(body);
    expect(ok).toBe(true);
  });

  it("provider_prs_thread_create requires --body", () => {
    const r = azVerb("provider_prs_thread_create o1/p1/r1 12");
    expect(r.status).not.toBe(0);
    expect(r.out).toContain("--body");
  });

  it("provider_prs_thread_create rejects --path without --line", () => {
    const r = azVerb('provider_prs_thread_create o1/p1/r1 12 --body x --path a/b');
    expect(r.status).not.toBe(0);
  });

  it("provider_prs_view --json DEFAULT_FIELDS returns zero nulls (projection contract)", () => {
    // The zero-null contract: every field pr-get's DEFAULT_FIELDS names must
    // exist and be non-null in the mapped projection.
    const pr = writeTmp("pr.json", prPayload());
    const fields = "number,title,body,state,isDraft,headRefName,baseRefName,author,labels,assignees,reviewRequests,milestone,mergeable,mergeStateStatus,url,createdAt,updatedAt,closedAt,mergedAt,comments,reviews";
    const r = azVerb(`provider_prs_view "" 12 --json ${fields}`, { STUB_CURL_RESPONSE: pr });
    expect(r.status).toBe(0);
    expect(jqOut(r.out, ["[.[] | select(. == null)] | length"])).toBe("0");
    // mergeable/mergeStateStatus map from mergeStatus per the contract.
    expect(jqOut(r.out, ["-r", ".mergeable"])).toBe("MERGEABLE");
  });

  it("provider_prs_list encodes a branch name with a space or an ampersand in the query", () => {
    const none = writeTmp("none.json", '{"value":[]}');
    const r = azVerb('provider_prs_list proj/repo1 --state open --head "feat/a b&c"', { STUB_CURL_RESPONSE: none });
    expect(r.status).toBe(0);
    expect(logHas("sourceRefName=refs%2Fheads%2Ffeat%2Fa%20b%26c")).toBe(true);
  });

  it("azure_pr_base encodes org, project and repo names, and takes the org of a three-part spec", () => {
    let r = azVerb('azure_pr_base "my org/my proj/my repo"');
    expect(r.out).toBe("https://dev.azure.com/my%20org/my%20proj/_apis/git/repositories/my%20repo");
    r = azVerb('azure_pr_base "p 1/r 1"');
    expect(r.out).toBe("https://dev.azure.com/org/p%201/_apis/git/repositories/r%201");
  });

  it("provider_prs_diff reads every page of changes and stops when nextSkip is 0", () => {
    const iters = writeTmp("iters.json", '{"value":[{"id":1},{"id":2}]}');
    const ch1 = writeTmp(
      "ch1.json",
      '{"changes":[{"item":{"path":"/a.cs"},"changeType":"edit"},{"item":{"path":"/b.cs"},"changeType":"add"}],"nextSkip":2,"nextTop":2}',
    );
    const ch2 = writeTmp("ch2.json", '{"changes":[{"item":{"path":"/c.cs"},"changeType":"delete"}],"nextSkip":0,"nextTop":0}');
    const queue = pageQueue(iters, ch1, ch2);
    const r = azVerb('provider_prs_diff "" 12 --name-only', { STUB_CURL_PAGES: queue });
    expect(r.status).toBe(0);
    expect(r.out.trim()).toBe("/a.cs\n/b.cs\n/c.cs");
  });

  it("provider_prs_diff does not loop when the server repeats its position", () => {
    const iters2 = writeTmp("iters2.json", '{"value":[{"id":1}]}');
    const chSame = writeTmp("ch-same.json", '{"changes":[{"item":{"path":"/a.cs"},"changeType":"edit"}],"nextSkip":0}');
    const queue = pageQueue(iters2, chSame);
    const r = azVerb('provider_prs_diff "" 12 --name-only', { STUB_CURL_PAGES: queue });
    expect(r.status).toBe(0);
    expect(r.out.trim()).toBe("/a.cs");
  });

  it("provider_prs_view rejects a malformed or unknown --json field by name, and prints nothing for a null -q result", () => {
    const pr1 = writeTmp(
      "pr1.json",
      '{"pullRequestId":12,"title":"t","status":"active","sourceRefName":"refs/heads/f","targetRefName":"refs/heads/m","repository":{"webUrl":"https://dev.azure.com/org/proj/_git/r"}}',
    );
    let r = azVerb(`provider_prs_view "" 12 --json 'title,nope'`, { STUB_CURL_RESPONSE: pr1 });
    expect(r.status).not.toBe(0);
    expect(r.out).toContain("unknown JSON field 'nope'");
    r = azVerb(`provider_prs_view "" 12 --json 'title}; input'`, { STUB_CURL_RESPONSE: pr1 });
    expect(r.status).not.toBe(0);
    expect(r.out).toContain("comma-separated list of field names");
    r = azVerb(`provider_prs_view "" 12 --json mergedAt -q .missing`, { STUB_CURL_RESPONSE: pr1 });
    expect(r.status).toBe(0);
    expect(r.out).toBe("");
  });

  it("provider_prs_list rejects an unknown --json field by name", () => {
    const prsF = writeTmp(
      "prs-f.json",
      '{"value":[{"pullRequestId":12,"title":"t","status":"active","sourceRefName":"refs/heads/f","targetRefName":"refs/heads/m","repository":{"webUrl":"https://dev.azure.com/org/proj/_git/r"}}]}',
    );
    const r = azVerb(`provider_prs_list "" --json 'number,bogus'`, { STUB_CURL_RESPONSE: prsF });
    expect(r.status).not.toBe(0);
    expect(r.out).toContain("unknown JSON field 'bogus'");
  });

  it("a plain comment stays out of the review threads until someone replies in it, then it is listed", () => {
    const thReply = writeTmp(
      "th-reply.json",
      [
        '{"value":[',
        ' {"id":1,"comments":[{"id":1,"content":"bot summary","author":{"displayName":"bot"}}]},',
        ' {"id":2,"comments":[{"id":1,"content":"bot summary","author":{"displayName":"bot"}},{"id":2,"content":"human answer","author":{"displayName":"human"}}]},',
        ' {"id":3,"comments":[{"id":1,"content":"merge policy","commentType":"system","author":{"displayName":"x"}},{"id":2,"content":"also system","commentType":"system","author":{"displayName":"x"}}]}]}',
      ].join("\n"),
    );
    const r = azVerb("provider_prs_threads_page o1/p1/r1 12", { STUB_CURL_RESPONSE: thReply });
    expect(r.status).toBe(0);
    expect(
      jqOut(r.out, ["-r", "[.data.repository.pullRequest.reviewThreads.nodes[].id] | join(\",\")"]),
    ).toBe("12/2");
    expect(jqOut(r.out, ["-r", ".data.repository.pullRequest.reviewThreads.nodes[0].comments.nodes | length"])).toBe("2");
  });

  it("the id pr-comment prints builds the ref thread resolve takes", () => {
    const newThread = writeTmp("new-thread.json", '{"id":77}');
    const r1 = azVerb("provider_prs_comment o1/p1/r1 12 --body x", { STUB_CURL_RESPONSE: newThread });
    const id = r1.out.trim();
    expect(id).toBe("77");
    const resolved = writeTmp("resolved.json", '{"id":77,"status":"fixed"}');
    writeFileSync(CALL_LOG, "");
    const r2 = azVerb(`provider_prs_thread_resolve o1/p1/r1 "12/${id}"`, { STUB_CURL_RESPONSE: resolved });
    expect(r2.status).toBe(0);
    expect(logHas("pullrequests/12/threads/77")).toBe(true);
  });
});
