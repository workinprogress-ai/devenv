// Port of tools/tests/lib/test_repo_target_unified.bats (10 tests): repo
// targeting — one resolver for every wrapper, and a devenv-repo safety gate
// that actually fires. get_repo_spec delegates to provider_repo_target; on
// Azure the canonical spec is the two-part project/repo (organization from
// config). resolve_target_repo exempts an explicit target (argument,
// DEVENV_REPO, or the --devenv override) from the gate and refuses an
// implicit one made from inside the devenv repo itself.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const ROOT = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))));
const TOOLS = join(ROOT, "tools");

let TMP = "";

const IDENTITY = {
  GIT_AUTHOR_NAME: "t",
  GIT_AUTHOR_EMAIL: "t@example.test",
  GIT_COMMITTER_NAME: "t",
  GIT_COMMITTER_EMAIL: "t@example.test",
};

beforeEach(() => {
  TMP = mkdtempSync(join(tmpdir(), `rtgt-${Date.now()}-${Math.random().toString(36).slice(2)}`));
  spawnSync("bash", ["-c", `git init -q "$TMP/devenv-root" 2>/dev/null`]);
  writeFileSync(join(TMP, "devenv.config"), "[provider]\nname=github\n[organization]\nname=t\norg=my-org\n");
  // Spawned fixtures configure the provider per-test via their own devenv.config;
  // an inherited provider selection or session-scoped override from the parent
  // shell would beat that config (provider_load short-circuits on a non-empty
  // PROVIDER_NAME) and poison azure-fixture assertions.
  delete process.env.PROVIDER_NAME;
  delete process.env.AZURE_DEVOPS_ORG;
  delete process.env.AZURE_DEVOPS_PROJECT;
  delete process.env.DEVENV_REPO;
});

function createMockGitRepo(repoPath: string): void {
  mkdirSync(repoPath, { recursive: true });
  const env = { ...process.env, ...IDENTITY };
  spawnSync("git", ["init", "-q"], { cwd: repoPath, env });
  spawnSync("git", ["remote", "add", "origin", "git@github.com:test-org/dummy.git"], { cwd: repoPath, env });
  writeFileSync(join(repoPath, "README.md"), "");
  spawnSync("git", ["add", "README.md"], { cwd: repoPath, env });
  spawnSync("git", ["commit", "-q", "-m", "init"], { cwd: repoPath, env });
}

function writeConfig(provider: "github" | "azure"): void {
  if (provider === "azure") {
    writeFileSync(
      join(TMP, "devenv.config"),
      "[provider]\nname=azure\nazure_org=my-org\nazure_project=my-proj\n[organization]\nname=t\norg=my-org\n",
    );
  } else {
    writeFileSync(join(TMP, "devenv.config"), "[provider]\nname=github\n[organization]\nname=t\norg=my-org\n");
  }
}

// in_repo DIR SCRIPT: run SCRIPT inside DIR with the tool libraries sourced.
function inRepo(dir: string, script: string, extraEnv: Record<string, string> = {}): { status: number; out: string } {
  const r = spawnSync(
    "bash",
    [
      "-c",
      `export PROJECT_ROOT='${ROOT}' DEVENV_ROOT='${TMP}' DEVENV_ROOT_SET=1\n` +
      `export DEVENV_TOOLS='${TOOLS}'\n` +
      `source '${TOOLS}/lib/error-handling.bash'\n` +
      `source '${TOOLS}/lib/git-operations.bash'\n` +
      `source '${TOOLS}/lib/provider-loader.bash'\n` +
      `cd '${dir}'\n` +
      script,
    ],
    { encoding: "utf8", env: { ...process.env, ...extraEnv } },
  );
  return { status: r.status ?? 1, out: (r.stdout ?? "") + (r.stderr ?? "") };
}

// a repo that is_devenv_repo recognises (bootstrap.sh marker)
function makeDevenvRepo(): string {
  const repo = join(TMP, "work/the-devenv");
  createMockGitRepo(repo);
  mkdirSync(join(repo, ".devcontainer"), { recursive: true });
  writeFileSync(join(repo, ".devcontainer/bootstrap.sh"), "#!/bin/bash\n");
  return repo;
}

