// Port of tools/tests/lib/test_provider_azure_workitems.bats (27 tests) — one
// vitest `it` per source `@test`. Azure work items: the devenv-type to
// Azure-type map, the markdown description format, tag handling on edit,
// comment paging, type changes, and the board-column status (read back and
// written). Shapes are the recorded ones where a recording exists
// (tools/tests/fixtures/azure/); the rest follow the documented API shape.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { spawnSync } from "node:child_process";
import { appendFileSync, chmodSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
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
let DEVENV_ROOT = "";
let PAGES_QUEUE = "";

// The cli-stubs curl fixture (same as the register port — see that file's
// header comment for the full mode inventory).
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
  TMP = mkdtempSync(join(tmpdir(), `azwi-${Date.now()}-${Math.random().toString(36).slice(2)}`));
  CALL_LOG = join(TMP, "stub-calls.log");
  REQ_BODIES = join(TMP, "request-bodies.log");
  DEVENV_ROOT = join(TMP, "devenv-root");
  PAGES_QUEUE = join(TMP, "pages.queue");
  const bin = join(TMP, "stub-bin");
  mkdirSync(bin, { recursive: true });
  mkdirSync(DEVENV_ROOT, { recursive: true });
  writeFileSync(CALL_LOG, "");
  writeFileSync(REQ_BODIES, "");
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

// azure_libs_source + call (this suite's lib list omits auth and prs).
function azVerb(call: string, extraEnv: Record<string, string> = {}): { status: number; out: string } {
  const script =
    `source '${TOOLS}/lib/providers/provider-core.bash'\n` +
    `PROVIDER_NAME=azure\n` +
    ["http", "urls", "repos", "issues", "projects"]
      .map((m) => `source '${TOOLS}/lib/providers/azure/${m}.bash'\n`)
      .join("") +
    `${call}\n`;
  const r = spawnSync("bash", ["-c", script], {
    input: "", // transport reads the credential header via -H @-
    encoding: "utf8",
    env: ENV({ AZURE_DEVOPS_ORG: "org", AZURE_DEVOPS_PROJECT: "proj", ...extraEnv }),
  });
  return { status: r.status ?? 1, out: (r.stdout ?? "") + (r.stderr ?? "") };
}

function pageQueue(...files: string[]): void {
  writeFileSync(PAGES_QUEUE, files.map((f) => `${f}\n`).join(""));
}

function reqBodyAny(expr: string): boolean {
  const body = spawnSync("cat", [REQ_BODIES], { encoding: "utf8" }).stdout ?? "";
  return spawnSync("jq", ["-s", "-e", expr], { input: body, stdio: ["pipe", "ignore", "ignore"] }).status === 0;
}

function logHas(pattern: string): boolean {
  return spawnSync("grep", ["-q", pattern, CALL_LOG]).status === 0;
}

// jq over the verb's stdout (the bats `<<< "$output"` pattern).
function jqOut(json: string, args: string[]): string {
  return (spawnSync("jq", args, { input: json, encoding: "utf8" }).stdout ?? "").trim();
}

// jq -s -e --arg over the request-body log (the source's variable-binding form).
function reqBodyAnyArg(expr: string, name: string, value: string): boolean {
  const body = spawnSync("cat", [REQ_BODIES], { encoding: "utf8" }).stdout ?? "";
  return spawnSync("jq", ["-s", "-e", "--arg", name, value, expr], { input: body, stdio: ["pipe", "ignore", "ignore"] }).status === 0;
}

const WF_WORDS = ["TBD", "To-Groom", "Ready", "Implementing", "Review", "Merged", "Staging", "Production"];

describe("provider azure workitems", () => {
  // ── The type map ─────────────────────────────────────────────────────────

  it("azure_work_item_type_for: Epic, Feature and Bug are native; Task and untyped are User Story", () => {
    for (const t of ["Epic:Epic", "Feature:Feature", "Bug:Bug", "Task:User Story", ":User Story", "bug:Bug"]) {
      const r = azVerb(`azure_work_item_type_for '${t.split(":")[0]}'`);
      expect(r.status).toBe(0);
      expect(r.out.trim(), `${t.split(":")[0]} -> ${r.out.trim()}`).toBe(t.split(":")[1]);
    }
  });

  it("azure_work_item_type_for: an [azure_issue_types] entry in devenv.config overrides the built-in map", () => {
    appendFileSync(join(DEVENV_ROOT, "devenv.config"), "[azure_issue_types]\ntask=Task\nspike=Feature\n");
    let r = azVerb("azure_work_item_type_for Task");
    expect(r.out.trim()).toBe("Task");
    r = azVerb("azure_work_item_type_for Spike");
    expect(r.status).toBe(0);
    expect(r.out.trim()).toBe("Feature");
  });

  it("azure_work_item_type_for: an unmapped type fails and says how to map it", () => {
    const r = azVerb("azure_work_item_type_for Story");
    expect(r.status).not.toBe(0);
    expect(r.out).toContain("[azure_issue_types]");
  });

  it("provider_issues_create --type Bug creates the item as a Bug", () => {
    const created = join(TMP, "created.json");
    writeFileSync(created, '{"id":301}');
    const r = azVerb('provider_issues_create --title "Broken" --type Bug', { STUB_CURL_RESPONSE: created });
    expect(r.status).toBe(0);
    expect(logHas("workitems/\\$Bug")).toBe(true);
  });

  it("provider_issues_create stores the description with the markdown multiline format", () => {
    const created = join(TMP, "created.json");
    writeFileSync(created, '{"id":301}');
    const r = azVerb('provider_issues_create --title "T" --body "# heading"', {
      STUB_CURL_RESPONSE: created,
      STUB_CURL_REQUEST_BODY: REQ_BODIES,
    });
    expect(r.status).toBe(0);
    expect(reqBodyAny('any(.[][]?; .path == "/multilineFieldsFormat/System.Description" and .value == "markdown")')).toBe(true);
  });

  it("provider_issues_list --type maps the devenv type onto the Azure type in the query", () => {
    const none = join(TMP, "none.json");
    writeFileSync(none, '{"workItems":[]}');
    const r = azVerb("provider_issues_list --type Task", {
      STUB_CURL_RESPONSE: none,
      STUB_CURL_REQUEST_BODY: REQ_BODIES,
    });
    expect(r.status).toBe(0);
    expect(reqBodyAny("any(.[]; (.query // \"\") | contains(\"[System.WorkItemType] = 'User Story'\"))")).toBe(true);
  });

  it("provider_issues_set_type leaves an item that already has the mapped type alone", () => {
    const story = join(TMP, "story.json");
    writeFileSync(story, '{"id":101,"fields":{"System.WorkItemType":"User Story"}}');
    const r = azVerb("provider_issues_set_type o r 101 Task", {
      STUB_CURL_RESPONSE: story,
      STUB_CURL_REQUEST_BODY: REQ_BODIES,
    });
    expect(r.status).toBe(0);
    expect(spawnSync("test", ["-s", REQ_BODIES]).status).not.toBe(0);
  });

  it("provider_issues_set_type changes the type to the mapped Azure type", () => {
    const story = join(TMP, "story.json");
    writeFileSync(story, '{"id":101,"fields":{"System.WorkItemType":"User Story"}}');
    const r = azVerb("provider_issues_set_type o r 101 Bug", {
      STUB_CURL_RESPONSE: story,
      STUB_CURL_REQUEST_BODY: REQ_BODIES,
    });
    expect(r.status).toBe(0);
    expect(reqBodyAny('any(.[][]?; .path == "/fields/System.WorkItemType" and .value == "Bug")')).toBe(true);
  });

  // ── Tags ─────────────────────────────────────────────────────────────────

  it("provider_issues_list trims the space Azure puts after each tag separator", () => {
    const wiql = join(TMP, "wiql.json");
    const details = join(TMP, "details.json");
    writeFileSync(wiql, '{"workItems":[{"id":101}]}');
    writeFileSync(details, '{"value":[{"id":101,"fields":{"System.Title":"t","System.State":"Active","System.Tags":"a; b;c"}}]}');
    pageQueue(wiql, details);
    const r = azVerb("provider_issues_list --state all", { STUB_CURL_PAGES: PAGES_QUEUE });
    expect(r.status).toBe(0);
    expect(jqOut(r.out, ["-c", "[.[0].labels[].name]"])).toBe('["a","b","c"]');
  });

  it("provider_issues_add_tag appends a new tag to the trimmed existing ones", () => {
    const r = azVerb("provider_issues_add_tag 101 extra", {
      STUB_CURL_RESPONSE: join(FIXTURES, "workitem.tags.two.json"),
      STUB_CURL_REQUEST_BODY: REQ_BODIES,
    });
    expect(r.status).toBe(0);
    expect(reqBodyAny('any(.[][]?; .path == "/fields/System.Tags" and .value == "smoke-tag; smoke-tag-2; extra")')).toBe(true);
  });

  it("provider_issues_edit --remove-label for a tag the item does not carry sends nothing", () => {
    const r = azVerb('provider_issues_edit "" 101 --remove-label never-there', {
      STUB_CURL_RESPONSE: join(FIXTURES, "workitem.tags.two.json"),
      STUB_CURL_REQUEST_BODY: REQ_BODIES,
    });
    expect(r.status).toBe(0);
    expect(spawnSync("test", ["-s", REQ_BODIES]).status).not.toBe(0);
  });

  it("provider_issues_edit removes the last tag by removing the field", () => {
    const one = join(TMP, "one.json");
    writeFileSync(one, '{"id":101,"fields":{"System.Tags":"only"}}');
    const r = azVerb('provider_issues_edit "" 101 --remove-label only', {
      STUB_CURL_RESPONSE: one,
      STUB_CURL_REQUEST_BODY: REQ_BODIES,
    });
    expect(r.status).toBe(0);
    expect(reqBodyAny('any(.[][]?; .op == "remove" and .path == "/fields/System.Tags")')).toBe(true);
  });

  it("provider_issues_edit applies --remove-label and --add-label together in one write", () => {
    const r = azVerb('provider_issues_edit "" 101 --remove-label smoke-tag --add-label fresh', {
      STUB_CURL_RESPONSE: join(FIXTURES, "workitem.tags.two.json"),
      STUB_CURL_REQUEST_BODY: REQ_BODIES,
    });
    expect(r.status).toBe(0);
    expect(reqBodyAny('any(.[][]?; .path == "/fields/System.Tags" and .value == "smoke-tag-2; fresh")')).toBe(true);
  });

  it("provider_issues_edit refuses an option Azure has no write path for, instead of dropping it", () => {
    const r = azVerb('provider_issues_edit "" 101 --milestone 7');
    expect(r.status).not.toBe(0);
    expect(r.out).toContain("--milestone");
    expect(r.out).toContain("not supported");
  });

  it("provider_issues_edit reads a body from stdin with --body-file -", () => {
    const ok = join(TMP, "ok.json");
    writeFileSync(ok, '{"id":101}');
    const script =
      `source '${TOOLS}/lib/providers/provider-core.bash'\n` +
      `PROVIDER_NAME=azure\n` +
      ["http", "urls", "repos", "issues", "projects"].map((m) => `source '${TOOLS}/lib/providers/azure/${m}.bash'\n`).join("") +
      `provider_issues_edit "" 101 --body-file -\n`;
    const r = spawnSync("bash", ["-c", script], {
      input: "body from stdin\n",
      encoding: "utf8",
      env: ENV({
        AZURE_DEVOPS_ORG: "org",
        AZURE_DEVOPS_PROJECT: "proj",
        STUB_CURL_RESPONSE: ok,
        STUB_CURL_REQUEST_BODY: REQ_BODIES,
      }),
    });
    expect(r.status ?? 1).toBe(0);
    expect(reqBodyAny('any(.[][]?; .path == "/fields/System.Description" and .value == "body from stdin")')).toBe(true);
    expect(reqBodyAny('any(.[][]?; .path == "/multilineFieldsFormat/System.Description")')).toBe(true);
  });

  // ── Comments page past one response ─────────────────────────────────────

  it("provider_issues_comments follows the continuation token to the last page", () => {
    const c1 = join(TMP, "c1.json");
    const c2 = join(TMP, "c2.json");
    writeFileSync(c1, '{"comments":[{"id":1,"workItemId":42,"text":"one","createdBy":{"displayName":"A"},"createdDate":"d"}],"continuationToken":"tok 1"}');
    writeFileSync(c2, '{"comments":[{"id":2,"workItemId":42,"text":"two","createdBy":{"displayName":"A"},"createdDate":"d"}]}');
    pageQueue(c1, c2);
    const r = azVerb('provider_issues_comments "" 42', { STUB_CURL_PAGES: PAGES_QUEUE });
    expect(r.status).toBe(0);
    expect(jqOut(r.out, ["-c", "[.[].id]"])).toBe('["42/1","42/2"]');
    expect(logHas("continuationToken=tok%201")).toBe(true);
  });

  it("provider_issues_comment_get finds a comment that is on a later page", () => {
    const c1 = join(TMP, "c1.json");
    const c2 = join(TMP, "c2.json");
    writeFileSync(c1, '{"comments":[{"id":1,"workItemId":42,"text":"one"}],"continuationToken":"t"}');
    writeFileSync(c2, '{"comments":[{"id":2,"workItemId":42,"text":"two"}]}');
    pageQueue(c1, c2);
    const r = azVerb('provider_issues_comment_get "" 42/2', { STUB_CURL_PAGES: PAGES_QUEUE });
    expect(r.status).toBe(0);
    expect(jqOut(r.out, ["-r", ".body"])).toBe("two");
  });

  // ── Status: the Kanban column ────────────────────────────────────────────

  it("provider_projects_for_issue reads every workflow word back as itself", () => {
    for (const word of WF_WORDS) {
      const r = azVerb('provider_projects_for_issue "https://dev.azure.com/org/proj/_workitems/edit/101" ""', {
        STUB_CURL_RESPONSE: join(FIXTURES, `kanban.column.${word}.json`),
      });
      expect(r.status).toBe(0);
      expect((r.out.trim().split("\t")[2] ?? "").trim(), `${word} read back as: ${r.out}`).toBe(word);
    }
  });

  it("provider_projects_for_issue names the board of the item's type", () => {
    const r = azVerb('provider_projects_for_issue "https://dev.azure.com/org/proj/_workitems/edit/101" ""', {
      STUB_CURL_RESPONSE: join(FIXTURES, "kanban.column.Review.json"),
    });
    expect((r.out.trim().split("\t")[0] ?? "").trim()).toBe("Stories");
  });

  it("provider_projects_for_issue reports the state of an item whose type has no board", () => {
    const issue = join(TMP, "issue.json");
    writeFileSync(issue, '{"id":5,"fields":{"System.State":"Active","System.WorkItemType":"Issue"}}');
    const r = azVerb('provider_projects_for_issue "https://dev.azure.com/org/proj/_workitems/edit/5" ""', {
      STUB_CURL_RESPONSE: issue,
    });
    expect((r.out.trim().split("\t")[2] ?? "").trim()).toBe("Active");
  });

  it("the wrapper path sets and reads back each workflow word: option_ids, field_set, for_issue", () => {
    for (const word of WF_WORDS) {
      writeFileSync(REQ_BODIES, "");
      let r = azVerb(`provider_projects_field_option_ids pid Status "${word}"`);
      expect(r.status).toBe(0);
      const option = (r.out.trim().split("\t")[1] ?? "").trim();
      r = azVerb(`provider_projects_field_set pid 101 Status "${option}"`, {
        STUB_CURL_RESPONSE: join(FIXTURES, `kanban.column.${word}.json`),
        STUB_CURL_REQUEST_BODY: REQ_BODIES,
      });
      expect(r.status).toBe(0);
      expect(
        reqBodyAnyArg('any(.[][]?; (.path | test("_Kanban\\\\.Column$")) and .value == $w)', "w", word),
        `field_set for ${word}: ${r.out.slice(0, 120)}`,
      ).toBe(true);
      r = azVerb('provider_projects_for_issue "https://dev.azure.com/org/proj/_workitems/edit/101" ""', {
        STUB_CURL_RESPONSE: join(FIXTURES, `kanban.column.${word}.json`),
      });
      expect((r.out.trim().split("\t")[2] ?? "").trim()).toBe(word);
    }
  });

  it("provider_projects_field_option_ids maps a fork-local word through [azure_status_aliases]", () => {
    appendFileSync(join(DEVENV_ROOT, "devenv.config"), "[azure_status_aliases]\nDoing=Implementing\n");
    const r = azVerb("provider_projects_field_option_ids pid Status Doing");
    expect(r.status).toBe(0);
    expect(r.out.trim()).toBe("Status\tImplementing");
  });

  it("azure_issue_patch_state builds valid JSON for a state name containing a quote", () => {
    const ok = join(TMP, "ok.json");
    writeFileSync(ok, '{"id":1}');
    const r = azVerb(`azure_issue_patch_state 1 'Won"t Fix'`, {
      STUB_CURL_RESPONSE: ok,
      STUB_CURL_REQUEST_BODY: REQ_BODIES,
    });
    expect(r.status).toBe(0);
    expect(reqBodyAny('any(.[][]?; .path == "/fields/System.State" and .value == "Won\\"t Fix")')).toBe(true);
  });

  // An item with no tags yet has no System.Tags field at all; the first tag
  // must still be written.
  it("provider_issues_add_tag writes the first tag of an item that has none", () => {
    const untagged = join(TMP, "untagged.json");
    writeFileSync(untagged, '{"id":1,"fields":{}}');
    const r = azVerb("provider_issues_add_tag 1 first", {
      STUB_CURL_RESPONSE: untagged,
      STUB_CURL_REQUEST_BODY: REQ_BODIES,
    });
    expect(r.status).toBe(0);
    expect(reqBodyAny('any(.[][]?; .path == "/fields/System.Tags" and .value == "first")')).toBe(true);
  });

  it("azure_tags_split of an empty or blank string is an empty array", () => {
    let r = azVerb(`azure_tags_split ""`);
    expect(r.out.trim()).toBe("[]");
    r = azVerb(`azure_tags_split " ; ;"`);
    expect(r.out.trim()).toBe("[]");
  });

  // ── An option the verb cannot honor is an error, not a silent difference ─

  it("provider_issues_list refuses --assignee: dropping the filter would list the wrong issues", () => {
    writeFileSync(CALL_LOG, "");
    const r = azVerb("provider_issues_list --assignee someone");
    expect(r.status).not.toBe(0);
    expect(r.out).toContain("--assignee");
    const count = parseInt((spawnSync("grep", ["-c", "^curl ", CALL_LOG], { encoding: "utf8" }).stdout ?? "0").trim(), 10) || 0;
    expect(count).toBe(0);
  });

  it("provider_issues_list refuses --milestone, --author and --mention too", () => {
    for (const flag of ["--milestone", "--author", "--mention"]) {
      const r = azVerb(`provider_issues_list ${flag} x`);
      expect(r.status, `accepted ${flag}`).not.toBe(0);
      expect(r.out).toContain(flag);
    }
  });
});
