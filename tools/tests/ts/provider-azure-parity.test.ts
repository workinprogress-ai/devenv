// Port of tools/tests/lib/test_provider_azure_parity.bats (13 tests): provider
// parity derived from the contract. CONTRACT.md lists every verb in its
// `contract:verbs` block; both providers are checked against it — every listed
// verb defined (provider-scoped marks respected), no undocumented domain verbs,
// table rows present, unknown options rejected by name, value-taking options
// never hang, and azure filters refuse values they cannot honor.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });

const ROOT = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))));
const TOOLS = join(ROOT, "tools");
const CONTRACT = join(TOOLS, "lib/providers/CONTRACT.md");

// Capability hooks are seam functions with core defaults — deliberately not
// both-provider verbs; excluded from the verb-parity inventory.
const DOMAIN_VERB_RE = "^provider_(repos|issues|issue|prs|pipelines|projects|org)_";
const CAPABILITY_HOOK_RE = "^provider_issues_(target_required|set_type_context|artifact_body_transform)$";

let TMP = "";

// Log-only gh stub + minimal curl stub (the parity tests never assert bodies).
const GH_STUB = `#!/usr/bin/env bash
echo "gh $*" >> "\${STUB_CALL_LOG:?}"
exit 0
`;
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
  TMP = mkdtempSync(join(tmpdir(), `azpar-${Date.now()}-${Math.random().toString(36).slice(2)}`));
  const bin = join(TMP, "stub-bin");
  mkdirSync(bin, { recursive: true });
  mkdirSync(join(TMP, "devenv-root"), { recursive: true });
  writeFileSync(join(TMP, "devenv-root/devenv.config"), "[provider]\nname=azure\nazure_org=org\nazure_project=proj\n");
  writeFileSync(join(TMP, "gh"), GH_STUB);
  chmodSync(join(TMP, "gh"), 0o755);
  writeFileSync(join(bin, "curl"), CURL_STUB);
  chmodSync(join(bin, "curl"), 0o755);
  writeFileSync(join(TMP, "stub-calls.log"), "");
});

const ENV = (extra: Record<string, string> = {}): Record<string, string> => ({
  ...process.env,
  TEST_TEMP_DIR: TMP,
  DEVENV_TOOLS: TOOLS,
  DEVENV_ROOT: join(TMP, "devenv-root"),
  AZURE_PAT: "test-pat",
  STUB_CALL_LOG: join(TMP, "stub-calls.log"),
  STUB_CURL_RESPONSE: join(TMP, "curl-response"),
  PATH: `${TMP}:${join(TMP, "stub-bin")}:${process.env.PATH ?? ""}`,
  ...extra,
});

function bash(script: string, env: Record<string, string> = {}): { status: number; out: string } {
  const r = spawnSync("bash", ["-c", script], { encoding: "utf8", env: ENV(env) });
  return { status: r.status ?? 1, out: (r.stdout ?? "") + (r.stderr ?? "") };
}

// contract_verbs [all|github|azure]: the verbs the contract lists for a provider
function contractVerbs(which: "all" | "github" | "azure"): string[] {
  const r = spawnSync(
    "bash",
    [
      "-c",
      `awk '/<!-- contract:verbs -->/{f=1;next} /<!-- \\/contract:verbs -->/{f=0} f' '${CONTRACT}'` +
      ` | grep -E '^provider_' | while read -r verb rest; do` +
      ` case "${which}" in` +
      ` all) echo "$verb" ;;` +
      ` github) [[ "$rest" == *"azure-only"* ]] || echo "$verb" ;;` +
      ` azure) [[ "$rest" == *"github-only"* ]] || echo "$verb" ;;` +
      ` esac; done`,
    ],
    { encoding: "utf8" },
  );
  return (r.stdout ?? "").split("\n").filter(Boolean);
}

// provider_defined PROVIDER: every provider_* function the modules define.
function providerDefined(prov: string): string[] {
  const r = bash(
    `source '${TOOLS}/lib/error-handling.bash'\n` +
    `source '${TOOLS}/lib/providers/provider-core.bash'\n` +
    `PROVIDER_NAME=${prov}\n` +
    `provider_load http urls auth repos issues prs pipelines projects org policies releases 2>/dev/null\n` +
    `declare -F | awk '{print $3}' | grep -E '^provider_' | sort`,
  );
  return r.out.split("\n").filter(Boolean);
}

