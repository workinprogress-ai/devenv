// Port of tools/tests/lib/test_repo_types.bats (33 tests) — one vitest `it`
// per source `@test`. Tests for repo-types.bash: config path resolution,
// validation, ruleset configuration (apply/PUT/403 guidance), repo-type
// detection, merge/feature settings, accessor defaults, payload token
// substitution, and the shipped default ruleset rendered for real.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const ROOT = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))));
const TOOLS = join(ROOT, "tools");
const LIB = join(TOOLS, "lib", "repo-types.bash");

let TMP = "";
let DEVENV_ROOT = "";
let BIN = "";

beforeEach(() => {
  TMP = mkdtempSync(join(tmpdir(), `rtypes-${Date.now()}-${Math.random().toString(36).slice(2)}`));
  DEVENV_ROOT = join(TMP, "devenv-root");
  BIN = join(TMP, "bin");
  mkdirSync(BIN, { recursive: true });
  mkdirSync(DEVENV_ROOT, { recursive: true });
});

// bash -c with combined output, TEST_TEMP_DIR-style env.
function sh(script: string, extraEnv: Record<string, string> = {}): { status: number; out: string } {
  const r = spawnSync("bash", ["-c", script], {
    encoding: "utf8",
    env: {
      ...process.env,
      TEST_TEMP_DIR: TMP,
      DEVENV_TOOLS: TOOLS,
      DEVENV_ROOT,
      // Seal the root: self-root would otherwise rebind DEVENV_ROOT to this
      // checkout (the harness's test_helper_setup exports it too).
      DEVENV_ROOT_SET: "1",
      PATH: `${BIN}:${process.env.PATH ?? ""}`,
      ...extraEnv,
    },
  });
  return { status: r.status ?? 1, out: (r.stdout ?? "") + (r.stderr ?? "") };
}

// create_stub_gh RESPONSE: gh stub that echoes $GH_STUB_RESPONSE for api calls.
function stubGhSimple(): void {
  writeFileSync(
    join(BIN, "gh"),
    [
      "#!/usr/bin/env bash",
      'if [ "$1" = "api" ]; then',
      '  echo "$GH_STUB_RESPONSE"',
      "  exit 0",
      "fi",
      "exit 0",
      "",
    ].join("\n"),
  );
    chmodSync(join(BIN, "gh"), 0o755);
}

// The source's fixture types config.
const FIXTURE_CFG = `types:
  service:
    naming_pattern: "^service\\\\.[a-z0-9-]+\\\\.[a-z0-9-]+$"
    naming_example: "service.platform.identity"
    rulesetConfigFile: ruleset-default.json
  none:
    naming_pattern: ".*"
    naming_example: "anything"
    rulesetConfigFile: null
`;

function createRepoTypesConfig(path: string): void {
  writeFileSync(path, FIXTURE_CFG);
}

const RULESET_JSON = `{
  "name": "Require PR",
  "target": "branch",
  "enforcement": "active",
  "conditions": {"ref_name": {"include": ["~DEFAULT_BRANCH"], "exclude": []}},
  "rules": [{"type": "pull_request", "parameters": {"required_approving_review_count": 1}}],
  "bypass_actors": [],
  "source_type": "Repository",
  "source": "{{owner}}/{{repo_name}}"
}
`;

const RULESET_LIBS =
  `source '${TOOLS}/lib/error-handling.bash'\n` +
  `source '${TOOLS}/lib/validation.bash'\n` +
  `source '${LIB}'\n`;

// Types config whose "service" type carries characters that break a sed
// replacement ("&" expands to the match, "/" ends the expression) and JSON
// ('"' and a backslash).
const AWKWARD_CFG = `types:
  service:
    description: "Tom & \\"Jerry\\" a/b \\\\ c {{owner}} done"
    rulesetConfigFile: rs.json
`;

function createAwkwardTypesConfig(path: string): void {
  writeFileSync(path, AWKWARD_CFG);
}

