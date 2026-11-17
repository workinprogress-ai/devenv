// Tool-to-tool delegation in a checkout that has no generated depth-1 stubs.
//
// Each case builds a throwaway fixture checkout (tools/lib + tools/config + the
// tool under test), gives it FAKE sibling entry points at tools/ts/<name>.ts
// that only log their argv, and runs the copied tool. The sibling can only be
// reached by resolving tools/ts/<name>.ts from the checkout — the fixture has
// no tools/<name> stub at all — so each case proves the delegation does not
// depend on a stub, with no real side effects (no git remote, gh or dotnet work).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CALLS_LOG_NAME, pathWithStubs, REPO_ROOT, stubCli, stubGh, tmpDir } from "./harness/index.ts";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const TOOLS = join(REPO_ROOT, "tools");

interface Call {
  tool: string;
  argv: string[];
  cwd: string;
}

let root = "";
let log = "";

function fakeSibling(name: string): string {
  return [
    'import { appendFileSync } from "node:fs";',
    `appendFileSync(process.env.SIBLING_LOG, JSON.stringify({ tool: ${JSON.stringify(name)}, argv: process.argv.slice(2), cwd: process.cwd() }) + "\\n");`,
    'process.exit(Number(process.env[`SIBLING_EXIT_${' + JSON.stringify(name.toUpperCase().replaceAll("-", "_")) + '}`] ?? "0"));',
    "",
  ].join("\n");
}

/** A fixture checkout holding real `tools` (copied) and fake `fakes` siblings. */
function makeCheckout(tools: string[], fakes: string[]): void {
  mkdirSync(join(root, "tools", "ts"), { recursive: true });
  cpSync(join(TOOLS, "lib"), join(root, "tools", "lib"), { recursive: true });
  cpSync(join(TOOLS, "config"), join(root, "tools", "config"), { recursive: true });
  for (const t of tools) cpSync(join(TOOLS, "ts", `${t}.ts`), join(root, "tools", "ts", `${t}.ts`));
  for (const f of fakes) writeFileSync(join(root, "tools", "ts", `${f}.ts`), fakeSibling(f));
  cpSync(join(TOOLS, "tests", "fixtures", "devenv.test.config"), join(root, "devenv.config"));
  // Package imports (zod, ...) resolve from the checkout root upward.
  symlinkSync(join(REPO_ROOT, "node_modules"), join(root, "node_modules"));
}

function run(
  tool: string,
  args: string[],
  opts: { cwd?: string; env?: Record<string, string>; input?: string } = {},
): { status: number; output: string } {
  const r = spawnSync("node", [join(root, "tools", "ts", `${tool}.ts`), ...args], {
    encoding: "utf8",
    cwd: opts.cwd ?? root,
    input: opts.input ?? "",
    env: { ...process.env, SIBLING_LOG: log, DEVENV_ROOT: root, ...opts.env } as NodeJS.ProcessEnv,
  });
  return { status: r.status ?? 1, output: (r.stdout ?? "") + (r.stderr ?? "") };
}

function calls(): Call[] {
  if (!existsSync(log)) return [];
  return readFileSync(log, "utf8")
    .split("\n")
    .filter((l) => l !== "")
    .map((l) => JSON.parse(l) as Call);
}

