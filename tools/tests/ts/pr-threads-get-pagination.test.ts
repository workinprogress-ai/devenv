// Port of tools/tests/scripts/test_pr_threads_get_pagination.bats (4 tests).
// Pagination behavior of pr-threads-get: the manual GraphQL pagination loop
// through a paginated gh fixture — multi-page traversal merges both pages'
// threads; a single page short-circuits with exactly one gh call; a gh failure
// mid-pagination surfaces non-zero; the unresolved-only filter drops resolved
// threads (--all keeps them).
import { beforeEach, describe, expect, it, vi } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const ROOT = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))));
const TOOLS = join(ROOT, "tools");
const SCRIPT = join(TOOLS, "pr-threads-get");

let TMP = "";
let CALL_LOG = "";
let TEST_REPO = "";

// Build a GraphQL response page with one thread and the given pageInfo.
// Usage: makePage(threadId, hasNext, cursorJson)
function makePage(threadId: string, hasNext: boolean, cursor: string | null): string {
  return `{"data":{"repository":{"pullRequest":{"reviewThreads":{
    "pageInfo":{"hasNextPage":${hasNext},"endCursor":${cursor}},
    "nodes":[{"id":"${threadId}","isResolved":false,"path":"src/a.ts","line":10,
              "startLine":10,"diffSide":"RIGHT",
              "comments":{"nodes":[{"id":"c_${threadId}","databaseId":42,
                                    "author":{"login":"reviewer"},
                                    "body":"fix this","createdAt":"2026-01-01T00:00:00Z",
                                    "url":"https://example.invalid/c/42"}]}}]
}}}}}`;
}

function writeTmp(name: string, content: string): string {
  const f = join(TMP, name);
  writeFileSync(f, content);
  return f;
}

beforeEach(() => {
  TMP = mkdtempSync(join(tmpdir(), `prtpg-${Date.now()}-${Math.random().toString(36).slice(2)}`));
  CALL_LOG = join(TMP, "stub-calls.log");
  writeFileSync(CALL_LOG, "");
  // The helper's sandboxed config: github provider.
  const root = join(TMP, "devenv-root");
  mkdirSync(root, { recursive: true });
  writeFileSync(
    join(root, "devenv.config"),
    "[provider]\nname=github\n\n[organization]\nname=Test Organization\norg=test-org\nemail_domain=test.example.com\n\n[workflows]\nstatus_workflow=TBD,To-Groom,Ready,Implementing,Review,Merged,Staging,Production\n",
  );
  const bin = join(TMP, "stub-bin");
  mkdirSync(bin, { recursive: true });
  // Recording stub: logs every argv; `gh auth token` succeeds; `gh api graphql`
  // answers from the STUB_GH_PAGES queue (pops one page per call, fails when
  // exhausted); other api calls answer STUB_GH_API_RESPONSE or empty.
  writeFileSync(
    join(bin, "gh"),
    [
      "#!/usr/bin/env bash",
      'echo "gh $*" >> "${STUB_CALL_LOG:?}"',
      'if [[ "${STUB_GH_FAIL:-0}" == "1" ]]; then echo "stub-gh: simulated failure" >&2; exit 1; fi',
      'if [[ "$1" == "auth" && "${2:-}" == "token" ]]; then',
      '  [ -n "${STUB_GH_AUTH_TOKEN:-}" ] && printf "%s\\n" "$STUB_GH_AUTH_TOKEN"',
      "  exit 0",
      "fi",
      'if [[ "$1" == "api" ]]; then',
      '  if [[ -n "${STUB_GH_PAGES:-}" && -f "${STUB_GH_PAGES}" ]]; then',
      '    if [[ -s "$STUB_GH_PAGES" ]]; then',
      '      page_file=$(head -n 1 "$STUB_GH_PAGES")',
      '      tail -n +2 "$STUB_GH_PAGES" > "$STUB_GH_PAGES.tmp" && mv "$STUB_GH_PAGES.tmp" "$STUB_GH_PAGES"',
      '      [[ -f "$page_file" ]] && cat "$page_file"',
      "      exit 0",
      "    fi",
      '    echo "stub-gh: pagination queue exhausted" >&2',
      "    exit 1",
      "  fi",
      '  [[ -f "${STUB_GH_API_RESPONSE:-/nonexistent}" ]] && cat "${STUB_GH_API_RESPONSE}"',
      "  exit 0",
      "fi",
      "exit 0",
      "",
    ].join("\n"),
  );
  spawnSync("chmod", ["+x", join(bin, "gh")]);
  // checkTargetRepo requires a real git repo (git rev-parse must pass),
  // so run from a real temp repo; the gh stub keeps the API hermetic.
  TEST_REPO = join(TMP, "repo");
  spawnSync("git", ["init", "-q", TEST_REPO]);
});