// run_builder RULESET_FILE [FULL_NAME]: prints the payload on stdout.
function runBuilder(rsFile: string, fullName = "acme/my-repo"): { status: number; out: string } {
  return sh(
    `source '${LIB}'\nbuild_ruleset_payload_from_file '${rsFile}' '${fullName}' service '${join(TMP, "types.yaml")}'\n`,
  );
}

// jq -r over a JSON string.
function jq(json: string, expr: string): string {
  return (spawnSync("jq", ["-r", expr], { input: json, encoding: "utf8" }).stdout ?? "").trim();
}

// run_default_ruleset EMAIL_DOMAIN: renders the shipped ruleset-default.json.
// The harness binds DEVENV_TOOLS to the SANDBOXED $DEVENV_ROOT/tools (a
// symlink suffices — repo-types resolves lib/ through it) and writes the
// synthetic devenv.config first, then the helper's overwrite supplies the
// email_domain under test.
function runDefaultRuleset(emailDomain: string): { status: number; out: string } {
  spawnSync("ln", ["-sfn", TOOLS, join(DEVENV_ROOT, "tools")]);
  writeFileSync(
    join(DEVENV_ROOT, "devenv.config"),
    `[organization]\nname=t\norg=acme\nemail_domain=${emailDomain}\n`,
  );
  createAwkwardTypesConfig(join(TMP, "types.yaml"));
  return sh(
    `source '${join(DEVENV_ROOT, "tools", "lib", "repo-types.bash")}'\nbuild_ruleset_payload_from_file '${join(TOOLS, "config", "ruleset-default.json")}' acme/my-repo service '${join(TMP, "types.yaml")}'\n`,
    { DEVENV_ROOT, DEVENV_TOOLS: join(DEVENV_ROOT, "tools") },
  );
}

