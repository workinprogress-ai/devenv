// Port of tools/tests/lib/test_repo_foreign_safety.bats (11 tests): foreign
// remote safety (issue #34) — repo_is_org_member membership checks (member /
// foreign / ambiguous / URL forms), and configure_git_repo's guard: it refuses
// to rewrite a foreign repo's remote, warns, and still applies the rest of the
// local git configuration. Org repos are configured exactly as before (control).
import { beforeEach, describe, expect, it, vi } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const ROOT = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))));
const TOOLS = join(ROOT, "tools");

let TMP = "";

// Mock identity root with the helper's tools symlink — git-operations sources
// provider-loader from $DEVENV_ROOT/tools, which is what wires policy_org.
function mockRoot(prefix: string): string {
  const root = mkdtempSync(join(tmpdir(), `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`));
  symlinkSync(TOOLS, join(root, "tools"));
  return root;
}

beforeEach(() => {
  TMP = mockRoot("frem");
  writeFileSync(join(TMP, "devenv.config"), "[provider]\nname=github\n[organization]\nname=t\norg=my-org\n");
});

// Init a git repo with an origin owned by the given owner.
function makeRepoWithOrigin(dir: string, owner: string, repo: string): void {
  spawnSync("git", ["init", "-q", dir]);
  spawnSync("git", ["-C", dir, "config", "user.email", "t@t"]);
  spawnSync("git", ["-C", dir, "config", "user.name", "t"]);
  spawnSync("git", ["-C", dir, "remote", "add", "origin", `https://github.com/${owner}/${repo}.git`]);
}

// membership ORG ARGS: org resolution is config/seed-scoped — point DEVENV_ROOT
// at a mock identity root for the duration of the call.
function membership(org: string, root: string, target: string, extraEnv: Record<string, string> = {}): { status: number; out: string } {
  writeFileSync(join(root, "devenv.config"), `[organization]\nname=t\norg=${org}\n`);
  const r = spawnSync(
    "bash",
    [
      "-c",
      `unset POLICY_ORG GH_ORG\n` +
      `source '${TOOLS}/lib/error-handling.bash'\n` +
      `source '${TOOLS}/lib/git-operations.bash'\n` +
      `repo_is_org_member "$1"`,
      "_",
      target,
    ],
    { encoding: "utf8", env: { ...process.env, DEVENV_ROOT: root, DEVENV_ROOT_SET: "1", ...extraEnv } },
  );
  return { status: r.status ?? 1, out: (r.stdout ?? "") + (r.stderr ?? "") };
}

// ===========================================================================
// repo_is_org_member
// ===========================================================================

