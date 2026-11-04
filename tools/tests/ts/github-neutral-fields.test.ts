// Port of tools/tests/lib/test_github_neutral_fields.bats (14 tests): GitHub
// verbs speak the seam's field names, not gh's — repoSpec for a repository's
// nameWithOwner, id for a run's databaseId, url for a comment's html_url. The
// verb maps the names on the way to gh, renames them on the way back, and
// applies any -q program to the neutral records.
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
let RESPONSE = "";

// Recording gh stub: logs argv, emits the canned response file.
const GH_STUB = `#!/usr/bin/env bash
printf 'gh %s\\n' "$*" >> "$GH_CALL_LOG"
cat "$GH_RESPONSE"
`;

beforeEach(() => {
  TMP = mkdtempSync(join(tmpdir(), `gnf-${Date.now()}-${Math.random().toString(36).slice(2)}`));
  const bin = join(TMP, "bin");
  mkdirSync(bin, { recursive: true });
  CALL_LOG = join(TMP, "gh.log");
  RESPONSE = join(TMP, "response.json");
  writeFileSync(CALL_LOG, "");
  writeFileSync(RESPONSE, "");
  writeFileSync(join(bin, "gh"), GH_STUB);
  chmodSync(join(bin, "gh"), 0o755);
});

function respond(json: string): void {
  writeFileSync(RESPONSE, json);
}

function logHas(substring: string): boolean {
  return readFileSync(CALL_LOG, "utf8").includes(substring);
}

// gh_verb CALL: run a github verb with repos/issues/prs/pipelines sourced.
function ghVerb(call: string): { status: number; out: string } {
  const r = spawnSync(
    "bash",
    [
      "-c",
      `source '${TOOLS}/lib/error-handling.bash'\n` +
      `source '${TOOLS}/lib/providers/provider-core.bash'\n` +
      `PROVIDER_NAME=github\n` +
      `source '${TOOLS}/lib/providers/github/repos.bash'\n` +
      `source '${TOOLS}/lib/providers/github/issues.bash'\n` +
      `source '${TOOLS}/lib/providers/github/prs.bash'\n` +
      `source '${TOOLS}/lib/providers/github/pipelines.bash'\n` +
      call,
    ],
    {
      encoding: "utf8",
      env: {
        ...process.env,
        GH_CALL_LOG: CALL_LOG,
        GH_RESPONSE: RESPONSE,
        PATH: `${join(TMP, "bin")}:${process.env.PATH ?? ""}`,
      },
    },
  );
  return { status: r.status ?? 1, out: (r.stdout ?? "") + (r.stderr ?? "") };
}

function jq(json: string, expr: string, flags: string[] = ["-r"]): string {
  return (spawnSync("jq", [...flags, expr], { input: json, encoding: "utf8" }).stdout ?? "").trim();
}

function jqOk(json: string, expr: string): boolean {
  return (spawnSync("jq", ["-e", expr], { input: json, stdio: "ignore" }).status ?? 1) === 0;
}

// ---------------------------------------------------------------------------
// repoSpec <-> nameWithOwner
// ---------------------------------------------------------------------------

describe("neutral fields: repoSpec", () => {
  it("repos view --json repoSpec asks gh for nameWithOwner and returns repoSpec", () => {
    respond('{"nameWithOwner":"acme/widgets","name":"widgets"}');
    const r = ghVerb("provider_repos_view acme/widgets --json repoSpec,name");
    expect(r.status).toBe(0);
    expect(logHas("--json nameWithOwner,name")).toBe(true);
    expect(jq(r.out, ".", ["-c"])).toBe('{"repoSpec":"acme/widgets","name":"widgets"}');
  });

  it("repos view -q applies to the neutral record: .repoSpec", () => {
    respond('{"nameWithOwner":"acme/widgets"}');
    const r = ghVerb("provider_repos_view acme/widgets --json repoSpec -q .repoSpec");
    expect(r.status).toBe(0);
    expect(r.out.trim()).toBe("acme/widgets");
  });

  it("repos list maps repoSpec in every record", () => {
    respond('[{"nameWithOwner":"acme/a"},{"nameWithOwner":"acme/b"}]');
    const r = ghVerb("provider_repos_list acme --limit 10 --json repoSpec -q '.[].repoSpec'");
    expect(r.status).toBe(0);
    expect(r.out.trim()).toBe("acme/a\nacme/b");
    expect(logHas("--json nameWithOwner")).toBe(true);
  });

  it("repos view without --json passes straight through to gh", () => {
    respond("plain text view");
    const r = ghVerb("provider_repos_view acme/widgets");
    expect(r.status).toBe(0);
    expect(r.out.trim()).toBe("plain text view");
  });
});

// ---------------------------------------------------------------------------
// id <-> databaseId (runs)
// ---------------------------------------------------------------------------

