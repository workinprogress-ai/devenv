// fork-export PTY tests (port of the clack-driven tests from
// test_fork_export.bats) — PROOF OF THE PTY HELPER. One representative test
// first: interactive picker cancellation leaves the target untouched. The
// remaining fork-export clack tests port onto this pattern once timing is
// calibrated under vitest's parallel workers.
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { drivePty } from "./harness/pty.ts";

const ROOT = join(__dirname, "../../.."); // tools/tests/ts → devenv root
const TOOLS = join(ROOT, "tools");
const SCRIPT = join(TOOLS, "ts/fork-export.ts");

let root: string;
let upstream: string;
let workingClone: string;
let ghClone: string;

function git(target: string, ...args: string[]): string {
  const r = spawnSync("git", ["-C", target, ...args], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
  return r.stdout;
}

/** The fork fixture trio (port of test_helper's create_fork_fixture_trio):
 * upstream bare, a working clone of an ado-origin bare, and a gh clone of
 * upstream — the fork-export shape. */
function makeForkTrio(): void {
  upstream = join(root, "upstream.git");
  const adoOrigin = join(root, "ado-origin.git");
  workingClone = join(root, "working-clone");
  ghClone = join(root, "gh-clone");

  spawnSync("git", ["init", "-q", "--bare", "-b", "master", upstream], { encoding: "utf8" });
  const seed = join(root, "_seed");
  spawnSync("git", ["clone", "-q", upstream, seed], { encoding: "utf8" });
  git(seed, "config", "user.email", "test@example.com");
  git(seed, "config", "user.name", "Test User");
  writeFileSync(join(seed, "README.md"), "");
  spawnSync("git", ["-C", seed, "add", "README.md"], { encoding: "utf8" });
  spawnSync("git", ["-C", seed, "commit", "-q", "-m", "Initial commit"], { encoding: "utf8" });
  spawnSync("git", ["-C", seed, "push", "-q", "origin", "HEAD:master"], { encoding: "utf8" });
  rmSync(seed, { recursive: true, force: true });

  spawnSync("git", ["clone", "-q", "--bare", upstream, adoOrigin], { encoding: "utf8" });
  spawnSync("git", ["clone", "-q", adoOrigin, workingClone], { encoding: "utf8" });
  git(workingClone, "config", "user.email", "test@example.com");
  git(workingClone, "config", "user.name", "Test User");
  spawnSync("git", ["clone", "-q", upstream, ghClone], { encoding: "utf8" });
  git(ghClone, "config", "user.email", "test@example.com");
  git(ghClone, "config", "user.name", "Test User");
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "fork-export-pty-"));
  makeForkTrio();
  const devenvRoot = join(root, "config-root");
  mkdirSync(devenvRoot, { recursive: true });
  writeFileSync(join(devenvRoot, "devenv.config"), `[fork]\nupstream_repo=${upstream}\nupstream_branch=master\n`);
  git(workingClone, "remote", "add", "upstream", upstream);
  git(workingClone, "fetch", "-q", "upstream");
  // Source commits get a Change-Id the way real ones do: through the hook.
  const hooks = join(workingClone, ".git", "hooks");
  mkdirSync(hooks, { recursive: true });
  const hook = join(hooks, "prepare-commit-msg");
  writeFileSync(hook, `#!/bin/sh\nexec "${TOOLS}/internal/prepare-commit-msg" "$@"\n`);
  chmodSync(hook, 0o755);
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

function addExportCommit(subject: string): void {
  appendFileSync(join(workingClone, "changes.txt"), `${subject}\n`);
  git(workingClone, "add", "changes.txt");
  git(workingClone, "commit", "-q", "-m", subject);
}

describe("fork-export PTY (interactive picker)", () => {
  it("interactive picker cancellation leaves target untouched", async () => {
    addExportCommit("Local one");
    const r = await drivePty("node", [SCRIPT, "--apply-to", ghClone], {
      keys: ["e"],
      env: { DEVENV_ROOT: join(root, "config-root"), DEVENV_ROOT_SET: "1" },
      cwd: workingClone,
    });
    expect(r.status).not.toBe(0);
    expect(r.out).toContain("commit selection cancelled");
    expect(git(ghClone, "status", "--porcelain")).toBe("");
    expect(git(ghClone, "rev-parse", "HEAD")).toBe(git(ghClone, "rev-parse", "origin/master"));
  }, 180_000);
});
