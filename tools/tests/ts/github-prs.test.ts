// Port of tools/tests/lib/test_provider_prs.bats (18 tests): contract tests
// for the github prs domain facade. Pagination coverage rides the STUB_GH_PAGES
// queue; mutations record to STUB_GH_MUTATIONS.
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

// The fixture's gh stub: argv log, fail mode, auth token, api with pages
// queue / mutations log / canned api response.
const GH_STUB = [
  "#!/usr/bin/env bash",
  'echo "gh $*" >> "${STUB_CALL_LOG:?}"',
  'if [[ "${STUB_GH_FAIL:-0}" == "1" ]]; then',
  '  echo "stub-gh: simulated failure" >&2',
  "  exit 1",
  "fi",
  'if [[ "$1" == "auth" && "${2:-}" == "token" ]]; then',
  '  if [[ -n "${STUB_GH_AUTH_TOKEN:-}" ]]; then',
  "    printf '%s\\n' \"$STUB_GH_AUTH_TOKEN\"",
  "    exit 0",
  "  fi",
  '  echo "stub-gh: not logged in" >&2',
  "  exit 1",
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

beforeEach(() => {
  TMP = mkdtempSync(join(tmpdir(), `gprs-${Date.now()}-${Math.random().toString(36).slice(2)}`));
  const stubDir = join(TMP, "stub-bin");
  mkdirSync(stubDir, { recursive: true });
  CALL_LOG = join(TMP, "stub-calls.log");
  writeFileSync(CALL_LOG, "");
  writeFileSync(join(stubDir, "gh"), GH_STUB);
  chmodSync(join(stubDir, "gh"), 0o755);
});

const ENV = (extra: Record<string, string> = {}): Record<string, string> => ({
  ...process.env,
  TEST_TEMP_DIR: TMP,
  DEVENV_TOOLS: TOOLS,
  STUB_CALL_LOG: CALL_LOG,
  PATH: `${join(TMP, "stub-bin")}:${process.env.PATH ?? ""}`,
  ...extra,
});

// verb CALL: run a prs verb with issues+prs modules sourced.
function verb(call: string, extraEnv: Record<string, string> = {}): { status: number; out: string } {
  const r = spawnSync(
    "bash",
    [
      "-c",
      `source '${TOOLS}/lib/providers/provider-core.bash'\n` +
      `provider_detect '${join(TMP, "absent.config")}'\n` +
      `source '${TOOLS}/lib/providers/github/issues.bash'\n` +
      `source '${TOOLS}/lib/providers/github/prs.bash'\n` +
      call,
    ],
    { encoding: "utf8", env: ENV(extraEnv) },
  );
  return { status: r.status ?? 1, out: (r.stdout ?? "") + (r.stderr ?? "") };
}

// gh CLI passthrough (for direct `gh api` probes against the stub).
function gh(args: string[], extraEnv: Record<string, string> = {}): { status: number; out: string } {
  const r = spawnSync("gh", args, { encoding: "utf8", env: ENV(extraEnv) });
  return { status: r.status ?? 1, out: (r.stdout ?? "") + (r.stderr ?? "") };
}

function logHasExact(line: string): boolean {
  return readFileSync(CALL_LOG, "utf8").split("\n").some((l) => l === line);
}

function logContains(substring: string): boolean {
  return readFileSync(CALL_LOG, "utf8").includes(substring);
}

function resetLog(): void {
  writeFileSync(CALL_LOG, "");
}

function ghLastCallEquals(expected: string): { ok: boolean; out: string } {
  const last = readFileSync(CALL_LOG, "utf8").split("\n").filter((l) => l.startsWith("gh ")).at(-1) ?? "";
  if (last !== `gh ${expected}`) {
    return { ok: false, out: `gh argv mismatch\n  expected: gh ${expected}\n  actual:   ${last}` };
  }
  return { ok: true, out: "" };
}

// ===========================================================================
// Load & idempotency
// ===========================================================================

describe("prs module", () => {
  it("loads and is idempotent under re-source", () => {
    const r = spawnSync(
      "bash",
      [
        "-c",
        `source '${TOOLS}/lib/providers/provider-core.bash'\n` +
        `provider_detect '${join(TMP, "absent.config")}'\n` +
        `source '${TOOLS}/lib/providers/github/issues.bash'\n` +
        `source '${TOOLS}/lib/providers/github/prs.bash'\n` +
        `source '${TOOLS}/lib/providers/github/prs.bash'\n` +
        `declare -F provider_prs_list >/dev/null || exit 1`,
      ],
      { encoding: "utf8", env: ENV() },
    );
    expect(r.status ?? 1).toBe(0);
  });
});

// ===========================================================================
// Reads
// ===========================================================================

describe("prs reads", () => {
  it("prs list: passes -R repo and flags", () => {
    const r = verb("provider_prs_list org/repo --state open");
    expect(r.status).toBe(0);
    expect(logHasExact("gh pr list -R org/repo --state open")).toBe(true);
  });

  it("prs view: passes number and repo", () => {
    const r = verb("provider_prs_view org/repo 33");
    expect(r.status).toBe(0);
    expect(logHasExact("gh pr view 33 -R org/repo")).toBe(true);
  });

  it("prs diff: passes number and repo", () => {
    const r = verb("provider_prs_diff org/repo 33");
    expect(r.status).toBe(0);
    expect(logHasExact("gh pr diff 33 -R org/repo")).toBe(true);
  });
});

// ===========================================================================
// Pagination (mandatory per plan watch-outs)
// ===========================================================================

describe("prs pagination", () => {
  it("prs list via api comments: paginated reads consume the page queue in order", () => {
    const p1 = join(TMP, "page1.json");
    const p2 = join(TMP, "page2.json");
    writeFileSync(p1, '{"p":1}');
    writeFileSync(p2, '{"p":2}');
    const queue = join(TMP, "pages.queue");
    writeFileSync(queue, `${p1}\n${p2}\n`);
    const pages = { STUB_GH_PAGES: queue };

    const first = gh(["api", "repos/org/repo/issues/1/comments", "--paginate"], pages);
    expect(first.status).toBe(0);
    expect(first.out.trim()).toBe('{"p":1}');

    const second = gh(["api", "repos/org/repo/issues/1/comments", "--paginate"], pages);
    expect(second.status).toBe(0);
    expect(second.out.trim()).toBe('{"p":2}');

    // queue exhausted -> stub fails with a defined error
    const third = gh(["api", "repos/org/repo/issues/1/comments", "--paginate"], pages);
    expect(third.status).not.toBe(0);
  });
});

// ===========================================================================
// Mutations
// ===========================================================================

describe("prs mutations", () => {
  it("prs create: passes title/body/head/base and repo", () => {
    const r = verb('provider_prs_create org/repo --title "T" --body "B" --head h --base main');
    expect(r.status).toBe(0);
    expect(logHasExact("gh pr create -R org/repo --title T --body B --head h --base main")).toBe(true);
  });

  it("prs merge: rebase + delete-branch defaults pass through", () => {
    const r = verb("provider_prs_merge org/repo 33 --rebase --delete-branch");
    expect(r.status).toBe(0);
    expect(logHasExact("gh pr merge 33 -R org/repo --rebase --delete-branch")).toBe(true);
  });

  it("prs merge: not issued when number is missing", () => {
    const r = verb("provider_prs_merge org/repo");
    expect(r.status).not.toBe(0);
    expect(readFileSync(CALL_LOG, "utf8")).not.toMatch(/^gh /m);
  });

  it("prs comment: passes number and body", () => {
    const r = verb('provider_prs_comment org/repo 33 --comment-body "note"');
    expect(r.status).toBe(0);
    expect(logHasExact("gh pr comment 33 -R org/repo --comment-body note")).toBe(true);
  });

  it("prs thread reply: POSTs to the REST replies endpoint", () => {
    const mutations = join(TMP, "mutations.log");
    writeFileSync(mutations, "");
    const r = verb('provider_prs_thread_reply org/repo 33 555 "reply text"', { STUB_GH_MUTATIONS: mutations });
    expect(r.status).toBe(0);
    const log = readFileSync(mutations, "utf8");
    expect(log).toContain("POST");
    expect(log).toContain("/repos/org/repo/pulls/33/comments/555/replies");
  });
});

// ===========================================================================
// Arg-order guards + GraphQL shapes
// ===========================================================================

describe("prs arg-order guards", () => {
  it("prs view: bare number first arg is the number, not a repo (regex guard)", () => {
    resetLog();
    verb('provider_prs_view "42" --json url');
    const r = ghLastCallEquals("pr view 42 --json url");
    expect(r.ok, r.out).toBe(true);
  });

  it("prs view: repo-first shape unchanged (guard regression guard)", () => {
    resetLog();
    verb('provider_prs_view "org/repo" "42" --json url');
    const r = ghLastCallEquals("pr view 42 --json url -R org/repo");
    expect(r.ok, r.out).toBe(true);
  });
});

describe("prs thread GraphQL + REST shapes", () => {
  it("thread resolve: variables-based mutation, emits isResolved", () => {
    // The source suite tolerates the transport outcome here (its assertion is
    // `|| echo`); the lock is the call shape: variables-based mutation.
    resetLog();
    verb("provider_prs_thread_resolve PRRT_kwDOAbc123");
    expect(logContains("graphql -f query=mutation($threadId: ID!)")).toBe(true);
    expect(logContains("threadId=PRRT_kwDOAbc123")).toBe(true);
  });

  it("thread resolve: empty thread id fails defined", () => {
    const r = verb('provider_prs_thread_resolve ""');
    expect(r.status).not.toBe(0);
    expect(r.out).toContain("required");
  });

  it("thread reply: repo/pr/comment/body validated, POST emitted", () => {
    resetLog();
    verb('provider_prs_thread_reply "org/repo" "9" "555" "reply body" > /dev/null');
    const r = ghLastCallEquals("api -X POST /repos/org/repo/pulls/9/comments/555/replies -f body=reply body");
    expect(r.ok, r.out).toBe(true);
  });

  it("thread reply: malformed repo fails defined", () => {
    const r = verb('provider_prs_thread_reply "norepo" "9" "555" "body"');
    expect(r.status).not.toBe(0);
  });

  it("threads page: builds owner/repo/pr variables; cursor optional", () => {
    resetLog();
    verb('provider_prs_threads_page "org/repo" "9" "CUR1" > /dev/null');
    expect(logContains("graphql -f query=query($owner: String!")).toBe(true);
    expect(logContains("-f owner=org")).toBe(true);
    expect(logContains("-f repo=repo")).toBe(true);
    expect(logContains("-F pr=9")).toBe(true);
    expect(logContains("-f cursor=CUR1")).toBe(true);
  });

  it("threads page: numeric pr enforced", () => {
    const r = verb('provider_prs_threads_page "org/repo" "abc"');
    expect(r.status).not.toBe(0);
  });
});
