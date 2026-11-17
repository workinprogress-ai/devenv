// ci-build-local tests — argv construction, token resolution order, version
// fallback, and the Dockerfile-absent error. docker and gh are stubbed on
// PATH (fixture binaries that record their argv); no real docker daemon is
// touched. Fixture hygiene per tools/tests/README.md: scratch dirs live
// under tmpPath().
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))));
const TOOL = join(ROOT, "tools", "ts", "ci-build-local.ts");

let TMP = "";

function ensureTmp(): void {
  if (!TMP) {
    TMP = mkdtempSync(join(tmpdir(), `cibuild-${Date.now()}-${Math.random().toString(36).slice(2)}`));
  }
}

function tmpPath(...parts: string[]): string {
  ensureTmp();
  const base = tmpdir();
  if (!isAbsolute(TMP) || !TMP.startsWith(base)) {
    throw new Error(`scratch-dir guard: TMP=${JSON.stringify(TMP)} is not under ${base}`);
  }
  return join(TMP, ...parts);
}

afterAll(() => {
  if (TMP) rmSync(TMP, { recursive: true, force: true });
});

// Stub binaries record their invocation to $RECORD; gh additionally prints a
// fake token to stdout (the tool consumes stdout as the credential). docker
// succeeds by default so the tool's happy path runs to completion.
function makeStubBin(name: string, exitCode = 0): string {
  const dir = tmpPath("bin");
  mkdirSync(dir, { recursive: true });
  const script = join(dir, name);
  const extra = name === "gh" ? 'echo stub-gh-token' : "";
  writeFileSync(
    script,
    [
      "#!/bin/bash",
      'echo "$0 $*" >> "$RECORD"',
      extra,
      `exit ${exitCode}`,
      "",
    ].join("\n")
  );
  chmodSync(script, 0o755);
  return dir;
}

function makeTargetRepo(name: string, withDockerfile: boolean): string {
  const dir = tmpPath(name);
  mkdirSync(dir, { recursive: true });
  if (withDockerfile) writeFileSync(join(dir, "Dockerfile"), "FROM scratch\n");
  // git repo so version resolution has a deterministic tag surface: none.
  spawnSync("git", ["init", "-q", dir]);
  spawnSync("git", ["-C", dir, "commit", "-q", "--allow-empty", "-m", "init", "--no-gpg-sign"]);
  return dir;
}

function runTool(args: string[], env: Record<string, string>) {
  return spawnSync("node", [TOOL, ...args], {
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
}

beforeEach(() => {
  ensureTmp();
});

describe("ci-build-local", () => {
  it("fails with exit 1 when no Dockerfile exists", () => {
    const bin = makeStubBin("docker");
    const repo = makeTargetRepo("no-dockerfile", false);
    const record = tmpPath("no-dockerfile.record");
    const r = runTool([repo], { PATH: `${bin}:${process.env.PATH}`, RECORD: record, NUGET_TOKEN: "t" });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("No Dockerfile found");
  });

  it("builds with the secret, both tags, and a version resolved from the target repo", () => {
    const bin = makeStubBin("docker");
    const repo = makeTargetRepo("happy", true);
    const record = tmpPath("happy.record");
    const r = runTool([repo], { PATH: `${bin}:${process.env.PATH}`, RECORD: record, NUGET_TOKEN: "tok" });
    expect(r.status).toBe(0);
    const invoked = readFileSync(record, "utf8");
    expect(invoked).toContain("--secret id=nuget_token,env=CI_BUILD_LOCAL_NUGET_TOKEN");
    expect(invoked).toContain("-t happy:local");
    // The fixture repo is pristine (no tags, single commit) → 0.0.0-dev,
    // regardless of any tags in the invoking cwd's repo.
    expect(invoked).toContain("-t happy:0.0.0-dev");
  });

  it("falls back to gh auth token when NUGET_TOKEN is unset", () => {
    const bin = makeStubBin("docker");
    const ghBin = makeStubBin("gh");
    const repo = makeTargetRepo("gh-fallback", true);
    const record = tmpPath("gh-fallback.record");
    const r = runTool([repo], {
      PATH: `${ghBin}:${bin}:${process.env.PATH}`,
      RECORD: record,
      NUGET_TOKEN: "",
    });
    expect(r.status).toBe(0);
    const invoked = readFileSync(record, "utf8");
    expect(invoked).toContain("gh auth token");
    expect(invoked).toContain("--secret");
  });

  it("resolves the next version from the target repo's tag, not the cwd", () => {
    const bin = makeStubBin("docker");
    const repo = makeTargetRepo("tagged", true);
    spawnSync("git", ["-C", repo, "tag", "v1.2.3"]);
    const record = tmpPath("tagged.record");
    // Run from the devenv repo (which carries its own unrelated tags) — the
    // version must come from the target repo, not the invoking cwd.
    const r = spawnSync("node", [TOOL, repo], {
      encoding: "utf8",
      cwd: ROOT,
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, RECORD: record, NUGET_TOKEN: "t" },
    });
    expect(r.status).toBe(0);
    const invoked = readFileSync(record, "utf8");
    expect(invoked).toContain("-t tagged:1.2.3");
  });

  it("fails with exit 3 when no token is available", () => {
    const bin = makeStubBin("docker");
    const ghBin = makeStubBin("gh", 1);
    const repo = makeTargetRepo("no-token", true);
    const record = tmpPath("no-token.record");
    const r = runTool([repo], {
      PATH: `${ghBin}:${bin}:${process.env.PATH}`,
      RECORD: record,
      NUGET_TOKEN: "",
    });
    expect(r.status).toBe(3);
    expect(r.stderr).toContain("No GitHub Packages token");
  });

  it("propagates docker build failure as exit 1", () => {
    const bin = makeStubBin("docker", 1);
    const repo = makeTargetRepo("build-fails", true);
    const record = tmpPath("build-fails.record");
    const r = runTool([repo], { PATH: `${bin}:${process.env.PATH}`, RECORD: record, NUGET_TOKEN: "t" });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("docker build failed");
  });
});
