// Spawn contract: large output is captured whole (never truncated into an
// empty/failed result), timeouts report as timeouts, and multibyte characters
// split across chunks decode intact.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { changedFiles } from "../../lib/core/git.ts";
import { patchId, patchesIdentical } from "../../lib/domain/fork/twin.ts";
import { spawnKubectl } from "../../lib/domain/kube/kube.ts";
import { assertSpawnCompleted, mustRun, run, SpawnError, SPAWN_MAX_BUFFER } from "../../lib/core/spawn.ts";
import { pathWithStubs, rmrf, stubCli, tmpDir, tmpStubBin } from "./harness/index.ts";

function git(repo: string, ...args: string[]): string {
  const r = spawnSync("git", ["-C", repo, ...args], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
  return r.stdout;
}

function initRepo(prefix: string): string {
  const repo = tmpDir(prefix);
  git(repo, "init", "-q", "-b", "master");
  git(repo, "config", "user.email", "t@example.com");
  git(repo, "config", "user.name", "T");
  writeFileSync(join(repo, "seed.txt"), "seed\n");
  git(repo, "add", ".");
  git(repo, "commit", "-q", "--no-verify", "-m", "seed");
  return repo;
}

const cleanups: string[] = [];
afterAll(() => cleanups.forEach(rmrf));

describe("changedFiles with a huge status", () => {
  let repo: string;
  beforeAll(() => {
    repo = initRepo("spawn-limits-status-");
    cleanups.push(repo);
    const dir = join(repo, "bulk");
    mkdirSync(dir);
    for (let i = 0; i < 20000; i++) writeFileSync(join(dir, `untracked-file-with-a-deliberately-long-name-to-inflate-the-status-output-${i}.txt`), "");
  });

  it("returns every untracked file", () => {
    expect(changedFiles(repo)).toHaveLength(20000);
  });
});

describe("patchId with a large patch", () => {
  it("computes an id for a >1 MiB commit and equal patches compare equal", () => {
    const blob = `${"x".repeat(99)}\n`.repeat(40000); // ~4 MB
    const a = initRepo("spawn-limits-patch-a-");
    const b = initRepo("spawn-limits-patch-b-");
    cleanups.push(a, b);
    for (const r of [a, b]) {
      writeFileSync(join(r, "big.txt"), blob);
      git(r, "add", ".");
      git(r, "commit", "-q", "--no-verify", "-m", "big");
    }
    const id = patchId(a, "HEAD");
    expect(id).not.toBe("");
    expect(patchId(b, "HEAD")).toBe(id);
    expect(patchesIdentical(a, b, git(a, "rev-parse", "HEAD").trim(), git(b, "rev-parse", "HEAD").trim())).toBe(true);
  });
});

describe("spawnKubectl with large output", () => {
  it("returns the full output and status 0", () => {
    const bin = tmpStubBin("spawn-limits-kubectl-");
    cleanups.push(bin);
    stubCli(bin, "kubectl", `#!/bin/sh\nhead -c 2097152 /dev/zero | tr '\\0' 'k'\nexit 0`);
    const saved = process.env.PATH;
    process.env.PATH = pathWithStubs(bin);
    try {
      const r = spawnKubectl(["get", "pods"]);
      expect(r.status).toBe(0);
      expect(r.stdout.length).toBe(2097152);
    } finally {
      process.env.PATH = saved;
    }
  });
});

describe("run/mustRun", () => {
  it("reports a timeout as timedOut and mustRun throws a timeout SpawnError", async () => {
    const argv = [process.execPath, "-e", "setTimeout(()=>{}, 30000)"];
    const r = await run(argv, { timeoutMs: 200 });
    expect(r.status).toBeNull();
    expect(r.timedOut).toBe(true);
    const err = await mustRun(argv, { timeoutMs: 200 }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SpawnError);
    expect((err as SpawnError).timedOut).toBe(true);
    expect((err as SpawnError).message).toContain("timeout");
  });

  it("does not flag a normal run as timed out", async () => {
    const r = await run([process.execPath, "-e", "0"], { timeoutMs: 10000 });
    expect(r.status).toBe(0);
    expect(r.timedOut).toBe(false);
  });

  it("decodes a multibyte character split across chunks", async () => {
    const script = `
      const b = Buffer.from("€"); // 3 bytes
      process.stdout.write(b.subarray(0, 1));
      process.stderr.write(b.subarray(0, 2));
      setTimeout(() => { process.stdout.write(b.subarray(1)); process.stderr.write(b.subarray(2)); }, 150);
    `;
    const r = await run([process.execPath, "-e", script]);
    expect(r.stdout).toBe("€");
    expect(r.stderr).toBe("€");
  });
});

describe("assertSpawnCompleted", () => {
  const result = (over: Partial<SpawnSyncReturns<string>>): SpawnSyncReturns<string> => ({
    pid: 1,
    output: ["", "", ""],
    stdout: "",
    stderr: "",
    status: 0,
    signal: null,
    ...over,
  });

  it("throws when the output overflowed maxBuffer (ENOBUFS)", () => {
    const error = Object.assign(new Error("spawnSync git ENOBUFS"), { code: "ENOBUFS" });
    expect(() => assertSpawnCompleted(result({ error, status: null, signal: "SIGTERM" }), ["git", "log"])).toThrow(
      new RegExp(`exceeded ${SPAWN_MAX_BUFFER} bytes: git log`),
    );
  });

  it("throws when the child was killed by a signal (null status)", () => {
    expect(() => assertSpawnCompleted(result({ status: null, signal: "SIGKILL" }), ["git", "gc"])).toThrow(
      /killed by SIGKILL: git gc/,
    );
  });

  it("accepts an ordinary non-zero exit (that is the caller's to interpret)", () => {
    expect(() => assertSpawnCompleted(result({ status: 128 }), ["git", "status"])).not.toThrow();
  });

  it("accepts a null status with no signal and no overflow (e.g. spawn failure ENOENT)", () => {
    const error = Object.assign(new Error("spawnSync nope ENOENT"), { code: "ENOENT" });
    expect(() => assertSpawnCompleted(result({ error, status: null }), ["nope"])).not.toThrow();
  });
});
