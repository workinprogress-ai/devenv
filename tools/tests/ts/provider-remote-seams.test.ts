// Port of tools/tests/lib/test_provider_remote_seams.bats (12 tests): URL
// seams that give every consumer the provider's own spec and web links, so no
// script has to know a host's path vocabulary:
//   provider_remote_to_spec  a git remote URL -> the repo spec (owner/repo or
//                            Azure project/repo)
//   provider_pr_web_url      SPEC NUMBER -> the pull request's page
//   provider_issue_web_url   SPEC NUMBER -> the issue or work item's page
// The Azure remote parser also reads <org>.visualstudio.com remotes.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const ROOT = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))));
const TOOLS = join(ROOT, "tools");

let DEVENV_ROOT = "";

beforeEach(() => {
  DEVENV_ROOT = mkdtempSync(join(tmpdir(), `rseam-${Date.now()}-${Math.random().toString(36).slice(2)}`));
  writeFileSync(
    join(DEVENV_ROOT, "devenv.config"),
    "[provider]\nname=azure\nazure_org=cfg-org\nazure_project=cfg-proj\n",
  );
});

// gh_run / az_run FN ARGS: load one provider's URL module and call the seam.
function run(provider: "github" | "azure", fn: string, args: string): { status: number; out: string } {
  const mod = provider === "github" ? "github/urls.bash" : "azure/urls.bash";
  const r = spawnSync(
    "bash",
    [
      "-c",
      `source '${TOOLS}/lib/providers/provider-core.bash'\n` +
      `PROVIDER_NAME=${provider}\n` +
      `source '${TOOLS}/lib/providers/${mod}'\n` +
      `${fn} ${args}`,
    ],
    { encoding: "utf8", env: { ...process.env, DEVENV_ROOT } },
  );
  return { status: r.status ?? 1, out: (r.stdout ?? "").trim() };
}

// ---------------------------------------------------------------------------
// GitHub
// ---------------------------------------------------------------------------

describe("github remote seams", () => {
  it("remote_to_spec: https, ssh and credential-embedded remotes yield owner/repo", () => {
    for (const remote of ["https://github.com/org/repo.git", "git@github.com:org/repo.git", "https://user:tok@github.com/org/repo"]) {
      const r = run("github", "provider_remote_to_spec", `"${remote}"`);
      expect(r.status, remote).toBe(0);
      expect(r.out, remote).toBe("org/repo");
    }
  });

  it("remote_to_spec: another host's remote is not ours", () => {
    const r = run("github", "provider_remote_to_spec", '"https://gitlab.com/org/repo.git"');
    expect(r.status).not.toBe(0);
    expect(r.out).toBe("");
  });

  it("pr and issue web urls follow GitHub's paths", () => {
    const pr = run("github", "provider_pr_web_url", "org/repo 12");
    expect(pr.status).toBe(0);
    expect(pr.out).toBe("https://github.com/org/repo/pull/12");
    const issue = run("github", "provider_issue_web_url", "org/repo 7");
    expect(issue.status).toBe(0);
    expect(issue.out).toBe("https://github.com/org/repo/issues/7");
  });

  it("web urls require a spec and a number", () => {
    expect(run("github", "provider_pr_web_url", '"" 12').status).not.toBe(0);
    expect(run("github", "provider_issue_web_url", 'org/repo ""').status).not.toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Azure
// ---------------------------------------------------------------------------

describe("azure remote seams", () => {
  it("remote_to_spec: every remote form yields the two-part project/repo", () => {
    for (const remote of [
      "https://dev.azure.com/o/p/_git/r",
      "https://dev.azure.com/o/p/_git/r.git",
      "git@ssh.dev.azure.com:v3/o/p/r",
      "https://user@dev.azure.com/o/p/_git/r",
    ]) {
      const r = run("azure", "provider_remote_to_spec", `"${remote}"`);
      expect(r.status, remote).toBe(0);
      expect(r.out, remote).toBe("p/r");
    }
  });

  it("remote_to_spec reads an <org>.visualstudio.com remote", () => {
    for (const remote of [
      "https://myorg.visualstudio.com/myproj/_git/myrepo",
      "https://tok@myorg.visualstudio.com/myproj/_git/myrepo",
    ]) {
      const r = run("azure", "provider_remote_to_spec", `"${remote}"`);
      expect(r.status, remote).toBe(0);
      expect(r.out, remote).toBe("myproj/myrepo");
    }
  });

  it("remote_to_web normalizes a visualstudio.com remote to the dev.azure.com form", () => {
    const r = run("azure", "provider_remote_to_web", '"https://myorg.visualstudio.com/myproj/_git/myrepo"');
    expect(r.status).toBe(0);
    expect(r.out).toBe("https://dev.azure.com/myorg/myproj/_git/myrepo");
  });

  it("remote_to_spec: a GitHub remote is not ours", () => {
    const r = run("azure", "provider_remote_to_spec", '"git@github.com:org/repo.git"');
    expect(r.status).not.toBe(0);
    expect(r.out).toBe("");
  });

  it("pr web url: a project/repo spec takes the organization from config", () => {
    const r = run("azure", "provider_pr_web_url", "proj/repo 12");
    expect(r.status).toBe(0);
    expect(r.out).toBe("https://dev.azure.com/cfg-org/proj/_git/repo/pullrequest/12");
  });

  it("pr web url: an org/project/repo spec carries its own organization", () => {
    const r = run("azure", "provider_pr_web_url", "o/p/r 12");
    expect(r.status).toBe(0);
    expect(r.out).toBe("https://dev.azure.com/o/p/_git/r/pullrequest/12");
  });

  it("issue web url is the work item page of the project", () => {
    const r = run("azure", "provider_issue_web_url", "proj/repo 7");
    expect(r.status).toBe(0);
    expect(r.out).toBe("https://dev.azure.com/cfg-org/proj/_workitems/edit/7");
  });

  it("web urls require a spec and a number", () => {
    expect(run("azure", "provider_pr_web_url", '"" 12').status).not.toBe(0);
    expect(run("azure", "provider_issue_web_url", 'proj/repo ""').status).not.toBe(0);
  });
});
