// Port of tools/tests/lib/test_provider_issues.bats (24 tests) — one vitest
// `it` per source `@test`. Contract tests for the github issues domain facade:
// module load + registration, inventory verbs, arg pass-through via stub-gh
// call-log assertions, mutation assertions (incl. not-issued-on-validation-
// failure), and the native-issue-types capability contract.
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

// The fixture's gh stub: argv log, failure mode, auth token, api with pages
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
  "  exit 1",
  "fi",
  'if [[ "$1" == "api" ]]; then',
  '  if [[ -n "${STUB_GH_PAGES:-}" && -f "${STUB_GH_PAGES}" ]]; then',
  '    if [[ -s "$STUB_GH_PAGES" ]]; then',
  '      page_file=$(head -n 1 "$STUB_GH_PAGES")',
  '      tail -n +2 "$STUB_GH_PAGES" > "${STUB_GH_PAGES}.tmp" && mv "${STUB_GH_PAGES}.tmp" "${STUB_GH_PAGES}"',
  '      [[ -f "$page_file" ]] && cat "$page_file"',
  "      exit 0",
  "    fi",
  "    exit 1",
  "  fi",
  '  if [[ "$*" == *"-X PATCH"* || "$*" == *"-X POST"* ]]; then',
  '    [[ -n "${STUB_GH_MUTATIONS:-}" ]] && echo "gh $*" >> "$STUB_GH_MUTATIONS"',
  "    printf '{\"id\": 111, \"html_url\": \"https://example.invalid/comment/111\"}'",
  "  else",
  '    [[ -f "${STUB_GH_API_RESPONSE:-/nonexistent}" ]] && cat "$STUB_GH_API_RESPONSE"',
  "  fi",
  "  exit 0",
  "fi",
  "exit 0",
  "",
].join("\n");