beforeEach(() => {
  root = tmpDir("sibdel");
  log = join(root, "sibling.log");
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("sibling delegation without generated stubs", () => {
  it("the fixture really has no depth-1 stubs", () => {
    makeCheckout(["repo-update-all"], ["repo-get"]);
    expect(existsSync(join(root, "tools", "repo-get"))).toBe(false);
    expect(existsSync(join(root, "tools", "repo-update-all"))).toBe(false);
  });

  it("repo-update-all runs repo-get inside every local repository", () => {
    makeCheckout(["repo-update-all"], ["repo-get"]);
    mkdirSync(join(root, "repos", "alpha"), { recursive: true });
    mkdirSync(join(root, "repos", "beta"), { recursive: true });
    const r = run("repo-update-all", []);
    expect(r.status).toBe(0);
    expect(calls().map((c) => c.cwd).sort()).toEqual([join(root, "repos", "alpha"), join(root, "repos", "beta")]);
    expect(calls().every((c) => c.tool === "repo-get" && c.argv.length === 0)).toBe(true);
  });

  it("repo-bump-version runs repo-get for the named repository", () => {
    makeCheckout(["repo-bump-version"], ["repo-get"]);
    const r = run("repo-bump-version", ["patch", "alpha"]);
    expect(calls()).toEqual([{ tool: "repo-get", argv: ["alpha"], cwd: root }]);
    // repo-get "succeeded" but left no clone behind, which the tool reports —
    // proof it got past the delegation rather than failing to launch it.
    expect(r.output).not.toContain("Failed to update repository");
  });

  it("repo-bump-version reports a repo-get failure", () => {
    makeCheckout(["repo-bump-version"], ["repo-get"]);
    const r = run("repo-bump-version", ["patch", "alpha"], { env: { SIBLING_EXIT_REPO_GET: "3" } });
    expect(r.status).not.toBe(0);
    expect(r.output).toContain("Failed to update repository: alpha");
  });

  it("repo-create runs repo-get, then repo-update-config on the clone", () => {
    makeCheckout(["repo-create"], ["repo-get", "repo-update-config"]);
    const bin = join(root, "bin");
    mkdirSync(bin);
    stubGh(
      bin,
      [
        "#!/usr/bin/env bash",
        'if [ "$1" = "auth" ] && [ "$2" = "status" ]; then exit 0; fi',
        `printf '%s\\n' "gh $*" >> "${join(bin, CALLS_LOG_NAME)}"`,
        'if [ "$1 $2" = "repo view" ]; then exit 1; fi',
        "exit 0",
      ].join("\n"),
    );
    const r = run("repo-create", ["--type", "planning", "--no-template", "--no-post-creation", "--description", "d", "planning.alpha"], {
      env: { PATH: pathWithStubs(bin) },
    });
    expect(r.output, r.output).not.toContain("not found");
    expect(calls().map((c) => c.tool), r.output).toEqual(["repo-get", "repo-update-config"]);
    expect(calls()[0]?.argv).toEqual(["planning.alpha"]);
    expect(calls()[1]?.argv).toEqual([join(root, "repos", "planning.alpha")]);
  });

  it("repo-commit --wip delegates to git-wip with exit-code passthrough", () => {
    makeCheckout(["repo-commit"], ["git-wip"]);
    const repo = join(root, "work");
    mkdirSync(repo);
    const git = (...a: string[]): void => {
      spawnSync("git", a, { cwd: repo, encoding: "utf8" });
    };
    git("init", "-q");
    writeFileSync(join(repo, "f.txt"), "x\n");
    const r = run("repo-commit", ["--wip"], { cwd: repo, env: { SIBLING_EXIT_GIT_WIP: "42" } });
    expect(r.status).toBe(42);
    expect(calls().map((c) => c.tool)).toEqual(["git-wip"]);
  });

  it("key-update-do hands the token to devenv-add-env-vars", () => {
    makeCheckout(["_key-update-do"], ["devenv-add-env-vars"]);
    const token = "d".repeat(40);
    // A failing sibling stops the tool right after the delegation.
    const r = run("_key-update-do", [token], { env: { SIBLING_EXIT_DEVENV_ADD_ENV_VARS: "7" } });
    expect(r.status).toBe(7);
    expect(calls()).toEqual([{ tool: "devenv-add-env-vars", argv: [`DIGITALOCEAN_API_TOKEN=${token}`], cwd: root }]);
  });

  it("key-update-tailscale hands the key to devenv-add-env-vars", () => {
    makeCheckout(["_key-update-tailscale"], ["devenv-add-env-vars"]);
    const key = "tskey-auth-fake";
    const bin = join(root, "bin");
    mkdirSync(bin);
    // No real tailscale/sudo may ever run: the tool must stop at the failing sibling.
    stubCli(bin, "tailscale", "#!/usr/bin/env bash\nexit 1\n");
    stubCli(bin, "sudo", "#!/usr/bin/env bash\nexit 1\n");
    const r = run("_key-update-tailscale", [key], {
      env: { SIBLING_EXIT_DEVENV_ADD_ENV_VARS: "7", PATH: pathWithStubs(bin) },
    });
    expect(r.status).toBe(7);
    expect(calls()).toEqual([{ tool: "devenv-add-env-vars", argv: [`TS_AUTHKEY=${key}`], cwd: root }]);
  });

  it("cs-references-update-wizard runs cs-references-update on the repo", () => {
    makeCheckout(["cs-references-update-wizard"], ["cs-references-update", "pr-create", "pr-merge"]);
    const repo = join(root, "test-repo");
    mkdirSync(join(repo, "src"), { recursive: true });
    const env = {
      HOME: join(root, "home"),
      GIT_AUTHOR_NAME: "T",
      GIT_AUTHOR_EMAIL: "t@example.com",
      GIT_COMMITTER_NAME: "T",
      GIT_COMMITTER_EMAIL: "t@example.com",
    };
    mkdirSync(env.HOME);
    const git = (...a: string[]): void => {
      spawnSync("git", a, { cwd: repo, encoding: "utf8", env: { ...process.env, ...env } });
    };
    git("init", "-q");
    writeFileSync(
      join(repo, "src", "MyLib.csproj"),
      '<Project Sdk="Microsoft.NET.Sdk"><ItemGroup><PackageReference Include="X.Y" Version="1.0.0" /></ItemGroup></Project>\n',
    );
    git("add", ".");
    git("commit", "-q", "-m", "chore: initial");
    git("branch", "-M", "master");
    git("remote", "add", "origin", "https://github.com/test-org/test-repo.git");
    git("update-ref", "refs/remotes/origin/master", "HEAD");
    git("symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/master");
    // The fake cs-references-update changes nothing, so the wizard ends at its
    // documented "no changes" exit before any PR step.
    const r = run("cs-references-update-wizard", ["--framework", "net10.0", repo], { cwd: repo, env });
    expect(r.status).toBe(10);
    expect(calls()).toEqual([{ tool: "cs-references-update", argv: [repo, "--framework", "net10.0"], cwd: repo }]);
  });

  it("cs-dependencies-update-wizard runs cs-references-update-wizard per repo", () => {
    makeCheckout(["cs-dependencies-update-wizard"], ["cs-references-update-wizard"]);
    const cache = join(root, "cache");
    mkdirSync(join(cache, ".index"), { recursive: true });
    mkdirSync(join(cache, "repo-alpha", "src"), { recursive: true });
    writeFileSync(join(cache, "repo-alpha", "src", "WorkInProgress.Alpha.csproj"), "");
    writeFileSync(join(cache, ".index", "package_to_repo.tsv"), "WorkInProgress.Alpha\trepo-alpha\n");
    writeFileSync(join(cache, ".index", "repo_packages.tsv"), "repo-alpha\tWorkInProgress.Alpha\n");
    writeFileSync(join(cache, ".index", "repo_dependencies.tsv"), "");
    writeFileSync(join(cache, ".cache_timestamp"), "test-ts\n");
    writeFileSync(join(cache, ".index", ".index_timestamp"), "test-ts\n");
    const bin = join(root, "bin");
    mkdirSync(bin);
    for (const name of ["jq", "dotnet", "dotnet-outdated"]) stubCli(bin, name, "#!/usr/bin/env bash\nexit 0\n");
    stubGh(bin);
    const r = run("cs-dependencies-update-wizard", ["--global", "--auto", "--no-refresh"], {
      env: { PATH: pathWithStubs(bin), REPO_CACHE_DIR: cache, SIBLING_EXIT_CS_REFERENCES_UPDATE_WIZARD: "10" },
    });
    expect(r.output).not.toContain("Single-repo wizard failed");
    expect(calls().map((c) => c.tool)).toEqual(["cs-references-update-wizard"]);
    expect(calls()[0]?.argv).toEqual(["--branch", expect.any(String), join(cache, "repo-alpha")]);
  });
});