// verb|first positional ("-" for none)|remaining positionals
const OPTION_TAKING_VERBS = `
provider_repos_view|p/r|
provider_repos_list|org/proj|
provider_repos_create|name|
provider_repos_edit|p/r|
provider_repos_patch|p/r|
provider_repos_collaborator_put|p/r user|
provider_issues_list|p/r|
provider_issues_view|p/r|1
provider_issues_create|p/r|
provider_issues_edit|p/r|1
provider_issues_close|p/r|1
provider_issues_reopen|p/r|1
provider_issues_comment|p/r|1
provider_issues_comment_add|p/r|1
provider_issues_comment_get|p/r|1/2
provider_issues_comment_edit|p/r|1/2
provider_issues_label_list|p/r|
provider_issues_label_create|p/r|name
provider_issues_milestones|p/r|
provider_prs_list|p/r|
provider_prs_view|p/r|1
provider_prs_diff|p/r|1
provider_prs_create|p/r|
provider_prs_merge|p/r|1
provider_prs_comment|p/r|1
provider_prs_thread_create|p/r|1
provider_pipelines_run_list|p/r|
provider_pipelines_run_view|p/r|1
provider_pipelines_run_watch|p/r|1
provider_pipelines_workflow_list|p/r|
provider_pipelines_workflow_run|p/r|wf
provider_pipelines_run_rerun|p/r|1
provider_pipelines_run_download|p/r|1
provider_projects_list|p/r|
provider_projects_field_list|p/r|1
provider_projects_item_add|p/r|1 https://x/i/1
provider_org_releases_list|p/r|
provider_org_feeds_list|-|
`.trim();

// spawnSync with argv: run the verb with fixed args then --no-such-option-xyz.
function bogusProbeArgv(prov: string, verb: string, fixedArgs: string[]): { status: number; out: string } {
  const r = spawnSync(
    "bash",
    [
      "-c",
      `source '${TOOLS}/lib/error-handling.bash'\n` +
      `source '${TOOLS}/lib/providers/provider-core.bash'\n` +
      `PROVIDER_NAME=${prov}\n` +
      `provider_load http urls auth repos issues prs pipelines projects org policies releases 2>/dev/null\n` +
      `'${verb}' "$@" --no-such-option-xyz`,
      "_",
      ...fixedArgs,
    ],
    { encoding: "utf8", env: ENV() },
  );
  return { status: r.status ?? 1, out: (r.stdout ?? "") + (r.stderr ?? "") };
}

describe("contract verb inventory", () => {
  it("the contract lists verbs, and the block is parsed", () => {
    expect(contractVerbs("all").length).toBeGreaterThanOrEqual(60);
  });

  it("every contract verb is defined by the github provider", () => {
    const defined = providerDefined("github");
    const missing = contractVerbs("github").filter((v) => !defined.includes(v));
    expect(missing, `github is missing:${missing.join(" ")}`).toEqual([]);
  });

  it("every contract verb is defined by the azure provider", () => {
    const defined = providerDefined("azure");
    const missing = contractVerbs("azure").filter((v) => !defined.includes(v));
    expect(missing, `azure is missing:${missing.join(" ")}`).toEqual([]);
  });

  it("neither provider defines a domain verb the contract does not list", () => {
    const listed = new Set(contractVerbs("all"));
    const extra: string[] = [];
    for (const prov of ["github", "azure"]) {
      for (const verb of providerDefined(prov)) {
        if (new RegExp(DOMAIN_VERB_RE).test(verb) && !new RegExp(CAPABILITY_HOOK_RE).test(verb) && !listed.has(verb)) {
          extra.push(`${prov}:${verb}`);
        }
      }
    }
    expect(extra, `undocumented verbs:${extra.join(" ")}`).toEqual([]);
  });

  it("every contract verb has a row in the contract's tables", () => {
    const contract = (spawnSync("bash", ["-c", `cat '${CONTRACT}'`], { encoding: "utf8" }).stdout ?? "");
    const exempt = new Set(["provider_api", "provider_api_paginate", "provider_issues_add_tag"]);
    const missing = contractVerbs("all").filter((v) => !exempt.has(v) && !contract.includes(`| \`${v}\``));
    expect(missing, `no table row for:${missing.join(" ")}`).toEqual([]);
  });

  it("the github-only and azure-only marks name verbs that really exist on one side only", () => {
    const gh = providerDefined("github");
    const az = providerDefined("azure");
    const marked = spawnSync(
      "bash",
      ["-c", `awk '/<!-- contract:verbs -->/{f=1;next} /<!-- \\/contract:verbs -->/{f=0} f' '${CONTRACT}' | grep -E '^provider_.*(github|azure)-only'`],
      { encoding: "utf8" },
    ).stdout ?? "";
    for (const line of marked.split("\n").filter(Boolean)) {
      const [verb, ...rest] = line.split(/\s+/);
      const note = rest.join(" ");
      if (note.includes("github-only")) {
        expect(gh, `${verb} marked github-only but undefined on github`).toContain(verb!);
        expect(az, `${verb} marked github-only but defined on azure`).not.toContain(verb!);
      } else if (note.includes("azure-only")) {
        expect(az, `${verb} marked azure-only but undefined on azure`).toContain(verb!);
        expect(gh, `${verb} marked azure-only but defined on github`).not.toContain(verb!);
      }
    }
  });
});

