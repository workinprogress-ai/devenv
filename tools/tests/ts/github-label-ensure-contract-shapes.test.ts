// Port of test_github_label_ensure.bats (6) + test_provider_contract_shapes.bats
// (6): GitHub label_ensure paging/literal-compare contract, and the
// both-providers response-shape contract (same verb + call → neutral shape).
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

beforeEach(() => {
  TMP = mkdtempSync(join(tmpdir(), `ghseam-${Date.now()}-${Math.random().toString(36).slice(2)}`));
});

// ── GitHub label_ensure (port of test_github_label_ensure.bats) ──────────
// provider_issues_label_ensure must see every label (gh label list stops at 30
// unless asked for more) and compare names literally.

const GH_STUB = `#!/usr/bin/env bash
printf 'gh %s\\n' "$*" >> "$GH_CALL_LOG"
case "$*" in
    "label list"*) cat "$LABELS_FILE" ;;
    "label create"*) exit 0 ;;
esac
exit 0
`;

function ensureSetup(): void {
  mkdirSync(join(TMP, "bin"), { recursive: true });
  writeFileSync(join(TMP, "gh.log"), "");
  writeFileSync(join(TMP, "labels.txt"), "");
  writeFileSync(join(TMP, "bin/gh"), GH_STUB);
  chmodSync(join(TMP, "bin/gh"), 0o755);
}

// ensure LABEL: run provider_issues_label_ensure with the gh stub on PATH.
function ensure(label: string): { status: number; out: string } {
  const r = spawnSync(
    "bash",
    [
      "-c",
      `source '${TOOLS}/lib/providers/provider-core.bash'\n` +
      `source '${TOOLS}/lib/providers/github/repos.bash'\n` +
      `source '${TOOLS}/lib/providers/github/issues.bash'\n` +
      `provider_issues_label_ensure o/r "$1"`,
      "_",
      label,
    ],
    {
      encoding: "utf8",
      env: {
        ...process.env,
        TEST_TEMP_DIR: TMP,
        GH_CALL_LOG: join(TMP, "gh.log"),
        LABELS_FILE: join(TMP, "labels.txt"),
        PATH: `${join(TMP, "bin")}:${process.env.PATH ?? ""}`,
      },
    },
  );
  return { status: r.status ?? 1, out: (r.stdout ?? "") + (r.stderr ?? "") };
}

function logHas(pattern: string): boolean {
  return spawnSync("grep", ["-q", pattern, join(TMP, "gh.log")]).status === 0;
}

function setLabels(content: string): void {
  writeFileSync(join(TMP, "labels.txt"), content);
}

describe("github label_ensure", () => {
  beforeEach(ensureSetup);

  it("asks gh for up to 1000 labels, not its default of 30", () => {
    const r = ensure("bug");
    expect(r.status).toBe(0);
    expect(logHas("label list.*--limit 1000")).toBe(true);
  });

  it("does not create a label that already exists", () => {
    setLabels("bug\nfeature\n");
    const r = ensure("bug");
    expect(r.status).toBe(0);
    expect(logHas("label create")).toBe(false);
  });

  it("creates a label that is absent", () => {
    setLabels("bug\n");
    const r = ensure("feature");
    expect(r.status).toBe(0);
    expect(logHas("label create feature")).toBe(true);
  });

  it("compares names literally: a.b is not matched by axb", () => {
    setLabels("axb\n");
    const r = ensure("a.b");
    expect(r.status).toBe(0);
    expect(logHas("label create a.b")).toBe(true);
  });

  it("does not read a name as a pattern: c++ and brackets are plain text", () => {
    setLabels("c++\n[x]\n");
    expect(ensure("c++").status).toBe(0);
    expect(logHas("label create")).toBe(false);
    writeFileSync(join(TMP, "gh.log"), "");
    expect(ensure("[x]").status).toBe(0);
    expect(logHas("label create")).toBe(false);
  });

  it("reports a listing failure instead of trying to create", () => {
    writeFileSync(
      join(TMP, "bin/gh"),
      '#!/usr/bin/env bash\necho "gh $*" >> "$GH_CALL_LOG"\n[ "$1 $2" = "label list" ] && { echo "HTTP 403" >&2; exit 1; }\nexit 0\n',
    );
    chmodSync(join(TMP, "bin/gh"), 0o755);
    const r = ensure("bug");
    expect(r.status).not.toBe(0);
    expect(logHas("label create")).toBe(false);
  });
});

