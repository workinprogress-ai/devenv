// Port of tools/tests/lib/test_github_failure_propagation.bats (11 tests) —
// one vitest `it` per source `@test`. A gh failure must reach the caller:
// `gh … | jq` returns jq's status, so an auth/network failure used to read as
// an empty-but-successful answer; and a GraphQL page cap that truncates
// silently makes a partial answer look complete.
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
let GH_RESPONSE = "";

const GH_STUB = [
  "#!/usr/bin/env bash",
  "printf 'gh %s\\n' \"$*\" >> \"$GH_CALL_LOG\"",
  'if [ -n "${GH_FAIL:-}" ]; then echo "HTTP 401: bad credentials" >&2; exit 1; fi',
  'cat "$GH_RESPONSE"',
  "",
].join("\n");

beforeEach(() => {
  TMP = mkdtempSync(join(tmpdir(), `ghfail-${Date.now()}-${Math.random().toString(36).slice(2)}`));
  GH_RESPONSE = join(TMP, "response.json");
  mkdirSync(join(TMP, "bin"), { recursive: true });
  writeFileSync(join(TMP, "gh.log"), "");
  writeFileSync(GH_RESPONSE, "");
  writeFileSync(join(TMP, "bin", "gh"), GH_STUB);
  chmodSync(join(TMP, "bin", "gh"), 0o755);
});

const ENV = (extra: Record<string, string> = {}): Record<string, string> => ({
  ...process.env,
  DEVENV_TOOLS: TOOLS,
  GH_CALL_LOG: join(TMP, "gh.log"),
  GH_RESPONSE,
  PATH: `${join(TMP, "bin")}:${process.env.PATH ?? ""}`,
  ...extra,
});

// gh_verb <call> [extraEnv]: run one github provider verb with the
// capabilities declared (the source suite's helper as a spawn).
function ghVerb(call: string, extraEnv: Record<string, string> = {}): { status: number; out: string } {
  const script =
    `source '${TOOLS}/lib/error-handling.bash'\n` +
    `source '${TOOLS}/lib/providers/provider-core.bash'\n` +
    `PROVIDER_NAME=github\n` +
    ["repos", "issues", "org", "projects", "prs"]
      .map((m) => `source '${TOOLS}/lib/providers/github/${m}.bash'\n`)
      .join("") +
    `${call}\n`;
  const r = spawnSync("bash", ["-c", script], { encoding: "utf8", env: ENV(extraEnv) });
  return { status: r.status ?? 1, out: (r.stdout ?? "") + (r.stderr ?? "") };
}

// jq -c over an expression, for output-shape assertions.
function jqCompact(json: string, expr: string): string {
  const r = spawnSync("jq", ["-c", expr], { input: json, encoding: "utf8" });
  return (r.stdout ?? "").trim();
}