describe("unknown-option rejection", () => {
  it("azure: every option-taking verb rejects an unknown option by name", () => {
    const failures: string[] = [];
    for (const line of OPTION_TAKING_VERBS.split("\n")) {
      const [verb = "", repo = "", rest = ""] = line.split("|");
      if (!verb) continue;
      const argv: string[] = [];
      if (repo !== "-") argv.push(repo);
      if (rest) argv.push(...rest.split(" ").filter(Boolean));
      const r = bogusProbeArgv("azure", verb, argv);
      if (r.status === 0 || !r.out.includes("no-such-option-xyz")) failures.push(verb);
    }
    expect(failures, `azure verbs that did not reject an unknown option:${failures.join(" ")}`).toEqual([]);
  });

  it("github: the verbs that parse their own options reject an unknown option by name", () => {
    for (const [verb, fixed] of [
      ["provider_issues_comment_edit", ["p/r", "1", "--body", "x"]],
      ["provider_issues_comment_add", ["p/r", "1", "--body", "x"]],
      ["provider_prs_thread_create", ["p/r", "1", "--body", "x"]],
    ] as const) {
      const r = bogusProbeArgv("github", verb, [...fixed]);
      expect(r.status, `${verb} accepted an unknown option`).not.toBe(0);
      expect(r.out, `${verb}: ${r.out}`).toContain("no-such-option-xyz");
    }
  });

  it("an unknown option makes no request", () => {
    writeFileSync(join(TMP, "stub-calls.log"), "");
    const r = bash(
      `source '${TOOLS}/lib/error-handling.bash'\n` +
      `source '${TOOLS}/lib/providers/provider-core.bash'\n` +
      `PROVIDER_NAME=azure\n` +
      `provider_load http urls auth repos issues 2>/dev/null\n` +
      `provider_issues_create '' --title t --no-such-option-xyz`,
    );
    expect(r.status).not.toBe(0);
    const curls = spawnSync("bash", ["-c", `grep -c '^curl ' '${join(TMP, "stub-calls.log")}' 2>/dev/null || true`], { encoding: "utf8" }).stdout ?? "0";
    expect(curls.trim()).toBe("0");
  });
});

