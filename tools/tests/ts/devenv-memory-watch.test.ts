// devenv-memory-watch: entry-point contract, options surface, sample
// persistence across runs, culprit summary format, reset.
import { toolScript } from "./harness/index.ts";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

vi.setConfig({ testTimeout: 120_000, hookTimeout: 60_000 });

const SCRIPT_PATH = toolScript("devenv-memory-watch");

let TMP = "";

beforeEach(() => {
  TMP = mkdtempSync(join(tmpdir(), `memwatch-${Date.now()}-${Math.random().toString(36).slice(2)}`));
});

const background: ChildProcess[] = [];

afterEach(() => {
  // Kill every background instance with its whole process group.
  for (const child of background.splice(0)) {
    try { if (child.pid !== undefined) process.kill(-child.pid, "SIGKILL"); } catch { /* already gone */ }
  }
  rmSync(TMP, { recursive: true, force: true });
});

const sleepMs = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function waitFor(cond: () => boolean, what: string, timeoutMs = 20_000): Promise<void> {
  const end = Date.now() + timeoutMs;
  while (!cond()) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await sleepMs(50);
  }
}

/** Starts a long-interval instance in its own process group and waits for its first sample. */
async function startBackground(stateDir: string, extra: string[] = []): Promise<ChildProcess> {
  const child = spawn("node", [SCRIPT_PATH, "--state-dir", stateDir, "--max-processes", "5", "--interval-minutes", "60", ...extra], {
    detached: true,
    stdio: "ignore",
  });
  background.push(child);
  // The culprit summary is written after the process snapshot, so the loop is then idle in its timer.
  await waitFor(() => existsSync(join(stateDir, "current-culprits.tsv")), "first report");
  return child;
}

const exited = (child: ChildProcess): Promise<void> =>
  new Promise((resolve) => (child.exitCode !== null || child.signalCode !== null ? resolve() : child.once("exit", () => resolve())));

const aged = (file: string): void => {
  const old = new Date(Date.now() - 120_000);
  utimesSync(file, old, old);
};

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
    // Recent timestamps keep both samples inside the retention window.
    const t = Math.floor(Date.now() / 1000);
    writeFileSync(join(state, "samples.tsv"), `S\t9\t${t - 120}\t1\tmax\nS\t10\t${t - 60}\t1\tmax\n`);
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

describe("single-instance lock", () => {
  const lockOf = (dir: string): string => join(dir, ".lock");

  it("refuses a second instance while the first lives, even after the lock ages past 30 s", async () => {
    const dir = join(TMP, "lock-live");
    await startBackground(dir);
    aged(lockOf(dir));
    const r = watch([...ARGS, "--state-dir", dir]);
    expect(r.status, r.out).toBe(2);
    expect(r.out).toContain("Another memory watch is already running");
    expect(existsSync(lockOf(dir))).toBe(true);
  });

  it("reclaims a lock naming a dead pid and removes it on exit", () => {
    const dir = join(TMP, "lock-dead");
    mkdirSync(dir, { recursive: true });
    const dead = spawnSync("true");
    // A reaped short-lived process: its pid is certainly not running now.
    const pid = dead.pid;
    expect(() => process.kill(pid, 0)).toThrow();
    writeFileSync(lockOf(dir), String(pid));
    const r = watch([...ARGS, "--state-dir", dir]);
    expect(r.status, r.out).toBe(0);
    expect(r.out).toContain("Captured sample #1");
    expect(existsSync(lockOf(dir))).toBe(false);
  });

  it("reclaims a lock with garbage content", () => {
    const dir = join(TMP, "lock-garbage");
    mkdirSync(dir, { recursive: true });
    writeFileSync(lockOf(dir), "not-a-pid\n");
    const r = watch([...ARGS, "--state-dir", dir]);
    expect(r.status, r.out).toBe(0);
    expect(existsSync(lockOf(dir))).toBe(false);
  });

  it("a refused instance started with --reset leaves the owner's lock and history intact", async () => {
    const dir = join(TMP, "lock-reset");
    await startBackground(dir);
    const files = ["samples.tsv", "processes.tsv", ".lock"];
    const before = files.map((f) => readFileSync(join(dir, f), "utf8"));
    const r = watch([...ARGS, "--state-dir", dir, "--reset"]);
    expect(r.status, r.out).toBe(2);
    expect(files.map((f) => readFileSync(join(dir, f), "utf8"))).toEqual(before);
  });

  it("has no child process to orphan, and SIGTERM releases the lock and exits promptly", async () => {
    const dir = join(TMP, "lock-sigterm");
    const child = await startBackground(dir);
    const kids = spawnSync("pgrep", ["-P", String(child.pid)], { encoding: "utf8" }).stdout.trim();
    expect(kids).toBe("");
    process.kill(child.pid as number, "SIGTERM");
    await exited(child);
    expect(child.exitCode).toBe(143);
    expect(existsSync(lockOf(dir))).toBe(false);
  });

  it.skipIf(process.getuid?.() === 0)("an unwritable state directory exits 2 with a clear message", () => {
    const dir = join(TMP, "lock-unwritable");
    mkdirSync(dir, { recursive: true });
    chmodSync(dir, 0o500);
    try {
      const r = watch([...ARGS, "--state-dir", dir]);
      expect(r.status, r.out).toBe(2);
      expect(r.out).toContain(`cannot create the lock file in ${dir}:`);
      expect(readdirSync(dir)).toEqual([]);
    } finally {
      chmodSync(dir, 0o700);
    }
  });

  it("an instance never removes a lock that names another live process", async () => {
    const dir = join(TMP, "lock-foreign");
    const child = await startBackground(dir);
    writeFileSync(lockOf(dir), String(process.pid));
    process.kill(child.pid as number, "SIGTERM");
    await exited(child);
    expect(readFileSync(lockOf(dir), "utf8")).toBe(String(process.pid));
  });
});