describe("repo_is_org_member", () => {
  it("membership: org repo spec is a member", () => {
    const r = membership("myorg", TMP, "myorg/myrepo");
    expect(r.status).toBe(0);
  });

  it("membership: foreign owner is not a member", () => {
    const r = membership("myorg", TMP, "otherorg/repo");
    expect(r.status).not.toBe(0);
  });

  it("membership: https URL with credentials, member", () => {
    const r = membership("myorg", TMP, "https://user:ghp_x@github.com/myorg/repo.git");
    expect(r.status).toBe(0);
  });

  it("membership: https URL without credentials, foreign", () => {
    const r = membership("myorg", TMP, "https://github.com/other/repo");
    expect(r.status).not.toBe(0);
  });

  it("membership: current-origin form (credential-bearing foreign) is foreign", () => {
    // the real-world shape found in repos/: user:token@ foreign remote
    const r = membership("myorg", TMP, "https://user:ghp_x@github.com/foreign/fork.git");
    expect(r.status).not.toBe(0);
  });

  it("membership: SSH form (git@host:owner/repo) recognized", () => {
    expect(membership("test-org", TMP, "git@github.com:test-org/dummy.git").status).toBe(0);
    expect(membership("test-org", TMP, "git@github.com:otherorg/dummy.git").status).not.toBe(0);
  });

  it("membership: ambiguous — no org configured anywhere", () => {
    const emptyCfg = join(TMP, "no-config");
    mkdirSync(emptyCfg, { recursive: true });
    symlinkSync(TOOLS, join(emptyCfg, "tools"));
    const r = spawnSync(
      "bash",
      [
        "-c",
        `unset POLICY_ORG GH_ORG\n` +
        `source '${TOOLS}/lib/error-handling.bash'\n` +
        `source '${TOOLS}/lib/git-operations.bash'\n` +
        `repo_is_org_member "$1"`,
        "_",
        "myorg/repo",
      ],
      { encoding: "utf8", env: { ...process.env, DEVENV_ROOT: emptyCfg, DEVENV_ROOT_SET: "1" } },
    );
    expect(r.status ?? 1).not.toBe(0);
    expect(((r.stdout ?? "") + (r.stderr ?? ""))).toContain("no GitHub org configured");
  });

  it("membership: ambiguous — unparseable spec treated as foreign with warning", () => {
    const r = membership("myorg", TMP, "not-a-url-or-spec", { GH_ORG: "myorg" });
    expect(r.status).not.toBe(0);
    expect(r.out).toContain("cannot parse owner");
  });

  it("membership: falls back to devenv.config [organization] org", () => {
    const cfgRoot = join(TMP, "cfgroot");
    mkdirSync(cfgRoot, { recursive: true });
    symlinkSync(TOOLS, join(cfgRoot, "tools"));
    writeFileSync(join(cfgRoot, "devenv.config"), "[organization]\nname=X\norg=cforg\n");
    expect(membership("cforg", cfgRoot, "cforg/repo").status).toBe(0);
    expect(membership("cforg", cfgRoot, "other/repo").status).not.toBe(0);
  });
});

// ===========================================================================
// configure_git_repo guard
// ===========================================================================

// configure IN_DIR EXTRA_ENV: run configure_git_repo "." NEW_URL inside dir,
// capturing combined output.
function configure(inDir: string, extraEnv: Record<string, string>): { out: string } {
  const r = spawnSync(
    "bash",
    [
      "-c",
      `source '${TOOLS}/lib/error-handling.bash'\n` +
      `source '${TOOLS}/lib/git-operations.bash'\n` +
      `cd '${inDir}'\n` +
      `configure_git_repo "." "https://user:ghp_x@github.com/myorg/some-repo.git"`,
    ],
    { encoding: "utf8", env: { ...process.env, ...extraEnv } },
  );
  return { out: (r.stdout ?? "") + (r.stderr ?? "") };
}

describe("configure_git_repo foreign-remote guard", () => {
  it("guard: foreign repo remote is NOT rewritten, warning emitted, local config still applied", () => {
    const dir = join(TMP, "foreign");
    makeRepoWithOrigin(dir, "foreignorg", "some-repo");
    const { out } = configure(dir, { GH_ORG: "myorg" });
    // remote untouched
    expect(spawnSync("git", ["-C", dir, "remote", "get-url", "origin"], { encoding: "utf8" }).stdout?.trim()).toBe(
      "https://github.com/foreignorg/some-repo.git",
    );
    // warning emitted
    expect(out).toContain("skipping remote URL rewrite");
    // local settings still applied (the non-rewrite parts of the function ran)
    expect(spawnSync("git", ["-C", dir, "config", "core.autocrlf"], { encoding: "utf8" }).stdout?.trim()).toBe("false");
  });

  it("guard: org repo remote IS rewritten as before (control)", () => {
    const dir = join(TMP, "orgrepo");
    makeRepoWithOrigin(dir, "myorg", "some-repo");
    const cfgRoot = join(TMP, "ctrl-cfg");
    mkdirSync(cfgRoot, { recursive: true });
    symlinkSync(TOOLS, join(cfgRoot, "tools"));
    writeFileSync(join(cfgRoot, "devenv.config"), "[organization]\nname=t\norg=myorg\n");
    const { out } = configure(dir, { DEVENV_ROOT: cfgRoot, DEVENV_ROOT_SET: "1" });
    void out;
    expect(spawnSync("git", ["-C", dir, "remote", "get-url", "origin"], { encoding: "utf8" }).stdout?.trim()).toBe(
      "https://user:ghp_x@github.com/myorg/some-repo.git",
    );
  });
});