describe("github failure propagation", () => {
  it("provider_org_issue_types fails when gh fails, instead of returning an empty list", () => {
    const r = ghVerb("provider_org_issue_types some-org", { GH_FAIL: "1" });
    expect(r.status).not.toBe(0);
  });

  it("provider_org_issue_types fails on a GraphQL error payload", () => {
    writeFileSync(GH_RESPONSE, '{"errors":[{"message":"Could not resolve to an Organization"}]}');
    const r = ghVerb("provider_org_issue_types some-org");
    expect(r.status).not.toBe(0);
    expect(r.out).toContain("Could not resolve");
  });

  it("provider_org_issue_types maps the types it is given", () => {
    writeFileSync(
      GH_RESPONSE,
      '{"data":{"organization":{"issueTypes":{"edges":[{"node":{"id":"T1","name":"Bug"}},{"node":{"id":"T2","name":"Task"}}],"pageInfo":{"hasNextPage":false}}}}}',
    );
    const r = ghVerb("provider_org_issue_types some-org");
    expect(r.status).toBe(0);
    expect(jqCompact(r.out, "[.[].name]")).toBe('["Bug","Task"]');
  });

  it("provider_org_issue_types warns when the 100-type page cap truncated the list", () => {
    writeFileSync(
      GH_RESPONSE,
      '{"data":{"organization":{"issueTypes":{"edges":[{"node":{"id":"T1","name":"Bug"}}],"pageInfo":{"hasNextPage":true}}}}}',
    );
    const r = ghVerb("provider_org_issue_types some-org");
    expect(r.status).toBe(0);
    expect(r.out).toContain("more than 100");
  });

  it("fetch_org_issue_type_ids fails when the type lookup fails", () => {
    const script =
      `source '${TOOLS}/lib/error-handling.bash'\n` +
      `source '${TOOLS}/lib/providers/provider-core.bash'\n` +
      `PROVIDER_NAME=github\n` +
      `source '${TOOLS}/lib/providers/github/repos.bash'\n` +
      `source '${TOOLS}/lib/providers/github/issues.bash'\n` +
      `source '${TOOLS}/lib/providers/github/org.bash'\n` +
      `source '${TOOLS}/lib/issues-config.bash'\n` +
      `fetch_org_issue_type_ids some-org\n`;
    const r = spawnSync("bash", ["-c", script], { encoding: "utf8", env: ENV({ GH_FAIL: "1" }) });
    expect(r.status).not.toBe(0);
  });

  it("provider_projects_for_issue warns when the issue's project list hit its page cap", () => {
    writeFileSync(
      GH_RESPONSE,
      '{"data":{"resource":{"projectItems":{"pageInfo":{"hasNextPage":true},"nodes":[{"project":{"id":"P","number":1,"title":"Board","owner":{"login":"acme"}},"fieldValues":{"pageInfo":{"hasNextPage":false},"nodes":[]}}]}}}}',
    );
    const r = ghVerb("provider_projects_for_issue https://github.com/acme/r/issues/1 acme");
    expect(r.status).toBe(0);
    expect(r.out).toContain("more projects than the query returns");
  });

  it("provider_projects_for_issue warns when an item's field values hit their page cap", () => {
    writeFileSync(
      GH_RESPONSE,
      '{"data":{"resource":{"projectItems":{"pageInfo":{"hasNextPage":false},"nodes":[{"project":{"id":"P","number":1,"title":"Board","owner":{"login":"acme"}},"fieldValues":{"pageInfo":{"hasNextPage":true},"nodes":[]}}]}}}}',
    );
    const r = ghVerb("provider_projects_for_issue https://github.com/acme/r/issues/1 acme");
    expect(r.out).toContain("more field values than the query returns");
  });

  it("provider_projects_for_issue fails on a GraphQL error payload", () => {
    writeFileSync(GH_RESPONSE, '{"errors":[{"message":"Resource not accessible"}]}');
    const r = ghVerb("provider_projects_for_issue https://github.com/acme/r/issues/1 acme");
    expect(r.status).not.toBe(0);
  });

  it("provider_projects_for_issue still lists each project with its Status", () => {
    writeFileSync(
      GH_RESPONSE,
      '{"data":{"resource":{"projectItems":{"pageInfo":{"hasNextPage":false},"nodes":[{"project":{"id":"P","number":7,"title":"Board","owner":{"login":"acme"}},"fieldValues":{"pageInfo":{"hasNextPage":false},"nodes":[{"__typename":"ProjectV2ItemFieldSingleSelectValue","name":"Review","field":{"name":"Status"}}]}}]}}}}',
    );
    const r = ghVerb("provider_projects_for_issue https://github.com/acme/r/issues/1 acme");
    expect(r.status).toBe(0);
    expect(r.out.trim()).toBe("Board\t7\tReview");
  });

  it("provider_prs_threads_page warns when a thread has more comments than the query returns", () => {
    writeFileSync(
      GH_RESPONSE,
      '{"data":{"repository":{"pullRequest":{"reviewThreads":{"pageInfo":{"hasNextPage":false,"endCursor":null},"nodes":[{"id":"T1","comments":{"pageInfo":{"hasNextPage":true},"nodes":[]}}]}}}}}',
    );
    const r = ghVerb("provider_prs_threads_page acme/r 5");
    expect(r.status).toBe(0);
    expect(r.out).toContain("more comments than the query returns");
  });

  it("provider_prs_threads_page fails when gh fails", () => {
    const r = ghVerb("provider_prs_threads_page acme/r 5", { GH_FAIL: "1" });
    expect(r.status).not.toBe(0);
  });
});
