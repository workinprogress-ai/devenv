// Port of tools/tests/lib/test_provider_projects.bats (32 tests) — one vitest
// `it` per source `@test`. Contract tests for the github projects + org
// facades, including the AC-3 capability failure-path tests (degradation with
// the defined error, before any gh call).
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
let CALL_LOG = "";

// The fixture's gh stub (argv log, failure mode, api modes).
const GH_STUB = [
  "#!/usr/bin/env bash",
  'echo "gh $*" >> "${STUB_CALL_LOG:?}"',
  'if [[ "${STUB_GH_FAIL:-0}" == "1" ]]; then echo "stub-gh: simulated failure" >&2; exit 1; fi',
  'if [[ "$1" == "auth" && "${2:-}" == "token" ]]; then exit 1; fi',
  'if [[ "$1" == "api" ]]; then',
  '  if [[ "$*" == *"-X PATCH"* || "$*" == *"-X POST"* ]]; then',
  '    [[ -n "${STUB_GH_MUTATIONS:-}" ]] && echo "gh $*" >> "$STUB_GH_MUTATIONS"',
  "    printf '{\"id\": 111}'",
  "  else",
  '    [[ -f "${STUB_GH_API_RESPONSE:-/nonexistent}" ]] && cat "$STUB_GH_API_RESPONSE"',
  "  fi",
  "  exit 0",
  "fi",
  "exit 0",
  "",
].join("\n");

beforeEach(() => {
  TMP = mkdtempSync(join(tmpdir(), `proj-${Date.now()}-${Math.random().toString(36).slice(2)}`));
  CALL_LOG = join(TMP, "stub-calls.log");
  const bin = join(TMP, "stub-bin");
  mkdirSync(bin, { recursive: true });
  writeFileSync(CALL_LOG, "");
  writeFileSync(join(bin, "gh"), GH_STUB);
  chmodSync(join(bin, "gh"), 0o755);
});

const ENV = (extra: Record<string, string> = {}): Record<string, string> => ({
  ...process.env,
  TEST_TEMP_DIR: TMP,
  DEVENV_TOOLS: TOOLS,
  STUB_CALL_LOG: CALL_LOG,
  PATH: `${join(TMP, "stub-bin")}:${process.env.PATH ?? ""}`,
  ...extra,
});

// The source suite's setup: source core → detect (absent config) → source
// github issues + projects + org, then run the call.
function runProjects(call: string, extraEnv: Record<string, string> = {}): { status: number; out: string } {
  const script =
    `source '${TOOLS}/lib/providers/provider-core.bash'\n` +
    `provider_detect '${join(TMP, "absent.config")}'\n` +
    `source '${TOOLS}/lib/providers/github/issues.bash'\n` +
    `source '${TOOLS}/lib/providers/github/projects.bash'\n` +
    `source '${TOOLS}/lib/providers/github/org.bash'\n` +
    `${call}\n`;
  const r = spawnSync("bash", ["-c", script], { encoding: "utf8", env: ENV(extraEnv) });
  return { status: r.status ?? 1, out: (r.stdout ?? "") + (r.stderr ?? "") };
}

function ghCount(): number {
  return parseInt((spawnSync("grep", ["-c", "^gh ", CALL_LOG], { encoding: "utf8" }).stdout ?? "0").trim(), 10) || 0;
}

function logHas(pattern: string): boolean {
  return spawnSync("grep", ["-q", pattern, CALL_LOG]).status === 0;
}

