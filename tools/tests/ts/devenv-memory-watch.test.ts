// Port of tools/tests/scripts/test_devenv_memory_watch.bats (7 tests).
// devenv-memory-watch: entry-point contract, options surface, sample
// persistence across runs, culprit summary format, reset.
import { toolScript } from "./harness/index.ts";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

vi.setConfig({ testTimeout: 120_000, hookTimeout: 60_000 });

const SCRIPT_PATH = toolScript("devenv-memory-watch");

let TMP = "";

beforeEach(() => {
  TMP = mkdtempSync(join(tmpdir(), `memwatch-${Date.now()}-${Math.random().toString(36).slice(2)}`));
});

afterEach(() => {
  rmSync(TMP, { recursive: true, force: true });
});

function watch(args: string[]): { status: number; out: string } {
  const r = spawnSync("node", [SCRIPT_PATH, ...args], { encoding: "utf8" });
  return { status: r.status ?? 1, out: (r.stdout ?? "") + (r.stderr ?? "") };
}

const ARGS = ["--once", "--max-processes", "5", "--top", "3", "--interval-minutes", "1"];

describe("scripts/devenv-memory-watch", () => {
  it("devenv-memory-watch.sh exists", () => {
    expect(existsSync(SCRIPT_PATH)).toBe(true);
  });

  it("devenv-memory-watch.sh is executable", () => {
    // Run via `node <script>.ts`, so the contract is "readable", not an exec bit.
    expect(spawnSync("test", ["-r", SCRIPT_PATH]).status).toBe(0);
  });

  it("devenv-memory-watch.sh has valid bash syntax", () => {
    expect(spawnSync("node", ["--check", SCRIPT_PATH]).status).toBe(0);
  });

  it("devenv-memory-watch.sh exposes useful options", () => {
    const r = watch(["--help"]);
    expect(r.status).toBe(0);
    expect(r.out).toContain("--interval-minutes");
    expect(r.out).toContain("--state-dir");
    expect(r.out).toContain("--once");
  });

  it("devenv-memory-watch.sh persists samples across runs", () => {
    const stateDir = join(TMP, "memory-watch-state");
    let r = watch([...ARGS, "--state-dir", stateDir]);
    expect(r.status).toBe(0);
    expect(r.out).toContain("Captured sample #1");
    expect(existsSync(join(stateDir, "samples.tsv"))).toBe(true);
    expect(existsSync(join(stateDir, "processes.tsv"))).toBe(true);
    expect(existsSync(join(stateDir, "current-culprits.tsv"))).toBe(true);
    r = watch([...ARGS, "--state-dir", stateDir]);
    expect(r.status).toBe(0);
    expect(r.out).toContain("Captured sample #2");
    expect(r.out).toContain("Current culprit summary:");
  });

  it("devenv-memory-watch.sh writes a current culprit summary", () => {
    const stateDir = join(TMP, "memory-watch-compact-state");
    const r = watch([...ARGS, "--state-dir", stateDir]);
    expect(r.status).toBe(0);
    expect(r.out).toContain("Current culprit summary:");
    expect(r.out).toContain("Top current culprit:");
    expect(r.out).not.toContain("Likely culprits by RSS growth:");
    expect(r.out).not.toContain("Largest current RSS consumers:");
    const head = spawnSync("head", ["-n", "2", join(stateDir, "current-culprits.tsv")], { encoding: "utf8" });
    expect(head.status).toBe(0);
    const out = head.stdout ?? "";
    expect(out).toContain("rank\tlabel\tcurrent\tdelta\tpeak\tsamples\tfirst_sample\tlast_sample\tfirst_seen\tlast_seen\tsignature");
    expect(out).toContain("\n1\t");
  });

  it("devenv-memory-watch.sh reset clears persisted history", () => {
    const stateDir = join(TMP, "memory-watch-reset-state");
    const first = watch([...ARGS, "--state-dir", stateDir]);
    expect(first.status).toBe(0);
    expect(first.out).toContain("Captured sample #1");
    const r = watch([...ARGS, "--state-dir", stateDir, "--reset"]);
    expect(r.status).toBe(0);
    expect(r.out).toContain("Captured sample #1");
    const awk = spawnSync("awk", ["-F", "\t", '$1 == "S" { count++ } END { print count + 0 }', join(stateDir, "samples.tsv")], { encoding: "utf8" });
    expect(awk.status).toBe(0);
    expect(Number.parseInt((awk.stdout ?? "0").trim(), 10)).toBe(1);
  });

  it("picks the latest sample numerically (sample 10 is later than sample 9)", () => {
    const state = join(TMP, "state");
    mkdirSync(state, { recursive: true });
    const sig = "zz-fixture-proc | zz-fixture-proc";
    writeFileSync(join(state, "samples.tsv"), "S\t9\t1000\t1\tmax\nS\t10\t1060\t1\tmax\n");
    writeFileSync(join(state, "processes.tsv"), `P\t9\t100\t${sig}\nP\t10\t500\t${sig}\n`);
    const r = watch(["--once", "--state-dir", state, "--max-processes", "1", "--top", "100000", "--interval-minutes", "1"]);
    expect(r.status, r.out).toBe(0);
    const row = readFileSync(join(state, "current-culprits.tsv"), "utf8")
      .split("\n")
      .find((l) => l.endsWith(`\t${sig}`));
    expect(row).toBeDefined();
    const cols = (row as string).split("\t");
    // columns: rank label current delta peak samples first_sample last_sample ...
    expect(cols[2]).toBe("500 KB");
    expect(cols[7]).toBe("10");
  });
});

// readFileSync referenced to keep the import honest if assertions change
void readFileSync;
