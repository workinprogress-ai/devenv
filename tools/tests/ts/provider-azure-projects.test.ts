// Port of tools/tests/lib/test_provider_azure_projects.bats (13 tests):
// provider_projects_* — the Boards mapping. Research-verified shapes: team id
// is a ROUTE segment; WIT states at plain 7.1; System.State is the only write
// surface. The two/three-step resolution chain (projects GUID -> team ->
// boards) rides the stub's STUB_CURL_PAGES queue in order.
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
let DEVENV_ROOT = "";

// Minimal curl stub mirroring the fixture's response modes.
const CURL_STUB = [
  "#!/usr/bin/env bash",
  'prev=""; out_file=""; write_fmt=""; headers_file="/dev/null"',
  'for arg in "$@"; do',
  '  [[ "$prev" == "-D" ]] && headers_file="$arg"',
  '  [[ "$prev" == "-o" ]] && out_file="$arg"',
  '  [[ "$prev" == "-w" ]] && write_fmt="$arg"',
  '  prev="$arg"',
  "done",
  'for arg in "$@"; do [[ "$arg" == "@-" ]] && { cat > /dev/null; break; }; done',
  'prev=""; url=""',
  'for arg in "$@"; do',
  '  case "$arg" in',
  '    -*) prev="$arg"; continue ;;',
  "  esac",
  '  if [[ "$prev" != "-D" && "$prev" != "-o" && "$prev" != "-u" && "$prev" != "-X" && "$prev" != "-d" && "$prev" != "-H" && "$prev" != "-w" ]]; then url="$arg"; fi',
  '  prev="$arg"',
  "done",
  'echo "curl $url" >> "${STUB_CALL_LOG:?}"',
  '# Capture the request payload when the caller asks for it',
  'if [[ -n "${STUB_CURL_REQUEST_BODY:-}" ]]; then',
  '  prev=""',
  '  for arg in "$@"; do',
  '    [[ "$prev" == "-d" ]] && printf \'%s\\n\' "$arg" >> "$STUB_CURL_REQUEST_BODY"',
  '    prev="$arg"',
  "  done",
  "fi",
  'code="${STUB_CURL_HTTP_CODE:-200}"',
  'emit_body() { [[ -f "$1" ]] || { [[ -n "$out_file" ]] && : > "$out_file"; return 0; }; if [[ -n "$out_file" ]]; then cat "$1" > "$out_file"; else cat "$1"; fi; }',
  "emit_write_out() { [[ -n \"$write_fmt\" ]] || return 0; printf '%b' \"${write_fmt//%\\{http_code\\}/$code}\"; }",
  "{ printf 'HTTP/1.1 %s OK\\r\\n\\r\\n' \"$code\"; } > \"$headers_file\"",
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
  'emit_body "${STUB_CURL_RESPONSE:-/nonexistent}"',
  "emit_write_out",
  "exit 0",
  "",
].join("\n");

beforeEach(() => {
  TMP = mkdtempSync(join(tmpdir(), `azproj-${Date.now()}-${Math.random().toString(36).slice(2)}`));
  DEVENV_ROOT = join(TMP, "devenv-root");
  mkdirSync(DEVENV_ROOT, { recursive: true });
  const bin = join(TMP, "stub-bin");
  mkdirSync(bin, { recursive: true });
  writeFileSync(join(TMP, "stub-calls.log"), "");
  writeFileSync(join(bin, "curl"), CURL_STUB);
  chmodSync(join(bin, "curl"), 0o755);
  writeFileSync(
    join(DEVENV_ROOT, "devenv.config"),
    "[provider]\nname=azure\nazure_org=org\nazure_project=proj\n",
  );
});

const ENV = (extra: Record<string, string> = {}): Record<string, string> => ({
  ...process.env,
  TEST_TEMP_DIR: TMP,
  DEVENV_TOOLS: TOOLS,
  DEVENV_ROOT,
  AZURE_PAT: "test-pat",
  STUB_CALL_LOG: join(TMP, "stub-calls.log"),
  STUB_CURL_RESPONSE: join(TMP, "curl-response"),
  PATH: `${join(TMP, "stub-bin")}:${process.env.PATH ?? ""}`,
  ...extra,
});

