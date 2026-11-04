// Port of tools/tests/lib/test_provider_contract_verbs.bats (19 tests):
// contract verbs present on BOTH providers (github backfill verification —
// the no-regression net for the call-site rewrites), azure mirrors, and the
// pipelines flag-passthrough checks.
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
let CALL_LOG = "";

// The fixture's gh stub: argv log, api with pages queue / mutations log /
// canned api response.
const GH_STUB = [
  "#!/usr/bin/env bash",
  'echo "gh $*" >> "${STUB_CALL_LOG:?}"',
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
  '      tail -n +2 "$STUB_GH_PAGES" > "$STUB_GH_PAGES.tmp" && mv "$STUB_CURL_PAGES.tmp" "$STUB_GH_PAGES" 2>/dev/null; tail -n +2 "$STUB_GH_PAGES" > "${STUB_GH_PAGES}.tmp" && mv "${STUB_GH_PAGES}.tmp" "${STUB_GH_PAGES}"',
  '      [[ -f "$page_file" ]] && cat "$page_file"',
  "      exit 0",
  "    fi",
  "    exit 1",
  "  fi",
  '  if [[ "$*" == *"-X PATCH"* || "$*" == *"-X POST"* ]]; then',
  '    [[ -n "${STUB_GH_MUTATIONS:-}" ]] && echo "gh $*" >> "$STUB_GH_MUTATIONS"',
  '    printf \'{"id": 111, "html_url": "https://example.invalid/comment/111"}\'',
  "  else",
  '    [[ -f "${STUB_GH_API_RESPONSE:-/nonexistent}" ]] && cat "$STUB_GH_API_RESPONSE"',
  "  fi",
  "  exit 0",
  "fi",
  "exit 0",
  "",
].join("\n");

// Minimal azure curl stub (response-file mode).
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
  'if [[ -n "${STUB_CURL_REQUEST_BODY:-}" ]]; then',
  '  prev=""',
  '  for arg in "$@"; do',
  "    [[ \"$prev\" == \"-d\" ]] && printf '%s\\n' \"$arg\" >> \"$STUB_CURL_REQUEST_BODY\"",
  '    prev="$arg"',
  "  done",
  "fi",
  'echo "curl" >> "${STUB_CALL_LOG:?}"',
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
  TMP = mkdtempSync(join(tmpdir(), `cverbs-${Date.now()}-${Math.random().toString(36).slice(2)}`));
  CALL_LOG = join(TMP, "stub-calls.log");
  const bin = join(TMP, "stub-bin");
  mkdirSync(bin, { recursive: true });
  mkdirSync(join(TMP, "devenv-root"), { recursive: true });
  writeFileSync(CALL_LOG, "");
  writeFileSync(join(bin, "gh"), GH_STUB);
  chmodSync(join(bin, "gh"), 0o755);
  writeFileSync(join(bin, "curl"), CURL_STUB);
  chmodSync(join(bin, "curl"), 0o755);
});

const ENV = (extra: Record<string, string> = {}): Record<string, string> => ({
  ...process.env,
  TEST_TEMP_DIR: TMP,
  DEVENV_TOOLS: TOOLS,
  DEVENV_ROOT: join(TMP, "devenv-root"),
  AZURE_PAT: "test-pat",
  STUB_CALL_LOG: CALL_LOG,
  STUB_CURL_RESPONSE: join(TMP, "curl-response"),
  PATH: `${join(TMP, "stub-bin")}:${process.env.PATH ?? ""}`,
  ...extra,
});

// gh_libs_source + call: github libs with the stubbed gh on PATH.
function ghRun(call: string, extraEnv: Record<string, string> = {}): { status: number; out: string } {
  const libs =
    `source '${TOOLS}/lib/providers/provider-core.bash'\n` +
    ["github/repos", "github/issues", "github/prs", "github/org", "github/pipelines"]
      .map((m) => `source '${TOOLS}/lib/providers/${m}.bash'\n`)
      .join("");
  const r = spawnSync("bash", ["-c", `${libs}${call}`], { encoding: "utf8", env: ENV(extraEnv) });
  return { status: r.status ?? 1, out: (r.stdout ?? "") + (r.stderr ?? "") };
}

function logHas(substring: string): boolean {
  return readFileSync(CALL_LOG, "utf8").includes(substring);
}