const { DEVENV_REPO: _dr, ...procEnv } = process.env;

function env(extra: Record<string, string> = {}): Record<string, string> {
  return {
    ...procEnv,
    STUB_CALL_LOG: CALL_LOG,
    DEVENV_TOOLS: TOOLS,
    DEVENV_ROOT: join(TMP, "devenv-root"),
    DEVENV_ROOT_SET: "1",
    DEVENV_REPO: "test-org/test-repo",
    PATH: `${join(TMP, "stub-bin")}:${procEnv.PATH ?? ""}`,
    ...extra,
  };
}

function apiCallCount(): number {
  const r = spawnSync("grep", ["-c", "^gh api graphql", CALL_LOG], { encoding: "utf8" });
  return Number.parseInt((r.stdout ?? "0").trim(), 10) || 0;
}

function callsContain(sub: string): boolean {
  return spawnSync("grep", ["-qF", "--", sub, CALL_LOG]).status === 0;
}

function runThreadsGet(args: string[], extraEnv: Record<string, string> = {}): { status: number; out: string } {
  const r = spawnSync(SCRIPT, args, { cwd: TEST_REPO, encoding: "utf8", env: env(extraEnv) });
  return { status: r.status ?? 1, out: (r.stdout ?? "") + (r.stderr ?? "") };
}

function fillQueue(pages: string[]): void {
  writeFileSync(join(TMP, "pages.txt"), pages.map((p) => `${p}\n`).join(""));
}

describe("scripts/pr-threads-get-pagination", () => {
  it("pagination: multi-page traversal merges all pages' threads", () => {
    fillQueue([
      writeTmp("p1.json", makePage("T1", true, '"CURSOR_1"')),
      writeTmp("p2.json", makePage("T2", false, "null")),
    ]);
    const r = runThreadsGet(["42"], { STUB_GH_PAGES: join(TMP, "pages.txt") });
    expect(r.status).toBe(0);
    expect(r.out).toContain('"id":"T1"');
    expect(r.out).toContain('"id":"T2"');
    // Two pagination calls (the auth preflight is excluded from the count)
    expect(apiCallCount()).toBe(2);
    // Second call carried the cursor from page 1
    expect(callsContain("cursor=CURSOR_1")).toBe(true);
  });

  it("pagination: single page short-circuits with exactly one gh call", () => {
    fillQueue([writeTmp("p1.json", makePage("T1", false, "null"))]);
    const r = runThreadsGet(["42"], { STUB_GH_PAGES: join(TMP, "pages.txt") });
    expect(r.status).toBe(0);
    expect(r.out).toContain('"id":"T1"');
    expect(apiCallCount()).toBe(1);
    // No cursor was sent on the only call
    expect(callsContain("cursor=")).toBe(false);
  });

  it("pagination: mid-pagination gh failure exits non-zero", () => {
    // Page 1 says more pages exist; the stub queue then exhausts and fails,
    // which the script must surface as a non-zero exit, not silently return
    // a truncated result.
    fillQueue([writeTmp("p1.json", makePage("T1", true, '"CURSOR_1"'))]);
    const r = runThreadsGet(["42"], { STUB_GH_PAGES: join(TMP, "pages.txt") });
    expect(r.status).not.toBe(0);
  });

  it("pagination: unresolved-only filter drops resolved threads", () => {
    const p1 = writeTmp(
      "p1.json",
      [
        '{"data":{"repository":{"pullRequest":{"reviewThreads":{',
        '    "pageInfo":{"hasNextPage":false,"endCursor":null},',
        '    "nodes":[{"id":"T_RESOLVED","isResolved":true,"path":"src/a.ts","line":10,',
        '              "startLine":10,"diffSide":"RIGHT","comments":{"nodes":[]}},',
        '             {"id":"T_OPEN","isResolved":false,"path":"src/b.ts","line":20,',
        '              "startLine":20,"diffSide":"RIGHT","comments":{"nodes":[]}}]',
        "}}}}}",
      ].join("\n"),
    );
    fillQueue([p1]);
    let r = runThreadsGet(["42"], { STUB_GH_PAGES: join(TMP, "pages.txt") });
    expect(r.status).toBe(0);
    expect(r.out).toContain('"id":"T_OPEN"');
    expect(r.out).not.toContain("T_RESOLVED");
    // Re-fill the queue (the first run consumed the page), then --all keeps
    // both threads.
    fillQueue([p1]);
    r = runThreadsGet(["--all", "42"], { STUB_GH_PAGES: join(TMP, "pages.txt") });
    expect(r.status).toBe(0);
    expect(r.out).toContain('"id":"T_RESOLVED"');
    expect(r.out).toContain('"id":"T_OPEN"');
  });
});
