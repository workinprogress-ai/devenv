// CLI contract for the repo-*, pr-* and helper tools: `--help`/`--version` exit
// 0 on stdout with no provider or workspace, unknown flags and bad operands are
// misuse (exit 2) before any mutation, and the documented exit codes are the
// ones returned. Every probe runs in a throwaway git repo; the harness canary
// fails a test that reaches a real gh/az/ssh.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathWithStubs, rmrf, stubCli, tmpDir, toolScript } from "./harness/index.ts";
import { EXIT_API_FAILURE, EXIT_MISUSE, EXIT_SUCCESS } from "../../lib/core/exit-codes.ts";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

let TMP = "";
let REPO = "";

const GIT_ENV = (): Record<string, string> => ({
  ...(process.env as Record<string, string>),
  HOME: join(TMP, "home"),
  GIT_AUTHOR_NAME: "Test",
  GIT_AUTHOR_EMAIL: "test@test.com",
  GIT_COMMITTER_NAME: "Test",
  GIT_COMMITTER_EMAIL: "test@test.com",
});

function git(args: string[]): string {
  return spawnSync("git", args, { cwd: REPO, encoding: "utf8", env: GIT_ENV() }).stdout ?? "";
}

function run(tool: string, args: string[], env: Record<string, string> = {}): { status: number; stdout: string; stderr: string } {
  const r = spawnSync("node", [toolScript(tool), ...args], {
    cwd: REPO,
    encoding: "utf8",
    input: "",
    env: { ...GIT_ENV(), ...env },
  });
  return { status: r.status ?? 1, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

beforeEach(() => {
  TMP = tmpDir("cli-contract-repo");
  mkdirSync(join(TMP, "home"), { recursive: true });
  REPO = join(TMP, "repo");
  spawnSync("git", ["init", "-q", REPO], { env: GIT_ENV() });
  writeFileSync(join(REPO, "file.txt"), "seed\n");
  git(["add", "file.txt"]);
  git(["commit", "-q", "-m", "initial"]);
});

afterEach(() => rmrf(TMP));

const HELP_TOOLS = [
  "repo-create",
  "repo-reset-merge-config",
  "repo-update-config",
  "pr-create",
  "pr-merge",
  "tunnel-ports",
  "repo-stage",
  "repo-bisect",
  "repo-cache-update",
  "repo-get",
  "repo-commit",
  "repo-scratchpad",
  "cs-dependencies-trace",
  "pr-review-comment",
];

describe.each(HELP_TOOLS)("%s house flags", (tool) => {
  it("--help exits 0 with usage on stdout", () => {
    const r = run(tool, ["--help"]);
    expect(r.status).toBe(EXIT_SUCCESS);
    expect(r.stdout).toContain("Usage:");
  });

  it("-h behaves like --help", () => {
    const r = run(tool, ["-h"]);
    expect(r.status).toBe(EXIT_SUCCESS);
    expect(r.stdout).toContain("Usage:");
  });

  it("--version exits 0 with a version on stdout", () => {
    const r = run(tool, ["--version"]);
    expect(r.status).toBe(EXIT_SUCCESS);
    expect(r.stdout.trim()).toMatch(/^\d+\.\d+\.\d+/);
  });

  it("-v behaves like --version", () => {
    const r = run(tool, ["-v"]);
    expect(r.status).toBe(EXIT_SUCCESS);
    expect(r.stdout.trim()).toMatch(/^\d+\.\d+\.\d+/);
  });
});

describe.each(HELP_TOOLS.filter((t) => t !== "pr-merge"))("%s unknown flag", (tool) => {
  it("is misuse (exit 2) with a --help hint", () => {
    const r = run(tool, ["--bogus-flag"]);
    expect(r.status).toBe(EXIT_MISUSE);
    expect(r.stdout + r.stderr).toContain("--help");
  });
});

describe("pr-merge", () => {
  it("rejects an unknown flag as misuse", () => {
    expect(run("pr-merge", ["--bogus-flag"]).status).toBe(EXIT_MISUSE);
  });
});

describe("pr-review-comment help", () => {
  it("lists the house flags once", () => {
    const r = run("pr-review-comment", ["--help"]);
    for (const flag of ["-h, --help", "-v, --version", "-V, --verbose"]) {
      expect(r.stdout.split(flag).length - 1, flag).toBe(1);
    }
  });
});

describe("misuse exits 2 before any mutation", () => {
  it("repo-create without a name", () => {
    expect(run("repo-create", []).status).toBe(EXIT_MISUSE);
  });

  it("repo-reset-merge-config without a target", () => {
    expect(run("repo-reset-merge-config", []).status).toBe(EXIT_MISUSE);
  });

  it("repo-update-config without a path", () => {
    expect(run("repo-update-config", []).status).toBe(EXIT_MISUSE);
  });

  it("repo-update-config with a nonexistent path", () => {
    const r = run("repo-update-config", [join(TMP, "nope")], { DEVENV_ORG: "test-org" });
    expect(r.status).toBe(EXIT_MISUSE);
  });

  it("pr-create with both --issue and --no-issue", () => {
    expect(run("pr-create", ["--issue", "5", "--no-issue", "title"]).status).toBe(EXIT_MISUSE);
  });

  it("pr-create with a missing --body-file", () => {
    const r = run("pr-create", ["--no-issue", "--body-file", join(TMP, "nope.md"), "feat: x"]);
    expect(r.status).toBe(EXIT_MISUSE);
  });

  it("tunnel-ports with a malformed mapping opens no tunnel", () => {
    const bin = join(TMP, "bin");
    mkdirSync(bin);
    stubCli(bin, "ssh", `#!/bin/sh\necho "ssh $*" >> "${join(TMP, "ssh.log")}"`);
    const r = run("tunnel-ports", ["user@host", "8080:dest", "nocolon"], { PATH: pathWithStubs(bin) });
    expect(r.status).toBe(EXIT_MISUSE);
    expect(existsSync(join(TMP, "ssh.log"))).toBe(false);
  });

  it("tunnel-ports without a target", () => {
    expect(run("tunnel-ports", []).status).toBe(EXIT_MISUSE);
  });

  it("repo-stage without paths", () => {
    expect(run("repo-stage", []).status).toBe(EXIT_MISUSE);
  });

  it("repo-stage --group without --batch", () => {
    expect(run("repo-stage", ["--group", "1", "file.txt"]).status).toBe(EXIT_MISUSE);
  });

  it("repo-stage --batch with --patch", () => {
    expect(run("repo-stage", ["--batch", "a", "--patch", "b"]).status).toBe(EXIT_MISUSE);
  });

  it("repo-stage --group with a non-integer", () => {
    expect(run("repo-stage", ["--batch", "a", "--group", "x"]).status).toBe(EXIT_MISUSE);
  });

  it("repo-bisect without arguments", () => {
    expect(run("repo-bisect", []).status).toBe(EXIT_MISUSE);
  });

  it("repo-bisect with bad arity", () => {
    expect(run("repo-bisect", ["HEAD"]).status).toBe(EXIT_MISUSE);
  });

  it("repo-commit refuses -m and stays a misuse", () => {
    const r = run("repo-commit", ["-m", "msg"]);
    expect(r.status).toBe(EXIT_MISUSE);
    expect(r.stdout + r.stderr).toContain("options are refused by design");
  });

  it("repo-commit refuses exclusive lanes together", () => {
    expect(run("repo-commit", ["--wip", "--amend"]).status).toBe(EXIT_MISUSE);
  });

  it("repo-commit without a message", () => {
    expect(run("repo-commit", []).status).toBe(EXIT_MISUSE);
  });

  it("repo-get rejects a single-dash name as an invalid repository name (exit 2)", () => {
    const r = run("repo-get", ["-repo"]);
    expect(r.status).toBe(EXIT_MISUSE);
    expect(r.stdout + r.stderr).toContain("Invalid repository name");
  });

  it("repo-get rejects extra operands (exit 2) without provider access", () => {
    expect(run("repo-get", ["a", "b"]).status).toBe(EXIT_MISUSE);
  });

  it("repo-scratchpad treats a flag-looking title word as an unknown flag", () => {
    expect(run("repo-scratchpad", ["commit", "-x", "fix"]).status).toBe(EXIT_MISUSE);
  });

  it("repo-scratchpad accepts a flag-looking title word after --", () => {
    // No scratchpad is active, so the run is refused for that reason (exit 1),
    // proving the title parsed as an operand rather than as an unknown flag.
    const r = run("repo-scratchpad", ["commit", "--", "-x", "fix"]);
    expect(r.status).not.toBe(EXIT_MISUSE);
    expect(r.stderr).toContain("no scratchpad active");
  });
});

describe("repo-get --help needs no workspace or provider", () => {
  it("exits 0 with DEVENV_ROOT unset and a failing gh", () => {
    const bin = join(TMP, "bin");
    mkdirSync(bin);
    stubCli(bin, "gh", "#!/bin/sh\nexit 1");
    const env = { PATH: pathWithStubs(bin) } as Record<string, string>;
    const r = spawnSync("node", [toolScript("repo-get"), "--help"], {
      cwd: REPO,
      encoding: "utf8",
      input: "",
      env: { ...GIT_ENV(), ...env, DEVENV_ROOT: "" },
    });
    expect(r.status).toBe(EXIT_SUCCESS);
    expect(r.stdout).toContain("Usage:");
  });
});

describe("repo-cache-update partial failure", () => {
  it("builds the index, prints the cache path, and exits with the API-failure code", () => {
    const bin = join(TMP, "bin");
    mkdirSync(bin);
    const cache = join(TMP, "cache");
    const root = join(TMP, "devenv-root");
    mkdirSync(root);
    writeFileSync(
      join(root, "devenv.config"),
      "[provider]\nname=github\n\n[organization]\nname=Test Organization\norg=test-org\nemail_domain=test.example.com\n",
    );
    const realGit = spawnSync("sh", ["-c", "command -v git"], { encoding: "utf8" }).stdout.trim();
    stubCli(
      bin,
      "gh",
      [
        "#!/bin/sh",
        'if [ "$1" = "auth" ] && [ "$2" = "status" ]; then exit 0; fi',
        'if [ "$1" = "repo" ]; then echo \'[{"name":"good"},{"name":"bad"}]\'; exit 0; fi',
        "exit 0",
      ].join("\n"),
    );
    stubCli(
      bin,
      "git",
      [
        "#!/bin/sh",
        'if [ "$1" = "clone" ]; then',
        '  for last; do :; done',
        '  case "$last" in *bad) exit 1 ;; esac',
        '  mkdir -p "$last/.git"; exit 0',
        "fi",
        `exec "${realGit}" "$@"`,
      ].join("\n"),
    );
    const { CS_DEP_ORG_PREFIX: _c, ...cleanEnv } = GIT_ENV();
    const r = spawnSync("node", [toolScript("repo-cache-update")], {
      cwd: REPO,
      encoding: "utf8",
      input: "",
      env: { ...cleanEnv, PATH: pathWithStubs(bin), REPO_CACHE_DIR: cache, DEVENV_ROOT: root, DEVENV_ROOT_SET: "1" },
    });
    expect(r.stderr).toContain("Failed to cache bad");
    expect(r.status).toBe(EXIT_API_FAILURE);
    expect(r.stdout.trim()).toBe(cache);
  });
});