describe("value-option handling", () => {
  it("a trailing value-taking option is rejected by name on both providers, within seconds", () => {
    const cases: Array<[string, string, string]> = [
      ["provider_issues_list", "p/r", "--state"],
      ["provider_issues_edit", "p/r 1", "--title"],
      ["provider_prs_list", "p/r", "--state"],
      ["provider_prs_create", "p/r", "--title"],
      ["provider_pipelines_run_list", "p/r", "--status"],
      ["provider_repos_view", "p/r", "--json"],
    ];
    const failures: string[] = [];
    for (const prov of ["azure", "github"]) {
      for (const [verb, pos, opt] of cases) {
        // GitHub forwards most verbs' options to gh, which reports a missing
        // value itself; only the verbs that parse their own options are checked there.
        if (prov === "github" && !(verb === "provider_issues_list" || verb === "provider_repos_view")) continue;
        const r = spawnSync(
          "timeout",
          [
            "20",
            "bash",
            "-c",
            `source '${TOOLS}/lib/error-handling.bash'\n` +
            `source '${TOOLS}/lib/providers/provider-core.bash'\n` +
            `PROVIDER_NAME=${prov}\n` +
            `provider_load http urls auth repos issues prs pipelines projects org policies releases 2>/dev/null\n` +
            `${verb} ${pos} ${opt}`,
          ],
          { encoding: "utf8", env: ENV() },
        );
        const status = r.status ?? 1;
        const out = (r.stdout ?? "") + (r.stderr ?? "");
        if (status === 0 || status === 124 || !out.includes(opt)) failures.push(`${prov}:${verb}(${opt},rc=${status})`);
      }
    }
    expect(failures, `no named error for a missing value:${failures.join(" ")}`).toEqual([]);
  });

  it("every option arm that takes a value goes through provider_need_value", () => {
    const r = spawnSync(
      "bash",
      [
        "-c",
        `grep -rn 'shift 2 ;;' '${TOOLS}/lib/providers' --include=*.bash | grep -v provider_need_value | grep -vE ':[0-9]+:\\s+(have_body=true; )?shift 2 ;;$' || true`,
      ],
      { encoding: "utf8" },
    );
    const bad = (r.stdout ?? "").trim();
    expect(bad, bad).toBe("");
  });

  it("azure filters reject values they cannot honor instead of returning everything", () => {
    const cases: Array<[string, string, string]> = [
      ["provider_issues_list", "p/r --state bogus", "--state"],
      ["provider_issues_list", "p/r --limit abc", "--limit"],
      ["provider_prs_list", "p/r --limit abc", "--limit"],
      ["provider_prs_list", "p/r --limit 0", "--limit"],
      ["provider_pipelines_run_list", "p/r --status banana", "--status"],
      ["provider_pipelines_run_list", "p/r --limit x", "--limit"],
    ];
    const failures: string[] = [];
    for (const [verb, args, needle] of cases) {
      const r = spawnSync(
        "timeout",
        [
          "20",
          "bash",
          "-c",
          `source '${TOOLS}/lib/error-handling.bash'\n` +
          `source '${TOOLS}/lib/providers/provider-core.bash'\n` +
          `PROVIDER_NAME=azure\n` +
          `provider_load http urls auth repos issues prs pipelines projects org policies releases 2>/dev/null\n` +
          `${verb} ${args}`,
        ],
        { encoding: "utf8", env: ENV() },
      );
      const status = r.status ?? 1;
      const out = (r.stdout ?? "") + (r.stderr ?? "");
      if (status === 0 || !out.includes(needle)) failures.push(`${verb}(${args},rc=${status})`);
    }
    expect(failures, `filters accepted an unusable value:${failures.join(" ")}`).toEqual([]);
  });

  it("the contract defines the --status words, and the Azure provider accepts every one of them", () => {
    const contract = (spawnSync("bash", ["-c", `cat '${CONTRACT}'`], { encoding: "utf8" }).stdout ?? "");
    for (const word of ["queued", "in_progress", "completed", "success", "failure", "cancelled"]) {
      expect(contract, `contract missing status word ${word}`).toContain(`\`${word}\``);
      writeFileSync(join(TMP, "empty-builds.json"), '{"value":[]}');
      const r = spawnSync(
        "timeout",
        [
          "20",
          "bash",
          "-c",
          `source '${TOOLS}/lib/error-handling.bash'\n` +
          `source '${TOOLS}/lib/providers/provider-core.bash'\n` +
          `PROVIDER_NAME=azure\n` +
          `provider_load http urls auth repos issues prs pipelines projects org policies releases 2>/dev/null\n` +
          `provider_pipelines_run_list --status ${word}`,
        ],
        { encoding: "utf8", env: ENV({ STUB_CURL_RESPONSE: join(TMP, "empty-builds.json") }) },
      );
      expect(r.status ?? 1, `azure rejected the contract word '${word}': ${(r.stdout ?? "") + (r.stderr ?? "")}`).toBe(0);
    }
  });
});