function writeCfg(azure: boolean): void {
  writeFileSync(
    join(TMP, "devenv-root/devenv.config"),
    azure
      ? "[provider]\nname=azure\nazure_org=o1\nazure_project=p1\n"
      : "[provider]\nname=github\n[organization]\nname=t\norg=my-org\n",
  );
}

function jq(json: string, expr: string, flags: string[] = ["-r"]): string {
  return (spawnSync("jq", [...flags, expr], { input: json, encoding: "utf8" }).stdout ?? "").trim();
}

// ===========================================================================
// Contract verbs present on BOTH providers (github backfill verification)
// ===========================================================================

describe("github backfill verbs", () => {
  it("provider_issues_comment_get fetches the comment REST resource", () => {
    writeFileSync(join(TMP, "c.json"), '{"id":911,"html_url":"https://github.o/r/issues/1#issuecomment-911","body":"x"}');
    const r = ghRun("provider_issues_comment_get o/r 911", { STUB_GH_API_RESPONSE: join(TMP, "c.json") });
    expect(r.status).toBe(0);
    expect(jq(r.out, ".id")).toBe("911");
  });

  it("provider_issues_comment_edit PATCHes the body", () => {
    const muts = join(TMP, "muts.log");
    writeFileSync(muts, "");
    const r = ghRun('provider_issues_comment_edit o/r 911 --body "new"', { STUB_GH_MUTATIONS: muts });
    expect(r.status).toBe(0);
    const log = readFileSync(muts, "utf8");
    expect(log).toContain("PATCH repos/o/r/issues/comments/911");
    expect(log).toContain("body=new");
  });

  it("provider_issues_comment_add POSTs to the issue comments endpoint", () => {
    const muts = join(TMP, "muts2.log");
    writeFileSync(muts, "");
    const r = ghRun('provider_issues_comment_add o/r 1 --body "created"', { STUB_GH_MUTATIONS: muts });
    expect(r.status).toBe(0);
    expect(readFileSync(muts, "utf8")).toContain("POST repos/o/r/issues/1/comments");
  });

  it("provider_issues_label_create passes name/color/description", () => {
    const r = ghRun('provider_issues_label_create o/r mylabel 1d76db "desc"');
    expect(r.status).toBe(0);
    expect(logHas("label create mylabel")).toBe(true);
  });

  it("provider_issues_label_update edits color", () => {
    const r = ghRun("provider_issues_label_update o/r mylabel ff0000");
    expect(r.status).toBe(0);
    expect(logHas("label edit mylabel")).toBe(true);
  });

  it("provider_repos_commits_count succeeds on non-empty", () => {
    writeFileSync(join(TMP, "commits.json"), '[{"sha":"abc"}]');
    const r = ghRun("provider_repos_commits_count o/r", { STUB_GH_API_RESPONSE: join(TMP, "commits.json") });
    expect(r.status).toBe(0);
  });

  it("provider_repos_commits_count fails on empty array", () => {
    writeFileSync(join(TMP, "nocommits.json"), "[]");
    const r = ghRun("provider_repos_commits_count o/r", { STUB_GH_API_RESPONSE: join(TMP, "nocommits.json") });
    expect(r.status).not.toBe(0);
  });

  it("provider_prs_thread_create general form emits thread url", () => {
    writeFileSync(join(TMP, "node.json"), '{"data":{"repository":{"id":"R_1"}}}');
    writeFileSync(
      join(TMP, "thread.json"),
      '{"data":{"addPullRequestReviewThread":{"thread":{"url":"https://github.o/r/pull/1#discussion_r1"}}}}',
    );
    const queue = join(TMP, "pages.queue");
    writeFileSync(queue, `${join(TMP, "node.json")}\n${join(TMP, "thread.json")}\n`);
    const r = ghRun('provider_prs_thread_create o/r 1 --body "note"', { STUB_GH_PAGES: queue });
    expect(r.status).toBe(0);
    expect(jq(r.out, ".thread.url")).toMatch(/discussion_r1/);
  });

  it("azure provider_prs_thread_create mirrors the same interface", () => {
    writeFileSync(join(TMP, "azthread.json"), '{"id":777,"status":1}');
    const libs =
      `source '${TOOLS}/lib/providers/provider-core.bash'\n` +
      ["azure/http", "azure/auth", "azure/repos", "azure/issues", "azure/prs"]
        .map((m) => `source '${TOOLS}/lib/providers/${m}.bash'\n`)
        .join("");
    const r = spawnSync("bash", ["-c", `${libs}provider_prs_thread_create o1/p1/r1 12 --body "note"`], {
      encoding: "utf8",
      env: ENV({ STUB_CURL_RESPONSE: join(TMP, "azthread.json") }),
    });
    expect(r.status ?? 1).toBe(0);
    expect(jq(r.stdout ?? "", ".thread.id")).toBe("12/777");
  });
});

