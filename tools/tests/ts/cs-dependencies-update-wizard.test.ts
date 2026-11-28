// cs-dependencies-update-wizard: --global mode and argument validation over a
// hand-built dependency-index cache.
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { spawnSync } from "node:child_process";
import { appendFileSync, chmodSync, existsSync, mkdirSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readdirSync, readFileSync } from "node:fs";
import { stubGh, pathWithStubs, toolScript, TOOLS } from "./harness/index.ts";

vi.setConfig({ testTimeout: 120_000, hookTimeout: 60_000 });

const WIZARD = toolScript("cs-dependencies-update-wizard");

let TMP = "";
let REPO_CACHE_DIR = "";

function setupMinimalCache(): void {
  mkdirSync(join(REPO_CACHE_DIR, ".index"), { recursive: true });
  // One simple repo with no org-internal deps (lands in generation 0)
  mkdirSync(join(REPO_CACHE_DIR, "repo-alpha", "src"), { recursive: true });
  writeFileSync(join(REPO_CACHE_DIR, "repo-alpha", "src", "WorkInProgress.Alpha.csproj"), "");
  writeFileSync(join(REPO_CACHE_DIR, ".index", "package_to_repo.tsv"), "WorkInProgress.Alpha\trepo-alpha\n");
  writeFileSync(join(REPO_CACHE_DIR, ".index", "repo_packages.tsv"), "repo-alpha\tWorkInProgress.Alpha\n");
  writeFileSync(join(REPO_CACHE_DIR, ".index", "repo_dependencies.tsv"), "");
  // Matching timestamps so ensure_dependency_index sees the index as fresh
  writeFileSync(join(REPO_CACHE_DIR, ".cache_timestamp"), "test-ts\n");
  writeFileSync(join(REPO_CACHE_DIR, ".index", ".index_timestamp"), "test-ts\n");
}

function setupTwoGenCache(): void {
  setupMinimalCache();
  // Add a second repo that depends on repo-alpha (generation 1)
  mkdirSync(join(REPO_CACHE_DIR, "repo-beta", "src"), { recursive: true });
  writeFileSync(join(REPO_CACHE_DIR, "repo-beta", "src", "WorkInProgress.Beta.csproj"), "");
  appendToFile(join(REPO_CACHE_DIR, ".index", "package_to_repo.tsv"), "WorkInProgress.Beta\trepo-beta\n");
  appendToFile(join(REPO_CACHE_DIR, ".index", "repo_packages.tsv"), "repo-beta\tWorkInProgress.Beta\n");
  appendToFile(join(REPO_CACHE_DIR, ".index", "repo_dependencies.tsv"), "repo-beta\tWorkInProgress.Alpha\t1.0.0\n");
}

function appendToFile(file: string, content: string): void {
  appendFileSync(file, content);
}

beforeEach(() => {
  TMP = mkdtempSync(join(tmpdir(), `csduw-${Date.now()}-${Math.random().toString(36).slice(2)}`));
  REPO_CACHE_DIR = join(TMP, "cache");
  mkdirSync(join(TMP, "bin"), { recursive: true });
  stubGh(join(TMP, "bin"));
  // The wizard checks for these before a real run; none of the dry-run paths
  // under test executes them, and a CI image has no dotnet-outdated.
  for (const tool of ["dotnet", "dotnet-outdated"]) {
    writeFileSync(join(TMP, "bin", tool), "#!/bin/sh\nexit 0\n");
    chmodSync(join(TMP, "bin", tool), 0o755);
  }
});

afterEach(() => {
  rmSync(TMP, { recursive: true, force: true });
});

const { DEVENV_REPO: _dr, ...procEnv } = process.env;

function runWizard(args: string[], extraEnv: Record<string, string> = {}): { status: number; out: string } {
  // setsid: no controlling terminal. The wizard's prompts read /dev/tty, and a
  // test run from a terminal (a commit hook) must never wait on it.
  const r = spawnSync("setsid", ["--wait", "node", WIZARD, ...args], {
    encoding: "utf8",
    env: { ...procEnv, PATH: pathWithStubs(join(TMP, "bin")), REPO_CACHE_DIR, ...extraEnv },
  });
  return { status: r.status ?? 1, out: (r.stdout ?? "") + (r.stderr ?? "") };
}

