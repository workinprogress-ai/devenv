// Tests for the TS provider facade: provider-core (detect, repo targeting,
// capabilities, error contract) and the github issues domain (verbs over a
// stubbed gh; call-shape assertions via the invocation log), plus the
// artifacts domain's byte-faithful header parse.
//
// gh is stubbed on PATH; the facade modules are imported per-test with
// vi.resetModules + fresh env so module-level caching never leaks.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// gh stub: records argv ("gh <args>") to FACADE_CALL_LOG and answers from
// FACADE_RESPONSES (lines of `match-substring<TAB>json`, first match wins).
// Mirrors tools/tests/fixtures/cli-stubs.bash's stub_gh contract.
// ---------------------------------------------------------------------------

let stubDir = "";
let callLog = "";
let responses = "";
const configRoots: string[] = [];

function installGhStub(): void {
  const script = `#!/usr/bin/env bash
printf 'gh %s\n' "$(printf '%s' "$*" | tr '\n' '\\036')" >> "${callLog}"
if [ "\${FACADE_GH_FAIL:-0}" = "1" ]; then
  echo "stub-gh: simulated failure" >&2
  exit 1
fi
if [ -s "${responses}" ]; then
  while IFS= read -r line; do
    [ -z "\$line" ] && continue
    key="\${line%%\$'\\t'*}"
    val="\${line#*$'\\t'}"
    case "gh \$*" in
      *"\$key"*) printf '%s\\n' "\$val"; exit 0 ;;
    esac
  done < "${responses}"
fi
exit 0
`;
  writeFileSync(join(stubDir, "gh"), script, { mode: 0o755 });
}

function ghCalls(): string[] {
  if (!existsSync(callLog)) return [];
  return readFileSync(callLog, "utf8").split("\n").filter((l) => l.startsWith("gh "));
}

import type * as facadeCore from "../../lib/providers/provider-core.ts";
import type * as facadeIssues from "../../lib/providers/github/issues.ts";
import type * as facadeArtifacts from "../../lib/domain/artifacts.ts";
import type * as facadePrs from "../../lib/providers/github/prs.ts";
import type * as facadePipelines from "../../lib/providers/github/pipelines.ts";

interface Loaded {
  core: typeof facadeCore;
  issues: typeof facadeIssues;
  artifacts: typeof facadeArtifacts;
  prs: typeof facadePrs;
  pipelines: typeof facadePipelines;
}

/** Fresh-import the facade modules under a controlled env. Module state
 * (detected provider, declared capabilities) resets with the module graph. */
async function loadFacade(opts: { provider?: string; org?: string } = {}): Promise<Loaded> {
  const root = mkdtempSync(join(tmpdir(), "facade-cfg-"));
  configRoots.push(root);
  writeFileSync(
    join(root, "devenv.config"),
    `[provider]\nname=${opts.provider ?? "github"}\n\n[organization]\norg=${opts.org ?? "fixture-org"}\n`,
  );
  vi.resetModules();
  process.env.DEVENV_ROOT = root;
  const core = await import("../../lib/providers/provider-core.ts");
  const issues = await import("../../lib/providers/github/issues.ts");
  const artifacts = await import("../../lib/domain/artifacts.ts");
  const prs = await import("../../lib/providers/github/prs.ts");
  const pipelines = await import("../../lib/providers/github/pipelines.ts");
  return { core, issues, artifacts, prs, pipelines };
}

