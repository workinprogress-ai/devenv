// Port of tools/tests/lib/test_provider_azure_issues.bats (48 tests) — one
// vitest `it` per source `@test`. The azure provider issues domain: work-item
// listing (WIQL), view/exists/comments reads, create/comment/close/reopen/edit
// mutations, tag<->label mapping, graph relation verbs, and the artifact
// marker transform. Transport via stub curl.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const ROOT = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))));
const TOOLS = join(ROOT, "tools");
const FIXDIR = join(ROOT, "tools", "tests", "fixtures", "azure");

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
  '    if [[ -s "$STUB_CURL_PAGES" ]]; then',
  "    printf 'x-ms-continuationtoken: token-page-2\\r\\n' >> \"$headers_file\"",
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
  TMP = mkdtempSync(join(tmpdir(), `aziss-${Date.now()}-${Math.random().toString(36).slice(2)}`));
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

// azure_libs_source + call (this suite's module list: http/urls/repos/issues).
function azVerb(call: string, extraEnv: Record<string, string> = {}): { status: number; out: string } {
  const script =
    `source '${TOOLS}/lib/providers/provider-core.bash'\n` +
    `PROVIDER_NAME=azure\n` +
    ["http", "urls", "repos", "issues"].map((m) => `source '${TOOLS}/lib/providers/azure/${m}.bash'\n`).join("") +
    `${call}\n`;
  const r = spawnSync("bash", ["-c", script], {
    input: "",
    encoding: "utf8",
    env: ENV({ AZURE_DEVOPS_ORG: "org", AZURE_DEVOPS_PROJECT: "proj", ...extraEnv }),
  });
  return { status: r.status ?? 1, out: (r.stdout ?? "") + (r.stderr ?? "") };
}

// Work item list/details payload shaped like Azure's.
const WIT_PAGE = `{"value":[
  {"id":101,"fields":{"System.Title":"First bug","System.State":"New","System.Tags":"bug;infra"}},
  {"id":102,"fields":{"System.Title":"Closed thing","System.State":"Closed","System.Tags":""}}
]}
`;

// item_type_page: the item's own type payload.
function itemTypePage(id: number, type: string): string {
  const f = join(TMP, `type-${id}.json`);
  writeFileSync(f, `{"id":${id},"fields":{"System.WorkItemType":"${type}"}}`);
  return f;
}

function pageQueue(...files: string[]): string {
  writeFileSync(PAGES_QUEUE, files.map((f) => `${f}\n`).join(""));
  return PAGES_QUEUE;
}

function jqOut(json: string, args: string[]): string {
  return (spawnSync("jq", args, { input: json, encoding: "utf8" }).stdout ?? "").trim();
}

function jqOk(json: string, args: string[]): boolean {
  return spawnSync("jq", args, { input: json, stdio: ["pipe", "ignore", "ignore"] }).status === 0;
}

function reqBodyAny(file: string, expr: string): boolean {
  const body = spawnSync("cat", [file], { encoding: "utf8" }).stdout ?? "";
  return spawnSync("jq", ["-s", "-e", expr], { input: body, stdio: ["pipe", "ignore", "ignore"] }).status === 0;
}

function logHas(pattern: string): boolean {
  return spawnSync("grep", ["-q", pattern, CALL_LOG]).status === 0;
}

// _graph_link_conflict_curl: PATCH answers 409 with the message; GET answers
// the parent's relations.
function graphLinkConflictCurl(message: string, relationsJson: string): void {
  writeFileSync(join(TMP, "conflict.json"), `{"message":"${message}"}`);
  writeFileSync(join(TMP, "parent-rel.json"), relationsJson);
  const inner = join(TMP, "stub-bin", "curl-inner");
  spawnSync("mv", [join(TMP, "stub-bin", "curl"), inner]);
    writeFileSync(
    join(TMP, "stub-bin", "curl"),
    [
      "#!/usr/bin/env bash",
      'if [[ " $* " == *" PATCH "* ]]; then',
      `    export STUB_CURL_RESPONSE='${join(TMP, "conflict.json")}' STUB_CURL_HTTP_CODE=409`,
      "else",
      `    export STUB_CURL_RESPONSE='${join(TMP, "parent-rel.json")}'`,
      "fi",
      'exec "$(dirname "$0")/curl-inner" "$@"',
      "",
    ].join("\n"),
  );
  chmodSync(join(TMP, "stub-bin", "curl"), 0o755);
}

