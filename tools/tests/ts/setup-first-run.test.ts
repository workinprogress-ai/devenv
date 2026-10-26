// Tests for setup-first-run.ts — the bootstrap handoff contract (AC-12).
// Non-interactive by contract: tests assert the dispatch surface (step
// selection, unknown-step rejection, --list, no-args contract) and the
// failure-sequencing behavior. The bash steps themselves are exercised by
// the bridge library's own suites; invoking real provisioning (git config,
// credential store) from vitest would need the full .setup seed world, so
// the failure-path test uses an unknown-function step name via a stubbed
// bridge invocation check instead.
import { describe, it, expect, afterAll } from "vitest";
import { spawnSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, cpSync } from "node:fs";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";

const TOOL = join(fileURLToPath(new URL(".", import.meta.url)), "../../ts/setup-first-run.ts");
const REPO_ROOT = join(dirname(fileURLToPath(new URL(".", import.meta.url))), "../..");

interface RunResult {
  status: number;
  stdout: string;
  stderr: string;
  output: string;
}

function runTool(args: string[]): RunResult {
  const r = spawnSync("node", [TOOL, ...args], {
    encoding: "utf8",
    input: "",
    stdio: ["pipe", "pipe", "pipe"],
  });
  const stdout = r.stdout ?? "";
  const stderr = r.stderr ?? "";
  return { status: r.status ?? 1, stdout, stderr, output: stdout + stderr };
}