describe("provider-core (TS facade core)", () => {
  beforeEach(() => {
    stubDir = mkdtempSync(join(tmpdir(), "facade-stub-"));
    callLog = join(stubDir, "calls.log");
    responses = join(stubDir, "responses.tsv");
    writeFileSync(responses, "");
    installGhStub();
    process.env.PATH = `${stubDir}:${process.env.PATH ?? ""}`;
  });

  afterEach(() => {
    for (const r of configRoots.splice(0)) rmSync(r, { recursive: true, force: true });
    rmSync(stubDir, { recursive: true, force: true });
    delete process.env.FACADE_GH_FAIL;
    delete process.env.DEVENV_REPO;
  });

  it("providerDetect reads [provider] name, defaulting to github", async () => {
    const { core } = await loadFacade();
    expect(core.providerDetect()).toBe("github");
  });

  it("a resolved-but-missing config hard-errors naming the path (no silent default)", async () => {
    // The fork's failure mode: DEVENV_ROOT (set-but-stale) or a broken
    // checkout resolved to a nonexistent devenv.config, detection silently
    // defaulted to github, and every credential fix chased the wrong
    // provider. Policy (user): hard-error naming the resolved path.
    const { core } = await loadFacade();
    rmSync(join(process.env.DEVENV_ROOT ?? "", "devenv.config"), { force: true });
    expect(() => core.providerDetect(true)).toThrow(/devenv\.config not found/);
  });

  it("an existing config without a [provider] section still defaults to github", async () => {
    // The default is org policy for a PRESENT config; only the missing
    // file is an error.
    const { core } = await loadFacade();
    writeFileSync(join(process.env.DEVENV_ROOT ?? "", "devenv.config"), "[organization]\norg=x\n");
    expect(core.providerDetect(true)).toBe("github");
  });

  it("a provider name that ships nothing throws a named error", async () => {
    const { core } = await loadFacade({ provider: "gitea" });
    expect(() => core.providerDetect(true)).toThrow(/is not shipped/);
  });

  it("azure is a shipped provider (domain verbs in TS) — detection succeeds", async () => {
    const { core } = await loadFacade({ provider: "azure" });
    expect(core.providerDetect(true)).toBe("azure");
  });

  it("providerRepoSplit throws the bash seam's defined error on an unresolvable spec", async () => {
    const { core } = await loadFacade();
    expect(core.providerRepoSplit("owner/repo")).toEqual({ owner: "owner", name: "repo" });
    // The unresolvable case needs a cwd with no git root: resolution now
    // falls through DEVENV_REPO/GH_REPO to the org+cwd leg, so run the
    // negative in a bare directory with the env legs cleared.
    const r = spawnSync("node", ["-e", [
      "process.env.DEVENV_REPO=''; delete process.env.DEVENV_REPO;",
      "process.env.GH_REPO=''; delete process.env.GH_REPO;",
      `const { providerRepoSplit } = await import('file://${process.cwd()}/tools/lib/providers/provider-core.ts');`,
      "try { providerRepoSplit(''); console.log('NO-THROW'); } catch (e) { console.log('THREW:', e.message); }",
    ].join(String.fromCharCode(10))], { encoding: "utf8", cwd: tmpdir() });
    expect(r.stdout).toContain("THREW:");
    expect(r.stdout).toContain("cannot resolve the target repository");
  });

  it("unknownOption throws the contract's exact wording", async () => {
    const { core } = await loadFacade();
    expect(() => core.unknownOption("provider_issues_list", "--bogus")).toThrow(
      "provider_issues_list: unknown or unsupported option '--bogus' — see tools/lib/providers/CONTRACT.md",
    );
  });

  it("a non-canonical capability declaration is a named error, not a silent false", async () => {
    const { core } = await loadFacade();
    // @ts-expect-error — deliberately wrong name; the named error IS the contract
    expect(() => core.providerDeclareCapability("warp-drive")).toThrow(/not a canonical capability/);
  });

  it("issues verbs route through gh with -R repo args (call shape)", async () => {
    const { issues } = await loadFacade();
    await issues.issuesList("org/repo", { state: "open", label: ["bug"], limit: 5 });
    await issues.issuesView("org/repo", 42, { json: "number,title" });
    const calls = ghCalls();
    expect(calls.some((c) => c.includes("issue list -R org/repo --state open --label bug --limit 5"))).toBe(true);
    expect(calls.some((c) => c.includes("issue view 42 -R org/repo --json number,title"))).toBe(true);
  });

  it("an empty spec omits -R entirely (gh cwd resolution), per provider_repo_args", async () => {
    const { issues } = await loadFacade();
    await issues.issuesList(undefined, { state: "all" });
    expect(ghCalls().some((c) => c.includes("issue list --state all") && !c.includes("-R"))).toBe(true);
  });

  it("issuesExists answers false on gh failure and true on success (exit-status contract)", async () => {
    const { issues } = await loadFacade();
    writeFileSync(responses, "issue view 7\t{\"number\": 7}\n");
    expect(await issues.issuesExists("org/repo", 7)).toBe(true);
    process.env.FACADE_GH_FAIL = "1";
    expect(await issues.issuesExists("org/repo", 404)).toBe(false);
  });

  it("comments are projected to the seam shape (html_url -> url)", async () => {
    const { issues } = await loadFacade();
    writeFileSync(responses, "repos/org/repo/issues/9/comments\t[{\"id\":1,\"html_url\":\"https://x/c1\",\"body\":\"hi\"}]\n");
    const out = await issues.issuesComments("org/repo", 9);
    const parsed = JSON.parse(out) as Array<{ url?: string; html_url?: string }>;
    expect(parsed[0]?.url).toBe("https://x/c1");
    expect(parsed[0] && "html_url" in parsed[0]).toBe(false);
  });

  it("issuesSetType is capability-gated and invokes gh with GH_REPO set", async () => {
    const { issues } = await loadFacade();
    await issues.issuesSetType("org", "repo", 5, "Bug");
    expect(ghCalls().some((c) => c.includes("issue edit 5 --type Bug"))).toBe(true);
  });

  it("graph verbs resolve node ids then mutate (call shape)", async () => {
    const { issues } = await loadFacade();
    writeFileSync(responses, "issue(number:$n){id}\tgid_123\n");
    await issues.issueGraphLink("org/repo", 1, 2);
    const calls = ghCalls();
    expect(calls.filter((c) => c.includes("api graphql")).length).toBe(3); // 2 node ids + the mutation
    expect(calls.some((c) => c.includes("addSubIssue"))).toBe(true);
  });

  it("transport failure throws, never an empty success (contract)", async () => {
    const { issues } = await loadFacade();
    process.env.FACADE_GH_FAIL = "1";
    await expect(issues.issuesList("org/repo")).rejects.toThrow(/gh issue list failed/);
  });
});