// ===========================================================================
// Contract verbs implemented on both providers
// ===========================================================================

describe("org verbs on both providers", () => {
  it("github provider_org_releases_list passes the gh dialect through", () => {
    const r = ghRun("provider_org_releases_list o/r --limit 10 --json tagName");
    expect(r.status).toBe(0);
    expect(logHas("release list -R o/r")).toBe(true);
  });

  it("azure provider_org_releases_list maps tags to the gh release shape", () => {
    writeCfg(true);
    writeFileSync(
      join(TMP, "tags.json"),
      '{"value":[{"name":"refs/tags/v1.2.3","creator":{"date":"2026-02-02T00:00:00Z"}},{"name":"refs/tags/v2.0.0-beta.1","creator":{"date":"2026-03-03T00:00:00Z"}}]}',
    );
    const libs =
      `source '${TOOLS}/lib/providers/provider-core.bash'\n` +
      ["azure/http", "azure/auth", "azure/urls", "azure/repos", "azure/releases"]
        .map((m) => `source '${TOOLS}/lib/providers/${m}.bash'\n`)
        .join("");
    const r = spawnSync("bash", ["-c", `${libs}provider_org_releases_list o1/p1/r1 --limit 10`], {
      encoding: "utf8",
      env: ENV({ STUB_CURL_RESPONSE: join(TMP, "tags.json") }),
    });
    expect(r.status ?? 1).toBe(0);
    // One JSON array of gh-shaped release records; newest first: the 2.0.0
    // prerelease is above 1.2.3.
    const ok = spawnSync(
      "jq",
      ["-e", 'length == 2 and .[1].tagName == "v1.2.3" and .[0].isPrerelease == true and .[1].isDraft == false'],
      { input: r.stdout ?? "", stdio: "ignore" },
    );
    expect(ok.status ?? 1).toBe(0);
  });

  it("azure provider_org_feeds_list emits the packaging surface", () => {
    writeCfg(true);
    writeFileSync(join(TMP, "feeds.json"), '{"value":[{"name":"main-feed","id":"f1","url":"https://feeds/x"}]}');
    const libs =
      `source '${TOOLS}/lib/providers/provider-core.bash'\n` +
      ["azure/http", "azure/auth", "azure/urls", "azure/repos", "azure/releases"]
        .map((m) => `source '${TOOLS}/lib/providers/${m}.bash'\n`)
        .join("");
    const r = spawnSync("bash", ["-c", `${libs}provider_org_feeds_list`], {
      encoding: "utf8",
      env: ENV({ STUB_CURL_RESPONSE: join(TMP, "feeds.json") }),
    });
    expect(r.status ?? 1).toBe(0);
    expect(jq(r.stdout ?? "", ".[0].name")).toBe("main-feed");
  });

  it("azure provider_issues_set_type replaces System.WorkItemType with the mapped Azure type", () => {
    writeCfg(true);
    writeFileSync(join(TMP, "typed.json"), '{"id":42,"fields":{"System.WorkItemType":"Bug"}}');
    writeFileSync(join(TMP, "typebody.log"), "");
    const libs =
      `source '${TOOLS}/lib/providers/provider-core.bash'\n` +
      ["azure/http", "azure/auth", "azure/urls", "azure/repos", "azure/issues"]
        .map((m) => `source '${TOOLS}/lib/providers/${m}.bash'\n`)
        .join("");
    const r = spawnSync("bash", ["-c", `${libs}provider_issues_set_type o p 42 Task`], {
      encoding: "utf8",
      env: ENV({
        // Pin the org/project: sibling suites leak AZURE_DEVOPS_* into the
        // shared worker env, and the transport prefers them over config.
        AZURE_DEVOPS_ORG: "o",
        AZURE_DEVOPS_PROJECT: "p",
        STUB_CURL_RESPONSE: join(TMP, "typed.json"),
        STUB_CURL_REQUEST_BODY: join(TMP, "typebody.log"),
      }),
    });
    expect(r.status ?? 1).toBe(0);
    const ok = spawnSync(
      "jq",
      ["-s", "-e", 'any(.[][]?; .path == "/fields/System.WorkItemType" and .value == "User Story")'],
      { input: readFileSync(join(TMP, "typebody.log"), "utf8"), stdio: ["pipe", "ignore", "ignore"] },
    );
    expect(ok.status ?? 1).toBe(0);
  });
});

