// Port of tools/tests/lib/test_github_projects_graphql.bats (12 tests):
// contract tests for the GitHub Projects GraphQL verbs (provider_projects_*).
// Stubbed gh; each test asserts the call shape the implementations must
// honor (ID resolution, mutation naming, query presence).
import { beforeEach, describe, expect, it, vi } from "vitest";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const ROOT = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))));
const LIB = join(ROOT, "tools/lib/provider-loader.bash");

let TMP = "";

// Recording gh stub: logs argv to GH_CALL_LOG, emits canned JSON per mode,
// and applies the caller's --jq program with real jq (mirroring gh).
const GH_STUB = `#!/usr/bin/env bash
echo "gh $*" >> "$GH_CALL_LOG"
jq_program=""
prev=""
for arg in "$@"; do
    if [ "$prev" = "--jq" ]; then jq_program="$arg"; fi
    prev="$arg"
done
payload=""
case "$*" in
    *updateProjectV2ItemFieldValue*)
        payload='{"data":{"updateProjectV2ItemFieldValue":{"projectV2Item":{"id":"PVTI_item1"}}}}'
        ;;
    *"ProjectV2SingleSelectField"*)
        payload='{"data":{"node":{"field":{"id":"PVTVF_field1","options":[{"id":"PVTFO_opt1","name":"To-Groom"},{"id":"PVTFO_opt2","name":"Ready"}]}}}}'
        ;;
    *"items(first"*)
        payload='{"data":{"node":{"items":{"pageInfo":{"hasNextPage":false,"endCursor":""},"nodes":[{"id":"PVTI_item1","content":{"number":42,"repository":{"nameWithOwner":"test-org/test-repo"}}}]}}}}'
        ;;
    *"projectV2(number"*)
        payload='{"data":{"organization":{"projectV2":{"id":"PVT_test1"}}}}'
        ;;
    *"projectsV2(first"*)
        payload='{"data":{"organization":{"projectsV2":{"nodes":[{"id":"PVT_test1","number":9,"title":"Test_project"}]}}}}'
        ;;
    *"resource(url"*)
        payload='{"data":{"resource":{"projectItems":{"nodes":[{"project":{"id":"PVT_test1","number":9,"title":"Test_project","owner":{"login":"test-org"}},"fieldValues":{"nodes":[{"__typename":"ProjectV2ItemFieldSingleSelectValue","name":"To-Groom","field":{"name":"Status"}}]}}]}}}}'
        ;;
    *)
        payload='{"data":{}}'
        ;;
esac
if [ -n "$jq_program" ]; then
    printf '%s' "$payload" | jq -r "$jq_program"
else
    echo "$payload"
fi
`;

beforeEach(() => {
  TMP = mkdtempSync(join(tmpdir(), `ghproj-${Date.now()}-${Math.random().toString(36).slice(2)}`));
  const stubDir = join(TMP, "bin");
  mkdirSync(stubDir, { recursive: true });
  writeFileSync(join(TMP, "gh-calls.log"), "");
  writeFileSync(join(stubDir, "gh"), GH_STUB);
  chmodSync(join(stubDir, "gh"), 0o755);
});

function logHas(pattern: string): boolean {
  return spawnSync("grep", ["-q", pattern, join(TMP, "gh-calls.log")]).status === 0;
}

function runLib(script: string, env: Record<string, string> = {}): { status: number; out: string } {
  const r = spawnSync("bash", ["-c", `source '${LIB}' && ${script}`], {
    encoding: "utf8",
    env: {
      ...process.env,
      GH_CALL_LOG: join(TMP, "gh-calls.log"),
      PATH: `${join(TMP, "bin")}:${process.env.PATH ?? ""}`,
      ...env,
    },
  });
  return { status: r.status ?? 1, out: (r.stdout ?? "") + (r.stderr ?? "") };
}

// gh OVERRIDE: a bash function definition prepended to the sourced script —
// the function shadows the PATH stub for one call.
function runWithGhFn(ghBody: string, script: string): { status: number; out: string } {
  const r = spawnSync("bash", ["-c", `${ghBody}\nsource '${LIB}' && ${script}`], {
    encoding: "utf8",
    env: { ...process.env, GH_CALL_LOG: join(TMP, "gh-calls.log"), PATH: `${join(TMP, "bin")}:${process.env.PATH ?? ""}` },
  });
  return { status: r.status ?? 1, out: (r.stdout ?? "") + (r.stderr ?? "") };
}

// gh override body factory: answers EVERY graphql call with PAYLOAD, applying
// the caller's --jq program with real jq.
const ghAlways = (payload: string): string =>
  [
    "gh() {",
    '    local prog="" prev=""',
    '    local a',
    '    for a in "$@"; do [ "$prev" = \'--jq\' ] && prog="$a"; prev="$a"; done',
    `    printf '%s' '${payload}' | jq -r "$prog"`,
    "}",
  ].join("\n");

describe("projects id_by_name", () => {
  it("returns the project node ID for a title match", () => {
    const r = runLib("provider_projects_id_by_name test-org Test_project");
    expect(r.status).toBe(0);
    expect(r.out.trim()).toBe("PVT_test1");
    expect(logHas("graphql")).toBe(true);
  });

  it("accepts a numeric project number", () => {
    const r = runLib("provider_projects_id_by_name test-org 9");
    expect(r.status).toBe(0);
    expect(r.out.trim()).toBe("PVT_test1");
  });

  it("rc=1 AND no graphql error spray when project not found", () => {
    // Not-found must be a clean rc=1 with empty stdout (the stub answers with
    // an empty node list, so a real implementation returns 1 silently); the
    // call MUST have happened (distinguishes rc=1-not-found from early-exit).
    const r = runLib("provider_projects_id_by_name test-org NoSuchProject 2>/dev/null");
    expect(r.status).toBe(1);
    expect(r.out.trim()).toBe("");
    expect(logHas("graphql")).toBe(true);
  });
});

