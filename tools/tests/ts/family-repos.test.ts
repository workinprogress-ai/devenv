// Tests for the repo/git family's TS facades: repos.ts verbs (view/create/
// commits-count/list + settings mutations), org.ts ruleset verbs, and the
// reposView/list seam field mapping — over a stubbed gh with a call log.
// The bash-side contracts (test_provider_repos.bats) keep covering the live
// bash modules their downstream consumers still source; this file pins the
// TS surface the migrated tools call.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const REPOS_TS = join(fileURLToPath(new URL(".", import.meta.url)), "../../lib/providers/github/repos.ts");
const ORG_TS = join(fileURLToPath(new URL(".", import.meta.url)), "../../lib/providers/github/org.ts");
const TYPES_TS = join(fileURLToPath(new URL(".", import.meta.url)), "../../lib/domain/repos/types.ts");

let stubDir = "";

/** Simpler runner: a gh stub whose stdout comes from GH_STUB_STDOUT env. */
function installGh(stdout: string): void {
  writeFileSync(
    join(stubDir, "gh"),
    [
      "#!/usr/bin/env bash",
      'printf \'%s\\n\' "gh $*" >> "' + join(stubDir, "calls.log") + '"',
      `printf '%s' "${stdout.replace(/"/g, '\\"')}"`,
      "exit 0",
      "",
    ].join("\n"),
    { mode: 0o755 },
  );
}

function ghCalls(): string[] {
  const log = join(stubDir, "calls.log");
  if (!existsSync(log)) return [];
  return readFileSync(log, "utf8").split("\n").filter((l) => l.startsWith("gh "));
}