// ===========================================================================
// merge_pr branch-keeping behavior
// ===========================================================================

describe("merge_pr", () => {
  it("deletes by default and keeps the branch on request", () => {
    // Stub AFTER sourcing: git-operations loads the provider layer, whose
    // real verbs would otherwise override these stubs.
    const r = spawnSync(
      "bash",
      [
        "-c",
        `source '${TOOLS}/lib/error-handling.bash'\n` +
        `source '${TOOLS}/lib/git-operations.bash'\n` +
        `provider_prs_merge() { printf '%s\\n' "$*"; }\n` +
        `provider_prs_view() { echo '{}'; }\n` +
        `merge_method_allowed() { return 0; }\n` +
        `msg="subject line"\n` +
        `out=$(merge_pr 42 "$msg" rebase "" false false 2>/dev/null)\n` +
        `printf '%s' "$out" | grep -q -- "--delete-branch" || exit 1\n` +
        `out2=$(merge_pr 42 "$msg" rebase "" false true 2>/dev/null)\n` +
        `if printf '%s' "$out2" | grep -q -- "--delete-branch"; then\n` +
        `  echo "keep_branch did not suppress --delete-branch: $out2" >&2\n` +
        `  exit 1\n` +
        `fi`,
      ],
      { encoding: "utf8", env: ENV() },
    );
    expect(r.status ?? 1).toBe(0);
  });
});

// ===========================================================================
// GraphQL variables vs embedded placeholders + pipelines flag passthrough
// ===========================================================================

describe("thread create + pipelines flags", () => {
  it("github provider_prs_thread_create looks the repository up through GraphQL variables, not embedded placeholders", () => {
    writeFileSync(join(TMP, "node.json"), '{"data":{"repository":{"id":"R_1"}}}');
    writeFileSync(
      join(TMP, "thread.json"),
      '{"data":{"addPullRequestReviewThread":{"thread":{"url":"https://github.o/r/pull/1#discussion_r1"}}}}',
    );
    const queue = join(TMP, "pages.queue");
    writeFileSync(queue, `${join(TMP, "node.json")}\n${join(TMP, "thread.json")}\n`);
    writeFileSync(CALL_LOG, "");
    const r = ghRun('provider_prs_thread_create myorg/myrepo 1 --body "note"', { STUB_GH_PAGES: queue });
    expect(r.status).toBe(0);
    expect(logHas("-f o=myorg")).toBe(true);
    expect(logHas("-f r=myrepo")).toBe(true);
    expect(logHas("{owner}")).toBe(false);
  });

  it("github provider_pipelines_run_rerun forwards --failed and --debug to gh run rerun", () => {
    writeFileSync(CALL_LOG, "");
    const r = ghRun("provider_pipelines_run_rerun o/r 123 --failed --debug");
    expect(r.status).toBe(0);
    expect(logHas("run rerun 123")).toBe(true);
    expect(logHas("--failed")).toBe(true);
    expect(logHas("--debug")).toBe(true);
  });

  it("github provider_pipelines_run_rerun still reruns a bare run id", () => {
    writeFileSync(CALL_LOG, "");
    const r = ghRun("provider_pipelines_run_rerun 123");
    expect(r.status).toBe(0);
    expect(logHas("run rerun 123")).toBe(true);
  });

  it("github provider_pipelines_workflow_list forwards --json and -q so a JSON consumer gets JSON", () => {
    writeFileSync(CALL_LOG, "");
    const r = ghRun("provider_pipelines_workflow_list o/r --json id,name,path,state -q '.[].name'");
    expect(r.status).toBe(0);
    expect(logHas("workflow list")).toBe(true);
    expect(logHas("--json id,name,path,state")).toBe(true);
    expect(logHas("-q .[].name")).toBe(true);
  });

  it("github provider_pipelines_workflow_list takes the repository first, as before", () => {
    writeFileSync(CALL_LOG, "");
    const r = ghRun("provider_pipelines_workflow_list o/r");
    expect(r.status).toBe(0);
    expect(logHas("-R o/r")).toBe(true);
  });
});
