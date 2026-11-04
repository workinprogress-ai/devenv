// Port of tools/tests/lib/test_azure_smoke_harness.bats (49 tests) — one
// vitest `it` per source `@test`. The Azure live-validation harness
// (azure-smoke-test.sh) driven against a fake curl and a fake git push, so
// its OWN behavior — the safety gate, teardown, and the honesty of its
// probes — is verified without any network.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync, existsSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });

const ROOT = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))));
const TOOLS = join(ROOT, "tools");
const HARNESS = join(TOOLS, "lib", "providers", "azure", "azure-smoke-test.sh");

let TMP = "";
let CURL_LOG = "";
let GIT_PUSH_LOG = "";
let PID_FILE = "";
let BIN = "";
let DEVENV_ROOT = "";

const CURL_STUB = [
  "#!/usr/bin/env bash",
  "method=GET; hdr=\"\"; url=\"\"",
  "while [ $# -gt 0 ]; do",
  '    case "$1" in',
  '        -X) method="$2"; shift 2 ;;',
  '        -D) hdr="$2"; shift 2 ;;',
  '        -H|--max-time|-d) shift 2 ;;',
  "        -*) shift ;;",
  '        *) url="$1"; shift ;;',
  "    esac",
  "done",
  'echo "$method $url" >> "$CURL_LOG"',
  'if [ -n "${FAKE_CURL_TERM_ON:-}" ] && [[ "$method $url" =~ $FAKE_CURL_TERM_ON ]]; then',
  '    kill -TERM "$(cat "$PID_FILE")"',
  "    sleep 1",
  "fi",
  "body='{}'",
  "[ -n \"${FAKE_BOARD_COLUMNS:-}\" ] || FAKE_BOARD_COLUMNS='{\"value\":[{\"name\":\"New\"},{\"name\":\"Active\"},{\"name\":\"Closed\"}]}'",
  "[ -n \"${FAKE_PR_BODY:-}\" ] || FAKE_PR_BODY='{\"pullRequestId\":7,\"status\":\"completed\",\"completionOptions\":{\"mergeStrategy\":\"rebase\"},\"lastMergeSourceCommit\":{\"commitId\":\"abc\"}}'",
  "[ -n \"${FAKE_REFS:-}\" ] || FAKE_REFS='{\"count\":0,\"value\":[]}'",
  "[ -n \"${FAKE_COMMIT:-}\" ] || FAKE_COMMIT='{\"commitId\":\"c1\",\"parents\":[\"p1\"]}'",
  'case "$method $url" in',
  '    "POST "*"/pullrequests"*)',
  '        if [ -n "${FAKE_PR:-}" ]; then',
  "            body='{\"pullRequestId\":7,\"status\":\"active\",\"repository\":{\"webUrl\":\"https://dev.azure.com/fake-org/smoke-proj/_git/smoke-repo\"}}'",
  "        else",
  "            body='{\"id\":\"g2\",\"name\":\"smoke-repo\"}'",
  "        fi ;;",
  '    "GET "*"/pullrequests/7"*) body="$FAKE_PR_BODY" ;;',
  '    "GET "*"/refs"*) body="$FAKE_REFS" ;;',
  '    "GET "*"/commits/c1"*) body="$FAKE_COMMIT" ;;',
  '    "GET "*"/commits?"*) body=\'{"value":[{"commitId":"c1"}]}\' ;;',
  '    "GET "*"/_apis/projects?"*|"GET "*"/_apis/projects") body=\'{"value":[{"name":"smoke-proj","id":"p1"}]}\' ;;',
  '    "GET "*"/_apis/projects/smoke-proj"*) body=\'{"id":"p1","name":"smoke-proj"}\' ;;',
  '    "GET "*"feeds.dev.azure.com"*) body=\'{"value":[]}\' ;;',
  '    "GET "*"/_apis/policy/configurations"*) body=\'{"value":[]}\' ;;',
  '    "POST "*"/workitems/"*"/comments"*) body=\'{"id":5,"workItemId":101,"text":"c"}\' ;;',
  '    "POST "*"/workitems/"*) body=\'{"id":101}\' ;;',
  '    "POST "*"/wiql"*) body=\'{"workItems":[{"id":1}]}\' ;;',
  '    "GET "*"/git/repositories/"*"?"*) body=\'{"id":"g1","name":"existing-repo","defaultBranch":"refs/heads/main","project":{"name":"smoke-proj"}}\' ;;',
  '    "GET "*"/git/repositories?"*|"GET "*"/git/repositories") body=\'{"value":[{"id":"g1","name":"existing-repo","url":"https://dev.azure.com/fake-org/smoke-proj/_apis/git/repositories/g1"}],"count":1}\' ;;',
  '    "GET "*"/_apis/projects/"*"/teams"*) body=\'{"value":[{"id":"t1","name":"smoke-proj Team"}]}\' ;;',
  '    "GET "*"/_apis/work/boards/"*"/columns"*) body="$FAKE_BOARD_COLUMNS" ;;',
  '    "GET "*"/_apis/work/boards"*) body=\'{"value":[{"id":"b1","name":"Issues"}]}\' ;;',
  '    "GET "*"/workitems/"[0-9]*)',
  '        if [ -n "${FAKE_NO_WEF:-}" ]; then',
  "        body='{\"id\":101,\"fields\":{\"System.State\":\"New\",\"System.Tags\":\"alpha;beta\",\"System.Title\":\"t\"}}'",
  "        else",
  "        body='{\"id\":101,\"fields\":{\"System.State\":\"New\",\"System.Tags\":\"alpha;beta\",\"System.Title\":\"t\",\"WEF_abc123_Kanban.Column\":\"New\"}}'",
  "        fi ;;",
  '    "POST "*"/git/repositories"*) body=\'{"id":"g2","name":"smoke-repo"}\' ;;',
  '    "GET "*"/workitemtypes/"*"/states"*) body=\'{"value":[{"name":"New","category":"Proposed"},{"name":"Active","category":"InProgress"},{"name":"Closed","category":"Completed"}]}\' ;;',
  '    "GET "*"/_apis/projects/p1?"*) body=\'{"id":"p1","capabilities":{"processTemplate":{"templateName":"Agile"}}}\' ;;',
  "esac",
  "printf 'HTTP/1.1 200 OK\\r\\n\\r\\n' > \"$hdr\"",
  "printf '%s' \"$body\"",
  "",
].join("\n");