// ── contract shapes (port of test_provider_contract_shapes.bats) ─────────
// One assertion, both providers: the same verb, called the same way, returns
// the shape the contract names. Each provider's transport is stubbed with a
// response in that host's own shape; the verb maps it to the neutral one.

function shapesSetup(): void {
  mkdirSync(join(TMP, "devenv-root"), { recursive: true });
  writeFileSync(join(TMP, "devenv-root/devenv.config"), "[provider]\nname=azure\nazure_org=org\nazure_project=proj\n");
  writeFileSync(join(TMP, "gh-response"), "");
  writeFileSync(join(TMP, "gh"), '#!/usr/bin/env bash\ncat "$GH_RESPONSE"\n');
  chmodSync(join(TMP, "gh"), 0o755);
  // minimal curl stub, mirroring the fixtures/cli-stubs factory's response
  // modes — INCLUDING the ordering: body first, then the -w %{http_code} line
  // (the transport strips the trailing code line to recover the body), and the
  // -H @- stdin drain (the auth header arrives on stdin; an unread pipe
  // truncates the caller's write).
  writeFileSync(
    join(TMP, "curl"),
    [
      "#!/usr/bin/env bash",
      'prev=""; out_file=""; write_fmt=""; headers_file="/dev/null"',
      'for arg in "$@"; do',
      '  [[ "$prev" == "-D" ]] && headers_file="$arg"',
      '  [[ "$prev" == "-o" ]] && out_file="$arg"',
      '  [[ "$prev" == "-w" ]] && write_fmt="$arg"',
      '  prev="$arg"',
      "done",
      'for arg in "$@"; do',
      '  [[ "$arg" == "@-" ]] && { cat > /dev/null; break; }',
      "done",
      'echo "curl" >> "${STUB_CALL_LOG:?}"',
      'code="${STUB_CURL_HTTP_CODE:-200}"',
      'emit_body() { [[ -f "$1" ]] || { [[ -n "$out_file" ]] && : > "$out_file"; return 0; }; if [[ -n "$out_file" ]]; then cat "$1" > "$out_file"; else cat "$1"; fi; }',
      'emit_write_out() { [[ -n "$write_fmt" ]] || return 0; printf \'%b\' "${write_fmt//%\\{http_code\\}/$code}"; }',
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
    ].join("\n"),
  );
  chmodSync(join(TMP, "curl"), 0o755);
}

// verb_on PROVIDER VERB ARGS: run a verb with that provider's modules loaded.
// The verb+args go through argv after "_" and are invoked with "$@".
function verbOn(provider: string, args: string, extraEnv: Record<string, string> = {}): { status: number; out: string } {
  // '""' in the source shell line means an EMPTY argv word (spawnSync takes
  // argv directly, so a literal two-quote string would arrive quoted).
  const parts = args.split(" ").map((w) => (w === '""' ? "" : w));
  const r = spawnSync(
    "bash",
    [
      "-c",
      `source '${TOOLS}/lib/error-handling.bash'\n` +
      `source '${TOOLS}/lib/providers/provider-core.bash'\n` +
      `PROVIDER_NAME=${provider}\n` +
      `provider_load http urls auth repos issues prs pipelines projects org policies releases 2>/dev/null\n` +
      `"$@"`,
      "_",
      ...parts,
    ],
    {
      encoding: "utf8",
      env: {
        ...process.env,
        TEST_TEMP_DIR: TMP,
        DEVENV_ROOT: join(TMP, "devenv-root"),
        AZURE_PAT: "test-pat",
        GH_RESPONSE: join(TMP, "gh-response"),
        STUB_CALL_LOG: join(TMP, "stub-calls.log"),
        STUB_CURL_RESPONSE: join(TMP, "curl-response"),
        PATH: `${TMP}:${process.env.PATH ?? ""}`,
        ...extraEnv,
      },
    },
  );
  // like bats `run`, output is stdout+stderr combined
  return { status: r.status ?? 1, out: (r.stdout ?? "") + (r.stderr ?? "") };
}