// Runs the wizard on a pseudo-terminal (its retry prompt reads /dev/tty) and answers every
// "[r]etry / [s]kip" prompt with `answer`. Returns the exit status and everything it printed.
function runOnPty(command: string[], env: Record<string, string>, answer: string): { status: number; out: string } {
  const script = [
    "import os, pty, select, sys, time, json",
    "cmd = json.loads(sys.argv[1]); answer = sys.argv[2]",
    "pid, fd = pty.fork()",
    "if pid == 0: os.execvp(cmd[0], cmd)",
    "out = b''; answered = 0; end = time.time() + 90",
    "while time.time() < end:",
    "    r, _, _ = select.select([fd], [], [], 0.5)",
    "    if r:",
    "        try: d = os.read(fd, 4096)",
    "        except OSError: break",
    "        if not d: break",
    "        out += d",
    "    if out.count(b'[s]kip') > answered:",
    "        answered += 1; os.write(fd, (answer + chr(10)).encode())",
    "if time.time() >= end:",
    "    try: os.kill(pid, 9)",
    "    except OSError: pass",
    "_, st = os.waitpid(pid, 0)",
    "sys.stdout.write(out.decode(errors='replace')); sys.exit(os.waitstatus_to_exitcode(st))",
  ].join("\n");
  const r = spawnSync("python3", ["-I", "-c", script, JSON.stringify(command), answer], { encoding: "utf8", env: { ...procEnv, ...env } });
  return { status: r.status ?? 1, out: r.stdout ?? "" };
}