describe("interval cap", () => {
  const MAX = 35791;

  it("accepts the largest interval whose delay fits the timer limit", () => {
    const dir = join(TMP, "iv-max");
    const r = watch(["--once", "--state-dir", dir, "--max-processes", "1", "--interval-minutes", String(MAX)]);
    expect(r.status, r.out).toBe(0);
    expect(r.out).toContain("Captured sample #1");
  });

  it("states the maximum in the usage text", () => {
    expect(watch(["--help"]).out).toContain(`maximum: ${MAX}`);
  });

  it.each([String(MAX + 1), "99999999999999999999"])("rejects --interval-minutes %s before touching the state directory", (bad) => {
    const dir = join(TMP, "iv-bad");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "samples.tsv"), "S\t1\t1\t1\tmax\n");
    const before = [readdirSync(dir).sort(), readFileSync(join(dir, "samples.tsv"), "utf8")];
    const r = watch(["--once", "--state-dir", dir, "--interval-minutes", bad]);
    expect(r.status, r.out).toBe(2);
    expect(r.out).toContain(`at most ${MAX}`);
    expect([readdirSync(dir).sort(), readFileSync(join(dir, "samples.tsv"), "utf8")]).toEqual(before);
  });
});

describe("interval cap with reset", () => {
  it("rejects an over-cap interval combined with --reset and deletes nothing", () => {
    const dir = join(TMP, "iv-reset");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "samples.tsv"), "S\t1\t1\t1\tmax\n");
    writeFileSync(join(dir, "processes.tsv"), "P\t1\t100\tzz | zz\n");
    const snapshot = (): Array<[string, string]> => readdirSync(dir).sort().map((n) => [n, readFileSync(join(dir, n), "utf8")]);
    const before = snapshot();
    const r = watch(["--once", "--reset", "--state-dir", dir, "--interval-minutes", "35792"]);
    expect(r.status, r.out).toBe(2);
    expect(r.out).toContain("at most 35791");
    expect(snapshot()).toEqual(before);
    expect(before.map(([n]) => n)).toEqual(["processes.tsv", "samples.tsv"]);
  });
});