// host_returns PROVIDER JSON: what the provider's transport answers.
function hostReturns(provider: string, json: string): Record<string, string> {
  if (provider === "github") {
    writeFileSync(join(TMP, "gh-response"), json);
    return {};
  }
  writeFileSync(join(TMP, "curl-response"), json);
  return { STUB_CURL_RESPONSE: join(TMP, "curl-response") };
}

function jqOut(json: string): string {
  return spawnSync("jq", ["-S", "-c", "."], { input: json, encoding: "utf8" }).stdout?.trim() ?? "";
}

function jqExpr(json: string, expr: string): string {
  return spawnSync("jq", ["-c", expr], { input: json, encoding: "utf8" }).stdout?.trim() ?? "";
}

describe("provider contract shapes", () => {
  beforeEach(shapesSetup);

  it("repos_view --json repoSpec,name: both providers return {repoSpec, name}", () => {
    let e = hostReturns("github", '{"nameWithOwner":"acme/widgets","name":"widgets"}');
    let r = verbOn("github", "provider_repos_view acme/widgets --json repoSpec,name", e);
    expect(r.status).toBe(0);
    expect(jqOut(r.out)).toBe('{"name":"widgets","repoSpec":"acme/widgets"}');

    e = hostReturns("azure", '{"name":"widgets","project":{"name":"acme"}}');
    r = verbOn("azure", "provider_repos_view acme/widgets --json repoSpec,name", e);
    expect(r.status).toBe(0);
    expect(jqOut(r.out)).toBe('{"name":"widgets","repoSpec":"acme/widgets"}');
  });

  it("run_list --json id,status: both providers return a numeric run id", () => {
    let e = hostReturns("github", '[{"databaseId":9001,"status":"completed"}]');
    let r = verbOn("github", 'provider_pipelines_run_list "" --json id,status', e);
    expect(r.status).toBe(0);
    expect(jqExpr(r.out, ".[0] | [(.id | type), .status]")).toBe('["number","completed"]');

    e = hostReturns("azure", '{"value":[{"id":9001,"status":"completed","result":"succeeded","sourceBranch":"refs/heads/main","definition":{"name":"CI"}}]}');
    r = verbOn("azure", 'provider_pipelines_run_list "" --json id,status', e);
    expect(r.status).toBe(0);
    expect(jqExpr(r.out, ".[0] | [(.id | type), .status]")).toBe('["number","completed"]');
  });

  it("run_view -q .id: both providers answer with the run id", () => {
    let e = hostReturns("github", '{"databaseId":9001}');
    let r = verbOn("github", 'provider_pipelines_run_view "" 9001 --json id -q .id', e);
    expect(r.status).toBe(0);
    expect(r.out.trim()).toBe("9001");

    e = hostReturns("azure", '{"id":9001,"status":"completed","sourceBranch":"refs/heads/main","definition":{"name":"CI"}}');
    r = verbOn("azure", 'provider_pipelines_run_view "" 9001 --json id -q .id', e);
    expect(r.status).toBe(0);
    expect(r.out.trim()).toBe("9001");
  });

  it("a comment record carries id, url and body, and no html_url, on both providers", () => {
    let e = hostReturns("github", '{"id":7,"html_url":"https://example.test/c/7","body":"hello"}');
    let r = verbOn("github", 'provider_issues_comment_get "" 7', e);
    expect(r.status).toBe(0);
    expect(() =>
      spawnSync("jq", ["-e", '.id == 7 and .url == "https://example.test/c/7" and .body == "hello" and (has("html_url") | not)'], { input: r.out, stdio: "ignore" }).status !== 0 ? new Error("shape") : undefined,
    ).not.toThrow();

    e = hostReturns("azure", '{"comments":[{"id":7,"workItemId":42,"text":"hello"}]}');
    r = verbOn("azure", 'provider_issues_comment_get "" 42/7', e);
    expect(r.status).toBe(0);
    expect(() =>
      spawnSync("jq", ["-e", '.id == "42/7" and (.url | length) > 0 and .body == "hello" and (has("html_url") | not)'], { input: r.out, stdio: "ignore" }).status !== 0 ? new Error("shape") : undefined,
    ).not.toThrow();
  });

  it("a review thread page carries each comment's id, nodeId, body and author, on both providers", () => {
    const ghJson =
      '{"data":{"repository":{"pullRequest":{"reviewThreads":{"pageInfo":{"hasNextPage":false,"endCursor":null},"nodes":[{"id":"T1","isResolved":false,"path":null,"line":0,"comments":{"nodes":[{"id":"PRRC_n","databaseId":42,"body":"b","author":{"login":"ann"}}]}}]}}}}}';
    let e = hostReturns("github", ghJson);
    let r = verbOn("github", "provider_prs_threads_page acme/widgets 5", e);
    expect(r.status).toBe(0);
    const ghShape = jqExpr(r.out, ".data.repository.pullRequest.reviewThreads.nodes[0].comments.nodes[0] | [(keys | sort), .body, .author.login]");

    const azJson =
      '{"value":[{"id":3,"status":"active","isDeleted":false,"threadContext":null,"comments":[{"id":1,"parentCommentId":0,"content":"b","commentType":"text","author":{"displayName":"ann"}}]}]}';
    e = hostReturns("azure", azJson);
    r = verbOn("azure", "provider_prs_threads_page acme/widgets 5", e);
    expect(r.status).toBe(0);
    const azShape = jqExpr(r.out, ".data.repository.pullRequest.reviewThreads.nodes[0].comments.nodes[0] | [(keys | sort), .body, .author.login]");

    expect(ghShape).toBe(azShape);
    expect(ghShape).toBe('[["author","body","id","nodeId"],"b","ann"]');
  });

  it("an issue list record carries the contract's fields on both providers", () => {
    let e = hostReturns("github", '[{"number":1,"title":"t","state":"OPEN","labels":[{"name":"bug"}],"url":"u"}]');
    let r = verbOn("github", 'provider_issues_list "" --json number,title,state,labels,url', e);
    expect(r.status).toBe(0);
    expect(jqExpr(r.out, ".[0] | keys | sort")).toBe('["labels","number","state","title","url"]');

    // Azure: WIQL first, then the batch
    writeFileSync(join(TMP, "wiql.json"), '{"workItems":[{"id":1}]}');
    writeFileSync(join(TMP, "batch.json"), '{"value":[{"id":1,"url":"https://x/1","fields":{"System.Title":"t","System.State":"Active","System.Tags":"bug"}}]}');
    writeFileSync(join(TMP, "queue"), `${join(TMP, "wiql.json")}\n${join(TMP, "batch.json")}\n`);
    e = { STUB_CURL_PAGES: join(TMP, "queue") };
    r = verbOn("azure", 'provider_issues_list "" --json number,title,state,labels,url', e);
    expect(r.status).toBe(0);
    expect(jqExpr(r.out, ".[0] | keys | sort")).toBe('["labels","number","state","title","url"]');
    expect(jqExpr(r.out, ".[0].labels")).toBe('[{"name":"bug"}]');
  });
});