describe("artifacts domain (byte-faithful header)", () => {
  let artifacts: Loaded["artifacts"];

  beforeEach(async () => {
    stubDir = mkdtempSync(join(tmpdir(), "facade-stub-"));
    callLog = join(stubDir, "calls.log");
    responses = join(stubDir, "responses.tsv");
    writeFileSync(responses, "");
    installGhStub();
    process.env.PATH = `${stubDir}:${process.env.PATH ?? ""}`;
    ({ artifacts } = await loadFacade());
  });

  const header = [
    "<!-- DEVENV_ARTIFACT_V1",
    "doc_id: dv1:org/repo:local:plan:issue-42-001",
    "issue_number: 42",
    "artifact_type: plan",
    "-->",
    "",
    "Body text.",
  ].join("\n");

  it("parseHeaderJson extracts the block's key pairs", () => {
    const h = artifacts.parseHeaderJson(header);
    expect(h).not.toBeNull();
    expect(h?.doc_id).toBe("dv1:org/repo:local:plan:issue-42-001");
    expect(h?.issue_number).toBe("42");
    expect(h?.artifact_type).toBe("plan");
  });

  it("parseHeaderJson returns null when the marker is absent", () => {
    expect(artifacts.parseHeaderJson("just some body")).toBeNull();
  });

  it("parseHeaderJson honors the first-1024 window (marker beyond it is absent)", () => {
    const far = "x".repeat(1100) + "\n<!-- DEVENV_ARTIFACT_V1\ndoc_id: late\n-->";
    expect(artifacts.parseHeaderJson(far)).toBeNull();
  });

  it("headerField reads the first KEY: line, trimmed", () => {
    expect(artifacts.headerField(header, "doc_id")).toBe("dv1:org/repo:local:plan:issue-42-001");
    expect(artifacts.headerField(header, "missing")).toBe("");
  });

  it("bodyUpsertable accepts a well-formed body and rejects each failure mode", () => {
    expect(artifacts.bodyUpsertable(header)).toEqual({ ok: true });
    const noDoc = header.replace("doc_id: dv1:org/repo:local:plan:issue-42-001\n", "");
    expect(artifacts.bodyUpsertable(noDoc).ok).toBe(false);
    const noIssue = header.replace("issue_number: 42\n", "").replace("issue-42-001", "abc-001");
    const r = artifacts.bodyUpsertable(noIssue);
    if (!r.ok) expect(r.reason).toContain("no resolvable issue number");
    const badNum = header.replace("issue_number: 42", "issue_number: 4x2");
    const r2 = artifacts.bodyUpsertable(badNum);
    if (!r2.ok) expect(r2.reason).toContain("not a number");
    const inferred = header.replace("issue_number: 42\n", "issue_number: none\n");
    expect(artifacts.bodyUpsertable(inferred)).toEqual({ ok: true });
  });

  it("packageTypeId normalizes aliases and passes through unknowns lowercased", () => {
    expect(artifacts.packageTypeId("NPM")).toBe("npm");
    expect(artifacts.packageTypeId("csharp")).toBe("nuget");
    expect(artifacts.packageTypeId("container")).toBe("docker");
    expect(artifacts.packageTypeId("mystery")).toBe("mystery");
    expect(artifacts.isSupportedPackageType("node")).toBe(true);
    expect(artifacts.isSupportedPackageType("mystery")).toBe(false);
  });

  it("queryPackages resolves the org from config, scopes by repo, filters by name", async () => {
    writeFileSync(responses, "users/fixture-org/packages\t[{\"name\":\"Left Pad\"},{\"name\":\"other\"}]\n");
    const all = JSON.parse(await artifacts.queryPackages()) as Array<{ name: string }>;
    expect(all.length).toBe(2);
    const filtered = JSON.parse(await artifacts.queryPackages({ name: "left" })) as Array<{ name: string }>;
    expect(filtered.length).toBe(1);
    expect(filtered[0]?.name).toBe("Left Pad");
    await artifacts.queryPackages({ repo: "fixture-org/some-repo" });
    expect(ghCalls().some((c) => c.includes("repos/fixture-org/some-repo/packages"))).toBe(true);
  });

  it("packageVersions flattens the paginated response", async () => {
    writeFileSync(responses, "versions\t[[{\"v\":1},{\"v\":2}],[{\"v\":3}]]\n");
    const out = JSON.parse(await artifacts.packageVersions({ type: "npm", name: "left-pad" })) as unknown[];
    expect(out.length).toBe(3);
  });

  it("unconfigured org makes owner resolution fail defined", async () => {
    const bare = mkdtempSync(join(tmpdir(), "facade-bare-"));
    configRoots.push(bare);
    writeFileSync(join(bare, "devenv.config"), "[provider]\nname=github\n");
    vi.resetModules();
    process.env.DEVENV_ROOT = bare;
    const fresh = await import("../../lib/domain/artifacts.ts");
    await expect(fresh.queryPackages()).rejects.toThrow(/owner is required/);
  });
});