describe("neutral fields: id (runs)", () => {
  it("run list --json id asks gh for databaseId and returns id", () => {
    respond('[{"databaseId":9001,"status":"completed"}]');
    const r = ghVerb("provider_pipelines_run_list acme/widgets --branch main --json id,status");
    expect(r.status).toBe(0);
    expect(logHas("--json databaseId,status")).toBe(true);
    expect(jq(r.out, ".", ["-c"])).toBe('[{"id":9001,"status":"completed"}]');
  });

  it("run list -q applies to the neutral records: .[0].id", () => {
    respond('[{"databaseId":9001},{"databaseId":9000}]');
    const r = ghVerb("provider_pipelines_run_list acme/widgets --json id -q '.[0].id'");
    expect(r.status).toBe(0);
    expect(r.out.trim()).toBe("9001");
  });

  it("run list keeps gh's other fields and the status filter flags", () => {
    respond("[]");
    const r = ghVerb("provider_pipelines_run_list acme/widgets --branch main --limit 5 --json id,status,conclusion");
    expect(r.status).toBe(0);
    expect(logHas("--branch main")).toBe(true);
    expect(logHas("--limit 5")).toBe(true);
  });

  it("run view --json id maps too", () => {
    respond('{"databaseId":9001,"url":"https://github.com/acme/widgets/actions/runs/9001"}');
    const r = ghVerb("provider_pipelines_run_view acme/widgets 9001 --json id,url -q .id");
    expect(r.status).toBe(0);
    expect(r.out.trim()).toBe("9001");
    expect(logHas("--json databaseId,url")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// url <-> html_url (comments)
// ---------------------------------------------------------------------------

describe("neutral fields: url (comments)", () => {
  it("comment_get returns the comment's web address as url, not html_url", () => {
    respond('{"id":911,"html_url":"https://github.com/o/r/issues/1#issuecomment-911","url":"https://api.github.com/x","body":"x"}');
    const r = ghVerb("provider_issues_comment_get o/r 911");
    expect(r.status).toBe(0);
    expect(jq(r.out, ".url")).toBe("https://github.com/o/r/issues/1#issuecomment-911");
    expect(jq(r.out, 'has("html_url")')).toBe("false");
  });

  it("comment_add and comment_edit return url too", () => {
    respond('{"id":1,"html_url":"https://github.com/o/r/issues/1#issuecomment-1"}');
    const add = ghVerb("provider_issues_comment_add o/r 1 --body hi");
    expect(jq(add.out, ".url")).toBe("https://github.com/o/r/issues/1#issuecomment-1");
    const edit = ghVerb("provider_issues_comment_edit o/r 1 --body hi");
    expect(jq(edit.out, ".url")).toBe("https://github.com/o/r/issues/1#issuecomment-1");
  });

  it("comments (the list) maps every record", () => {
    respond('[{"id":1,"html_url":"https://x/1"},{"id":2,"html_url":"https://x/2"}]');
    const r = ghVerb('provider_issues_comments "" 7 o/r');
    expect(r.status).toBe(0);
    expect(jq(r.out, "[.[].url]", ["-c"])).toBe('["https://x/1","https://x/2"]');
  });

  it("a paginated comments list (several arrays) is mapped array by array", () => {
    respond('[{"id":1,"html_url":"https://x/1"}][{"id":2,"html_url":"https://x/2"}]');
    const r = ghVerb('provider_issues_comments "" 7 o/r');
    expect(r.status).toBe(0);
    expect(jq(r.out, "[.[][].url]", ["-sc"])).toBe('["https://x/1","https://x/2"]');
  });

  it("thread_reply returns url", () => {
    respond('{"id":5,"html_url":"https://github.com/o/r/pull/1#discussion_r5"}');
    const r = ghVerb("provider_prs_thread_reply o/r 1 99 hello");
    expect(r.status).toBe(0);
    expect(jq(r.out, ".url")).toBe("https://github.com/o/r/pull/1#discussion_r5");
  });
});

// ---------------------------------------------------------------------------
// comment id and node id in a review-thread page
// ---------------------------------------------------------------------------

describe("neutral fields: review threads", () => {
  it("threads page: a comment's id is the reply id (databaseId) and nodeId the GraphQL node id", () => {
    respond(
      '{"data":{"repository":{"pullRequest":{"reviewThreads":{"pageInfo":{"hasNextPage":false,"endCursor":null},"nodes":[{"id":"T1","isResolved":false,"comments":{"nodes":[{"id":"PRRC_node","databaseId":42,"body":"b","author":{"login":"a"}}]}}]}}}}}',
    );
    const r = ghVerb("provider_prs_threads_page acme/r 5");
    expect(r.status).toBe(0);
    expect(
      jqOk(
        r.out,
        '.data.repository.pullRequest.reviewThreads.nodes[0].comments.nodes[0] | .id == 42 and .nodeId == "PRRC_node" and (has("databaseId") | not)',
      ),
    ).toBe(true);
    // the thread's own id is untouched: pr-thread-resolve takes it
    expect(jq(r.out, ".data.repository.pullRequest.reviewThreads.nodes[0].id")).toBe("T1");
  });
});