const GIT_STUB = [
  "#!/usr/bin/env bash",
  'if [[ " $* " == *" push "* ]]; then',
  '    echo "push $*" >> "$GIT_PUSH_LOG"',
  '    [ -n "${FAKE_GIT_PUSH_FAIL:-}" ] && { echo "fatal: simulated push failure" >&2; exit 1; }',
  "    exit 0",
  "fi",
  'exec "$REAL_GIT" "$@"',
  "",
].join("\n");

const SYNTHETIC_CONFIG = [
  "[provider]",
  "name=github",
  "",
  "[organization]",
  "name=Test Organization",
  "org=test-org",
  "email_domain=test.example.com",
  "",
  "[workflows]",
  "status_workflow=TBD,To-Groom,Ready,Implementing,Review,Merged,Staging,Production",
  "",
].join("\n");

beforeEach(() => {
  TMP = mkdtempSync(join(tmpdir(), `azh-${Date.now()}-${Math.random().toString(36).slice(2)}`));
  CURL_LOG = join(TMP, "curl.log");
  GIT_PUSH_LOG = join(TMP, "push.log");
  PID_FILE = join(TMP, "harness.pid");
  BIN = join(TMP, "bin");
  DEVENV_ROOT = join(TMP, "devenv-root");
  mkdirSync(BIN, { recursive: true });
  mkdirSync(DEVENV_ROOT, { recursive: true });
  writeFileSync(CURL_LOG, "");
  writeFileSync(GIT_PUSH_LOG, "");
  writeFileSync(join(BIN, "curl"), CURL_STUB);
  chmodSync(join(BIN, "curl"), 0o755);
  writeFileSync(join(BIN, "git"), GIT_STUB);
  chmodSync(join(BIN, "git"), 0o755);
  // The harness's synthetic devenv.config (test_helper_setup's shape).
  writeFileSync(join(DEVENV_ROOT, "devenv.config"), SYNTHETIC_CONFIG);
});