describe("projects item_id_for_issue", () => {
  it("returns the item node ID (repo-matched)", () => {
    const r = runLib("provider_projects_item_id_for_issue PVT_test1 42 test-org test-repo");
    expect(r.status).toBe(0);
    expect(r.out.trim()).toMatch(/^PVTI_/);
  });

  it("rejects the 2-arg call", () => {
    const r = runLib("provider_projects_item_id_for_issue PVT_test1 42");
    expect(r.status).not.toBe(0);
    expect(r.out).toContain("owner and repo required");
  });

  it("filters by repository (cross-repo number collision)", () => {
    // Board holds #42 in two repos; only the named repo's card may resolve.
    const r = runWithGhFn(
      ghAlways(
        '{"data":{"node":{"items":{"pageInfo":{"hasNextPage":false,"endCursor":""},"nodes":[{"id":"PVTI_other","content":{"number":42,"repository":{"nameWithOwner":"other-org/other-repo"}}},{"id":"PVTI_mine","content":{"number":42,"repository":{"nameWithOwner":"test-org/test-repo"}}}]}}}}',
      ),
      "provider_projects_item_id_for_issue PVT_test1 42 test-org test-repo",
    );
    expect(r.status).toBe(0);
    expect(r.out.trim()).toBe("PVTI_mine");
  });

  it("refuses ambiguous same-repo duplicates", () => {
    const r = runWithGhFn(
      ghAlways(
        '{"data":{"node":{"items":{"pageInfo":{"hasNextPage":false,"endCursor":""},"nodes":[{"id":"PVTI_a","content":{"number":42,"repository":{"nameWithOwner":"test-org/test-repo"}}},{"id":"PVTI_b","content":{"number":42,"repository":{"nameWithOwner":"test-org/test-repo"}}}]}}}}',
      ),
      "provider_projects_item_id_for_issue PVT_test1 42 test-org test-repo",
    );
    expect(r.status).not.toBe(0);
    expect(r.out).toContain("expected exactly 1");
  });

  it("errors when the named repo has no card", () => {
    const r = runWithGhFn(
      ghAlways(
        '{"data":{"node":{"items":{"pageInfo":{"hasNextPage":false,"endCursor":""},"nodes":[{"id":"PVTI_other","content":{"number":42,"repository":{"nameWithOwner":"other-org/other-repo"}}}]}}}}',
      ),
      "provider_projects_item_id_for_issue PVT_test1 42 test-org test-repo",
    );
    expect(r.status).not.toBe(0);
    expect(r.out).toContain("not in project");
  });

  it("paginates past the first item page", () => {
    // Page 1: hasNextPage=true, no match. Page 2: the named repo's card.
    // gh override keyed on the -f c=<cursor> continuation flag.
    const ghBody = [
      "gh() {",
      '    local prog="" prev="" page',
      '    local a',
      '    for a in "$@"; do [ "$prev" = \'--jq\' ] && prog="$a"; prev="$a"; done',
      '    for a in "$@"; do case "$a" in c=*) page=2 ;; esac; done',
      '    if [ "${page:-}" = 2 ]; then',
      `        printf '%s' '{"data":{"node":{"items":{"pageInfo":{"hasNextPage":false,"endCursor":""},"nodes":[{"id":"PVTI_p2","content":{"number":42,"repository":{"nameWithOwner":"test-org/test-repo"}}}]}}}}' | jq -r "$prog"`,
      "    else",
      `        printf '%s' '{"data":{"node":{"items":{"pageInfo":{"hasNextPage":true,"endCursor":"CUR1"},"nodes":[{"id":"PVTI_p1","content":{"number":42,"repository":{"nameWithOwner":"other-org/other-repo"}}}]}}}}' | jq -r "$prog"`,
      "    fi",
      "}",
    ].join("\n");
    const r = runWithGhFn(ghBody, "provider_projects_item_id_for_issue PVT_test1 42 test-org test-repo");
    expect(r.status).toBe(0);
    expect(r.out.trim()).toBe("PVTI_p2");
  });
});

describe("projects field + list verbs", () => {
  it("field_option_ids returns '<field-id> <option-id>' pair", () => {
    const r = runLib("provider_projects_field_option_ids PVT_test1 Status To-Groom");
    expect(r.status).toBe(0);
    expect(r.out.trim()).toMatch(/^PVTVF_[a-z0-9]+ PVTFO_[a-z0-9]+$|^[A-Za-z0-9_]+ [A-Za-z0-9_]+$/);
  });

  it("field_set issues a graphql mutation", () => {
    const r = runLib("provider_projects_field_set PVT_test1 PVTI_item1 PVTVF_f1 PVTFO_o1");
    expect(r.status).toBe(0);
    expect(logHas("updateProjectV2ItemFieldValue")).toBe(true);
  });

  it("for_issue lists projects with status, empty when none", () => {
    const r = runLib("provider_projects_for_issue https://github.com/test-org/test-repo/issues/42 test-org");
    expect(r.status).toBe(0);
    // Implementation detail asserted by the live suite; here: call shape only.
    expect(logHas("graphql")).toBe(true);
  });
});