describe("repo types", () => {
  it("repo_types_config_path honors override and env", () => {
    let r = sh(`source '${LIB}'\nrepo_types_config_path /tmp/override`);
    expect(r.status).toBe(0);
    expect(r.out.trim()).toBe("/tmp/override");
    r = sh(`export REPO_TYPES_CONFIG=/tmp/from_env\nsource '${LIB}'\nrepo_types_config_path`);
    expect(r.status).toBe(0);
    expect(r.out.trim()).toBe("/tmp/from_env");
  });

  it("load_repo_types_config fails when file missing", () => {
    const r = sh(`source '${LIB}'\nload_repo_types_config /tmp/does-not-exist`);
    expect(r.status).not.toBe(0);
  });

  it("validate_repo_type enforces naming pattern", () => {
    const cfg = join(TMP, "repo-types.yaml");
    createRepoTypesConfig(cfg);
    let r = sh(`source '${LIB}'\nvalidate_repo_type service.platform.identity service '${cfg}'`);
    expect(r.status).toBe(0);
    r = sh(`source '${LIB}'\nvalidate_repo_type invalid service '${cfg}'`);
    expect(r.status).not.toBe(0);
    r = sh(`source '${LIB}'\nvalidate_repo_type anything unknown '${cfg}'`);
    expect(r.status).not.toBe(0);
  });

  it("validate_repo_type extracts repo name from owner/repo format", () => {
    const cfg = join(TMP, "repo-types.yaml");
    createRepoTypesConfig(cfg);
    let r = sh(`source '${LIB}'\nvalidate_repo_type workinprogress-ai/service.platform.identity service '${cfg}'`);
    expect(r.status).toBe(0);
    r = sh(`source '${LIB}'\nvalidate_repo_type workinprogress-ai/invalid service '${cfg}'`);
    expect(r.status).not.toBe(0);
  });

  it("configure_rulesets_for_type applies configured rulesets", () => {
    const cfg = join(TMP, "repo-types.yaml");
    createRepoTypesConfig(cfg);
    mkdirSync(join(TMP, "config"), { recursive: true });
    writeFileSync(join(TMP, "config", "ruleset-default.json"), RULESET_JSON);
    stubGhSimple();
    const r = sh(
      `${RULESET_LIBS}configure_rulesets_for_type test-org/test-repo service '${cfg}'`,
      { GH_STUB_RESPONSE: '{"success": true}' },
    );
    expect(r.status).toBe(0);
  });

  it("configure_rulesets_for_type updates existing ruleset via PUT", () => {
    const cfg = join(TMP, "repo-types.yaml");
    createRepoTypesConfig(cfg);
    mkdirSync(join(TMP, "config"), { recursive: true });
    writeFileSync(join(TMP, "config", "ruleset-default.json"), RULESET_JSON);
    // Stub gh to simulate an existing ruleset and capture calls.
    writeFileSync(
      join(BIN, "gh"),
      [
        "#!/usr/bin/env bash",
        "set -euo pipefail",
        'script_dir="$(cd "$(dirname "$0")" && pwd)"',
        'log_file="${script_dir%/bin}/gh_calls.log"',
        'echo "$@" >> "$log_file"',
        'if [ "$1" = "api" ] && [[ "$2" == repos/*/*/rulesets ]]; then',
        '  echo \'[{"id":999,"name":"Require PR"}]\'',
        "  exit 0",
        "fi",
        'if [ "$1" = "api" ] && [ "$2" = "--input" ] && [ "$4" = "-X" ] && [ "$5" = "PUT" ]; then',
        "  echo '{\"id\":999}'",
        "  exit 0",
        "fi",
        "exit 0",
        "",
      ].join("\n"),
    );
    chmodSync(join(BIN, "gh"), 0o755);
    chmodSync(join(BIN, "gh"), 0o755);
    // DEVENV_TOOLS points at the sandboxed root so ruleset-default.json
    // resolves to the test's own fixture, not the shipped one.
    const r = sh(
      `export DEVENV_TOOLS='${TMP}'\n${RULESET_LIBS}configure_rulesets_for_type test-org/test-repo service '${cfg}'\n`,
    );
    expect(r.status, `rc=${r.status} out=${r.out.slice(0, 300)}`).toBe(0);
    // PUT was called.
    const logDump = spawnSync("cat", [join(TMP, "gh_calls.log")], { encoding: "utf8" }).stdout ?? "";
    expect(
      spawnSync("grep", ["-q", "-e", "PUT repos/test-org/test-repo/rulesets/999", join(TMP, "gh_calls.log")]).status,
      `log: ${logDump.slice(0, 300)}`,
    ).toBe(0);
  });

  it("configure_rulesets_for_type returns success on 403 guidance", () => {
    const cfg = join(TMP, "repo-types.yaml");
    createRepoTypesConfig(cfg);
    mkdirSync(join(TMP, "config"), { recursive: true });
    writeFileSync(
      join(TMP, "config", "ruleset-default.json"),
      RULESET_JSON.replace('"parameters": {"required_approving_review_count": 1}', '"parameters": {}').replace(
        '"rules": [{"type": "pull_request", "parameters": {"required_approving_review_count": 1}}]',
        '"rules": [{"type": "pull_request"}]',
      ),
    );
    const r = sh(
      `export DEVENV_TOOLS='${TMP}'\n${RULESET_LIBS}configure_rulesets_for_type test-org/test-repo service '${cfg}'\n`,
      { GH_STUB_RESPONSE: '{"success": true}' },
    );
    expect(r.status).toBe(0);
  });

  it("detect_repo_type matches service pattern", () => {
    const cfg = join(TMP, "repo-types.yaml");
    createRepoTypesConfig(cfg);
    const r = sh(`source '${LIB}'\ndetect_repo_type service.platform.identity '${cfg}' silent`);
    expect(r.status).toBe(0);
    expect(r.out.trim()).toBe("service");
  });

  it("detect_repo_type extracts repo name from full name", () => {
    const cfg = join(TMP, "repo-types.yaml");
    createRepoTypesConfig(cfg);
    const r = sh(`source '${LIB}'\ndetect_repo_type workinprogress-ai/service.platform.identity '${cfg}' silent`);
    expect(r.status).toBe(0);
    expect(r.out.trim()).toBe("service");
  });

  it("detect_repo_type matches none pattern for any name", () => {
    const cfg = join(TMP, "repo-types.yaml");
    createRepoTypesConfig(cfg);
    const r = sh(`source '${LIB}'\ndetect_repo_type anything-goes '${cfg}' silent`);
    expect(r.status).toBe(0);
    expect(r.out.trim()).toBe("none");
  });

  it("detect_repo_type returns first matching pattern", () => {
    const cfg = join(TMP, "repo-types-multi.yaml");
    writeFileSync(
      cfg,
      `types:\n  service:\n    naming_pattern: "^service\\\\.[a-z0-9-]+\\\\.[a-z0-9-]+$"\n    naming_example: "service.platform.identity"\n  docs:\n    naming_pattern: "^docs\\\\.[a-z0-9-]+$"\n    naming_example: "docs.something"\n  all:\n    naming_pattern: ".*"\n    naming_example: "anything"\n`,
    );
    const r = sh(`source '${LIB}'\ndetect_repo_type docs.api '${cfg}' silent`);
    expect(r.status).toBe(0);
    expect(r.out.trim()).toBe("docs");
  });

  it("detect_repo_type returns failure in silent mode with no match", () => {
    const cfg = join(TMP, "repo-types-strict.yaml");
    writeFileSync(
      cfg,
      `types:\n  service:\n    naming_pattern: "^service\\\\.[a-z0-9-]+\\\\.[a-z0-9-]+$"\n    naming_example: "service.platform.identity"\n`,
    );
    const r = sh(`source '${LIB}'\ndetect_repo_type invalid-name '${cfg}' silent`);
    expect(r.status).not.toBe(0);
    expect(r.out.trim()).toBe("");
  });

  it("detect_repo_type handles multiple types correctly", () => {
    const cfg = join(TMP, "repo-types-complex.yaml");
    writeFileSync(
      cfg,
      `types:\n  planning:\n    naming_pattern: "^planning(\\\\.[a-z0-9-]+)+$"\n    naming_example: "planning.roadmap"\n  docs:\n    naming_pattern: "^docs\\\\.[a-z0-9-]+$"\n    naming_example: "docs.api"\n  service:\n    naming_pattern: "^service\\\\.[a-z0-9-]+\\\\.[a-z0-9-]+$"\n    naming_example: "service.platform.identity"\n`,
    );
    let r = sh(`source '${LIB}'\ndetect_repo_type planning.roadmap '${cfg}' silent`);
    expect(r.status).toBe(0);
    expect(r.out.trim()).toBe("planning");
    r = sh(`source '${LIB}'\ndetect_repo_type docs.api '${cfg}' silent`);
    expect(r.out.trim()).toBe("docs");
    r = sh(`source '${LIB}'\ndetect_repo_type service.platform.auth '${cfg}' silent`);
    expect(r.out.trim()).toBe("service");
  });

  it("detect_repo_type handles edge cases", () => {
    const cfg = join(TMP, "repo-types.yaml");
    createRepoTypesConfig(cfg);
    // Empty repo name matches the .* pattern.
    let r = sh(`source '${LIB}'\ndetect_repo_type workinprogress-ai/ '${cfg}' silent`);
    expect(r.status).toBe(0);
    expect(r.out.trim()).toBe("none");
    r = sh(`source '${LIB}'\ndetect_repo_type service.platform.test '${cfg}' silent`);
    expect(r.status).toBe(0);
    expect(r.out.trim()).toBe("service");
  });

  it("configure_merge_types_for_type handles missing allowedMergeTypes", () => {
    const cfg = join(TMP, "repo-types-no-merge.yaml");
    writeFileSync(cfg, `types:\n  custom:\n    naming_pattern: "^custom.*"\n    naming_example: "custom.repo"\n    rulesetConfigFile: null\n`);
    writeFileSync(
      join(BIN, "gh"),
      [
        "#!/usr/bin/env bash",
        'if [ "$1" = "api" ] && [ "$2" = "-X" ] && [ "$3" = "PATCH" ]; then',
        "  if [[ \"$@\" == *'allow_merge_commit=true'* ]]; then",
        "    echo '{\"allow_merge_commit\": true}'",
        "    exit 0",
        "  fi",
        "fi",
        "exit 0",
        "",
      ].join("\n"),
    );
    chmodSync(join(BIN, "gh"), 0o755);
    chmodSync(join(BIN, "gh"), 0o755);
    const r = sh(`source '${LIB}'\ncommand -v gh\nconfigure_merge_types_for_type test-org/test-repo custom '${cfg}'`);
    expect(r.status, `rc=${r.status} out=${r.out.slice(0, 300)}`).toBe(0);
    expect(r.out).toMatch("merge: true");
    expect(r.out).toMatch("squash: false");
    expect(r.out).toMatch("rebase: false");
  });

  it("configure_merge_types_for_type reads allowedMergeTypes from config", () => {
    const cfg = join(TMP, "repo-types-squash.yaml");
    writeFileSync(
      cfg,
      `types:\n  docs:\n    naming_pattern: "^docs.*"\n    naming_example: "docs.something"\n    allowedMergeTypes:\n      - squash\n    rulesetConfigFile: null\n`,
    );
    writeFileSync(
      join(BIN, "gh"),
      [
        "#!/usr/bin/env bash",
        'if [ "$1" = "api" ] && [ "$2" = "-X" ] && [ "$3" = "PATCH" ]; then',
        "  if [[ \"$@\" == *'allow_merge_commit=false'* ]] && [[ \"$@\" == *'allow_squash_merge=true'* ]]; then",
        "    echo '{\"allow_squash_merge\": true}'",
        "    exit 0",
        "  fi",
        "fi",
        "exit 0",
        "",
      ].join("\n"),
    );
    chmodSync(join(BIN, "gh"), 0o755);
    chmodSync(join(BIN, "gh"), 0o755);
    const r = sh(`source '${LIB}'\nconfigure_merge_types_for_type test-org/test-repo docs '${cfg}'`);
    expect(r.status).toBe(0);
    expect(r.out).toMatch("merge: false");
    expect(r.out).toMatch("squash: true");
    expect(r.out).toMatch("rebase: false");
  });

  it("configure_pr_branch_deletion_for_type applies setting via API", () => {
    stubGhSimple();
    const cfg = join(TMP, "cfg-1.yaml");
    writeFileSync(
      cfg,
      `types:\n  service:\n    naming_pattern: "^service\\\\.[a-z0-9-]+\\\\.[a-z0-9-]+$"\n    naming_example: "service.platform.identity"\n    deletePRBranchOnMerge: true\n`,
    );
    const r = sh(`${RULESET_LIBS}configure_pr_branch_deletion_for_type test-org/test-repo service '${cfg}'`, {
      GH_STUB_RESPONSE: '{"success": true}',
    });
    expect(r.status).toBe(0);
    expect(r.out).toMatch("PR branch deletion on merge configured");
    expect(r.out).toMatch("enabled: true");
  });

  it("configure_pr_branch_deletion_for_type respects config setting false", () => {
    stubGhSimple();
    const cfg = join(TMP, "cfg-2.yaml");
    writeFileSync(
      cfg,
      `types:\n  none:\n    naming_pattern: ".*"\n    naming_example: "anything"\n    deletePRBranchOnMerge: false\n`,
    );
    const r = sh(`${RULESET_LIBS}configure_pr_branch_deletion_for_type test-org/test-repo none '${cfg}'`, {
      GH_STUB_RESPONSE: '{"success": true}',
    });
    expect(r.status).toBe(0);
    expect(r.out).toMatch("Configuring PR branch deletion");
    expect(r.out).toMatch("false");
  });

  it("configure_repository_features_for_type applies all settings via API", () => {
    stubGhSimple();
    const cfg = join(TMP, "cfg-3.yaml");
    writeFileSync(
      cfg,
      `types:\n  service:\n    naming_pattern: "^service\\\\.[a-z0-9-]+\\\\.[a-z0-9-]+$"\n    naming_example: "service.platform.identity"\n    hasWiki: false\n    hasIssues: true\n    hasDiscussions: false\n    hasProjects: false\n    allowAutoMerge: true\n    allowUpdateBranch: true\n    allowForking: false\n    squashMergeCommitTitle: PR_TITLE\n    squashMergeCommitMessage: COMMIT_MESSAGES\n`,
    );
    const r = sh(`${RULESET_LIBS}configure_repository_features_for_type test-org/test-repo service '${cfg}'`, {
      GH_STUB_RESPONSE: '{"success": true}',
    });
    expect(r.status).toBe(0);
    expect(r.out).toMatch("Repository features configured");
    expect(r.out).toMatch("Wiki: false");
    expect(r.out).toMatch("Issues: true");
    expect(r.out).toMatch("Discussions: false");
    expect(r.out).toMatch("Projects: false");
    expect(r.out).toMatch("Auto-merge: true");
    expect(r.out).toMatch("Update branch: true");
    expect(r.out).toMatch("Forking: false");
    expect(r.out).toMatch("title=PR_TITLE");
    expect(r.out).toMatch("message=COMMIT_MESSAGES");
  });

  it("configure_repository_features_for_type respects all config settings", () => {
    stubGhSimple();
    const cfg = join(TMP, "cfg-4.yaml");
    writeFileSync(
      cfg,
      `types:\n  custom:\n    naming_pattern: "^custom.*"\n    naming_example: "custom.repo"\n    hasWiki: true\n    hasIssues: false\n    hasDiscussions: true\n    hasProjects: true\n    allowAutoMerge: false\n    allowUpdateBranch: false\n    allowForking: true\n    squashMergeCommitTitle: COMMIT_OR_PR_TITLE\n    squashMergeCommitMessage: PR_BODY\n`,
    );
    const r = sh(`${RULESET_LIBS}configure_repository_features_for_type test-org/test-repo custom '${cfg}'`, {
      GH_STUB_RESPONSE: '{"success": true}',
    });
    expect(r.status).toBe(0);
    expect(r.out).toMatch("Wiki: true");
    expect(r.out).toMatch("Issues: false");
    expect(r.out).toMatch("Discussions: true");
    expect(r.out).toMatch("Projects: true");
    expect(r.out).toMatch("Auto-merge: false");
    expect(r.out).toMatch("Update branch: false");
    expect(r.out).toMatch("Forking: true");
    expect(r.out).toMatch("title=COMMIT_OR_PR_TITLE");
    expect(r.out).toMatch("message=PR_BODY");
  });

  it("getters return sensible defaults when properties missing", () => {
    const cfg = join(TMP, "repo-types-min.yaml");
    writeFileSync(cfg, `types:\n  custom:\n    naming_pattern: "^custom.*"\n    naming_example: "custom.repo"\n`);
    const get = (fn: string): { status: number; out: string } =>
      sh(`source '${LIB}'\n${fn} custom '${cfg}'`);
    const expectOut = (fn: string, expected: string): void => {
      const r = get(fn);
      expect(r.status, `${fn}: ${r.out}`).toBe(0);
      expect(r.out.trim(), fn).toBe(expected);
    };
    expectOut("get_type_main_branch", "master");
    expectOut("get_type_template", "null");
    expectOut("get_type_ruleset_config_file", "null");
    expectOut("get_type_allowed_merge_types", '["merge"]');
    expectOut("get_type_is_template", "false");
    expect(get("get_type_post_creation_script").out.trim()).toBe("");
    expectOut("get_type_delete_post_creation_script", "true");
    expectOut("get_type_post_creation_commit_handling", "none");
    expectOut("get_type_description", "No description");
    expectOut("get_type_naming_pattern", "^custom.*");
    expectOut("get_type_naming_example", "custom.repo");
    expectOut("get_type_delete_pr_branch_on_merge", "true");
    expectOut("get_type_has_wiki", "false");
    expectOut("get_type_has_issues", "true");
    expectOut("get_type_has_discussions", "false");
    expectOut("get_type_has_projects", "false");
    expectOut("get_type_allow_auto_merge", "true");
    expectOut("get_type_allow_update_branch", "true");
    expectOut("get_type_allow_forking", "false");
    expectOut("get_type_squash_merge_commit_title", "PR_TITLE");
    expectOut("get_type_squash_merge_commit_message", "COMMIT_MESSAGES");
  });

  it("get_type_access returns configured access array", () => {
    const cfg = join(TMP, "repo-types.yaml");
    writeFileSync(
      cfg,
      `types:\n  custom:\n    naming_pattern: "^custom.*"\n    naming_example: "custom.repo"\n    access:\n      - name: Engineering\n        type: team\n        permission: push\n      - name: DevOps\n        type: team\n        permission: admin\n`,
    );
    const r = sh(`source '${LIB}'\nget_type_access custom '${cfg}'`);
    expect(r.status).toBe(0);
    expect(r.out).toContain("Engineering");
    expect(r.out).toContain("DevOps");
    expect(r.out).toContain("push");
    expect(r.out).toContain("admin");
  });

  it("get_type_access returns empty array when not specified", () => {
    const cfg = join(TMP, "repo-types.yaml");
    writeFileSync(cfg, `types:\n  custom:\n    naming_pattern: "^custom.*"\n    naming_example: "custom.repo"\n`);
    const r = sh(`source '${LIB}'\nget_type_access custom '${cfg}'`);
    expect(r.status).toBe(0);
    expect(r.out.trim()).toBe("[]");
  });

  it("build_ruleset_payload_from_file keeps awkward characters in a token value intact", () => {
    createAwkwardTypesConfig(join(TMP, "types.yaml"));
    writeFileSync(join(TMP, "rs.json"), '{"name":"R-{{repo_name}}","description":"{{type_description}}","owner":"{{owner}}"}');
    const r = runBuilder(join(TMP, "rs.json"));
    expect(r.status).toBe(0);
    expect(jq(r.out, ".description")).toBe('Tom & "Jerry" a/b \\ c {{owner}} done');
    expect(jq(r.out, ".name")).toBe("R-my-repo");
    expect(jq(r.out, ".owner")).toBe("acme");
  });

  it("build_ruleset_payload_from_file replaces every occurrence and leaves unknown tokens alone", () => {
    createAwkwardTypesConfig(join(TMP, "types.yaml"));
    writeFileSync(
      join(TMP, "rs.json"),
      '{"a":"{{repo_name}}/{{repo_name}}","b":"{{type_name}}","c":"{{not_a_token}}","d":["x-{{owner}}"]}',
    );
    const r = runBuilder(join(TMP, "rs.json"));
    expect(r.status).toBe(0);
    expect(jq(r.out, ".a")).toBe("my-repo/my-repo");
    expect(jq(r.out, ".b")).toBe("service");
    expect(jq(r.out, ".c")).toBe("{{not_a_token}}");
    expect(jq(r.out, ".d[0]")).toBe("x-acme");
  });

  it("build_ruleset_payload_from_file substitutes in a single pass", () => {
    // The description itself contains "{{owner}}"; it must come out
    // literally, not be expanded by a later replacement.
    createAwkwardTypesConfig(join(TMP, "types.yaml"));
    writeFileSync(join(TMP, "rs.json"), '{"d":"{{type_description}}"}');
    const r = runBuilder(join(TMP, "rs.json"));
    expect(r.status).toBe(0);
    expect(jq(r.out, ".d")).toContain("{{owner}} done");
  });

  it("build_ruleset_payload_from_file reports why an invalid template yields no payload", () => {
    createAwkwardTypesConfig(join(TMP, "types.yaml"));
    writeFileSync(join(TMP, "rs.json"), "{ this is not json");
    const r = spawnSync("bash", ["-c", `source '${LIB}'\nbuild_ruleset_payload_from_file '${join(TMP, "rs.json")}' acme/my-repo service '${join(TMP, "types.yaml")}'\n`], {
      encoding: "utf8",
      env: { ...process.env, TEST_TEMP_DIR: TMP, DEVENV_TOOLS: TOOLS, DEVENV_ROOT, PATH: `${BIN}:${process.env.PATH ?? ""}` },
    });
    // The source ran with --separate-stderr: stdout is just the payload.
    expect(r.status).toBe(1);
    expect((r.stdout ?? "").trim()).toBe("{}");
    expect((r.stderr ?? "")).toContain("did not produce valid JSON");
  });

  it("configure_rulesets_for_type names the repo type and description when it skips", () => {
    mkdirSync(join(TMP, "tools", "config"), { recursive: true });
    writeFileSync(join(TMP, "tools", "config", "rs.json"), "{ this is not json");
    createAwkwardTypesConfig(join(TMP, "types.yaml"));
    const r = sh(
      `source '${LIB}'\nexport DEVENV_TOOLS='${join(TMP, "tools")}'\nconfigure_rulesets_for_type acme/my-repo service '${join(TMP, "types.yaml")}'\n`,
    );
    expect(r.status).toBe(0);
    expect(r.out).toContain("Failed to generate valid ruleset payload");
    expect(r.out).toContain("repo type 'service'");
    expect(r.out).toContain('Tom & "Jerry" a/b \\ c');
  });

  it("default ruleset: an empty email_domain emits no email rules (it used to require ends_with '@')", () => {
    const r = runDefaultRuleset("");
    expect(r.status).toBe(0);
    expect(parseInt(jq(r.out, '[.rules[] | select(.type | test("email_pattern"))] | length'), 10)).toBe(0);
    expect(parseInt(jq(r.out, '[.. | strings | select(. == "@")] | length'), 10)).toBe(0);
  });

  it("default ruleset: a configured email_domain keeps both email rules, with the domain", () => {
    const r = runDefaultRuleset("example.com");
    expect(r.status).toBe(0);
    expect(jq(r.out, '[.rules[] | select(.type == "commit_author_email_pattern") | .parameters.pattern][0]')).toBe(
      "@example.com",
    );
    expect(jq(r.out, '[.rules[] | select(.type == "committer_email_pattern") | .parameters.pattern][0]')).toBe(
      "@example.com",
    );
  });

  it("default ruleset: the other rules are unaffected by dropping the email rules", () => {
    const r = runDefaultRuleset("");
    expect(r.status).toBe(0);
    const types = jq(r.out, '[.rules[].type] | join(",")');
    expect(types).toContain("pull_request");
    expect(types).toContain("commit_message_pattern");
    expect(types).toContain("required_linear_history");
  });

  it("default ruleset: no branch_name_pattern rule (it targets only the default branch, where it can never apply)", () => {
    const r = runDefaultRuleset("example.com");
    expect(r.status).toBe(0);
    expect(parseInt(jq(r.out, '[.rules[] | select(.type == "branch_name_pattern")] | length'), 10)).toBe(0);
  });

  it("configure_merge_types_for_type returns failure when the API call fails (it used to return 0)", () => {
    writeFileSync(join(BIN, "gh"), '#!/usr/bin/env bash\necho "HTTP 403" >&2\nexit 1\n');
    chmodSync(join(BIN, "gh"), 0o755);
    createAwkwardTypesConfig(join(TMP, "types.yaml"));
    const r = sh(
      `source '${LIB}'\nconfigure_merge_types_for_type acme/my-repo service '${join(TMP, "types.yaml")}'\n`,
    );
    expect(r.status).not.toBe(0);
  });
});