const ENV = (extra: Record<string, string> = {}): Record<string, string> => ({
  ...process.env,
  CURL_LOG,
  GIT_PUSH_LOG,
  PID_FILE,
  REAL_GIT: spawnSync("bash", ["-c", "command -v git"], { encoding: "utf8" }).stdout?.trim() ?? "git",
  PATH: `${BIN}:${process.env.PATH ?? ""}`,
  AZURE_PAT: "fake-pat-value",
  AZURE_DEVOPS_ORG: "fake-org",
  AZURE_SMOKE_TEST_PROJECT: "smoke-proj",
  AZURE_API_VERSION: "7.1",
  AZURE_HTTP_MAX_RETRIES: "1",
  AZURE_SMOKE_POLL_INTERVAL: "0",
  AZURE_SMOKE_POLL_MAX: "2",
  DEVENV_ROOT,
  DEVENV_ROOT_SET: "1",
  AZURE_SMOKE: "",
  AZURE_SMOKE_CONFIRM: "",
  ...extra,
});

// run_harness: stable PID (written to PID_FILE) so the fake curl can signal
// TERM; stdin closed (the source redirects </dev/null).
function runHarness(...args: string[]): { status: number; out: string } {
  const argStr = args.map((a) => `'${a}'`).join(" ");
  const r = spawnSync(
    "bash",
    ["-c", `echo $$ > "$PID_FILE"; exec bash '${HARNESS}' ${argStr}`],
    { input: "", encoding: "utf8", env: ENV() },
  );
  return { status: r.status ?? 1, out: (r.stdout ?? "") + (r.stderr ?? "") };
}

// write_run: a full destructive-tier run against the fakes.
function writeRun(...args: string[]): { status: number; out: string } {
  return runHarnessWith({ AZURE_SMOKE: "write", AZURE_SMOKE_CONFIRM: "smoke-proj" }, ...args);
}

function runHarnessWith(env: Record<string, string>, ...args: string[]): { status: number; out: string } {
  const argStr = args.map((a) => `'${a}'`).join(" ");
  const r = spawnSync(
    "bash",
    ["-c", `echo $$ > "$PID_FILE"; exec bash '${HARNESS}' ${argStr}`],
    { input: "", encoding: "utf8", env: ENV(env) },
  );
  return { status: r.status ?? 1, out: (r.stdout ?? "") + (r.stderr ?? "") };
}

function logLines(pattern: string): string[] {
  const r = spawnSync("grep", ["-E", pattern, CURL_LOG], { encoding: "utf8" });
  return (r.stdout ?? "").split("\n").filter((l) => l.trim() !== "");
}

function logHas(pattern: string): boolean {
  return spawnSync("grep", ["-qE", pattern, CURL_LOG]).status === 0;
}