function runTs(file: string, code: string): { status: number; stdout: string; stderr: string } {
  const script = join(stubDir, "probe.mts");
  writeFileSync(script, code.replaceAll("__FILE__", file).replaceAll("__STUB__", stubDir));
  const r = spawnSync("node", [script], {
    encoding: "utf8",
    env: { ...process.env, PATH: `${stubDir}:${process.env.PATH ?? ""}` },
  });
  return { status: r.status ?? 1, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

describe("repos.ts facade", () => {
  beforeEach(() => {
    stubDir = mkdtempSync(join(tmpdir(), "p8-repos-"));
  });
  afterEach(() => {
    rmSync(stubDir, { recursive: true, force: true });
  });

  it("reposView takes the repo positionally and maps seam fields back", async () => {
    installGh('{"nameWithOwner":"org/repo","defaultBranchRef":{"name":"main"}}');
    const r = runTs(REPOS_TS, `
      const m = await import("__FILE__");
      const out = await m.reposView("org/repo", { json: "repoSpec" });
      console.log(JSON.stringify({ out, parsed: JSON.parse(out) }));
    `);
    expect(r.status).toBe(0);
    const parsed = JSON.parse(r.stdout.trim().split("\n").pop() ?? "{}");
    expect(parsed.parsed.repoSpec).toBe("org/repo");
    expect(ghCalls().join("\n")).toContain("repo view org/repo");
    expect(ghCalls().join("\n")).toContain("--json nameWithOwner");
  });

  it("reposView without --json passes -q through untouched", async () => {
    installGh("main");
    const r = runTs(REPOS_TS, `
      const m = await import("__FILE__");
      const out = await m.reposView("org/repo", { jq: ".defaultBranchRef.name" });
      console.log(out.trim());
    `);
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toBe("main");
    expect(ghCalls().join("\n")).toContain("--jq .defaultBranchRef.name");
  });

  it("reposCreate builds the create argv (visibility, description, template)", async () => {
    installGh("created");
    const r = runTs(REPOS_TS, `
      const m = await import("__FILE__");
      const out = await m.reposCreate("org/new-repo", {
        visibility: "private",
        description: "A test repo",
        template: "org/template.planning",
      });
      console.log(JSON.stringify(out));
    `);
    expect(r.status).toBe(0);
    const calls = ghCalls().join("\n");
    expect(calls).toContain("repo create org/new-repo");
    expect(calls).toContain("--private");
    expect(calls).toContain("--description A test repo");
    expect(calls).toContain("--template org/template.planning");
    void JSON.parse(r.stdout.trim().split("\n").pop() ?? "{}");
  });

  it("reposCommitsCount resolves true on a non-empty commits array and false on failure", async () => {
    installGh('[{"sha":"abc"}]');
    const ok = runTs(REPOS_TS, `
      const m = await import("__FILE__");
      console.log(await m.reposCommitsCount("org/repo"));
    `);
    expect(ok.stdout.trim()).toBe("true");
    expect(ghCalls().join("\n")).toContain("repos/org/repo/commits?per_page=1");

    writeFileSync(join(stubDir, "calls.log"), "");
    installGh("");
    // failure: gh exits non-zero via a broken stub
    writeFileSync(join(stubDir, "gh"), "#!/usr/bin/env bash\nexit 1\n", { mode: 0o755 });
    const fail = runTs(REPOS_TS, `
      const m = await import("__FILE__");
      console.log(await m.reposCommitsCount("org/repo"));
    `);
    expect(fail.stdout.trim()).toBe("false");
  });

  it("reposList maps seam fields and applies .[].name to the renamed records", async () => {
    installGh('[{"nameWithOwner":"org/a"},{"nameWithOwner":"org/b"}]');
    const r = runTs(REPOS_TS, `
      const m = await import("__FILE__");
      const out = await m.reposList("test-org", { limit: 1000, json: "repoSpec", jq: ".[].repoSpec" });
      console.log(out.trim());
    `);
    expect(r.status).toBe(0);
    expect(r.stdout.trim().split("\n")).toEqual(["org/a", "org/b"]);
    const calls = ghCalls().join("\n");
    expect(calls).toContain("repo list test-org --limit 1000");
    expect(calls).toContain("--json nameWithOwner");
  });

  it("settings mutations emit the exact REST argv (patch/team-put/collaborator-put/edit)", async () => {
    installGh("");
    const r = runTs(REPOS_TS, `
      const m = await import("__FILE__");
      m.reposPatch("org/repo", ["-F", "allow_merge_commit=true"]);
      m.reposEdit("org/repo", ["--template"]);
      m.reposTeamPut("org", "team-slug", "org/repo", "push");
      m.reposCollaboratorPut("org/repo", "someuser", "triage");
      console.log("done");
    `);
    expect(r.status).toBe(0);
    const calls = ghCalls().join("\n");
    expect(calls).toContain("gh api -X PATCH repos/org/repo -F allow_merge_commit=true");
    expect(calls).toContain("gh repo edit org/repo --template");
    expect(calls).toContain("gh api -X PUT orgs/org/teams/team-slug/repos/org/repo -f permission=push");
    expect(calls).toContain("gh api -X PUT repos/org/repo/collaborators/someuser -f permission=triage");
  });
});

describe("org.ts ruleset verbs", () => {
  beforeEach(() => {
    stubDir = mkdtempSync(join(tmpdir(), "p8-org-"));
  });
  afterEach(() => {
    rmSync(stubDir, { recursive: true, force: true });
  });

  it("rulesets list hits the paginated REST route; create/update POST/PUT payloads", async () => {
    installGh('[{"id":1,"name":"Require PR"}]');
    writeFileSync(join(stubDir, "payload.json"), "{}");
    const r = runTs(ORG_TS, `
      const m = await import("__FILE__");
      console.log(m.orgRulesetsList("org/repo").trim());
      const pf = "__STUB__/payload.json";
      m.orgRulesetCreate("org/repo", pf);
      m.orgRulesetUpdate("org/repo", "7", pf);
      console.log("done");
    `);
    expect(r.status).toBe(0);
    const calls = ghCalls().join("\n");
    expect(calls).toContain("gh api repos/org/repo/rulesets --paginate");
    expect(calls).toContain("gh api --input ");
    expect(calls).toContain("-X POST repos/org/repo/rulesets");
    expect(calls).toContain("-X PUT repos/org/repo/rulesets/7");
    void runTs;
  });
});

describe("domain/repos/types.ts", () => {
  beforeEach(() => {
    stubDir = mkdtempSync(join(tmpdir(), "p8-types-"));
  });
  afterEach(() => {
    rmSync(stubDir, { recursive: true, force: true });
  });

  it("validate/detect enforce naming patterns and owner/repo extraction", async () => {
    const r = runTs(TYPES_TS, `
      const m = await import("__FILE__");
      const cfg = m.RepoTypesConfigSchema.parse({ types: {
        service: { naming_pattern: "^service\\\\.[a-z0-9-]+\\\\.[a-z0-9-]+$", naming_example: "service.platform.identity" },
        none: { naming_pattern: ".*", naming_example: "anything" },
      }});
      const out = [];
      out.push(["valid-ok", m.validateRepoType("service.platform.identity", "service", cfg) === undefined]);
      out.push(["extracts", m.validateRepoType("workinprogress-ai/service.platform.identity", "service", cfg) === undefined]);
      try { m.validateRepoType("invalid", "service", cfg); out.push(["invalid-rejected", false]); }
      catch { out.push(["invalid-rejected", true]); }
      out.push(["detect", m.detectRepoType("org/service.a.b", cfg) === "service"]);
      out.push(["detect-none", m.detectRepoType("org/anything", cfg) === "none"]);
      console.log(JSON.stringify(out));
    `);
    expect(r.status).toBe(0);
    const pairs = JSON.parse(r.stdout.trim()) as Array<[string, boolean]>;
    for (const [name, ok] of pairs) expect(ok, name).toBe(true);
  });

  it("buildRulesetPayload token-stamps in one pass, leaves unknown tokens, drops email rules on empty domain", async () => {
    const r = runTs(TYPES_TS, `
      const m = await import("__FILE__");
      const template = JSON.stringify({
        name: "ruleset for {{repo_name}} by {{owner}}",
        desc: "{{type_description}} & {{unknown_token}}",
        rules: [
          { type: "pull_request" },
          { type: "commit_author_email_pattern" },
        ],
      });
      const out = m.buildRulesetPayload(template, {
        repo_name: "service.a&b/c", owner: "org", email_domain: "", type_name: "service", type_description: 'desc "quoted"',
      });
      console.log(out);
    `);
    expect(r.status).toBe(0);
    const payload = JSON.parse(r.stdout.trim()) as { name: string; desc: string; rules: Array<{ type: string }> };
    expect(payload.name).toBe("ruleset for service.a&b/c by org");
    // awkward characters survive verbatim; unknown token left as written
    expect(payload.desc).toBe('desc "quoted" & {{unknown_token}}');
    // empty email_domain drops email-pattern rules
    expect(payload.rules).toEqual([{ type: "pull_request" }]);
  });

  it("configured email_domain keeps email rules stamped with the domain", async () => {
    const r = runTs(TYPES_TS, `
      const m = await import("__FILE__");
      const template = JSON.stringify({ rules: [
        { type: "pull_request" },
        { type: "commit_author_email_pattern", parameters: { pattern: "x" } },
      ]});
      const out = m.buildRulesetPayload(template, {
        repo_name: "r", owner: "org", email_domain: "example.com", type_name: "t", type_description: "d",
      });
      console.log(out);
    `);
    const payload = JSON.parse(r.stdout.trim()) as { rules: Array<{ type: string }> };
    expect(payload.rules).toHaveLength(2);
  });

  it("getters return the schema defaults when properties are missing", async () => {
    const r = runTs(TYPES_TS, `
      const m = await import("__FILE__");
      const cfg = m.RepoTypesConfigSchema.parse({ types: { bare: { naming_pattern: ".*", naming_example: "x" } } });
      const t = cfg.types.bare;
      console.log(JSON.stringify({
        mainBranch: m.getTypeMainBranch(t),
        hasIssues: m.getTypeHasIssues(t),
        hasWiki: m.getTypeHasWiki(t),
        allowAutoMerge: m.getTypeAllowAutoMerge(t),
        mergeTypes: m.getTypeAllowedMergeTypes(t),
        access: m.getTypeAccess(t),
      }));
    `);
    const v = JSON.parse(r.stdout.trim()) as Record<string, unknown>;
    expect(v.mainBranch).toBe("master");
    expect(v.hasIssues).toBe(true);
    expect(v.hasWiki).toBe(false);
    expect(v.allowAutoMerge).toBe(true);
    expect(v.mergeTypes).toEqual(["merge"]);
    expect(v.access).toEqual([]);
  });

  it("parseYamlSubset reads the org-authored config shape (nested maps + flat-map lists)", async () => {
    const r = runTs(TYPES_TS, `
      const m = await import("__FILE__");
      const yaml = [
        "types:",
        "  planning:",
        "    description: Planning repos",
        "    docs_first: true",
        "    mainBranch: master",
        "    allowedMergeTypes:",
        "      - rebase",
        "    access:",
        "      - name: Engineering",
        "        type: team",
        "        permission: push",
      ].join("\\n");
      const parsed = m.RepoTypesConfigSchema.parse(m.parseYamlSubset(yaml));
      const t = parsed.types.planning;
      console.log(JSON.stringify({ docs: m.getTypeDocsFirst(t), merges: m.getTypeAllowedMergeTypes(t), access: m.getTypeAccess(t) }));
    `);
    const v = JSON.parse(r.stdout.trim()) as { docs: boolean; merges: string[]; access: Array<{ name: string }> };
    expect(v.docs).toBe(true);
    expect(v.merges).toEqual(["rebase"]);
    expect(v.access).toEqual([{ name: "Engineering", type: "team", permission: "push" }]);
  });

  it("loads the real repo-types.yaml from this checkout", async () => {
    const toolsRoot = JSON.stringify(join(dirname(TYPES_TS), "../../.."));
    const r = runTs(TYPES_TS, `
      const m = await import("__FILE__");
      const cfg = m.loadRepoTypesConfig(undefined, __TOOLSPARENT__);
      console.log(Object.keys(cfg.types).sort().join(","));
    `.replaceAll("__TOOLSPARENT__", toolsRoot));
    expect(r.status).toBe(0);
    const keys = r.stdout.trim();
    expect(keys).toContain("planning");
    expect(keys).toContain("service");
  });
});