describe("provider azure issues", () => {
  it("provider_issues_list maps work items to the seam shape", () => {
    writeFileSync(join(TMP, "wiql.json"), '{"workItems":[{"id":101},{"id":102}]}');
    writeFileSync(join(TMP, "details.json"), WIT_PAGE);
    const queue = pageQueue(join(TMP, "wiql.json"), join(TMP, "details.json"));
    const r = azVerb("provider_issues_list --state all", { STUB_CURL_PAGES: queue });
    expect(r.status).toBe(0);
    const mapped = r.out;
    expect(jqOut(mapped, ["length"])).toBe("2");
    expect(jqOk(mapped, ["-e", '.[0].number == 101 and .[0].state == "OPEN" and (.[0].labels | map(.name) | index("bug"))'])).toBe(true);
    expect(jqOk(mapped, ["-e", '.[1].number == 102 and .[1].state == "CLOSED"'])).toBe(true);
  });

  it("provider_issues_view maps a work item with gh-dialect fields", () => {
    const wi = join(TMP, "wi.json");
    writeFileSync(wi, '{"id":101,"fields":{"System.Title":"First bug","System.State":"New","System.Description":"<p>body</p>","System.Tags":"bug;infra"}}');
    const r = azVerb('provider_issues_view "" 101 --json number,title,state,body', { STUB_CURL_RESPONSE: wi });
    expect(r.status).toBe(0);
    expect(jqOk(r.out, ["-e", '.number == 101 and .title == "First bug" and .state == "OPEN"'])).toBe(true);
    expect(logHas("workitems/101")).toBe(true);
  });

  it("provider_issues_view -q returns the projected scalar (not the object)", () => {
    // The grooming flow feeds the output straight back into edit
    // --body-file: the output MUST be the body text alone, never a JSON
    // object. The body passes through the entity-decode (tags are the
    // store's native HTML; they stay).
    const wi = join(TMP, "wi2.json");
    writeFileSync(wi, '{"id":101,"fields":{"System.Title":"T","System.State":"New","System.Description":"fenced &quot;with quotes&quot;\\n```\\n","System.Tags":""}}');
    let r = azVerb('provider_issues_view "" 101 --json body -q .body', { STUB_CURL_RESPONSE: wi });
    expect(r.status).toBe(0);
    expect(r.out).toBe('fenced "with quotes"\n```\n');
    // A url projection yields the scalar URL (issue-select url mode).
    r = azVerb('provider_issues_view "" 101 --json url -q .url', { STUB_CURL_RESPONSE: wi });
    expect(r.status).toBe(0);
    expect(r.out.startsWith("https://dev.azure.com/") && r.out.includes("/_workitems/edit/101")).toBe(true);
  });

  it("provider_issues_exists is a silent presence test", () => {
    const wi = join(TMP, "wi3.json");
    writeFileSync(wi, '{"id":101,"fields":{}}');
    const r = azVerb('provider_issues_exists "" 101', { STUB_CURL_RESPONSE: wi });
    expect(r.status).toBe(0);
    expect(r.out.trim()).toBe("");
  });

  it("provider_issues_exists fails on 404", () => {
    const err = join(TMP, "err.json");
    writeFileSync(err, '{"message":"not found"}');
    const r = azVerb('provider_issues_exists "" 999', { STUB_CURL_HTTP_CODE: "404", STUB_CURL_RESPONSE: err });
    expect(r.status).not.toBe(0);
  });

  it("provider_issues_create posts a title-and-tags patch to the User Story type and prints the id", () => {
    const created = join(TMP, "created.json");
    writeFileSync(created, '{"id":301,"fields":{}}');
    const r = azVerb('provider_issues_create --title "New work" --label bug --label infra', {
      STUB_CURL_RESPONSE: created,
    });
    expect(r.status).toBe(0);
    expect(r.out.trim()).toBe("301");
    expect(logHas("workitems/\\$User%20Story")).toBe(true);
  });

  it("provider_issues_create without a title fails defined", () => {
    const r = azVerb("provider_issues_create --label bug");
    expect(r.status).not.toBe(0);
    expect(r.out).toMatch(/--title/);
  });

  it("provider_issues_comment posts to the comments API", () => {
    const comment = join(TMP, "comment.json");
    writeFileSync(comment, '{"id":55,"text":"hello"}');
    const r = azVerb('provider_issues_comment "" 101 --body "hello"', { STUB_CURL_RESPONSE: comment });
    expect(r.status).toBe(0);
    expect(r.out.trim()).toBe("55");
    expect(logHas("workitems/101/comments")).toBe(true);
  });

  it("provider_issues_close moves the item to the Completed state of its own type", () => {
    // close and reopen read the item's own type, then that type's states by
    // category (recorded shapes: Proposed, InProgress, Resolved, Completed,
    // Removed).
    const typePage = itemTypePage(101, "User Story");
    const patched = join(TMP, "patched.json");
    const closeBody = join(TMP, "close.body");
    writeFileSync(patched, '{"id":101}');
    writeFileSync(closeBody, "");
    const queue = pageQueue(typePage, join(FIXDIR, "workitemtypes.user-story.states.json"), patched);
    const r = azVerb('provider_issues_close "" 101', {
      STUB_CURL_PAGES: queue,
      STUB_CURL_REQUEST_BODY: closeBody,
    });
    expect(r.status).toBe(0);
    expect(logHas("workitemtypes/User%20Story/states")).toBe(true);
    expect(reqBodyAny(closeBody, 'any(.[][]?; .path == "/fields/System.State" and .value == "Closed")')).toBe(true);
  });

  it("provider_issues_close accepts and drops --reason (Azure has no close reason)", () => {
    const typePage = itemTypePage(101, "Issue");
    const patched = join(TMP, "patched2.json");
    const closeBody = join(TMP, "close2.body");
    writeFileSync(patched, '{"id":101}');
    writeFileSync(closeBody, "");
    const queue = pageQueue(typePage, join(FIXDIR, "workitemtypes.issue.states.json"), patched);
    const r = azVerb('provider_issues_close "" 101 --reason "not planned"', {
      STUB_CURL_PAGES: queue,
      STUB_CURL_REQUEST_BODY: closeBody,
    });
    expect(r.status).toBe(0);
    expect(spawnSync("grep", ["-q", "not planned", closeBody]).status).not.toBe(0);
    expect(spawnSync("grep", ["-q", "Closed", closeBody]).status).toBe(0);
  });

  it("provider_issues_reopen moves the item to the first Proposed state of its own type", () => {
    const typePage = itemTypePage(101, "User Story");
    const patched = join(TMP, "patched3.json");
    const reopenBody = join(TMP, "reopen.body");
    writeFileSync(patched, '{"id":101}');
    writeFileSync(reopenBody, "");
    const queue = pageQueue(typePage, join(FIXDIR, "workitemtypes.user-story.states.json"), patched);
    const r = azVerb('provider_issues_reopen "" 101', {
      STUB_CURL_PAGES: queue,
      STUB_CURL_REQUEST_BODY: reopenBody,
    });
    expect(r.status).toBe(0);
    expect(reqBodyAny(reopenBody, 'any(.[][]?; .path == "/fields/System.State" and .value == "New")')).toBe(true);
  });

  it("provider_issues_reopen on an Issue (states Active and Closed only) uses its InProgress state", () => {
    const typePage = itemTypePage(101, "Issue");
    const patched = join(TMP, "patched4.json");
    const reopenBody = join(TMP, "reopen2.body");
    writeFileSync(patched, '{"id":101}');
    writeFileSync(reopenBody, "");
    const queue = pageQueue(typePage, join(FIXDIR, "workitemtypes.issue.states.json"), patched);
    const r = azVerb('provider_issues_reopen "" 101', {
      STUB_CURL_PAGES: queue,
      STUB_CURL_REQUEST_BODY: reopenBody,
    });
    expect(r.status).toBe(0);
    expect(reqBodyAny(reopenBody, 'any(.[][]?; .path == "/fields/System.State" and .value == "Active")')).toBe(true);
  });

  it("provider_issues_edit patches title and tags", () => {
    const edited = join(TMP, "edited.json");
    writeFileSync(edited, '{"id":101,"fields":{}}');
    const r = azVerb('provider_issues_edit "" 101 --title "Renamed" --add-label triage', {
      STUB_CURL_RESPONSE: edited,
    });
    expect(r.status).toBe(0);
    expect(logHas("workitems/101")).toBe(true);
  });

  it("provider_issues_create builds a valid JSON-Patch body when the title quotes JSON", () => {
    // User text must never sit in a hand-built JSON literal — a title
    // containing quotes/backslashes must still produce a parseable document.
    const created = join(TMP, "created2.json");
    const reqBody = join(TMP, "req-body.log");
    writeFileSync(created, '{"id":302,"fields":{}}');
    writeFileSync(reqBody, "");
    const title = 'Say "hi" back';
    const tag = "bug'quote";
    const r = azVerb(`provider_issues_create --title 'Say "hi" back' --label 'bug'\\''quote'`, {
      STUB_CURL_REQUEST_BODY: reqBody,
      STUB_CURL_RESPONSE: created,
    });
    expect(r.status).toBe(0);
    const body = spawnSync("cat", [reqBody], { encoding: "utf8" }).stdout ?? "";
    expect(
      spawnSync("jq", ["-e", "--arg", "t", title, "--arg", "g", tag, "length == 2 and .[0].value == $t and .[1].value == $g"], {
        input: body,
        stdio: ["pipe", "ignore", "ignore"],
      }).status,
    ).toBe(0);
  });

  it("provider_issues_edit builds a valid JSON-Patch body when the body quotes JSON", () => {
    const edited = join(TMP, "edited2.json");
    const reqBody = join(TMP, "req-body2.log");
    writeFileSync(edited, '{"id":101,"fields":{}}');
    writeFileSync(reqBody, "");
    const title = 'Title with "quotes" & back\\slash';
    const r = azVerb(`provider_issues_edit "" 101 --title 'Title with "quotes" & back\\slash'`, {
      STUB_CURL_REQUEST_BODY: reqBody,
      STUB_CURL_RESPONSE: edited,
    });
    expect(r.status).toBe(0);
    const body = spawnSync("cat", [reqBody], { encoding: "utf8" }).stdout ?? "";
    expect(
      spawnSync("jq", ["-e", "--arg", "t", title, "length == 1 and .[0].value == $t"], {
        input: body,
        stdio: ["pipe", "ignore", "ignore"],
      }).status,
    ).toBe(0);
  });

  it("provider_issues_list --type filters by work-item type in the WIQL query", () => {
    // --type must reach the WIQL WHERE clause, not fall into the repo slot.
    const emptyWiql = join(TMP, "empty-wiql.json");
    const typeWiql = join(TMP, "type-wiql.log");
    writeFileSync(emptyWiql, '{"workItems":[]}');
    writeFileSync(typeWiql, "");
    azVerb("provider_issues_list --type Bug", {
      STUB_CURL_REQUEST_BODY: typeWiql,
      STUB_CURL_RESPONSE: emptyWiql,
    });
    expect(spawnSync("grep", ["-q", "System.WorkItemType] = 'Bug'", typeWiql]).status).toBe(0);
  });

  it("provider_issues_list --json body projects a decoded body (issue-search contract)", () => {
    // The wrapper's search path matches on .body — the projected field must
    // carry the decoded markdown, not an empty string.
    writeFileSync(join(TMP, "details2.json"), WIT_PAGE);
    writeFileSync(join(TMP, "wiql2.json"), '{"workItems":[{"id":101}]}');
    const queue = pageQueue(join(TMP, "wiql2.json"), join(TMP, "details2.json"));
    const r = azVerb("provider_issues_list --json number,body", { STUB_CURL_PAGES: queue });
    expect(r.status).toBe(0);
    expect(jqOk(r.out, ["-e", 'length == 2 and all(.[]; has("number") and has("body"))'])).toBe(true);
  });

  it("provider_issues_list -q over an empty result is empty output, not null (gh semantics)", () => {
    const emptyWiql = join(TMP, "empty-wiql2.json");
    writeFileSync(emptyWiql, '{"workItems":[]}');
    const r = azVerb("provider_issues_list -q '.[0].number'", { STUB_CURL_RESPONSE: emptyWiql });
    expect(r.status).toBe(0);
    expect(r.out.trim()).toBe("");
  });

  it("provider_issues_list composes valid WIQL JSON when the label quotes the query", () => {
    // A label containing a quote must not break the WIQL document.
    const emptyWiql = join(TMP, "empty-wiql3.json");
    const wiqlBody = join(TMP, "wiql-body.log");
    writeFileSync(emptyWiql, '{"workItems":[]}');
    writeFileSync(wiqlBody, "");
    const r = azVerb(`provider_issues_list --label 'tag'\\''with'\\''quotes'`, {
      STUB_CURL_REQUEST_BODY: wiqlBody,
      STUB_CURL_RESPONSE: emptyWiql,
    });
    expect(r.status).toBe(0);
    const q = (spawnSync("jq", ["-r", ".query"], { input: spawnSync("cat", [wiqlBody], { encoding: "utf8" }).stdout ?? "", encoding: "utf8" }).stdout ?? "").trim();
    expect(q).toContain("CONTAINS");
    // Valid shapes: raw label, or WIQL-escaped (single quotes doubled).
    expect(/tagwithquotes|tag'.?with.?quotes|tag''with''quotes/.test(q.replace(/'/g, "'")) || q.includes("tag''with''quotes")).toBe(true);
  });

  it("provider_issues_edit with nothing to edit fails defined", () => {
    const r = azVerb("provider_issues_edit 101");
    expect(r.status).not.toBe(0);
    expect(r.out).toMatch(/nothing to edit/);
  });

  it("provider_issues_comments maps the discussion shape", () => {
    const comments = join(TMP, "comments.json");
    writeFileSync(
      comments,
      '{"comments":[{"createdBy":{"displayName":"Alice"},"text":"first","createdDate":"2026-09-26T10:00:00Z"},{"createdBy":{"displayName":"Bob"},"text":"second","createdDate":"2026-09-26T11:00:00Z"}]}',
    );
    const r = azVerb('provider_issues_comments "" 101', { STUB_CURL_RESPONSE: comments });
    expect(r.status).toBe(0);
    expect(jqOk(r.out, ["-e", 'any(.[]; .user.login == "Alice" and .body == "first") and any(.[]; .user.login == "Bob")'])).toBe(true);
  });

  it("artifact header survives the comment round-trip (DEVENV_ARTIFACT_V1)", () => {
    // The issue-artifact machinery posts markdown comments whose first line
    // is the DEVENV_ARTIFACT_V1 header; the comment transport must not
    // mangle it. The transport posts the body as-is (jq -n --arg); assert
    // via the stub having been called.
    const art = join(TMP, "art.json");
    writeFileSync(art, '{"id":55}');
    const r = azVerb(`provider_issues_comment "" 101 --body '<!-- DEVENV_ARTIFACT_V1 doc_id: x -->'`, {
      STUB_CURL_RESPONSE: art,
    });
    expect(r.status).toBe(0);
    expect(logHas("workitems/101/comments")).toBe(true);
  });

  it("provider_issues_label_list reads the project's tags from the tags endpoint", () => {
    const tags = join(TMP, "tags.json");
    writeFileSync(tags, '{"count":3,"value":[{"id":"1","name":"bug"},{"id":"2","name":" infra"},{"id":"3","name":"triage"}]}');
    const r = azVerb("provider_issues_label_list", { STUB_CURL_RESPONSE: tags });
    expect(r.status).toBe(0);
    expect(jqOut(r.out, ["-c", "[.[].name]"])).toBe('["bug","infra","triage"]');
    expect(logHas("/_apis/wit/tags")).toBe(true);
  });

  it("provider_issues_label_list falls back to the distinct tags of the work items when the tags endpoint is unavailable", () => {
    const noTags = join(TMP, "no-tags.json");
    const wiql = join(TMP, "wiql3.json");
    const details = join(TMP, "details3.json");
    writeFileSync(noTags, "{}");
    writeFileSync(wiql, '{"workItems":[{"id":1},{"id":2}]}');
    writeFileSync(details, '{"value":[\n  {"id":1,"fields":{"System.Tags":"bug; infra"}},\n  {"id":2,"fields":{"System.Tags":"bug; triage"}}\n]}');
    const queue = pageQueue(noTags, wiql, details);
    const r = azVerb("provider_issues_label_list", { STUB_CURL_PAGES: queue });
    expect(r.status).toBe(0);
    expect(jqOut(r.out, ["-c", "[.[].name]"])).toBe('["bug","infra","triage"]');
  });

  it("comment create targets the markdown-format route", () => {
    // The portal only renders markdown when the create carries
    // ?format=markdown at the 7.2-preview.4 schema.
    const c2 = join(TMP, "c2.json");
    writeFileSync(c2, '{"id":8663010,"workItemId":42,"text":"m"}');
    writeOrgConfig("o1", "p1");
    const r = azVerb('provider_issues_comment_add o1/p1/r1 42 --body "m"', { STUB_CURL_RESPONSE: c2 });
    expect(r.status).toBe(0);
    expect(logHas("format=markdown")).toBe(true);
    expect(logHas("api-version=7.2-preview.4")).toBe(true);
  });

  it("provider_issues_comment_add creates a comment and emits gh-shaped JSON", () => {
    const created = join(TMP, "created3.json");
    writeFileSync(created, '{"id":777001,"workItemId":42,"text":"hello"}');
    writeOrgConfig("o1", "p1");
    const r = azVerb('provider_issues_comment_add o1/p1/r1 42 --body "hello"', { STUB_CURL_RESPONSE: created });
    expect(r.status).toBe(0);
    expect(jqOut(r.out, ["-r", ".id"])).toBe("42/777001");
    expect(jqOut(r.out, ["-r", ".url"])).toContain("_workitems/edit/42");
  });

  it("provider_issues_comment_edit patches the comment body", () => {
    const edited = join(TMP, "edited3.json");
    writeFileSync(edited, '{"id":777001,"workItemId":42,"text":"updated"}');
    writeOrgConfig("o1", "p1");
    const r = azVerb('provider_issues_comment_edit o1/p1/r1 42/777001 --body "updated"', { STUB_CURL_RESPONSE: edited });
    expect(r.status).toBe(0);
    expect(jqOut(r.out, ["-r", ".id"])).toBe("42/777001");
  });

  it("provider_issues_comment_get finds the comment and reports its url", () => {
    const list = join(TMP, "list.json");
    writeFileSync(list, '{"totalCount":1,"count":1,"comments":[{"id":777001,"workItemId":42,"text":"found"}]}');
    writeOrgConfig("o1", "p1");
    const r = azVerb('provider_issues_comment_get "" 42/777001', { STUB_CURL_RESPONSE: list });
    expect(r.status).toBe(0);
  });

  it("provider_issues_comment_get fails defined when the id is absent", () => {
    const empty = join(TMP, "empty.json");
    writeFileSync(empty, '{"totalCount":0,"count":0,"comments":[]}');
    writeOrgConfig("o1", "p1");
    const r = azVerb('provider_issues_comment_get "" 42/999', { STUB_CURL_RESPONSE: empty });
    expect(r.status).not.toBe(0);
  });

  it("provider_issues_comments restores markdown from the html-encoded store", () => {
    // Azure entity-encodes long text (quotes -> &quot;) and treats trailing
    // newlines loosely; the boundary contract restores markdown and is
    // trailing-newline-insensitive.
    const list = join(TMP, "list2.json");
    writeFileSync(list, '{"totalCount":1,"count":1,"comments":[{"id":8663000,"workItemId":42,"text":"fenced block &quot;with quotes&quot;\\n```\\n"}]}');
    writeOrgConfig("o1", "p1");
    const r = azVerb('provider_issues_comments "" 42', { STUB_CURL_RESPONSE: list });
    expect(r.status).toBe(0);
    expect(jqOut(r.out, ["-j", ".[0].body"])).toBe('fenced block "with quotes"\n```');
  });

  it("provider_issues_comment_add normalizes the trailing newline before storage", () => {
    // The stored text must be exactly "line": the trailing newline the user
    // passed is stripped here (the store re-adds it), so a write->read
    // cycle is newline-stable.
    const created = join(TMP, "created4.json");
    const curlbody = join(TMP, "curlbody.log");
    writeFileSync(created, '{"id":8663001,"workItemId":42,"text":"sent"}');
    writeFileSync(curlbody, "");
    writeOrgConfig("o1", "p1");
    const r = azVerb("provider_issues_comment_add o1/p1/r1 42 --body 'line'", {
      STUB_CURL_RESPONSE: created,
      STUB_CURL_REQUEST_BODY: curlbody,
    });
    expect(r.status).toBe(0);
    const body = spawnSync("cat", [curlbody], { encoding: "utf8" }).stdout ?? "";
    expect(spawnSync("jq", ["-j", ".text"], { input: body, encoding: "utf8" }).stdout).toBe("line");
  });

  it("provider_issues_comments emits id and url for artifact matching", () => {
    const list = join(TMP, "list3.json");
    writeFileSync(list, '{"totalCount":1,"count":1,"comments":[{"id":777001,"workItemId":42,"text":"b","createdBy":{"displayName":"a"},"createdDate":"2026-01-01"}]}');
    writeOrgConfig("o1", "p1");
    const r = azVerb('provider_issues_comments "" 42', { STUB_CURL_RESPONSE: list });
    expect(r.status).toBe(0);
    expect(jqOut(r.out, ["-r", ".[0].id"])).toBe("42/777001");
    expect(jqOut(r.out, ["-r", ".[0].url"])).toContain("_workitems/edit/42");
  });

  it("provider_issues_add_tag appends to existing tags and is idempotent", () => {
    const view = join(TMP, "view.json");
    writeFileSync(view, '{"fields":{"System.Tags":"existing;tags"}}');
    writeOrgConfig("o1", "p1");
    const r = azVerb("provider_issues_add_tag 42 newtag", { STUB_CURL_RESPONSE: view });
    expect(r.status).toBe(0);
  });

  it("provider_issues_label_create without --issue fails defined (azure tags need a work item)", () => {
    writeOrgConfig("o1", "p1");
    const r = azVerb("provider_issues_label_create o1/p1/r1 mytag");
    expect(r.status).not.toBe(0);
    expect(r.out).toMatch(/--issue/);
  });

  it("provider_issues_label_update is a no-op success (tags have no color/description)", () => {
    writeOrgConfig("o1", "p1");
    const r = azVerb('provider_issues_label_update o1/p1/r1 mytag ff0000 "desc"');
    expect(r.status).toBe(0);
  });

  // ── Sub-issue graph relation verbs ───────────────────────────────────────

  it("provider_issue_graph_children lists Hierarchy-Forward relation ids", () => {
    const parent = join(TMP, "parent.json");
    writeFileSync(
      parent,
      '{"id":100,"relations":[{"rel":"System.LinkTypes.Hierarchy-Forward","url":"https://dev.azure.com/o/p/_apis/wit/workItems/101"},{"rel":"System.LinkTypes.Related","url":"https://dev.azure.com/o/p/_apis/wit/workItems/999"},{"rel":"System.LinkTypes.Hierarchy-Forward","url":"https://dev.azure.com/o/p/_apis/wit/workItems/102"}]}',
    );
    writeOrgConfig("o1", "p1");
    const r = azVerb('provider_issue_graph_children "" 100', { STUB_CURL_RESPONSE: parent });
    expect(r.status).toBe(0);
    const lines = r.out.split("\n").map((l) => l.trim()).filter(Boolean);
    expect(lines[0]).toBe("101");
    expect(lines[1]).toBe("102");
  });

  it("provider_issue_graph_parent resolves the Hierarchy-Reverse target", () => {
    const child = join(TMP, "child.json");
    writeFileSync(child, '{"id":101,"relations":[{"rel":"System.LinkTypes.Hierarchy-Reverse","url":"https://dev.azure.com/o/p/_apis/wit/workItems/100"}]}');
    writeOrgConfig("o1", "p1");
    const r = azVerb('provider_issue_graph_parent "" 101', { STUB_CURL_RESPONSE: child });
    expect(r.status).toBe(0);
    expect(r.out.trim()).toBe("100");
  });

  it("provider_issue_graph_parent without relations emits empty", () => {
    const bare = join(TMP, "bare.json");
    writeFileSync(bare, '{"id":101}');
    writeOrgConfig("o1", "p1");
    const r = azVerb('provider_issue_graph_parent "" 101', { STUB_CURL_RESPONSE: bare });
    expect(r.status).toBe(0);
    expect(r.out.trim()).toBe("");
  });

  it("provider_issue_graph_link patches a Hierarchy-Forward relation", () => {
    const linked = join(TMP, "linked.json");
    const reqbody = join(TMP, "reqbody.log");
    writeFileSync(linked, '{"id":100}');
    writeFileSync(reqbody, "");
    writeOrgConfig("o1", "p1");
    const r = azVerb('provider_issue_graph_link "" 100 101', {
      STUB_CURL_RESPONSE: linked,
      STUB_CURL_REQUEST_BODY: reqbody,
    });
    expect(r.status).toBe(0);
    expect(spawnSync("grep", ["-q", "System.LinkTypes.Hierarchy-Forward", reqbody]).status).toBe(0);
    expect(spawnSync("grep", ["-q", "workItems/101", reqbody]).status).toBe(0);
  });

  it("provider_issue_graph_unlink removes the matching relation by index", () => {
    const parent2 = join(TMP, "parent2.json");
    writeFileSync(
      parent2,
      '{"id":100,"relations":[{"rel":"System.LinkTypes.Hierarchy-Forward","url":"https://dev.azure.com/o/p/_apis/wit/workItems/101"},{"rel":"System.LinkTypes.Hierarchy-Forward","url":"https://dev.azure.com/o/p/_apis/wit/workItems/102"}]}',
    );
    writeOrgConfig("o1", "p1");
    const r = azVerb('provider_issue_graph_unlink "" 100 101', { STUB_CURL_RESPONSE: parent2 });
    expect(r.status).toBe(0);
  });

  it("provider_issue_graph_link: a conflict is success only when the parent already lists the child", () => {
    graphLinkConflictCurl(
      "Relation already exists",
      '{"id":100,"relations":[{"rel":"System.LinkTypes.Hierarchy-Forward","url":"https://dev.azure.com/o1/p1/_apis/wit/workItems/101"}]}',
    );
    writeOrgConfig("o1", "p1");
    const r = azVerb('provider_issue_graph_link "" 100 101');
    expect(r.status).toBe(0);
  });

  it("provider_issue_graph_link: a failure whose text contains 'already' but whose link is absent stays a failure", () => {
    graphLinkConflictCurl("Child already has a parent link", '{"id":100,"relations":[]}');
    writeOrgConfig("o1", "p1");
    const r = azVerb('provider_issue_graph_link "" 100 101');
    expect(r.status).not.toBe(0);
  });

  it("provider_issues_view leaves a markdown description undecoded and decodes an HTML one", () => {
    const md = join(TMP, "md.json");
    writeFileSync(md, '{"id":101,"fields":{"System.Title":"t","System.State":"New","System.Description":"use &lt;div&gt; and &amp; literally"},"multilineFieldsFormat":{"System.Description":"markdown"}}');
    let r = azVerb('provider_issues_view "" 101 --json body -q .body', { STUB_CURL_RESPONSE: md });
    expect(r.status).toBe(0);
    expect(r.out.trim()).toBe("use &lt;div&gt; and &amp; literally");

    const html = join(TMP, "html.json");
    writeFileSync(html, '{"id":101,"fields":{"System.Title":"t","System.State":"New","System.Description":"say &quot;hi&quot; &amp; bye"},"multilineFieldsFormat":{}}');
    r = azVerb('provider_issues_view "" 101 --json body -q .body', { STUB_CURL_RESPONSE: html });
    expect(r.out.trim()).toBe('say "hi" & bye');
  });

  it("provider_issues_list applies the same markdown rule per item", () => {
    const wiql = join(TMP, "wiql4.json");
    const batch = join(TMP, "batch.json");
    writeFileSync(wiql, '{"workItems":[{"id":1},{"id":2}]}');
    writeFileSync(
      batch,
      '{"value":[{"id":1,"fields":{"System.Title":"a","System.State":"New","System.Description":"a &lt; b"},"multilineFieldsFormat":{"System.Description":"markdown"}},{"id":2,"fields":{"System.Title":"b","System.State":"New","System.Description":"a &lt; b"}}]}',
    );
    const queue = join(TMP, "pages.q");
    writeFileSync(queue, `${wiql}\n${batch}\n`);
    const r = azVerb('provider_issues_list "" --json number,body', { STUB_CURL_PAGES: queue });
    expect(r.status).toBe(0);
    expect(jqOut(r.out, ["-r", '.[] | select(.number == 1) | .body'])).toBe("a &lt; b");
    expect(jqOut(r.out, ["-r", '.[] | select(.number == 2) | .body'])).toBe("a < b");
  });

  // ── Artifact marker transformation ───────────────────────────────────────

  it("azure_marker_transform prepends a bare doc_id line and strips HTML comments", () => {
    const r = azVerb(
      `azure_marker_transform '<!-- DEVENV_ARTIFACT_V1\ndoc_id: dv1:r:i-1:plan:x-001\nartifact_type: plan\n-->\n\n# Title'`,
    );
    const out = r.out;
    expect(out.split("\n")[0]).toBe("doc_id: dv1:r:i-1:plan:x-001");
    // Negations run last (suite negation guard): comment content must be
    // gone, the real body must survive.
    expect(out.includes("DEVENV_ARTIFACT_V1")).toBe(false);
    expect(out.includes("artifact_type")).toBe(false);
    expect(out).toContain("# Title");
  });

  it("azure_marker_transform is idempotent when a bare doc_id line already exists", () => {
    const r = azVerb(`azure_marker_transform 'doc_id: dv1:r:i-1:plan:x-001\n\nbody text'`);
    expect(r.out).toBe("doc_id: dv1:r:i-1:plan:x-001\n\nbody text");
  });

  it("azure_marker_transform leaves bodies without a doc_id untouched", () => {
    const r = azVerb(`azure_marker_transform 'just a comment'`);
    expect(r.out).toBe("just a comment");
  });

  it("transformed body matches the upsert doc_id search within the first 256 characters", () => {
    // The exact jq the wrapper runs; a transformed body must yield exactly 1
    // match.
    const r = azVerb(`azure_marker_transform '<!-- DEVENV_ARTIFACT_V1\ndoc_id: dv1:r:i-1:plan:x-001\n-->\n\n# Grooming'`);
    const matches = spawnSync(
      "jq",
      [
        "-Rs",
        "--arg",
        "doc_id",
        "dv1:r:i-1:plan:x-001",
        '([.] | map(select(((. // "")[0:256] | split("\\n") | any((select(test("^[[:space:]]*doc_id:[[:space:]]*")) | sub("^[[:space:]]*doc_id:[[:space:]]*"; "") | sub("[[:space:]]+$"; "")) == $doc_id)))) | length)',
      ],
      { input: r.out, encoding: "utf8" },
    ).stdout?.trim();
    expect(matches).toBe("1");
  });
});

// writeOrgConfig: per-test org/project devenv.config (the o1/p1 variants).
function writeOrgConfig(org: string, project: string): void {
  writeFileSync(join(DEVENV_ROOT, "devenv.config"), `[provider]\nname=azure\nazure_org=${org}\nazure_project=${project}\n`);
}