describe("provider projects (github)", () => {
  // ── Capability registration ──────────────────────────────────────────────

  it("projects module: registers project-boards capability", () => {
    const r = runProjects("provider_has_capability project-boards");
    expect(r.status).toBe(0);
  });

  it("org module: registers rulesets and native-issue-types capabilities", () => {
    const r = runProjects("provider_has_capability rulesets\nprovider_has_capability native-issue-types");
    expect(r.status).toBe(0);
  });

  // ── AC-3 failure path: projects degrade with the defined error ──────────

  it("AC-3: projects_list without project-boards capability fails defined, no gh call", () => {
    // Simulate a provider without boards: the variable is cleared in the
    // spawned shell AFTER the modules sourced (an exported empty env var
    // would be re-appended by each module's declare at source time).
    const r = runProjects('PROVIDER_CAPABILITIES=""\nprovider_projects_list org/repo');
    expect(r.status).not.toBe(0);
    expect(r.out).toContain("provider 'github' does not support capability 'project-boards'");
    expect(ghCount()).toBe(0);
  });

  it("AC-3: projects_item_add gated before any gh call", () => {
    const r = runProjects('PROVIDER_CAPABILITIES=""\nprovider_projects_item_add org/repo 12 https://github.com/org/repo/issues/99');
    expect(r.status).not.toBe(0);
    expect(ghCount()).toBe(0);
  });

  it("AC-3: projects_field_list gated before any gh call", () => {
    const r = runProjects('PROVIDER_CAPABILITIES=""\nprovider_projects_field_list org/repo 12');
    expect(r.status).not.toBe(0);
    expect(ghCount()).toBe(0);
  });

  // ── AC-3 failure path: rulesets degrade with the defined error ──────────

  it("AC-3: rulesets_list without rulesets capability fails defined, no gh call", () => {
    const r = runProjects('PROVIDER_CAPABILITIES=""\nprovider_org_rulesets_list org/repo');
    expect(r.status).not.toBe(0);
    expect(r.out).toContain("provider 'github' does not support capability 'rulesets'");
    expect(ghCount()).toBe(0);
  });

  it("AC-3: ruleset_update gated before any gh call", () => {
    const r = runProjects('PROVIDER_CAPABILITIES=""\nprovider_org_ruleset_update org/repo 7 /dev/null');
    expect(r.status).not.toBe(0);
    expect(ghCount()).toBe(0);
  });

  // ── AC-3 failure path: native issue-types ────────────────────────────────

  it("AC-3: org_issue_types without native-issue-types capability fails defined", () => {
    const r = runProjects('PROVIDER_CAPABILITIES=""\nprovider_org_issue_types myorg');
    expect(r.status).not.toBe(0);
    expect(r.out).toContain("provider 'github' does not support capability 'native-issue-types'");
    expect(ghCount()).toBe(0);
  });

  // ── Happy paths (capabilities declared) ──────────────────────────────────

  // gh project commands are owner-scoped: they take --owner and no repository
  // positional ("accepts at most 1 arg"), so the seam's repo argument is
  // accepted and never reaches gh.

  it("projects list: a repo argument is accepted but not passed to gh", () => {
    const r = runProjects("provider_projects_list org/repo --owner org");
    expect(r.status).toBe(0);
    expect(logHas("^gh project list --owner org$")).toBe(true);
  });

  it("projects list: flags only", () => {
    const r = runProjects("provider_projects_list --owner org");
    expect(r.status).toBe(0);
    expect(logHas("^gh project list --owner org$")).toBe(true);
  });

  it("projects item-add: project number and item url wired; the repo argument is not a gh positional", () => {
    const r = runProjects("provider_projects_item_add org/repo 12 https://github.com/org/repo/issues/99 --owner org");
    expect(r.status).toBe(0);
    expect(logHas("^gh project item-add 12 --url https://github.com/org/repo/issues/99 --owner org$")).toBe(true);
  });

  it("projects item-add: an empty repo argument (the callers' form) behaves the same", () => {
    const r = runProjects('provider_projects_item_add "" 12 https://github.com/org/repo/issues/99 --owner org');
    expect(r.status).toBe(0);
    expect(logHas("^gh project item-add 12 --url https://github.com/org/repo/issues/99 --owner org$")).toBe(true);
  });

  it("projects field-list: project number wired; the repo argument is not a gh positional", () => {
    const r = runProjects("provider_projects_field_list org/repo 12 --owner org");
    expect(r.status).toBe(0);
    expect(logHas("^gh project field-list 12 --owner org$")).toBe(true);
  });

  it("projects field-list: a bare project number followed by flags is the number, not a repository", () => {
    const r = runProjects("provider_projects_field_list 12 --owner org");
    expect(r.status).toBe(0);
    expect(logHas("^gh project field-list 12 --owner org$")).toBe(true);
  });

  it("projects item-add: a bare project number first is the number, not a repository", () => {
    const r = runProjects("provider_projects_item_add 12 https://github.com/org/repo/issues/99 --owner org");
    expect(r.status).toBe(0);
    expect(logHas("^gh project item-add 12 --url https://github.com/org/repo/issues/99 --owner org$")).toBe(true);
  });

  it("rulesets list: paginated REST endpoint with capability present", () => {
    const r = runProjects("provider_org_rulesets_list org/repo");
    expect(r.status).toBe(0);
    expect(logHas("^gh api repos/org/repo/rulesets --paginate$")).toBe(true);
  });

  it("ruleset get: id wired into the endpoint", () => {
    const r = runProjects("provider_org_ruleset_get org/repo 42");
    expect(r.status).toBe(0);
    expect(logHas("^gh api repos/org/repo/rulesets/42$")).toBe(true);
  });

  it("ruleset create: payload file wired via --input POST", () => {
    const muts = join(TMP, "mutations.log");
    const payload = join(TMP, "payload.json");
    writeFileSync(payload, "{}");
    const r = runProjects(`provider_org_ruleset_create org/repo '${payload}'`, { STUB_GH_MUTATIONS: muts });
    expect(r.status).toBe(0);
    expect(spawnSync("grep", ["-q", "POST", muts]).status).toBe(0);
  });

  it("org issue types: GraphQL query issued with the org as a variable", () => {
    const types = join(TMP, "types.json");
    writeFileSync(types, '{"data":{"organization":{"issueTypes":{"edges":[],"pageInfo":{"hasNextPage":false}}}}}');
    const r = runProjects("provider_org_issue_types myorg", { STUB_GH_API_RESPONSE: types });
    expect(r.status).toBe(0);
    expect(logHas("gh api graphql")).toBe(true);
    expect(spawnSync("grep", ["-q", "-e", "-f o=myorg", CALL_LOG]).status).toBe(0);
  });

  it("releases list: -R form, ungated (portable domain)", () => {
    const r = runProjects("provider_org_releases_list org/repo --limit 5");
    expect(r.status).toBe(0);
    expect(logHas("^gh release list -R org/repo --limit 5$")).toBe(true);
  });

  it("releases list: works even when rulesets capability is stripped (portable)", () => {
    const r = runProjects('PROVIDER_CAPABILITIES=""\nprovider_org_releases_list org/repo');
    expect(r.status).toBe(0);
    expect(logHas("^gh release list -R org/repo$")).toBe(true);
  });

  // ── Phase-2 verbs: project GraphQL resolution + field mutation ──────────

  it("projects id_by_name: numeric form uses projectV2(number:)", () => {
    const gql = join(TMP, "gql.json");
    writeFileSync(gql, '{"data":{"organization":{"projectV2":{"id":"PVT_num"}}}}');
    const r = runProjects("provider_projects_id_by_name myorg 42", { STUB_GH_API_RESPONSE: gql });
    expect(r.status).toBe(0);
    // The stub ignores --jq (it cats the canned file), so assert the call
    // shape: numeric path issues graphql with -F n= (no list scan).
    expect(spawnSync("grep", ["-q", "-e", "-f o=myorg -F n=42 --jq", CALL_LOG]).status).toBe(0);
  });

  it("projects id_by_name: capability-gated", () => {
    const r = runProjects('PROVIDER_CAPABILITIES=""\nprovider_projects_id_by_name myorg 42');
    expect(r.status).not.toBe(0);
    expect(r.out).toContain("does not support capability 'project-boards'");
  });

  it("projects item_id_for_issue: rejects non-numeric issue", () => {
    const r = runProjects('provider_projects_item_id_for_issue "PVT_abc" "not-a-number" myorg myrepo');
    expect(r.status).not.toBe(0);
    expect(r.out).toContain("must be numeric");
  });

  it("projects item_id_for_issue: graphql issued with project id", () => {
    // The cli-stubs gh returns raw JSON without applying --jq, but the
    // lookup's filtering happens inside the jq program gh executes. Wrap the
    // stub with a jq-applying shim on PATH (mirroring real gh behavior).
    const gql2 = join(TMP, "gql2.json");
    writeFileSync(
      gql2,
      '{"data":{"node":{"items":{"pageInfo":{"hasNextPage":false,"endCursor":""},"nodes":[{"id":"PVTI_9","content":{"number":7,"repository":{"nameWithOwner":"myorg/myrepo"}}}]}}}}',
    );
    const shim = join(TMP, "jq-gh-bin");
    mkdirSync(shim, { recursive: true });
    writeFileSync(
      join(shim, "gh"),
      [
        "#!/usr/bin/env bash",
        'echo "gh $*" >> "$STUB_CALL_LOG"',
        'prog=""',
        'prev=""',
        'for a in "$@"; do [ "$prev" = "--jq" ] && prog="$a"; prev="$a"; done',
        `cat '${gql2}' | jq -r "$prog"`,
        "",
      ].join("\n"),
    );
    chmodSync(join(shim, "gh"), 0o755);
    const r = runProjects('provider_projects_item_id_for_issue "PVT_abc" 7 myorg myrepo', {
      PATH: `${shim}:${join(TMP, "stub-bin")}:${process.env.PATH ?? ""}`,
    });
    expect(r.status, `rc=${r.status} out=${r.out.slice(0, 200)}`).toBe(0);
    // The multi-line jq program follows --jq on the same log line, but the
    // record wraps: assert the two tokens on the line instead of the pair.
    // Dash-leading patterns must go through -e (grep would parse them as
    // flags): the record is one multi-line echo of the full argv.
    expect(spawnSync("grep", ["-q", "-e", "-f p=PVT_abc", CALL_LOG]).status).toBe(0);
    expect(spawnSync("grep", ["-q", "-e", "--jq", CALL_LOG]).status).toBe(0);
  });

  it("projects field_option_ids: graphql issued", () => {
    const gql3 = join(TMP, "gql3.json");
    writeFileSync(gql3, '{"data":{"node":{"field":{"id":"FLD_1","options":[{"id":"OPT_a","name":"To-groom"}]}}}}');
    const r = runProjects('provider_projects_field_option_ids "PVT_abc" "Status" "to-groom"', { STUB_GH_API_RESPONSE: gql3 });
    expect(r.status).toBe(0);
    expect(r.out.trim()).toBe("FLD_1 OPT_a");
    expect(logHas("gh api graphql")).toBe(true);
  });

  it("projects field_set: mutation issued with all four IDs", () => {
    const muts = join(TMP, "mutations.log");
    const r = runProjects('provider_projects_field_set "PVT_abc" "PVTI_1" "FLD_2" "OPT_3"', { STUB_GH_MUTATIONS: muts });
    expect(r.status).toBe(0);
    expect(spawnSync("grep", ["-q", "updateProjectV2ItemFieldValue", CALL_LOG]).status).toBe(0);
  });

  it("projects field_set: capability-gated", () => {
    const r = runProjects('PROVIDER_CAPABILITIES=""\nprovider_projects_field_set "PVT_abc" "PVTI_1" "FLD_2" "OPT_3"');
    expect(r.status).not.toBe(0);
    expect(r.out).toContain("does not support capability 'project-boards'");
  });

  it("projects for_issue: graphql issued with issue url", () => {
    const items = join(TMP, "items.json");
    writeFileSync(items, '{"data":{"resource":{"projectItems":{"pageInfo":{"hasNextPage":false},"nodes":[]}}}}');
    const r = runProjects('provider_projects_for_issue "https://github.com/myorg/r/issues/1" myorg', {
      STUB_GH_API_RESPONSE: items,
    });
    expect(r.status).toBe(0);
    expect(logHas("gh api graphql")).toBe(true);
  });

  it("repos api: generic escape hatch passes method/endpoint through", () => {
    const r = runProjects(`source '${TOOLS}/lib/providers/github/repos.bash'\nprovider_api PATCH repos/org/repo -f has_wiki=false`);
    expect(r.status).toBe(0);
    expect(logHas("^gh api -X PATCH repos/org/repo -f has_wiki=false$")).toBe(true);
  });

  it("repos api_paginate: --paginate flag wired", () => {
    const r = runProjects(`source '${TOOLS}/lib/providers/github/repos.bash'\nprovider_api_paginate /users/org/packages`);
    expect(r.status).toBe(0);
    expect(logHas("^gh api /users/org/packages --paginate$")).toBe(true);
  });

  it("id_by_name: quote-bearing title logs the reason, not silent not-found", () => {
    const r = runProjects(`provider_projects_id_by_name "org" 'Bad "Title"'`);
    expect(r.status).not.toBe(0);
    expect(r.out).toContain("double quotes");
  });
});