describe("prs verbs (call-shape contract over the gh stub)", () => {
  beforeEach(() => {
    stubDir = mkdtempSync(join(tmpdir(), "facade-stub-"));
    callLog = join(stubDir, "calls.log");
    responses = join(stubDir, "responses.tsv");
    installGhStub();
    process.env.PATH = `${stubDir}:${process.env.PATH ?? ""}`;
  });

  afterEach(() => {
    for (const r of configRoots.splice(0)) rmSync(r, { recursive: true, force: true });
    rmSync(stubDir, { recursive: true, force: true });
    delete process.env.DEVENV_REPO;
  });

  it("prsMerge sends the method, subject/body, delete-branch and admin flags in order", async () => {
    const { prs } = await loadFacade();
    await prs.prsMerge("o/r", 12, { method: "rebase", subject: "s", body: "b", deleteBranch: true, admin: true });
    const call = ghCalls().find((c) => c.includes("pr merge")) ?? "";
    expect(call).toContain("pr merge 12 --rebase --subject s --body b --delete-branch --admin -R o/r");
  });

  it("prsMerge defaults to rebase + delete-branch, no admin", async () => {
    const { prs } = await loadFacade();
    await prs.prsMerge("o/r", 5);
    const call = ghCalls().find((c) => c.includes("pr merge")) ?? "";
    expect(call).toContain("--rebase --delete-branch");
    expect(call).not.toContain("--admin");
    expect(call).not.toContain("--subject");
  });

  it("prsDiff asks for --name-only only when requested", async () => {
    const { prs } = await loadFacade();
    await prs.prsDiff("o/r", 7, { nameOnly: true });
    expect(ghCalls().some((c) => c.includes("pr diff 7 --name-only -R o/r"))).toBe(true);
    await prs.prsDiff("o/r", 7);
    const plain = ghCalls().filter((c) => c.includes("pr diff 7")).at(-1) ?? "";
    expect(plain).not.toContain("--name-only");
  });

  it("prsCreate rides the body through stdin (--body-file -) and carries draft/reviewer/assignee/label flags", async () => {
    const { prs } = await loadFacade();
    await prs.prsCreate("o/r", {
      title: "T", body: "B", head: "h", base: "m", draft: true,
      reviewer: ["alice"], assignee: ["@me"], label: ["ci"],
    }, { input: "B" });
    const call = ghCalls().find((c) => c.includes("pr create")) ?? "";
    expect(call).toContain("--body-file -");
    expect(call).toContain("--draft");
    expect(call).toContain("--reviewer alice");
    expect(call).toContain("--assignee @me");
    expect(call).toContain("--label ci");
  });

  it("prsCreate rejects body and bodyFile together", async () => {
    const { prs } = await loadFacade();
    await expect(prs.prsCreate("o/r", { head: "h", base: "m", body: "x", bodyFile: "/tmp/nope" })).rejects.toThrow(/mutually exclusive/);
  });

  it("prsThreadReply posts to the REST replies route and projects html_url to url", async () => {
    writeFileSync(responses, `pulls/1/comments\t{"id":9,"html_url":"https://github.com/o/r/pull/1#discussion_r9","body":"x"}\n`);
    const { prs } = await loadFacade();
    const r = await prs.prsThreadReply("o/r", 1, 9, "hello");
    const call = ghCalls().find((c) => c.includes("replies")) ?? "";
    expect(call).toContain("api -X POST /repos/o/r/pulls/1/comments/9/replies -f body=hello");
    const parsed = JSON.parse(r.stdout) as { url?: string; html_url?: string };
    expect(parsed.url).toBe("https://github.com/o/r/pull/1#discussion_r9");
    expect(parsed.html_url).toBeUndefined();
  });

  it("prsThreadResolve sends the thread id as a GraphQL variable and reports the resolved state", async () => {
    writeFileSync(responses, `resolveReviewThread\t{"data":{"resolveReviewThread":{"thread":{"id":"T1","isResolved":true}}}}\n`);
    const { prs } = await loadFacade();
    const state = await prs.prsThreadResolve("T1");
    const calls = ghCalls().join("\n");
    expect(calls).toContain("-f threadId=T1");
    expect(calls).not.toContain("TID=");
    expect(state).toBe("true");
  });

  it("prsThreadResolve throws named on a GraphQL error payload", async () => {
    writeFileSync(responses, `resolveReviewThread\t{"errors":[{"message":"bad"}]}\n`);
    const { prs } = await loadFacade();
    await expect(prs.prsThreadResolve("T1")).rejects.toThrow(/GraphQL error resolving T1/);
  });

  it("prsThreadCreate resolves ids first and sends the inline variables with -F line", async () => {
    writeFileSync(responses, [
      "pr view\tPR_R1",
      "repository(owner\tR_NODE_1",
      "addPullRequestReviewThread\t{\"data\":{\"addPullRequestReviewThread\":{\"thread\":{\"url\":\"https://x/1\"}}}}",
    ].join("\n"));
    const { prs } = await loadFacade();
    await prs.prsThreadCreate("o/r", 3, { body: "note", path: "a.ts", line: 4, side: "RIGHT" });
    const calls = ghCalls().join("\n");
    // The query document is syntactically complete: no spliced $extra token.
    expect(calls).not.toContain("$extra");
    expect(calls).toContain("-F line=4");
    expect(calls).toContain("-f path=a.ts");
    expect(calls).toContain("-f side=RIGHT");
    expect(calls).toContain("-f pr=PR_R1");
    expect(calls).toContain("-f repo=R_NODE_1");
  });

  it("prsThreadCreate --path without --line is a named error", async () => {
    const { prs } = await loadFacade();
    await expect(prs.prsThreadCreate("o/r", 3, { body: "n", path: "a.ts" })).rejects.toThrow(/--path requires --line/);
  });

  it("prsThreadCreate projects the GraphQL envelope to the {thread:{url}} seam shape (F11 pin)", async () => {
    // The tool parses parsed.thread?.url; a raw envelope would read "" and
    // report "no thread URL returned". This pins the projection.
    writeFileSync(responses, [
      "pr view\tPR_R77",
      "repository(owner\tR_NODE_77",
      "addPullRequestReviewThread\t{\"data\":{\"addPullRequestReviewThread\":{\"thread\":{\"url\":\"https://github.com/o/r/pull/3#discussion_r77\"}}}}",
    ].join("\n") + "\n");
    const { prs } = await loadFacade();
    const r = await prs.prsThreadCreate("o/r", 3, { body: "n" });
    const parsed = JSON.parse(r.stdout) as { thread?: { url?: string }; data?: unknown };
    expect(parsed.data).toBeUndefined();
    expect(parsed.thread?.url).toBe("https://github.com/o/r/pull/3#discussion_r77");
  });

  it("prsThreadCreate surfaces a GraphQL error payload as a named throw", async () => {
    writeFileSync(responses, [
      "pr view\tPR_R77",
      "repository(owner\tR_NODE_77",
      "addPullRequestReviewThread\t{\"errors\":[{\"message\":\"bad input\"}]}",
    ].join("\n") + "\n");
    const { prs } = await loadFacade();
    await expect(prs.prsThreadCreate("o/r", 3, { body: "n" })).rejects.toThrow(/GraphQL error posting the thread/);
  });

  it("prsThreadsPage passes the cursor only when given", async () => {
    const { prs } = await loadFacade();
    await prs.prsThreadsPage("o/r", 4, "CUR");
    expect(ghCalls().join("\n")).toContain("-f cursor=CUR");
    await prs.prsThreadsPage("o/r", 4);
    const all = ghCalls().join("\n");
    // Only one cursor occurrence overall (the second call sent none).
    expect(all.split("-f cursor=").length - 1).toBe(1);
  });
});