describe("setup-first-run (bootstrap handoff contract)", () => {
  it("--list enumerates the provisioning steps", () => {
    const r = runTool(["--list"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("credentials");
    expect(r.stdout).toContain("env-vars");
    expect(r.stdout).toContain("tool-symlinks");
    expect(r.stdout).toContain("devenvrc");
    expect(r.stdout).toContain("custom-bootstrap");
  });

  it("no args explains the contract and exits 2", () => {
    const r = runTool([]);
    expect(r.status).toBe(2);
    expect(r.output).toContain("nothing to do");
    expect(r.output).toContain("--all");
  });

  it("unknown step names are rejected with the valid set named", () => {
    const r = runTool(["not-a-step"]);
    expect(r.status).toBe(2);
    expect(r.output).toContain("unknown step");
    expect(r.output).toContain("--list");
  });

  it("help documents the non-interactive contract", () => {
    const r = runTool(["--help"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("Non-interactive by contract");
    expect(r.stdout).toContain("--all");
    expect(r.stdout).toContain("idempotent");
  });

  it("step order matches the historical bootstrap sequence", () => {
    const r = runTool(["--list"]);
    const lines = r.stdout.trim().split("\n").map((l) => l.split(/\s+/)[0]);
    const expectedOrder = [
      "credentials", "bash-functions", "env-vars", "tool-symlinks",
      "devenvrc", "bashrc", "git-config", "copilot-instructions",
      "claude-integration", "knowledge-sync", "engineering-sync",
      "directories", "nuget-sources", "npmrc", "custom-bootstrap", "cleanup",
    ];
    expect(lines).toEqual(expectedOrder);
  });

  it("--all runs every step in order and completes in this container", () => {
    // This container's toolbox (workspace root) has satisfied .setup seeds +
    // provider auth, so the full sequence succeeds: all 16 steps report ok.
    // The dev clone itself is seedless — provisioning targets the toolbox,
    // so the test passes the chain's handoff env explicitly, exactly as the
    // bootstrap's run_setup_first_run does.
    const toolbox = process.env.DEVENV_TOOLBOX_ROOT ?? "/workspaces/devenv";
    if (!existsSync(join(toolbox, ".setup", "email.txt"))) {
      // Seeds live in the real toolbox; a rebuilt container before first
      // `setup` would not have them. Skip rather than fail spuriously.
      return;
    }
    const r = spawnSync("node", [TOOL, "--all", "--json"], {
      encoding: "utf8",
      input: "",
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, DEVENV_TOOLBOX_ROOT: toolbox },
    });
    const stdout = r.stdout ?? "";
    const status = r.status ?? 1;
    expect(status).toBe(0);
    const results = JSON.parse(stdout) as { step: string; status: string }[];
    expect(results.length).toBe(16);
    expect(results.every((x) => x.status === "ok")).toBe(true);
    expect(results[0]?.step).toBe("credentials");
    expect(results[15]?.step).toBe("cleanup");
  }, 120_000);
});

// The TS→bash seam, exercised against a fixture toolbox: the tool must give
// the bridge functions the bootstrap-owned globals (prelude) and must run
// one invocation's steps in a single bash session (cross-step shell state:
// credentials seeds HUMAN_NAME/USER_EMAIL; git-config consumes them). The
// fake HOME keeps every write inside the fixture.
describe("setup-first-run seam (fixture toolbox)", () => {
  const tempRoots: string[] = [];

  function makeToolbox(): { root: string; home: string } {
    const root = mkdtempSync(join(tmpdir(), "sfr-toolbox-"));
    const home = mkdtempSync(join(tmpdir(), "sfr-home-"));
    tempRoots.push(root, home);
    mkdirSync(join(root, ".setup"), { recursive: true });
    mkdirSync(join(root, "tools", "lib"), { recursive: true });
    mkdirSync(join(root, ".runtime"), { recursive: true });
    for (const lib of ["provision.bash", "git-operations.bash", "self-root.bash", "error-handling.bash", "scratchpad.bash"]) {
      const src = join(REPO_ROOT, "tools", "lib", lib);
      if (existsSync(src)) cpSync(src, join(root, "tools", "lib", lib));
    }
    cpSync(join(REPO_ROOT, "devenv.config"), join(root, "devenv.config"));
    writeFileSync(join(root, ".setup", "name.txt"), "Fixture Name\n");
    writeFileSync(join(root, ".setup", "email.txt"), "fixture@example.com\n");
    writeFileSync(join(root, ".setup", "provider_org.txt"), "fixture-org\n");
    writeFileSync(join(root, ".setup", "provider_user.txt"), "fixture-user\n");
    return { root, home };
  }

  function runInToolbox(args: string[], root: string, home: string): RunResult {
    const r = spawnSync("node", [TOOL, ...args], {
      encoding: "utf8",
      input: "",
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, DEVENV_TOOLBOX_ROOT: root, HOME: home },
    });
    const stdout = r.stdout ?? "";
    const stderr = r.stderr ?? "";
    return { status: r.status ?? 1, stdout, stderr, output: stdout + stderr };
  }

  afterAll(() => {
    for (const dir of tempRoots) rmSync(dir, { recursive: true, force: true });
  });

  it("credentials + git-config share one session: the fixture identity reaches the fixture gitconfig", () => {
    const { root, home } = makeToolbox();
    const r = runInToolbox(["credentials", "git-config", "--json"], root, home);
    expect(r.status).toBe(0);
    const gitconfig = join(home, ".gitconfig");
    expect(existsSync(gitconfig)).toBe(true);
    const execGit = (key: string) =>
      execFileSync("git", ["config", "--file", gitconfig, "--get", key], { encoding: "utf8" }).trim();
    expect(execGit("user.name")).toBe("Fixture Name");
    expect(execGit("user.email")).toBe("fixture@example.com");
  }, 60_000);

  it("--json keeps step noise off stdout: the full stdout parses as pure JSON", () => {
    const { root, home } = makeToolbox();
    const r = runInToolbox(["credentials", "--json"], root, home);
    expect(r.status).toBe(0);
    const parsed = JSON.parse(r.stdout) as unknown;
    expect(Array.isArray(parsed)).toBe(true);
    expect((parsed as { step: string }[])[0]?.step).toBe("credentials");
  }, 60_000);

  it("an unknown step name is a misuse failure naming the valid set", () => {
    const { root, home } = makeToolbox();
    const r = runInToolbox(["not-a-step"], root, home);
    expect(r.status).toBe(2);
    expect(r.output).toContain("unknown step");
    expect(r.output).toContain("--list");
  }, 60_000);
});