describe("retention", () => {
  const DAY = 86400;
  const nowS = (): number => Math.floor(Date.now() / 1000);
  const sigOf = (n: number): string => `zz-ret-${n} | zz-ret-${n}`;

  /** Seeds samples (id, age in days) each with one process row; returns the state dir. */
  function seed(name: string, ages: Array<[string, number | string]>): string {
    const dir = join(TMP, name);
    mkdirSync(dir, { recursive: true });
    const s = ages.map(([id, age]) => `S\t${id}\t${typeof age === "number" ? nowS() - age * DAY : age}\t1\tmax`);
    const p = ages.map(([id]) => `P\t${id}\t100\t${sigOf(Number(id))}`);
    writeFileSync(join(dir, "samples.tsv"), `${s.join("\n")}\n`);
    writeFileSync(join(dir, "processes.tsv"), `${p.join("\n")}\n`);
    return dir;
  }
  const ids = (dir: string, file: string, kind: string): string[] =>
    readFileSync(join(dir, file), "utf8").split("\n").filter((l) => l.startsWith(`${kind}\t`)).map((l) => l.split("\t")[1] as string);
  const run = (dir: string, extra: string[]) => watch(["--once", "--state-dir", dir, "--max-processes", "1", "--top", "100", ...extra]);
  const AGES: Array<[string, number]> = [["1", 10], ["2", 8], ["3", 6], ["4", 1]];

  it("trims both files to the window, keeps ids monotonic and leaves no temp file", () => {
    const dir = seed("ret-a", AGES);
    const r = run(dir, ["--retain-days", "7"]);
    expect(r.status, r.out).toBe(0);
    expect(r.out).toContain("Captured sample #5");
    expect(ids(dir, "samples.tsv", "S")).toEqual(["3", "4", "5"]);
    expect(ids(dir, "processes.tsv", "P").filter((i) => Number(i) <= 4)).toEqual(["3", "4"]);
    expect(readdirSync(dir).filter((f) => f.endsWith(".tmp"))).toEqual([]);
  });

  it("defaults to 7 days", () => {
    const dir = seed("ret-b", AGES);
    expect(run(dir, []).status).toBe(0);
    expect(ids(dir, "samples.tsv", "S")).toEqual(["3", "4", "5"]);
  });

  it("--retain-days 30 keeps older samples", () => {
    const dir = seed("ret-c", AGES);
    expect(run(dir, ["--retain-days", "30"]).status).toBe(0);
    expect(ids(dir, "samples.tsv", "S")).toEqual(["1", "2", "3", "4", "5"]);
  });

  it.each(["0", "-1", "abc", "1.5", ""])("rejects --retain-days '%s' and writes nothing", (bad) => {
    const dir = seed("ret-d", AGES);
    const before = [readFileSync(join(dir, "samples.tsv"), "utf8"), readFileSync(join(dir, "processes.tsv"), "utf8")];
    const r = run(dir, ["--retain-days", bad]);
    expect(r.status, r.out).toBe(2);
    expect(readdirSync(dir).sort()).toEqual(["processes.tsv", "samples.tsv"]);
    expect([readFileSync(join(dir, "samples.tsv"), "utf8"), readFileSync(join(dir, "processes.tsv"), "utf8")]).toEqual(before);
  });

  it("computes the report from the retained window only", () => {
    const dir = seed("ret-e", AGES);
    expect(run(dir, []).status).toBe(0);
    const culprits = readFileSync(join(dir, "current-culprits.tsv"), "utf8");
    expect(culprits).not.toContain(sigOf(1));
    expect(culprits).not.toContain(sigOf(2));
    expect(culprits).toContain(sigOf(4));
  });

  it("keeps the newest sample even when it is older than the window", () => {
    const dir = seed("ret-keep-newest", [["1", 20], ["2", 15]]);
    // The new capture becomes the newest; the old ones fall out of the window.
    expect(run(dir, []).status).toBe(0);
    expect(ids(dir, "samples.tsv", "S")).toEqual(["3"]);
  });

  it("keeps rows with an unparsable timestamp", () => {
    const dir = seed("ret-f", [["1", "not-a-time"], ["2", 10], ["3", 1]]);
    expect(run(dir, []).status).toBe(0);
    expect(ids(dir, "samples.tsv", "S")).toEqual(["1", "3", "4"]);
  });

  it.each([["empty", ""], ["whitespace-only", "  "]])("keeps rows with an %s timestamp", (_name, blank) => {
    const dir = seed("ret-blank", [["1", blank], ["2", 10], ["3", 1]]);
    expect(run(dir, []).status).toBe(0);
    expect(ids(dir, "samples.tsv", "S")).toEqual(["1", "3", "4"]);
  });

  it("drops process rows whose sample id has no sample row", () => {
    const dir = seed("ret-g", [["1", 1]]);
    writeFileSync(join(dir, "processes.tsv"), `P\t1\t100\t${sigOf(1)}\nP\t99\t100\t${sigOf(99)}\n`);
    expect(run(dir, []).status).toBe(0);
    expect(ids(dir, "processes.tsv", "P")).not.toContain("99");
    expect(readFileSync(join(dir, "current-culprits.tsv"), "utf8")).not.toContain(sigOf(99));
  });
});

// readFileSync referenced to keep the import honest if assertions change
void readFileSync;