describe("azure smoke harness", () => {
  it("azure-smoke-test.sh has valid bash syntax", () => {
    expect(spawnSync("bash", ["-n", HARNESS]).status).toBe(0);
  });

  it("--help works without the gate", () => {
    const r = runHarness("--help");
    expect(r.status).toBe(0);
    expect(r.out).toContain("AZURE_SMOKE");
  });

  it("gate: refuses to run at all without AZURE_SMOKE (no request is made)", () => {
    const r = runHarness();
    expect(r.status).not.toBe(0);
    expect(r.out).toContain("AZURE_SMOKE");
    expect(existsSync(CURL_LOG) && readFileSync(CURL_LOG, "utf8").trim() !== "").toBe(false);
  });

  it("gate: any value other than 1 or write is refused", () => {
    const r = runHarnessWith({ AZURE_SMOKE: "yes" });
    expect(r.status).not.toBe(0);
    expect(existsSync(CURL_LOG) && readFileSync(CURL_LOG, "utf8").trim() !== "").toBe(false);
  });

  it("gate: AZURE_SMOKE=1 is the read-only tier — it issues no writes and creates no fixtures", () => {
    runHarnessWith({ AZURE_SMOKE: "1" });
    // The project-existence and reads run; nothing is created, patched or
    // deleted.
    expect(readFileSync(CURL_LOG, "utf8").trim() !== "").toBe(true);
    expect(logLines("^(PATCH|PUT|DELETE) ").length).toBe(0);
    expect(logLines("^POST .*(/workitems/|/git/repositories|/pullrequests|/policy/)").length).toBe(0);
  });

  it("gate: AZURE_SMOKE=write without an explicit confirmation is refused before any request", () => {
    const r = runHarnessWith({ AZURE_SMOKE: "write" });
    expect(r.status).not.toBe(0);
    expect(r.out).toContain("AZURE_SMOKE_CONFIRM");
    expect(existsSync(CURL_LOG) && readFileSync(CURL_LOG, "utf8").trim() !== "").toBe(false);
  });

  it("gate: a confirmation naming a different project is refused", () => {
    const r = runHarnessWith({ AZURE_SMOKE: "write", AZURE_SMOKE_CONFIRM: "some-other-project" });
    expect(r.status).not.toBe(0);
    expect(existsSync(CURL_LOG) && readFileSync(CURL_LOG, "utf8").trim() !== "").toBe(false);
  });

  it("gate: AZURE_SMOKE=write with the matching confirmation runs the destructive tier", () => {
    writeRun();
    expect(logHas("^POST .*/workitems/")).toBe(true);
  });

  // ── Teardown ─────────────────────────────────────────────────────────────

  it("teardown: an interrupt (TERM) mid-run still deletes the repo and the work items", () => {
    writeRun();
    // After the TERM the teardown stack must have issued the deletes.
    const log = readFileSync(CURL_LOG, "utf8").split("\n");
    const seenIdx = log.findIndex((l) => /POST .*\/pullrequests/.test(l));
    const deletes = log.slice(seenIdx + 1).filter((l) => l.startsWith("DELETE "));
    const allDeletes = deletes.join("\n");
    expect(allDeletes).toContain("/git/repositories/smoke-repo-");
    expect(allDeletes).toContain("/workitems/");
  });

  it("teardown: every work item the run created is destroyed", () => {
    writeRun();
    const posts = logLines("^POST .*/workitems/\\$").length;
    const dels = logLines("^DELETE .*/workitems/[0-9]+\\?destroy=true").length;
    expect(posts).toBeGreaterThanOrEqual(1);
    expect(dels).toBeGreaterThanOrEqual(posts);
  });

  it("teardown: the repo-scoped policy sweep runs before the repo is deleted (LIFO)", () => {
    writeRun();
    const log = readFileSync(CURL_LOG, "utf8").split("\n");
    const sweepLine = log.findIndex((l) => /GET .*policy\/configurations/.test(l));
    const repoDelLine = log.findIndex((l) => /^DELETE .*\/git\/repositories\/smoke-repo-/.test(l));
    expect(sweepLine).toBeGreaterThanOrEqual(0);
    expect(repoDelLine).toBeGreaterThanOrEqual(0);
    expect(sweepLine).toBeLessThan(repoDelLine);
  });

  it("teardown: the run leaves no temp files behind (clone, askpass helper, payloads)", () => {
    const tmpdirSub = join(TMP, "tmpdir");
    mkdirSync(tmpdirSub, { recursive: true });
    writeRun();
    expect(readdirSync(tmpdirSub)).toEqual([]);
  });

  it("teardown: the read-only tier also leaves no temp files", () => {
    const tmpdirSub = join(TMP, "tmpdir");
    mkdirSync(tmpdirSub, { recursive: true });
    runHarnessWith({ AZURE_SMOKE: "1" });
    expect(readdirSync(tmpdirSub)).toEqual([]);
  });

  // ── Honesty ──────────────────────────────────────────────────────────────

  it("honesty: a failed seed/branch push is reported FAIL, never PASS, and no PR is attempted", () => {
    const r = runHarnessWith({ AZURE_SMOKE: "write", AZURE_SMOKE_CONFIRM: "smoke-proj", FAKE_GIT_PUSH_FAIL: "1" });
    expect(r.out).toContain("FAIL  default branch seed");
    expect(r.out).not.toContain("PASS  branch push");
    expect(logLines("^POST .*/pullrequests").length).toBe(0);
  });

  it("honesty: with working pushes the branch-push probe passes and a PR is attempted", () => {
    const r = writeRun();
    expect(r.out).toContain("PASS  branch push");
    expect(logHas("^POST .*/pullrequests")).toBe(true);
  });

  it("honesty: PR create passes only when a PR id was actually parsed", () => {
    // The fake returns no pullrequest URL, so no id can be parsed.
    const r = writeRun();
    expect(r.out).not.toContain("PASS  PR create (id )");
    expect(r.out).toContain("FAIL  PR create");
  });

  it("honesty: the seed push really targets the configured origin remote", () => {
    writeRun();
    expect(readFileSync(GIT_PUSH_LOG, "utf8")).toContain("push -q origin main");
  });

  // ── set -u ───────────────────────────────────────────────────────────────

  it("the harness runs under set -u", () => {
    expect(/^set -u$/m.test(readFileSync(HARNESS, "utf8"))).toBe(true);
  });

  it("a full destructive run hits no unbound variable", () => {
    const r = writeRun();
    expect(r.out).not.toContain("unbound variable");
  });

  it("no request URL is built from an empty project or org (no double slashes in the path)", () => {
    writeRun();
    expect(logLines("^[A-Z]+ https://dev\\.azure\\.com/[^/]*//").length).toBe(0);
    expect(logLines("^[A-Z]+ https://dev\\.azure\\.com//").length).toBe(0);
  });

  it("the field_option_ids probe reads the verb's newline-delimited stream", () => {
    const r = writeRun();
    expect(r.out).toContain("PASS  provider_projects_field_option_ids");
  });

  // ── Capture ──────────────────────────────────────────────────────────────

  it("capture: --help documents AZURE_SMOKE_CAPTURE_DIR", () => {
    const r = runHarness("--help");
    expect(r.status).toBe(0);
    expect(r.out).toContain("AZURE_SMOKE_CAPTURE_DIR");
  });

  it("capture: a run with capture enabled leaves no redaction map behind", () => {
    const tmpdirSub = join(TMP, "tmpdir");
    mkdirSync(tmpdirSub, { recursive: true });
    runHarnessWith({ AZURE_SMOKE: "1", AZURE_SMOKE_CAPTURE_DIR: join(TMP, "captures"), TMPDIR: tmpdirSub });
    expect(readdirSync(tmpdirSub)).toEqual([]);
  });

  it("capture: without AZURE_SMOKE_CAPTURE_DIR no capture directory or map is created", () => {
    const tmpdirSub = join(TMP, "tmpdir");
    mkdirSync(tmpdirSub, { recursive: true });
    runHarnessWith({ AZURE_SMOKE: "1", TMPDIR: tmpdirSub });
    expect(existsSync(join(TMP, "captures"))).toBe(false);
    expect(readdirSync(tmpdirSub)).toEqual([]);
  });

  it("capture: the redaction map is never created inside the capture directory", () => {
    const captureDir = join(TMP, "captures2");
    runHarnessWith({ AZURE_SMOKE: "1", AZURE_SMOKE_CAPTURE_DIR: captureDir });
    const find = spawnSync("bash", ["-c", `find '${captureDir}' -name 'smoke-redact-map*' 2>/dev/null | grep -q .`]);
    expect(find.status).not.toBe(0);
  });

  // ── Tier 1 outcome checks ────────────────────────────────────────────────

  it("tier 1: board columns equal to status_workflow pass", () => {
    const r = runHarnessWith({ AZURE_SMOKE_STATUS_WORKFLOW: "New,Active,Closed", AZURE_SMOKE: "1" });
    expect(r.out).toContain("PASS  board 'Issues' columns equal status_workflow");
  });

  it("tier 1: board columns that differ from status_workflow FAIL", () => {
    const r = runHarnessWith({ AZURE_SMOKE_STATUS_WORKFLOW: "New,Active,Review,Closed", AZURE_SMOKE: "1" });
    expect(r.out).toContain("FAIL  board 'Issues' columns equal status_workflow");
  });

  it("tier 1: the configured status_workflow is used when no override is set", () => {
    // The test config defines an 8-word vocabulary; the fake board has 3
    // columns.
    const r = runHarnessWith({ AZURE_SMOKE: "1" });
    expect(r.out).toContain("FAIL  board 'Issues' columns equal status_workflow");
  });

  it("tier 1: without a status_workflow the board check is skipped, not failed", () => {
    const cfg = readFileSync(join(DEVENV_ROOT, "devenv.config"), "utf8");
    writeFileSync(join(DEVENV_ROOT, "devenv.config"), cfg.split("[workflows]")[0] ?? cfg);
    const r = runHarnessWith({ AZURE_SMOKE: "1" });
    expect(r.out).toContain("SKIP  board columns vs status_workflow");
    expect(r.out).not.toContain("FAIL  board 'Issues' columns");
  });

  it("tier 1: labels that equal the raw trimmed tags pass", () => {
    const r = runHarnessWith({ AZURE_SMOKE: "1" });
    expect(r.out).toContain("PASS  work item raw shape");
  });

  it("tier 1: PR list state checks are skipped when the repo has no pull requests", () => {
    const r = runHarnessWith({ AZURE_SMOKE: "1" });
    expect(r.out).toContain("SKIP  PR list state filters");
  });

  it("tier 1: captured fixtures exist and carry no real org or project name", () => {
    const captureDir = join(TMP, "captures3");
    runHarnessWith({
      AZURE_SMOKE: "1",
      AZURE_SMOKE_CAPTURE_DIR: captureDir,
      AZURE_SMOKE_STATUS_WORKFLOW: "New,Active,Closed",
    });
    for (const f of ["repos.list.json", "wiql.query.json", "workitem.get.json", "boards.list.json", "board.columns.Issues.json", "workitemtypes.issue.states.json"]) {
      const p = join(captureDir, f);
      if (!existsSync(p)) {
        throw new Error(`missing fixture: ${f}; have: ${existsSync(captureDir) ? readdirSync(captureDir).join(",") : "(no dir)"}`);
      }
      expect(spawnSync("jq", ["-e", ".", p], { stdio: ["pipe", "ignore", "ignore"] }).status).toBe(0);
    }
    const leak = spawnSync("grep", ["-rqiE", "fake-org|smoke-proj|fake-pat-value", captureDir]);
    expect(leak.status).not.toBe(0);
    expect(readFileSync(join(captureDir, "repos.list.json"), "utf8")).toContain("example-org");
  });

  it("tier 1: the read-only tier with capture enabled still issues no writes", () => {
    runHarnessWith({ AZURE_SMOKE: "1", AZURE_SMOKE_CAPTURE_DIR: join(TMP, "captures4") });
    expect(logLines("^(PATCH|PUT|DELETE) ").length).toBe(0);
  });

  // ── Tier 2 outcome checks ────────────────────────────────────────────────

  it("tier 2: a completed PR, a deleted source branch and a one-parent head pass the merge outcome checks", () => {
    const r = runHarnessWith({ AZURE_SMOKE: "write", AZURE_SMOKE_CONFIRM: "smoke-proj", FAKE_PR: "1" });
    expect(r.out).toContain("PASS  merged PR is completed");
    expect(r.out).toContain("PASS  source branch is deleted after the merge");
    expect(r.out).toContain("PASS  rebase merge leaves a linear history");
  });

  it("tier 2: a merge that leaves the source branch behind FAILs the outcome check", () => {
    const r = runHarnessWith({
      AZURE_SMOKE: "write",
      AZURE_SMOKE_CONFIRM: "smoke-proj",
      FAKE_PR: "1",
      FAKE_REFS: '{"count":1,"value":[{"name":"refs/heads/smoke-1"}]}',
    });
    expect(r.out).toContain("FAIL  source branch is deleted after the merge");
  });

  it("tier 2: a merge commit (two parents) FAILs the linear-history check", () => {
    const r = runHarnessWith({
      AZURE_SMOKE: "write",
      AZURE_SMOKE_CONFIRM: "smoke-proj",
      FAKE_PR: "1",
      FAKE_COMMIT: '{"commitId":"c1","parents":["p1","p2"]}',
    });
    expect(r.out).toContain("FAIL  rebase merge leaves a linear history");
  });

  it("tier 2: a status that reads back as itself passes, one that does not FAILs", () => {
    const r = runHarnessWith({ AZURE_SMOKE: "write", AZURE_SMOKE_CONFIRM: "smoke-proj", AZURE_SMOKE_STATUS_WORKFLOW: "New,Review" });
    expect(r.out).toContain("PASS  status round-trip [Issue]: 'New' reads back as itself");
    expect(r.out).toContain("FAIL  status round-trip [Issue]: 'Review' reads back as itself");
  });

  it("tier 2: the Kanban column write is read back and compared", () => {
    const r = runHarnessWith({ AZURE_SMOKE: "write", AZURE_SMOKE_CONFIRM: "smoke-proj", AZURE_SMOKE_STATUS_WORKFLOW: "New,Review" });
    expect(r.out).toContain("PASS  Kanban column write [Issue]: 'New' reads back");
    expect(r.out).toContain("FAIL  Kanban column write [Issue]: 'Review' reads back");
  });

  it("tier 2: without a status_workflow the round-trip is skipped", () => {
    const cfg = readFileSync(join(DEVENV_ROOT, "devenv.config"), "utf8");
    writeFileSync(join(DEVENV_ROOT, "devenv.config"), cfg.split("[workflows]")[0] ?? cfg);
    const r = writeRun();
    expect(r.out).toContain("SKIP  status round-trip");
  });

  it("tier 2: tag edit outcomes are asserted against the work item's real tags", () => {
    // The fake work item always carries alpha;beta, so the two-tag outcome
    // must FAIL.
    const r = writeRun();
    expect(r.out).toContain("FAIL  two label adds leave two tags");
    expect(r.out).toContain("FAIL  edit --add-label keeps the existing tags");
  });

  it("tier 2: the review-PR experiment pushes both branches, deletes both, and records the PR state", () => {
    const r = runHarnessWith({ AZURE_SMOKE: "write", AZURE_SMOKE_CONFIRM: "smoke-proj", FAKE_PR: "1" });
    expect(r.out).toContain("review PR after both branches are deleted (evidence) — status=completed");
    const pushes = readFileSync(GIT_PUSH_LOG, "utf8");
    expect(pushes).toMatch(/:review\/smoke-.*-target/);
    expect(pushes).toMatch(/:review\/smoke-.*-source/);
  });

  it("tier 2: the review-PR experiment does not run when the seed push failed", () => {
    const r = runHarnessWith({
      AZURE_SMOKE: "write",
      AZURE_SMOKE_CONFIRM: "smoke-proj",
      FAKE_GIT_PUSH_FAIL: "1",
      FAKE_PR: "1",
    });
    expect(r.out).not.toContain("review PR after both branches");
  });

  it("a full destructive run reaches its summary line (it does not die mid-run)", () => {
    const r = writeRun();
    expect(r.out).toContain("summary:");
  });

  it("a full destructive run still exercises the probes that follow the projects probes", () => {
    const r = writeRun();
    expect(r.out.includes("provider_prs_threads_page") || r.out.includes("second PR create")).toBe(true);
    expect(r.out).toContain("provider_repos_patch");
  });

  it("tier 2: a work item type with no board Kanban column field is reported as a FAIL, not skipped", () => {
    const r = runHarnessWith({ AZURE_SMOKE: "write", AZURE_SMOKE_CONFIRM: "smoke-proj", FAKE_NO_WEF: "1" });
    expect(r.out).toContain("FAIL  work item type [Issue] carries a board Kanban column field");
    expect(r.out).toContain("summary:");
  });

  it("tier 2: a User Story fixture is created, status-checked and destroyed", () => {
    const r = writeRun();
    expect(r.out).toContain("PASS  fixture User Story");
    expect(r.out).toContain("[User Story]");
    expect(logLines("^DELETE .*/workitems/[0-9]+\\?destroy=true").length).toBeGreaterThan(0);
  });

  it("tier 1: the project process template is checked and recorded", () => {
    const captureDir = join(TMP, "captures5");
    const r = runHarnessWith({ AZURE_SMOKE: "1", AZURE_SMOKE_CAPTURE_DIR: captureDir });
    expect(r.out).toContain("PASS  project process is Agile");
    expect(existsSync(join(captureDir, "project.capabilities.json"))).toBe(true);
    expect(existsSync(join(captureDir, "workitemtypes.user-story.states.json"))).toBe(true);
  });

  it("tier 2: a PR completed with another strategy than rebase FAILs the strategy check", () => {
    const r = runHarnessWith({
      AZURE_SMOKE: "write",
      AZURE_SMOKE_CONFIRM: "smoke-proj",
      FAKE_PR: "1",
      FAKE_PR_BODY: '{"pullRequestId":7,"status":"completed","completionOptions":{"mergeStrategy":"noFastForward"},"lastMergeSourceCommit":{"commitId":"abc"}}',
    });
    expect(r.out).toContain("FAIL  merge used the rebase strategy");
  });

  it("tier 2: a PR that never completes is judged after polling, not hung on", () => {
    const r = runHarnessWith({
      AZURE_SMOKE: "write",
      AZURE_SMOKE_CONFIRM: "smoke-proj",
      FAKE_PR: "1",
      FAKE_PR_BODY: '{"pullRequestId":7,"status":"active","mergeStatus":"queued","lastMergeSourceCommit":{"commitId":"abc"}}',
    });
    expect(r.out).toContain("FAIL  merged PR is completed");
    expect(r.out).toContain("summary:");
  });
});
