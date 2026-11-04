// Port of tools/tests/lib/test_provider_azure_http.bats (28 tests) — one
// vitest `it` per source `@test`. lib/providers/azure/http.bash — the Azure
// DevOps REST transport, exercised entirely through a PATH-shadowed curl stub.
// Assertions lock the transport contract: Basic-auth header form, api-version
// injection, ContinuationToken pagination, 429/Retry-After and 5xx retry,
// malformed-JSON typing, and token redaction.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { spawnSync } from "node:child_process";
import { appendFileSync, chmodSync, existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const ROOT = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))));
const TOOLS = join(ROOT, "tools");
const LIB = join(TOOLS, "lib", "providers", "azure", "http.bash");

let TMP = "";
let CALL_LOG = "";

const STUB_CURL = [
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

// The argv-logging curl several tests install (records argv, writes 200 into
// -D, exits 0).
const ARGV_CURL = [
  "#!/usr/bin/env bash",
  "printf '%s\\n' \"$@\" > \"$TEST_TEMP_DIR/curl-argv.log\"",
  "exit 0",
  "",
].join("\n");

beforeEach(() => {
  TMP = mkdtempSync(join(tmpdir(), `azhttp-${Date.now()}-${Math.random().toString(36).slice(2)}`));
  CALL_LOG = join(TMP, "stub-calls.log");
  const bin = join(TMP, "stub-bin");
  mkdirSync(bin, { recursive: true });
  writeFileSync(CALL_LOG, "");
  writeFileSync(join(bin, "curl"), STUB_CURL);
  chmodSync(join(bin, "curl"), 0o755);
});

const ENV = (extra: Record<string, string> = {}): Record<string, string> => ({
  ...process.env,
  DEVENV_TOOLS: TOOLS,
  STUB_CALL_LOG: CALL_LOG,
  AZURE_PAT: "test-pat-secret-12345",
  TEST_TEMP_DIR: TMP,
  PATH: `${join(TMP, "stub-bin")}:${process.env.PATH ?? ""}`,
  ...extra,
});

// http_run: source the lib and call, with stdin closed (the transport reads
// the credential header via -H @-).
function httpRun(call: string, extraEnv: Record<string, string> = {}): { status: number; out: string } {
  const r = spawnSync("bash", ["-c", `source '${LIB}'\n${call}\n`], {
    input: "",
    encoding: "utf8",
    env: ENV(extraEnv),
  });
  return { status: r.status ?? 1, out: (r.stdout ?? "") + (r.stderr ?? "") };
}

function curlCount(): number {
  return parseInt((spawnSync("grep", ["-c", "^curl ", CALL_LOG], { encoding: "utf8" }).stdout ?? "0").trim(), 10) || 0;
}

function logHas(pattern: string): boolean {
  return spawnSync("grep", ["-q", pattern, CALL_LOG]).status === 0;
}

function jqOut(json: string, args: string[]): string {
  return (spawnSync("jq", args, { input: json, encoding: "utf8" }).stdout ?? "").trim();
}

// no_sleep: the transport's retry sleep becomes a no-op (set up per test).
function noSleep(): void {
  writeFileSync(join(TMP, "stub-bin", "sleep"), "#!/usr/bin/env bash\nexit 0\n");
  chmodSync(join(TMP, "stub-bin", "sleep"), 0o755);
}

// page_files <n>: n pages of one item each, queued. Only the last page
// carries no continuation token, so paging stops there.
function pageFiles(n: number): string {
  const queue = join(TMP, "queue");
  writeFileSync(queue, "");
  for (let i = 1; i <= n; i++) {
    const f = join(TMP, `page${i}.json`);
    const token = i < n ? `,"continuationToken":"t${i}"` : "";
    writeFileSync(f, `{"value":[{"i":${i}}]${token}}`);
    appendFileSync(queue, `${f}\n`);
  }
  return queue;
}

describe("provider azure http", () => {
  it("azure-http: library sources cleanly", () => {
    const r = httpRun("echo loaded");
    expect(r.status).toBe(0);
    expect(r.out.trim()).toBe("loaded");
  });

  it("azure-http: request sends Basic auth via Authorization header (PAT never in argv or URL)", () => {
    const resp = join(TMP, "resp.json");
    writeFileSync(resp, '{"value":[]}');
    writeFileSync(
      join(TMP, "stub-bin", "curl"),
      [
        "#!/usr/bin/env bash",
        "printf '%s\\n' \"$@\" > \"$TEST_TEMP_DIR/curl-argv.log\"",
        "cat > \"$TEST_TEMP_DIR/curl-stdin.log\"",
        'prev=""',
        'for arg in "$@"; do',
        '  if [[ "$prev" == "-D" ]]; then printf \'HTTP/1.1 200 OK\\r\\n\\r\\n\' > "$arg"; fi',
        '  prev="$arg"',
        "done",
        "exit 0",
        "",
      ].join("\n"),
    );
    chmodSync(join(TMP, "stub-bin", "curl"), 0o755);
    httpRun(`azure_http_request GET 'https://dev.azure.com/org/proj/_apis/test'`, { STUB_CURL_RESPONSE: resp });
    // The PAT itself never appears in any curl argument (process listings)
    expect(spawnSync("grep", ["-q", "test-pat-secret", join(TMP, "curl-argv.log")]).status).not.toBe(0);
    // Auth travels as an Authorization: Basic header on stdin, not in argv
    const expected = spawnSync("bash", ["-c", `printf ':%s' "$AZURE_PAT" | base64 | tr -d '\\r\\n'`], { encoding: "utf8", env: ENV() }).stdout?.trim();
    expect(spawnSync("grep", ["-q", `Authorization: Basic ${expected}`, join(TMP, "curl-stdin.log")]).status).toBe(0);
    expect(spawnSync("grep", ["-qi", "Authorization", join(TMP, "curl-argv.log")]).status).not.toBe(0);
  });

  it("azure-http: request injects api-version=7.1", () => {
    const resp = join(TMP, "resp.json");
    writeFileSync(resp, '{"value":[]}');
    httpRun(`azure_http_request GET 'https://dev.azure.com/org/proj/_apis/test'`, { STUB_CURL_RESPONSE: resp });
    expect(logHas("api-version=7.1")).toBe(true);
  });

  it("azure-http: request appends api-version with & when URL has a query", () => {
    const resp = join(TMP, "resp.json");
    writeFileSync(resp, '{"value":[]}');
    httpRun(`azure_http_request GET 'https://dev.azure.com/org/proj/_apis/test?\\$top=10'`, { STUB_CURL_RESPONSE: resp });
    expect(logHas("api-version=7.1")).toBe(true);
    expect(logHas("top=10")).toBe(true);
  });

  it("azure-http: URL-pinned api-version (preview resources) is passed through untouched", () => {
    const resp = join(TMP, "resp.json");
    writeFileSync(resp, '{"value":[]}');
    httpRun(`azure_http_request GET 'https://dev.azure.com/org/proj/_apis/wit/workitems/1/comments?api-version=7.1-preview.3'`, {
      STUB_CURL_RESPONSE: resp,
    });
    expect(logHas("api-version=7.1-preview.3")).toBe(true);
    // Exactly one api-version on the wire — the default must not be appended.
    const count = parseInt(
      (spawnSync("bash", ["-c", `grep -o 'api-version=' '${CALL_LOG}' | wc -l`], { encoding: "utf8" }).stdout ?? "0").trim(),
      10,
    );
    expect(count).toBe(1);
  });

  it("azure-http: request without credentials fails typed, no call made", () => {
    const r = httpRun(`AZURE_PAT_FILE=/nonexistent/no-pat-file azure_http_request GET 'https://dev.azure.com/org/_apis/test'`, {
      AZURE_PAT: "",
    });
    expect(r.status).not.toBe(0);
    expect(r.out).toMatch(/no-credentials/);
    expect(r.out).toMatch(/key-update-azure/);
    expect(curlCount()).toBe(0);
  });

  it("azure-http: empty AZURE_PAT self-heals via the neutral seam (PAT file)", () => {
    const patFile = join(TMP, "pat-file");
    writeFileSync(patFile, "file-resolved-pat-abc\n");
    chmodSync(patFile, 0o600);
    const resp = join(TMP, "resp.json");
    writeFileSync(resp, '{"value":[]}');
    const r = httpRun(`AZURE_PAT_FILE='${patFile}' azure_http_request GET 'https://dev.azure.com/org/_apis/test'`, {
      AZURE_PAT: "",
      STUB_CURL_RESPONSE: resp,
    });
    expect(r.status).toBe(0);
    expect(curlCount()).toBe(1);
  });

  it("azure-http: paginate self-heals the credential seam too", () => {
    const patFile = join(TMP, "pat-file");
    writeFileSync(patFile, "file-resolved-pat-abc\n");
    chmodSync(patFile, 0o600);
    const empty = join(TMP, "empty.json");
    writeFileSync(empty, '{"value":[]}');
    const r = httpRun(`AZURE_PAT_FILE='${patFile}' azure_http_paginate 'https://dev.azure.com/org/proj/_apis/test'`, {
      AZURE_PAT: "",
      STUB_CURL_RESPONSE: empty,
    });
    expect(r.status).toBe(0);
    expect(curlCount()).toBe(1);
  });

  it("azure-http: paginate without any credential fails typed before calling curl", () => {
    const r = httpRun(`AZURE_PAT_FILE=/nonexistent/no-pat-file azure_http_paginate 'https://dev.azure.com/org/proj/_apis/test'`, {
      AZURE_PAT: "",
    });
    expect(r.status).not.toBe(0);
    expect(r.out).toMatch(/no-credentials/);
    expect(curlCount()).toBe(0);
  });

  it("azure-http: non-retryable HTTP error surfaces typed error with message", () => {
    const err = join(TMP, "err.json");
    writeFileSync(err, '{"message":"TF401027: permission denied"}');
    const r = httpRun(`azure_http_request GET 'https://dev.azure.com/org/_apis/test'`, {
      STUB_CURL_HTTP_CODE: "403",
      STUB_CURL_RESPONSE: err,
    });
    expect(r.status).not.toBe(0);
    expect(r.out).toMatch('"code":403');
    expect(r.out).toMatch("TF401027");
  });

  it("azure-http: malformed JSON body is a typed error", () => {
    const bad = join(TMP, "bad.json");
    writeFileSync(bad, "not json at all");
    const r = httpRun(`azure_http_request GET 'https://dev.azure.com/org/_apis/test'`, { STUB_CURL_RESPONSE: bad });
    expect(r.status).not.toBe(0);
    expect(r.out).toMatch("malformed-json");
  });

  it("azure-http: transport failure is a typed error after retries", () => {
    noSleep();
    const r = httpRun(`azure_http_request GET 'https://dev.azure.com/org/_apis/test'`, { STUB_CURL_FAIL: "1" });
    expect(r.status).not.toBe(0);
    expect(r.out).toMatch('"transport"');
    expect(curlCount()).toBeGreaterThanOrEqual(2);
  });

  it("azure-http: paginate combines ContinuationToken pages into one array", () => {
    const p1 = join(TMP, "page1.json");
    const p2 = join(TMP, "page2.json");
    const queue = join(TMP, "pages.queue");
    // Page 1 carries the token (body-embedded — the transport follows either
    // carrier); page 2 is the last, so it carries none.
    writeFileSync(p1, '{"value":[{"id":1}],"continuationToken":"t1"}');
    writeFileSync(p2, '{"value":[{"id":2},{"id":3}]}');
    writeFileSync(queue, `${p1}\n${p2}\n`);
    const r = httpRun(`azure_http_paginate 'https://dev.azure.com/org/proj/_apis/test'`, { STUB_CURL_PAGES: queue });
    expect(r.status).toBe(0);
    const combined = r.out;
    expect(jqOut(combined, ["-r", ". | length"])).toBe("3");
    expect(jqOut(combined, ["-r", ".[0].id"])).toBe("1");
    expect(jqOut(combined, ["-r", ".[2].id"])).toBe("3");
    expect(curlCount()).toBe(2);
    expect(logHas("continuationToken=")).toBe(true);
  });

  it("azure-http: work-item content type (json-patch+json) reaches curl as a header", () => {
    // The live Tier-2 run surfaced Azure rejecting application/json on
    // work-item PATCH/POST with a 400 — the transport must forward the
    // caller-selected content type.
    const ok = join(TMP, "ok.json");
    writeFileSync(ok, '{"id":1}');
    writeFileSync(join(TMP, "stub-bin", "curl"), ARGV_CURL);
    chmodSync(join(TMP, "stub-bin", "curl"), 0o755);
    httpRun(`azure_http_request PATCH 'https://dev.azure.com/org/_apis/wit/workitems/1' '[]' 'application/json-patch+json'`, {
      STUB_CURL_RESPONSE: ok,
    });
    expect(spawnSync("grep", ["-q", "Content-Type: application/json-patch+json", join(TMP, "curl-argv.log")]).status).toBe(0);
  });

  it("azure-http: redaction strips the PAT from logged text", () => {
    const r = httpRun(`AZURE_PAT='leaky-token-xyz' azure_redact 'error at https://dev.azure.com/org?token=leaky-token-xyz'`);
    expect(r.status).toBe(0);
    expect(r.out).not.toMatch("leaky-token-xyz");
    expect(r.out).toMatch("REDACTED");
  });

  it("azure-http: paginate follows a body-embedded continuationToken", () => {
    // Body-continuation regression: some endpoints embed the token in the
    // response body instead of a ContinuationToken header — without the
    // fallback the list silently truncates after one page.
    const p1 = join(TMP, "page1.json");
    const p2 = join(TMP, "page2.json");
    const queue = join(TMP, "pages.queue");
    writeFileSync(p1, '{"value":[{"id":1}],"continuationToken":"tok-1"}');
    writeFileSync(p2, '{"value":[{"id":2}]}');
    writeFileSync(queue, `${p1}\n${p2}\n`);
    const r = httpRun(`azure_http_paginate 'https://dev.azure.com/org/proj/_apis/test'`, { STUB_CURL_PAGES: queue });
    expect(r.status).toBe(0);
    expect(jqOut(r.out, ["length"])).toBe("2");
    expect(jqOut(r.out, ["-r", ".[1].id"])).toBe("2");
  });

  it("azure-http: the status is the final hop's, not the redirect's", () => {
    // curl -L dumps every hop's headers; the first line is the 302, the last
    // the real answer.
    writeFileSync(
      join(TMP, "stub-bin", "curl"),
      [
        "#!/usr/bin/env bash",
        'prev=""; for arg in "$@"; do [[ "$prev" == "-D" ]] && printf \'HTTP/1.1 302 Found\\r\\n\\r\\nHTTP/1.1 200 OK\\r\\n\\r\\n\' > "$arg"; prev="$arg"; done',
        "printf '{\"value\":[1]}'",
        "",
      ].join("\n"),
    );
    chmodSync(join(TMP, "stub-bin", "curl"), 0o755);
    const r = httpRun(`azure_http_request GET "https://dev.azure.com/org/_apis/projects"`);
    expect(r.status).toBe(0);
    expect(jqOut(r.out, ["-c", "."])).toBe('{"value":[1]}');
  });

  it("azure-http: curl's own -w status is used and stripped from the body", () => {
    writeFileSync(
      join(TMP, "stub-bin", "curl"),
      [
        "#!/usr/bin/env bash",
        'prev=""; for arg in "$@"; do [[ "$prev" == "-D" ]] && printf \'HTTP/1.1 302 Found\\r\\n\\r\\n\' > "$arg"; prev="$arg"; done',
        "printf '{\"value\":[1]}\\n__azure_http_code=200'",
        "",
      ].join("\n"),
    );
    chmodSync(join(TMP, "stub-bin", "curl"), 0o755);
    const r = httpRun(`azure_http_request GET "https://dev.azure.com/org/_apis/projects"`);
    expect(r.status).toBe(0);
    expect(jqOut(r.out, ["-c", "."])).toBe('{"value":[1]}');
  });

  it("azure-http: a sign-in page served with 200 is an auth error, not malformed JSON", () => {
    const signin = join(TMP, "signin.html");
    writeFileSync(signin, "<html><title>Sign in to your account</title></html>");
    const r = httpRun(`azure_http_request GET "https://dev.azure.com/org/_apis/projects"`, { STUB_CURL_RESPONSE: signin });
    expect(r.status).not.toBe(0);
    expect(r.out).toContain('"error":"auth"');
    expect(r.out).toContain("key-update-azure");
  });

  it("azure-http: a 429 is retried even for a POST", () => {
    noSleep();
    const r429 = join(TMP, "429.json");
    writeFileSync(r429, '{"message":"slow down"}');
    const r = httpRun(`azure_http_request POST "https://dev.azure.com/org/proj/_apis/wit/workitems/\\$Bug" '{"a":1}'`, {
      STUB_CURL_HTTP_CODE: "429",
      STUB_CURL_RESPONSE: r429,
    });
    expect(r.status).not.toBe(0);
    expect(curlCount()).toBe(3);
  });

  it("azure-http: a POST the caller marks idempotent (a read-only query) is retried on a 5xx", () => {
    noSleep();
    const r503 = join(TMP, "503.json");
    writeFileSync(r503, '{"message":"unavailable"}');
    const r = httpRun(`azure_http_request POST "https://dev.azure.com/org/proj/_apis/wit/wiql" '{"query":"q"}' application/json idempotent`, {
      STUB_CURL_HTTP_CODE: "503",
      STUB_CURL_RESPONSE: r503,
    });
    expect(r.status).not.toBe(0);
    expect(curlCount()).toBe(3);
  });

  it("azure-http: a PATCH that fails at the connection level is not re-sent", () => {
    noSleep();
    const r = httpRun(`azure_http_request PATCH "https://dev.azure.com/org/proj/_apis/git/pullrequests/1" '{"a":1}'`, {
      STUB_CURL_FAIL: "1",
    });
    expect(r.status).not.toBe(0);
    expect(curlCount()).toBe(1);
  });

  it("azure-http: paginate follows the x-ms-continuationtoken header through every page", () => {
    const queue = pageFiles(3);
    const r = httpRun(`azure_http_paginate "https://dev.azure.com/org/proj/_apis/build/builds"`, { STUB_CURL_PAGES: queue });
    expect(r.status).toBe(0);
    expect(jqOut(r.out, ["-c", "[.[].i]"])).toBe("[1,2,3]");
    expect(curlCount()).toBe(3);
  });

  it("azure-http: paginate with max_items stops paging once it has enough and returns exactly that many", () => {
    const queue = pageFiles(5);
    const r = httpRun(`azure_http_paginate "https://dev.azure.com/org/proj/_apis/build/builds" 2`, { STUB_CURL_PAGES: queue });
    expect(r.status).toBe(0);
    expect(jqOut(r.out, ["-c", "[.[].i]"])).toBe("[1,2]");
    expect(curlCount()).toBe(2);
  });

  it("azure-http: paginate URL-encodes a continuation token taken from the body", () => {
    writeFileSync(
      join(TMP, "stub-bin", "curl"),
      [
        "#!/usr/bin/env bash",
        'prev=""; for arg in "$@"; do [[ "$prev" == "-D" ]] && printf \'HTTP/1.1 200 OK\\r\\n\\r\\n\' > "$arg"; prev="$arg"; url="$arg"; done',
        'echo "curl $url" >> "$STUB_CALL_LOG"',
        'if [[ "$url" == *continuationToken=* ]]; then printf \'{"value":[{"i":2}]}\'; else printf \'{"value":[{"i":1}],"continuationToken":"a b/c+d"}\'; fi',
        "",
      ].join("\n"),
    );
    chmodSync(join(TMP, "stub-bin", "curl"), 0o755);
    const r = httpRun(`azure_http_paginate "https://dev.azure.com/org/proj/_apis/build/builds"`);
    expect(r.status).toBe(0);
    expect(jqOut(r.out, ["-c", "[.[].i]"])).toBe("[1,2]");
    expect(logHas("continuationToken=a%20b%2Fc%2Bd")).toBe(true);
  });

  it("azure-http: paginate retries a 429 page instead of failing the listing at once", () => {
    noSleep();
    const r429 = join(TMP, "429.json");
    writeFileSync(r429, '{"message":"slow"}');
    const r = httpRun(`azure_http_paginate "https://dev.azure.com/org/proj/_apis/build/builds"`, {
      STUB_CURL_HTTP_CODE: "429",
      STUB_CURL_RESPONSE: r429,
    });
    expect(r.status).not.toBe(0);
    expect(curlCount()).toBe(3);
  });

  it("azure-http: download writes the binary body to the destination", () => {
    const artifact = join(TMP, "artifact.bin");
    const out = join(TMP, "out.zip");
    writeFileSync(artifact, "PK\x03\x04zipbytes");
    const r = httpRun(`azure_http_download "https://dev.azure.com/org/proj/_apis/build/builds/9/artifacts?artifactName=a" "${out}"`, {
      STUB_CURL_RESPONSE: artifact,
    });
    expect(r.status).toBe(0);
    expect(spawnSync("cmp", ["-s", artifact, out]).status).toBe(0);
    expect(logHas("api-version=7.1")).toBe(true);
  });

  it("azure-http: a failed download leaves no partial file and a 401 is the typed auth error", () => {
    const body = join(TMP, "body");
    const out = join(TMP, "out.zip");
    writeFileSync(body, "nope");
    const r = httpRun(`azure_http_download "https://dev.azure.com/org/x" "${out}"`, {
      STUB_CURL_HTTP_CODE: "401",
      STUB_CURL_RESPONSE: body,
    });
    expect(r.status).not.toBe(0);
    expect(r.out).toContain("key-update-azure");
    expect(existsSync(out)).toBe(false);
  });
});