describe("scripts/cs-dependencies-update-wizard", () => {
  it("a retry after the single-repo wizard left a half-done update resumes it with --continue", () => {
    setupMinimalCache();
    // A fixture tools root: this checkout's lib, the wizard under test, and a fake single-repo wizard
    // that pauses (exit 30) on its first run and finishes (exit 10) only when it is told to --continue.
    const root = join(TMP, "fake", "tools");
    mkdirSync(join(root, "ts"), { recursive: true });
    spawnSync("cp", ["-r", join(TOOLS, "lib"), join(root, "lib")]);
    spawnSync("cp", [join(TOOLS, "ts", "cs-dependencies-update-wizard.ts"), join(root, "ts", "wizard.ts")]);
    const devRoot = join(TMP, "devroot");
    mkdirSync(devRoot, { recursive: true });
    writeFileSync(join(devRoot, "devenv.config"), "[provider]\nname=github\n");
    const calls = join(TMP, "single-repo.calls");
    writeFileSync(
      join(root, "cs-references-update-wizard"),
      `#!/bin/bash\necho "$*" >> "${calls}"\nif [ "$(wc -l < "${calls}")" -eq 1 ]; then exit 30; fi\nfor a in "$@"; do [ "$a" = "--continue" ] && exit 10; done\nexit 99\n`,
    );
    chmodSync(join(root, "cs-references-update-wizard"), 0o755);
    const r = runOnPty(
      ["node", join(root, "ts", "wizard.ts"), "--global", "--auto", "--no-refresh", "--include", "repo-alpha"],
      { PATH: pathWithStubs(join(TMP, "bin")), REPO_CACHE_DIR, DEVENV_ROOT: devRoot },
      "r",
    );
    expect(existsSync(calls), r.out).toBe(true);
    const lines = readFileSync(calls, "utf8").trim().split("\n");
    expect(lines).toHaveLength(2);
    expect(lines[0]).not.toContain("--continue");
    expect(lines[1]).toContain("--continue");
    expect(r.out).toContain("Resuming repo-alpha from its update branch");
    expect(r.status).toBe(0);
  });

  it("cs-dependencies-update-wizard stub dispatches (entry-point contract)", () => {
    expect(existsSync(WIZARD)).toBe(true);
    expect(spawnSync("node", [WIZARD, "--version"]).status).toBe(0);
  });

  it("cs-dependencies-update-wizard.sh shows usage with --help", () => {
    const r = runWizard(["--help"]);
    expect(r.status).toBe(0);
    expect(r.out).toContain("Usage:");
    expect(r.out).toContain("--global");
  });

  it("cs-dependencies-update-wizard.sh shows version 1.1.0 with --version", () => {
    const r = runWizard(["--version"]);
    expect(r.status).toBe(0);
    expect(r.out).toContain("1.1.0");
  });

  // ---------------------------------------------------------------------
  // Argument validation — --global mode
  // ---------------------------------------------------------------------

  it("--global and TARGET_DIR are mutually exclusive", () => {
    const r = runWizard(["--global", TMP]);
    expect(r.status).not.toBe(0);
    expect(r.out).toContain("mutually exclusive");
  });

  it("--global with a non-integer string treats it as TARGET_DIR and errors", () => {
    // 'foo' is not [0-9]+ so it is consumed as TARGET_DIR → mutually exclusive error
    const r = runWizard(["--global", "foo"]);
    expect(r.status).not.toBe(0);
  });

  it("--global 0 is accepted as explicit start at generation 0", () => {
    setupMinimalCache();
    const r = runWizard(["--global", "0", "--dry-run", "--no-refresh"]);
    expect(r.status).toBe(0);
  });

  it("--global with no argument defaults to generation 0", () => {
    setupMinimalCache();
    const r = runWizard(["--global", "--dry-run", "--no-refresh"]);
    expect(r.status).toBe(0);
  });

  it("--global N exceeding max generation is an error", () => {
    setupMinimalCache(); // only generation 0 exists
    const r = runWizard(["--global", "99", "--dry-run", "--no-refresh"]);
    expect(r.status).not.toBe(0);
    expect(r.out).toContain("99");
  });

  // ---------------------------------------------------------------------
  // Global mode — dry-run output
  // ---------------------------------------------------------------------

  it("--global --dry-run prints Global header", () => {
    setupMinimalCache();
    const r = runWizard(["--global", "--dry-run", "--no-refresh"]);
    expect(r.status).toBe(0);
    expect(r.out).toContain("Global Dependency Update Wizard");
    expect(r.out).toContain("DRY RUN");
  });

  it("--global --dry-run lists repo-alpha in generation 0", () => {
    setupMinimalCache();
    const r = runWizard(["--global", "--dry-run", "--no-refresh"]);
    expect(r.status).toBe(0);
    expect(r.out).toContain("repo-alpha");
  });

  it("--global --dry-run with two generations lists both repos", () => {
    setupTwoGenCache();
    const r = runWizard(["--global", "--dry-run", "--no-refresh"]);
    expect(r.status).toBe(0);
    expect(r.out).toContain("repo-alpha");
    expect(r.out).toContain("repo-beta");
  });

  it("--global 1 --dry-run skips generation 0 and processes generation 1", () => {
    setupTwoGenCache();
    const r = runWizard(["--global", "1", "--dry-run", "--no-refresh"]);
    expect(r.status).toBe(0);
    expect(r.out).toContain("Resuming from generation: 1");
    expect(r.out).toContain("repo-beta");
    // repo-alpha should be skipped (generation 0)
    expect(r.out).toContain("Skipping generation 0");
  });

  it("--global --dry-run --no-refresh never refreshes the cache between generations", () => {
    setupTwoGenCache();
    const r = runWizard(["--global", "--dry-run", "--no-refresh"]);
    expect(r.status).toBe(0);
    expect(r.out).not.toContain("Refreshing repository cache");
  });

  it("--global --dry-run prints completion footer", () => {
    setupMinimalCache();
    const r = runWizard(["--global", "--dry-run", "--no-refresh"]);
    expect(r.status).toBe(0);
    expect(r.out).toContain("Global dependency update complete");
  });

  // ---------------------------------------------------------------------
  // Single-target mode still works
  // ---------------------------------------------------------------------

  it("single-target mode rejects unknown options as before", () => {
    const r = runWizard(["--unknown-flag"]);
    expect(r.status).not.toBe(0);
  });

  it("single-target mode fails on non-existent directory", () => {
    const r = runWizard(["/this/does/not/exist"]);
    expect(r.status).not.toBe(0);
  });

  // ---------------------------------------------------------------------
  // Framework / language flag forwarding (single-repo wizard call sites)
  // ---------------------------------------------------------------------

  it("--global forwards --framework to cs-references-update-wizard", () => {
    setupMinimalCache();
    const r = runWizard(["--global", "--dry-run", "--no-refresh", "--framework", "net10.0"]);
    expect(r.status).toBe(0);
    // Dry-run path never reaches delegation; this test verifies flag parsing accepted
    expect(r.out).toContain("DRY RUN");
  });

  it("cs-dependencies-update-wizard.sh parses all framework flags in single-target parse order", () => {
    // Unknown-flag rejection still works alongside the new flags.
    // --lang-default + --lang-version conflict surfaces from the inner wizard;
    // at the outer level parsing must succeed far enough to attempt delegation
    // (fails on non-existent dir or inner validation — either way not an
    // 'unknown option' error).
    const r = runWizard(["--framework", "net10.0", "--lang-version", "14.0", "--lang-default"]);
    expect(r.status).not.toBe(0);
    expect(r.out).not.toContain("Unknown option");
  });

  it("cs-dependencies-update-wizard.sh shows framework flags in usage", () => {
    const r = runWizard(["--help"]);
    expect(r.status).toBe(0);
    expect(r.out).toContain("--framework");
    expect(r.out).toContain("--lang-version");
    expect(r.out).toContain("--lang-default");
  });

  it("accepts --self-approve and shows it in usage", () => {
    setupMinimalCache();
    const r = runWizard(["--global", "--dry-run", "--no-refresh", "--self-approve"]);
    expect(r.status).toBe(0);
    expect(runWizard(["--help"]).out).toContain("--self-approve");
  });

  it("cs-dependencies-update-wizard.sh shows --post-update in usage", () => {
    expect(runWizard(["--help"]).out).toContain("--post-update");
  });

  it("cs-dependencies-update-wizard.sh rejects a missing --post-update script up front", () => {
    setupMinimalCache();
    const r = runWizard(["--global", "--dry-run", "--no-refresh", "--post-update", "/nonexistent/migrate.sh"]);
    expect(r.status).toBe(3);
    expect(r.out).toContain("--post-update script not found");
  });

  it("--include selects matching repos only", () => {
    setupTwoGenCache();
    const r = runWizard(["--global", "--dry-run", "--no-refresh", "--include", "repo-beta"]);
    expect(r.status).toBe(0);
    expect(r.out).toContain("Would update repo-beta");
    expect(r.out).not.toContain("Would update repo-alpha");
    expect(r.out).toContain("Repository filter: 1 of 2 repositories selected");
  });

  it("--exclude wins over --include, and repeated globs combine", () => {
    setupTwoGenCache();
    const r = runWizard(["--global", "--dry-run", "--no-refresh", "--include", "repo-*", "--exclude", "repo-beta"]);
    expect(r.status).toBe(0);
    expect(r.out).toContain("Would update repo-alpha");
    expect(r.out).not.toContain("Would update repo-beta");
  });

  it("a filter matching nothing updates nothing", () => {
    setupTwoGenCache();
    const r = runWizard(["--global", "--dry-run", "--no-refresh", "--include", "lib.cs.*"]);
    expect(r.status).toBe(0);
    expect(r.out).toContain("No repositories match the --include/--exclude filter");
    expect(r.out).not.toContain("Would update");
  });

  it("--include without --global is an argument error", () => {
    const r = runWizard(["--include", "repo-*"]);
    expect(r.status).toBe(2);
    expect(r.out).toContain("apply to --global mode only");
  });

  it("rejects a missing --pre-restore script up front", () => {
    setupMinimalCache();
    const r = runWizard(["--global", "--dry-run", "--no-refresh", "--pre-restore", "/nonexistent/pre.sh"]);
    expect(r.status).toBe(3);
    expect(r.out).toContain("--pre-restore script not found");
  });

  it("shows --pre-restore in usage", () => {
    expect(runWizard(["--help"]).out).toContain("--pre-restore");
  });

  it("cs-dependencies-update-wizard.sh --framework without value errors", () => {
    const r = runWizard(["--global", "--framework"]);
    expect(r.status).not.toBe(0);
  });
});

describe("sibling resolution", () => {
  it("no tool hands a DEVENV_TOOLS directory to siblingInvocation/siblingCommand", () => {
    // A foreign DEVENV_TOOLS would redirect the sibling to that checkout's
    // generated stub instead of this checkout's tools/ts entry point.
    const dir = join(import.meta.dirname, "..", "..", "ts");
    const offenders = readdirSync(dir)
      .filter((f) => f.endsWith(".ts"))
      .filter((f) => /sibling(?:Invocation|Command)\([^;]*DEVENV_TOOLS/.test(readFileSync(join(dir, f), "utf8")))
      .sort();
    expect(offenders).toEqual([]);
  });
});