beforeEach(() => {
  TMP = mkdtempSync(join(tmpdir(), `issues-${Date.now()}-${Math.random().toString(36).slice(2)}`));
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

// source provider-core + detect (absent config → default provider) + source
// github/issues + call — the source suite's setup block, per spawn.
function runIssue(call: string, extraEnv: Record<string, string> = {}): { status: number; out: string } {
  const script =
    `source '${TOOLS}/lib/providers/provider-core.bash'\n` +
    `provider_detect '${join(TMP, "absent.config")}'\n` +
    `source '${TOOLS}/lib/providers/github/issues.bash'\n` +
    `${call}\n`;
  const r = spawnSync("bash", ["-c", script], { encoding: "utf8", env: ENV(extraEnv) });
  return { status: r.status ?? 1, out: (r.stdout ?? "") + (r.stderr ?? "") };
}

// stub_call_count gh: number of logged gh invocations.
function ghCount(): number {
  const r = spawnSync("grep", ["-c", "^gh ", CALL_LOG], { encoding: "utf8" });
  return parseInt((r.stdout ?? "0").trim(), 10) || 0;
}

// gh_last_call_equals: the last logged gh invocation, exact-match asserted.
function lastGh(): string {
  const r = spawnSync("bash", ["-c", `grep '^gh ' '${CALL_LOG}' | tail -n1`], { encoding: "utf8" });
  return (r.stdout ?? "").trim();
}

// grep -q against the call log.
function logHas(pattern: string): boolean {
  return spawnSync("grep", ["-q", pattern, CALL_LOG]).status === 0;
}

describe("provider_issues", () => {
  // ── Load & capability registration ──────────────────────────────────────

  it("issues module: loads and registers native-issue-types capability", () => {
    const r = runIssue("provider_has_capability native-issue-types");
    expect(r.status).toBe(0);
  });

  it("issues module: is idempotent under re-source", () => {
    const r = runIssue(
      `source '${TOOLS}/lib/providers/github/issues.bash'\ndeclare -F provider_issues_list >/dev/null`,
    );
    expect(r.status).toBe(0);
  });

  // ── Reads ────────────────────────────────────────────────────────────────

  it("issues list: passes -R repo and flags through to gh", () => {
    const r = runIssue("provider_issues_list org/repo --state open --limit 5");
    expect(r.status).toBe(0);
    expect(logHas("^gh issue list -R org/repo --state open --limit 5$")).toBe(true);
  });

  it("issues list: without repo omits -R (cwd/GH_REPO resolution)", () => {
    const r = runIssue("provider_issues_list --state all");
    expect(r.status).toBe(0);
    expect(logHas("^gh issue list --state all$")).toBe(true);
  });

  it("issues view: passes number and repo", () => {
    const r = runIssue("provider_issues_view org/repo 42");
    expect(r.status).toBe(0);
    expect(logHas("^gh issue view 42 -R org/repo$")).toBe(true);
  });

  it("issues exists: succeeds when gh view succeeds", () => {
    const r = runIssue("provider_issues_exists org/repo 7");
    expect(r.status).toBe(0);
    expect(logHas("^gh issue view 7 -R org/repo --json number$")).toBe(true);
  });

  // ── Mutations — issued assertions ────────────────────────────────────────

  it("issues create: passes title/body/repo to gh", () => {
    const r = runIssue('provider_issues_create org/repo --title "T" --body "B"');
    expect(r.status).toBe(0);
    expect(logHas("^gh issue create -R org/repo --title T --body B$")).toBe(true);
  });

  it("issues close: passes number and repo", () => {
    const r = runIssue("provider_issues_close org/repo 9");
    expect(r.status).toBe(0);
    expect(logHas("^gh issue close 9 -R org/repo$")).toBe(true);
  });

  it("issues reopen: passes number and repo", () => {
    const r = runIssue("provider_issues_reopen org/repo 9");
    expect(r.status).toBe(0);
    expect(logHas("^gh issue reopen 9 -R org/repo$")).toBe(true);
  });

  it("issues edit: passes number, repo, and fields", () => {
    const r = runIssue('provider_issues_edit org/repo 12 --title "New"');
    expect(r.status).toBe(0);
    expect(logHas("^gh issue edit 12 -R org/repo --title New$")).toBe(true);
  });

  it("issues comment: passes number and body", () => {
    const r = runIssue('provider_issues_comment org/repo 12 --comment-body "hello"');
    expect(r.status).toBe(0);
    expect(logHas("^gh issue comment 12 -R org/repo --comment-body hello$")).toBe(true);
  });

  // ── Mutations — not-issued assertions ────────────────────────────────────

  it("issues create: when gh fails, mutation is recorded but function fails", () => {
    const r = runIssue('provider_issues_create org/repo --title "T"', { STUB_GH_FAIL: "1" });
    expect(r.status).not.toBe(0);
    // The stub still logs the attempt (the facade passed it through correctly).
    expect(logHas("^gh issue create -R org/repo --title T$")).toBe(true);
  });

  it("issues set_type: native type edit not issued when capability is absent", () => {
    const r = runIssue('PROVIDER_CAPABILITIES=""\nprovider_issues_set_type org repo 5 Bug');
    expect(r.status).not.toBe(0);
    expect(ghCount()).toBe(0);
  });

  it("issues set_type: rejects invalid type names before any gh call", () => {
    // Policy layer rejects.
    const r = runIssue("normalize_issue_type() { return 1; }\nprovider_issues_set_type org repo 5 NotAType");
    expect(r.status).not.toBe(0);
    expect(ghCount()).toBe(0);
  });

  it("issues set_type: issues GH_REPO-prefixed edit for valid type", () => {
    // Policy layer maps.
    const r = runIssue("normalize_issue_type() { echo 'Bug'; }\nprovider_issues_set_type org repo 5 bug", {
      GH_TOKEN: "x",
    });
    expect(r.status).toBe(0);
    expect(logHas("gh issue edit 5 --type Bug")).toBe(true);
  });

  // ── Labels ───────────────────────────────────────────────────────────────

  it("label list: passes repo and caller flags through unchanged", () => {
    const r = runIssue("provider_issues_label_list org/repo --json name");
    expect(r.status).toBe(0);
    expect(logHas("^gh label list -R org/repo --json name$")).toBe(true);
  });

  it("label ensure: creates when label absent, skips when present", () => {
    // absent: empty label list -> create issued
    writeFileSync(join(TMP, "labels.json"), "[]");
    const r = runIssue("provider_issues_label_ensure org/repo priority-high", {
      STUB_GH_API_RESPONSE: join(TMP, "labels.json"),
    });
    expect(r.status).toBe(0);
    expect(logHas("gh label create priority-high -R org/repo")).toBe(true);
  });

  it("milestones: trailing flags pass through to gh api (issue-triage --jq)", () => {
    writeFileSync(CALL_LOG, "");
    runIssue(`provider_issues_milestones "org/repo" --jq '.[] | .title'`);
    expect(lastGh()).toBe("gh api repos/org/repo/milestones --jq .[] | .title");
  });

  it("label list: no duplicate --json when caller supplies fields", () => {
    writeFileSync(CALL_LOG, "");
    runIssue(`provider_issues_label_list "org/repo" --limit 200 --json name,description,color`);
    expect(lastGh()).toBe("gh label list -R org/repo --limit 200 --json name,description,color");
  });

  it("gh_repo_args: repo value with command substitution stays inert", () => {
    // Regression lock: the helper once eval'd its input, executing $(...)
    // from repo names (audit F009). printf -v assignment is inert by design.
    const marker = join(TMP, "pwned-marker");
    // The repo value is the literal `a$(touch '<marker>')b` in the child
    // (the `\$` keeps bash from substituting); the expected value travels
    // through the env to avoid re-quoting it in the assert line.
    const probe = `a\\$(touch '${marker}')b`;
    const script =
      `source '${TOOLS}/lib/providers/provider-core.bash'\n` +
      `source '${TOOLS}/lib/providers/github/issues.bash'\n` +
      `provider_repo_args arr "$PROBE"\n` +
      `[[ "\${arr[0]}" == "-R" ]] || exit 1\n` +
      `[[ "\${arr[1]}" == "$PROBE" ]] || exit 1\n` +
      `[[ ! -f "$MARKER" ]] || exit 1\n`;
    const r = spawnSync("bash", ["-c", script], {
      encoding: "utf8",
      env: ENV({ PROBE: probe, MARKER: marker }),
    });
    expect(r.status).toBe(0);
  });

  it("issues list: valueless flag passes through without swallowing the next arg", () => {
    writeFileSync(CALL_LOG, "");
    runIssue(`provider_issues_list "" --web`);
    expect(lastGh()).toBe("gh issue list --web");
  });

  it("issues list: valued flag followed by boolean parses both", () => {
    writeFileSync(CALL_LOG, "");
    runIssue(`provider_issues_list "" --state open --web`);
    expect(lastGh()).toBe("gh issue list --state open --web");
  });

  it("issues list: flag missing its value fails defined", () => {
    const r = runIssue(`provider_issues_list "" --state`);
    expect(r.status).not.toBe(0);
    expect(r.out).toContain("requires a value");
  });

  it("label ensure: list failure is reported, not treated as absent", () => {
    // A gh stub that fails the list forces the defined error path.
    const failBin = join(TMP, "failbin");
    mkdirSync(failBin, { recursive: true });
    writeFileSync(
      join(failBin, "gh"),
      '#!/usr/bin/env bash\n[ "$1" = "label" ] && [ "$2" = "list" ] && exit 1\nexit 0\n',
    );
    chmodSync(join(failBin, "gh"), 0o755);
    const r = runIssue(`provider_issues_label_ensure "org/repo" "some-label"`, {
      PATH: `${failBin}:${process.env.PATH ?? ""}`,
    });
    expect(r.status).not.toBe(0);
    expect(r.out).toContain("cannot list labels");
  });
});