describe("one resolver: get_repo_spec == provider_repo_target", () => {
  it("get_repo_spec honors DEVENV_REPO", () => {
    writeConfig("github");
    createMockGitRepo(join(TMP, "work/proj-a"));
    const r = inRepo(join(TMP, "work/proj-a"), "DEVENV_REPO=other-org/other-repo get_repo_spec");
    expect(r.status).toBe(0);
    expect(r.out.trim()).toBe("other-org/other-repo");
  });

  it("get_repo_spec equals provider_repo_target from a working directory (github)", () => {
    writeConfig("github");
    createMockGitRepo(join(TMP, "work/proj-a"));
    const r = inRepo(join(TMP, "work/proj-a"), 'echo "$(get_repo_spec)|$(provider_repo_target)"');
    expect(r.status).toBe(0);
    expect(r.out.trim()).toBe("my-org/proj-a|my-org/proj-a");
  });

  it("azure: get_repo_spec and provider_repo_target both emit the two-part project/repo", () => {
    writeConfig("azure");
    createMockGitRepo(join(TMP, "work/proj-a"));
    const r = inRepo(join(TMP, "work/proj-a"), 'echo "$(get_repo_spec)|$(provider_repo_target)"');
    expect(r.status).toBe(0);
    expect(r.out.trim()).toBe("my-proj/proj-a|my-proj/proj-a");
  });

  it("azure: the cwd spec is never the org plus repo (which Azure would read as project/repo)", () => {
    writeConfig("azure");
    createMockGitRepo(join(TMP, "work/proj-a"));
    const r = inRepo(join(TMP, "work/proj-a"), "get_repo_spec");
    expect(r.status).toBe(0);
    expect(r.out.trim()).not.toBe("my-org/proj-a");
  });
});

describe("the devenv-repo safety gate", () => {
  it("gate: an implicit target from inside the devenv repo is refused", () => {
    writeConfig("github");
    const repo = makeDevenvRepo();
    const r = inRepo(repo, "resolve_target_repo");
    expect(r.status).not.toBe(0);
    expect(r.out).toContain("devenv repository itself");
  });

  it("gate: an explicit repo argument from inside the devenv repo is allowed", () => {
    writeConfig("github");
    const repo = makeDevenvRepo();
    const r = inRepo(repo, "resolve_target_repo other-org/other-repo");
    expect(r.status).toBe(0);
    expect(r.out.trim()).toBe("other-org/other-repo");
  });

  it("gate: DEVENV_REPO from inside the devenv repo is allowed", () => {
    writeConfig("github");
    const repo = makeDevenvRepo();
    const r = inRepo(repo, "DEVENV_REPO=other-org/other-repo resolve_target_repo");
    expect(r.status).toBe(0);
    expect(r.out.trim()).toBe("other-org/other-repo");
  });

  it("gate: the --devenv override (ALLOW_DEVENV_REPO=1) allows an implicit target with a warning", () => {
    writeConfig("github");
    const repo = makeDevenvRepo();
    const r = inRepo(repo, "ALLOW_DEVENV_REPO=1 resolve_target_repo");
    expect(r.status).toBe(0);
    expect(r.out).toContain("my-org/the-devenv");
  });

  it("gate: an implicit target from a non-devenv repo is allowed", () => {
    writeConfig("github");
    createMockGitRepo(join(TMP, "work/proj-a"));
    const r = inRepo(join(TMP, "work/proj-a"), "resolve_target_repo");
    expect(r.status).toBe(0);
    expect(r.out.trim()).toBe("my-org/proj-a");
  });

  it("gate: resolve_target_repo does not leak a DEVENV_REPO into the caller's shell", () => {
    writeConfig("github");
    createMockGitRepo(join(TMP, "work/proj-a"));
    const r = inRepo(join(TMP, "work/proj-a"), 'resolve_target_repo >/dev/null; echo "after=[${DEVENV_REPO:-}]"');
    expect(r.status).toBe(0);
    expect(r.out).toContain("after=[]");
  });
});