// azure_run FN ARGS: the explicit subshell harness (sourcing inside run's
// function-call proved flaky for three-GET chains; the subshell is
// deterministic).
function azureRun(fn: string, args = ""): { status: number; out: string } {
  const mods = ["http", "auth", "urls", "repos", "issues", "projects"]
    .map((m) => `source '${TOOLS}/lib/providers/azure/${m}.bash'\n`)
    .join("");
  const r = spawnSync(
    "bash",
    [
      "-c",
      `source '${TOOLS}/lib/providers/provider-core.bash'\n${mods}${fn} ${args}`,
    ],
    { encoding: "utf8", env: ENV() },
  );
  return { status: r.status ?? 1, out: (r.stdout ?? "") + (r.stderr ?? "") };
}

// queue_responses FILES: order the stub's STUB_CURL_PAGES queue.
function queueResponses(...files: string[]): Record<string, string> {
  const queue = join(TMP, "pages.queue");
  writeFileSync(queue, files.map((f) => `${f}\n`).join(""));
  return { STUB_CURL_PAGES: queue };
}

function jq(json: string, expr: string, flags: string[] = ["-r"]): string {
  return (spawnSync("jq", [...flags, expr], { input: json, encoding: "utf8" }).stdout ?? "").trim();
}

describe("azure projects Boards mapping", () => {
  it("provider_projects_list lists boards with gh-shaped entries", () => {
    writeFileSync(join(TMP, "boards.json"), '{"value":[{"id":"b1","name":"Stories"},{"id":"b2","name":"Epics"}]}');
    writeFileSync(join(TMP, "projects.json"), '{"id":"guid-proj","name":"proj"}');
    writeFileSync(join(TMP, "teams.json"), '{"value":[{"id":"guid-team","name":"proj Team"}]}');
    const e = queueResponses(join(TMP, "projects.json"), join(TMP, "teams.json"), join(TMP, "boards.json"));
    const r = spawnSync("bash", ["-c", buildAzureSource() + "provider_projects_list"], { encoding: "utf8", env: ENV(e) });
    expect(r.status ?? 1).toBe(0);
    const first = (r.stdout ?? "").split("\n")[0] ?? "";
    expect(jq(first, ".name")).toBe("Stories");
  });

  it("provider_projects_id_by_name resolves a board by name", () => {
    writeFileSync(join(TMP, "boards.json"), '{"value":[{"id":"b1","name":"Stories"}]}');
    writeFileSync(join(TMP, "projects.json"), '{"id":"guid-proj","name":"proj"}');
    writeFileSync(join(TMP, "teams.json"), '{"value":[{"id":"guid-team","name":"proj Team"}]}');
    const e = queueResponses(join(TMP, "projects.json"), join(TMP, "teams.json"), join(TMP, "boards.json"));
    const r = spawnSync("bash", ["-c", buildAzureSource() + "provider_projects_id_by_name org Stories"], { encoding: "utf8", env: ENV(e) });
    expect(r.status ?? 1).toBe(0);
    expect((r.stdout ?? "").trim()).toBe("b1");
  });

  it("provider_projects_id_by_name fails defined for an unknown board", () => {
    writeFileSync(join(TMP, "boards.json"), '{"value":[{"id":"b1","name":"Stories"}]}');
    writeFileSync(join(TMP, "projects.json"), '{"id":"guid-proj","name":"proj"}');
    writeFileSync(join(TMP, "teams.json"), '{"value":[{"id":"guid-team","name":"proj Team"}]}');
    const e = queueResponses(join(TMP, "projects.json"), join(TMP, "teams.json"), join(TMP, "boards.json"));
    const r = spawnSync("bash", ["-c", buildAzureSource() + "provider_projects_id_by_name org NoSuch"], { encoding: "utf8", env: ENV(e) });
    expect(r.status ?? 1).not.toBe(0);
  });

  it("provider_projects_item_add is a no-op success (born on the board)", () => {
    const r = azureRun("provider_projects_item_add", '"" 42 "https://dev.azure.com/o/p/workitems/edit/42"');
    expect(r.status).toBe(0);
  });

  it("provider_projects_item_id_for_issue returns the work item id", () => {
    const r = azureRun("provider_projects_item_id_for_issue", "board-guid 100999 org repo");
    expect(r.status).toBe(0);
    expect(r.out.trim()).toBe("100999");
  });

  it("provider_projects_field_list emits the board columns as the Status options", () => {
    writeFileSync(join(TMP, "projects.json"), '{"name":"proj","id":"G1"}');
    writeFileSync(join(TMP, "teams.json"), '{"value":[{"id":"T1"}]}');
    writeFileSync(join(TMP, "boards.json"), '{"value":[{"id":"b1","name":"Stories"},{"id":"b2","name":"Features"}]}');
    const colStories = join(ROOT, "tools/tests/fixtures/azure/board.columns.Stories.json");
    const colFeatures = join(ROOT, "tools/tests/fixtures/azure/board.columns.Features.json");
    const e = queueResponses(
      join(TMP, "projects.json"),
      join(TMP, "teams.json"),
      join(TMP, "boards.json"),
      colStories,
      colFeatures,
    );
    const r = spawnSync("bash", ["-c", buildAzureSource() + "provider_projects_field_list \"\" 1"], { encoding: "utf8", env: ENV(e) });
    expect(r.status ?? 1).toBe(0);
    const options = (r.stdout ?? "")
      .split("\n")
      .filter(Boolean)
      .map((l) => jq(l, ".option"))
      .join(" ");
    expect(options).toBe("TBD To-Groom Ready Implementing Review Merged Staging Production");
  });

  it("provider_projects_field_option_ids passes a state word through", () => {
    writeFileSync(join(TMP, "states.json"), '{"value":[{"name":"New"},{"name":"Active"},{"name":"Closed"}]}');
    const e = { STUB_CURL_RESPONSE: join(TMP, "states.json") };
    const r = spawnSync("bash", ["-c", buildAzureSource() + "provider_projects_field_option_ids pid Status Active"], { encoding: "utf8", env: ENV(e) });
    expect(r.status ?? 1).toBe(0);
    expect((r.stdout ?? "").trim()).toBe("Status\tActive");
  });

  it("provider_projects_field_option_ids passes a column word through; the board validates it when it is written", () => {
    const r = azureRun("provider_projects_field_option_ids", "pid Status To-Groom");
    expect(r.status).toBe(0);
    expect(r.out.trim()).toBe("Status\tTo-Groom");
  });

  it("provider_projects_field_option_ids resolves config aliases", () => {
    writeFileSync(join(TMP, "states.json"), '{"value":[{"name":"New"},{"name":"Closed"}]}');
    writeFileSync(
      join(DEVENV_ROOT, "devenv.config"),
      "[provider]\nname=azure\nazure_org=org\nazure_project=proj\n\n[azure_status_aliases]\nTBD=New\n",
    );
    const e = { STUB_CURL_RESPONSE: join(TMP, "states.json") };
    const r = spawnSync("bash", ["-c", buildAzureSource() + "provider_projects_field_option_ids pid Status TBD"], { encoding: "utf8", env: ENV(e) });
    expect(r.status ?? 1).toBe(0);
    expect((r.stdout ?? "").trim()).toBe("Status\tNew");
  });

  it("provider_projects_field_set on an item with no board column patches System.State", () => {
    writeFileSync(join(TMP, "patched.json"), '{"id":42,"fields":{"System.State":"Active","System.WorkItemType":"Issue"}}');
    writeFileSync(join(TMP, "fsbody.log"), "");
    const e = {
      STUB_CURL_RESPONSE: join(TMP, "patched.json"),
      STUB_CURL_REQUEST_BODY: join(TMP, "fsbody.log"),
    };
    const r = spawnSync("bash", ["-c", buildAzureSource() + "provider_projects_field_set pid 42 Status Closed"], { encoding: "utf8", env: ENV(e) });
    expect(r.status ?? 1).toBe(0);
    expect(readFileSync(join(TMP, "fsbody.log"), "utf8")).toContain("System.State");
  });

  it("azure_status_alias exact-state pass-through matches a real tab", () => {
    // F-SMOKE-2 regression: the framed list must be matched with real tabs
    // (a literal \t in the pattern is read as the character 't'). In-process
    // call: the multi-line states arg must survive as ONE parameter.
    const mods = ["http", "auth", "urls", "repos", "issues", "projects"]
      .map((m) => `source '${TOOLS}/lib/providers/azure/${m}.bash'\n`)
      .join("");
    const r = spawnSync(
      "bash",
      [
        "-c",
        `source '${TOOLS}/lib/providers/provider-core.bash'\n${mods}` +
        `states=$(printf 'New\\nActive\\nClosed')\nazure_status_alias "$1" "$2"`,
        "_",
        "Active",
        "New\nActive\nClosed",
      ],
      { encoding: "utf8", env: ENV() },
    );
    expect(r.status ?? 1).toBe(0);
    expect((r.stdout ?? "").trim()).toBe("Active");
  });

  it("the default team lookup resolves the project by the configured value, a name or a GUID", () => {
    writeFileSync(
      join(DEVENV_ROOT, "devenv.config"),
      "[provider]\nname=azure\nazure_org=org\nazure_project=my proj\n",
    );
    writeFileSync(join(TMP, "project.json"), '{"id":"guid-proj","name":"my proj"}');
    writeFileSync(join(TMP, "teams.json"), '{"value":[{"id":"guid-team","name":"T"}]}');
    const e = queueResponses(join(TMP, "project.json"), join(TMP, "teams.json"));
    const r = spawnSync("bash", ["-c", buildAzureSource() + "azure_default_team_id"], { encoding: "utf8", env: ENV(e) });
    expect(r.status ?? 1).toBe(0);
    expect((r.stdout ?? "").trim()).toBe("guid-team");
    const log = readFileSync(join(TMP, "stub-calls.log"), "utf8");
    expect(log).toContain("_apis/projects/my%20proj?");
    expect(log).toContain("_apis/projects/guid-proj/teams");
  });

  it("provider_projects_id_by_name passes numeric input through without HTTP (15.14)", () => {
    // The shared fan-out feeds work-item ids here (for_issue column 2), not
    // board names — numeric input must short-circuit before the boards
    // lookup (a lookup would fail "no board named '<work-item-id>'").
    const stubDir = mkdtempSync(join(tmpdir(), `azp-short-${Date.now()}`));
    writeFileSync(
      join(stubDir, "azure_http_request"),
      `#!/usr/bin/env bash\necho "HTTP $*" >> "${stubDir}/calls.log"\nexit 1\n`,
    );
    chmodSync(join(stubDir, "azure_http_request"), 0o755);
    const r = spawnSync(
      "bash",
      [
        "-c",
        `source '${TOOLS}/lib/providers/provider-core.bash'\n` +
        `source '${TOOLS}/lib/providers/azure/http.bash'\n` +
        `source '${TOOLS}/lib/providers/azure/projects.bash'\n` +
        `provider_projects_id_by_name org 101383`,
      ],
      { encoding: "utf8", env: ENV({ PATH: `${stubDir}:${process.env.PATH ?? ""}` }) },
    );
    expect(r.status ?? 1).toBe(0);
    expect((r.stdout ?? "").trim()).toBe("101383");
    expect(() => readFileSync(join(stubDir, "calls.log"), "utf8")).toThrow();
  });
});

// The azure module sourcing preamble (shared by every azure_run call).
function buildAzureSource(): string {
  return (
    `source '${TOOLS}/lib/providers/provider-core.bash'\n` +
    ["http", "auth", "urls", "repos", "issues", "projects"]
      .map((m) => `source '${TOOLS}/lib/providers/azure/${m}.bash'\n`)
      .join("")
  );
}