describe("pipelines verbs (seam projection contract over the gh stub)", () => {
  beforeEach(() => {
    stubDir = mkdtempSync(join(tmpdir(), "facade-stub-"));
    callLog = join(stubDir, "calls.log");
    responses = join(stubDir, "responses.tsv");
    installGhStub();
    process.env.PATH = `${stubDir}:${process.env.PATH ?? ""}`;
  });

  afterEach(() => {
    for (const r of configRoots.splice(0)) rmSync(r, { recursive: true, force: true });
    rmSync(stubDir, { recursive: true, force: true });
    delete process.env.DEVENV_REPO;
  });

  it("runList json+jq: seam rename happens first, the jq projection applies to renamed records", async () => {
    const { pipelines } = await loadFacade();
    // gh returns databaseId (the seam map's gh-side name); the seam renames it
    // back to id BEFORE the caller's jq program applies (bash _gh_json_run order).
    writeFileSync(responses, `run list\t[{"databaseId":987,"url":"u1"}]\n`);
    const out = await pipelines.pipelinesRunList("o/r", { json: "id,url", jq: ".[0].id" });
    expect(out).toBe("987");
  });

  it("runList json only: renamed records returned, no projection", async () => {
    const { pipelines } = await loadFacade();
    writeFileSync(responses, `run list\t[{"databaseId":5}]\n`);
    const out = await pipelines.pipelinesRunList("o/r", { json: "id" });
    expect(JSON.parse(out)).toEqual([{ id: 5 }]);
  });

  it("runList forwards --status when asked (watch auto-detect contract)", async () => {
    const { pipelines } = await loadFacade();
    writeFileSync(responses, `run list\t[{"databaseId":9}]\n`);
    await pipelines.pipelinesRunList("o/r", { json: "id", jq: ".[0].id", status: "in_progress" });
    const call = ghCalls().find((c) => c.includes("run list")) ?? "";
    expect(call).toContain("--status in_progress");
    expect(call).toContain("--json databaseId");
  });
});
