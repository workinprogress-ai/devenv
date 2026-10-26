// devenv-memory-watch — sample container memory over time and flag likely
// culprits. Port of devenv-memory-watch.sh: cgroup sampling, per-process
// snapshots, a current-culprits TSV (delta/peak aggregation per signature).

import { spawnSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync, openSync, closeSync, statSync } from "node:fs";
import { join } from "node:path";
import { assertNodeFloor } from "../lib/core/node-floor.ts";
import { selfRoot } from "../lib/core/self-root.ts";

assertNodeFloor();

const DEFAULT_INTERVAL_MINUTES = 10;
const DEFAULT_TOP_COUNT = 10;
const DEFAULT_MAX_PROCESSES = 250;

function usage(): never {
  console.log(`Usage: devenv-memory-watch [OPTIONS]

Samples container memory usage over time, persists history in a state directory,
and writes a compact current-culprits TSV for the latest analysis.

Options:
  -h, --help                 Show this help message and exit
  -i, --interval-minutes N    Sample every N minutes (default: ${DEFAULT_INTERVAL_MINUTES})
  -t, --top N                Show the top N culprits in the summary TSV (default: ${DEFAULT_TOP_COUNT})
  -s, --state-dir PATH        Directory used to store samples and progress
  -m, --max-processes N       Maximum processes captured per sample (default: ${DEFAULT_MAX_PROCESSES})
  -r, --reset                 Clear persisted history before starting
  -o, --once                  Capture one sample, print a report, then exit

Environment Variables:
  DEVENV_ROOT                         Repo root used when --state-dir is not supplied
  STATE_DIR                           Overrides the persisted state directory
  DEVENV_MEMORY_WATCH_MAX_PROCESSES   Overrides the per-sample process cap`);
  process.exit(0);
}

const argv = process.argv.slice(2);
if (argv.includes("-h") || argv.includes("--help")) usage();

let intervalMinutes = DEFAULT_INTERVAL_MINUTES;
let topCount = DEFAULT_TOP_COUNT;
let maxProcesses = Number(process.env.DEVENV_MEMORY_WATCH_MAX_PROCESSES ?? DEFAULT_MAX_PROCESSES);
let resetState = false;
let once = false;

const isPositiveInt = (v: string): boolean => /^\d+$/.test(v) && Number(v) > 0;
const die = (msg: string): never => { console.error(`ERROR: ${msg}`); process.exit(1); };

for (let i = 0; i < argv.length; i++) {
  const a = argv[i] as string;
  const val = (name: string): string => {
    const v = argv[i + 1];
    if (v === undefined) die(`${name} requires a value`);
    i++;
    return v as string;
  };
  if (a === "-i" || a === "--interval-minutes") {
    const v = val(a);
    if (!isPositiveInt(v)) die("--interval-minutes must be a positive integer");
    intervalMinutes = Number(v);
  } else if (a === "-t" || a === "--top") {
    const v = val(a);
    if (!isPositiveInt(v)) die("--top must be a positive integer");
    topCount = Number(v);
  } else if (a === "-s" || a === "--state-dir") {
    process.env.STATE_DIR = val(a);
  } else if (a === "-m" || a === "--max-processes") {
    const v = val(a);
    if (!isPositiveInt(v)) die("--max-processes must be a positive integer");
    maxProcesses = Number(v);
  } else if (a === "-r" || a === "--reset") resetState = true;
  else if (a === "-o" || a === "--once") once = true;
  else die(`Unknown argument: ${a}`);
}

const devenvRoot = process.env.DEVENV_ROOT ?? selfRoot(process.cwd());
const stateDir = process.env.STATE_DIR
  ?? (existsSync(join(devenvRoot, ".debug", "devenv-memory-watch")) || !existsSync(join(devenvRoot, ".debug", "devcontainer-memory-watch"))
    ? join(devenvRoot, ".debug", "devenv-memory-watch")
    : join(devenvRoot, ".debug", "devcontainer-memory-watch"));
const samplesFile = join(stateDir, "samples.tsv");
const processesFile = join(stateDir, "processes.tsv");
const currentCulpritsFile = join(stateDir, "current-culprits.tsv");
const lockFile = join(stateDir, ".lock");

// --- helpers (ports of the awk/POSIX pieces) ---

function humanizeKb(kb: number): string {
  if (kb >= 1024 * 1024) return `${(kb / (1024 * 1024)).toFixed(1)} GB`;
  if (kb >= 1024) return `${(kb / 1024).toFixed(1)} MB`;
  return `${kb} KB`;
}

function humanizeBytes(b: number): string {
  if (b >= 1024 ** 4) return `${(b / 1024 ** 4).toFixed(1)} TB`;
  if (b >= 1024 ** 3) return `${(b / 1024 ** 3).toFixed(1)} GB`;
  if (b >= 1024 ** 2) return `${(b / 1024 ** 2).toFixed(1)} MB`;
  if (b >= 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${b} B`;
}

function compactSignature(signature: string): string {
  const [comm = "", args = ""] = signature.split(" | ");
  if (args === "") return comm;
  const maxTokens = 6, maxLength = 110;
  const tokens = args.split(/\s+/).filter((t) => t !== "");
  const out = tokens.slice(0, maxTokens)
    .map((t) => (t.startsWith("/") ? t.split("/").pop() ?? t : t))
    .join(" ") || comm;
  return tokens.length > maxTokens || args.length > maxLength ? `${out} ...` : out;
}

function formatTimestamp(ts: string): string {
  const n = Number(ts);
  if (!Number.isFinite(n)) return ts;
  return new Date(n * 1000).toISOString().replace("T", " ").replace(/\.\d+Z$/, " UTC");
}

function readCgroupValue(primary: string, fallback: string): string {
  for (const p of [primary, fallback]) {
    try {
      return readFileSync(p, "utf8").trim();
    } catch { /* next */ }
  }
  return "0";
}

interface SampleRow { id: string; ts: string; current: string; max: string }
interface ProcRow { sampleId: string; rss: number; signature: string }

function loadState(): { samples: SampleRow[]; procs: ProcRow[] } {
  const samples: SampleRow[] = [];
  try {
    for (const line of readFileSync(samplesFile, "utf8").split("\n")) {
      if (line === "") continue;
      const [kind, id, ts, current, max] = line.split("\t");
      if (kind === "S") samples.push({ id: id as string, ts: ts as string, current: current as string, max: max as string });
    }
  } catch { /* no samples yet */ }
  const procs: ProcRow[] = [];
  try {
    for (const line of readFileSync(processesFile, "utf8").split("\n")) {
      if (line === "") continue;
      const [kind, sampleId, rss, ...sig] = line.split("\t");
      if (kind === "P") procs.push({ sampleId: sampleId as string, rss: Number(rss), signature: sig.join("\t") });
    }
  } catch { /* none */ }
  return { samples, procs };
}

function nextSampleId(samples: SampleRow[]): number {
  return samples.length === 0 ? 1 : Number(samples[samples.length - 1]?.id) + 1;
}

function collectProcessSnapshot(sampleId: string): void {
  const ps = spawnSync("ps", ["-eo", "pid=,ppid=,rss=,comm=,args=", "--sort=-rss"], { encoding: "utf8" });
  const lines = (ps.stdout ?? "").split("\n").slice(0, maxProcesses);
  for (const line of lines) {
    if (line.trim() === "") continue;
    const m = line.match(/^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s*(.*)$/);
    if (!m) continue;
    const [, , , rss, comm, argsRest] = m as unknown as [string, string, string, string, string, string];
    const args = (argsRest ?? "").replace(/\s+/g, " ").trim();
    const signature = `${comm} | ${args === "" ? comm : args}`.replace(/\t/g, " ");
    appendFileSync(processesFile, `P\t${sampleId}\t${rss}\t${signature}\n`);
  }
}

interface CulpritRow {
  delta: number; last: number; peak: number; first: number; hits: number;
  firstSample: string; lastSample: string; firstTime: string; lastTime: string;
  signature: string;
}

function buildCulpritRows(samples: SampleRow[], procs: ProcRow[]): CulpritRow[] {
  const sampleTime = new Map(samples.map((s) => [s.id, s.ts]));
  const agg = new Map<string, {
    totalBySample: Map<string, number>;
  }>();
  for (const p of procs) {
    let e = agg.get(p.signature);
    if (!e) { e = { totalBySample: new Map() }; agg.set(p.signature, e); }
    e.totalBySample.set(p.sampleId, (e.totalBySample.get(p.sampleId) ?? 0) + p.rss);
  }
  const rows: CulpritRow[] = [];
  for (const [signature, e] of agg) {
    let firstSample = "", lastSample = "";
    let firstRss = 0, lastRss = 0, peak = 0, hits = 0;
    const ordered = [...e.totalBySample.entries()].sort((a, b) => Number(a[0]) - Number(b[0]));
    for (const [sampleId, total] of ordered) {
      hits++;
      if (firstSample === "") { firstSample = sampleId; firstRss = total; }
      if (sampleId > lastSample || lastSample === "") { lastSample = sampleId; lastRss = total; }
      if (total > peak) peak = total;
    }
    rows.push({
      delta: lastRss - firstRss, last: lastRss, peak, first: firstRss, hits,
      firstSample, lastSample,
      firstTime: sampleTime.get(firstSample) ?? "", lastTime: sampleTime.get(lastSample) ?? "",
      signature,
    });
  }
  return rows;
}

function writeCurrentCulprits(samples: SampleRow[], procs: ProcRow[]): void {
  const rows = buildCulpritRows(samples, procs)
    .sort((a, b) => b.last - a.last || b.delta - a.delta)
    .slice(0, topCount);
  const out = ["rank\tlabel\tcurrent\tdelta\tpeak\tsamples\tfirst_sample\tlast_sample\tfirst_seen\tlast_seen\tsignature"];
  rows.forEach((r, i) => {
    out.push([
      String(i + 1), compactSignature(r.signature), humanizeKb(r.last), humanizeKb(r.delta),
      humanizeKb(r.peak), String(r.hits), r.firstSample, r.lastSample,
      formatTimestamp(r.firstTime), formatTimestamp(r.lastTime), r.signature,
    ].join("\t"));
  });
  writeFileSync(currentCulpritsFile, `${out.join("\n")}\n`);
}

function renderReport(): void {
  const { samples, procs } = loadState();
  if (samples.length === 0) {
    console.log("No samples recorded yet.");
    return;
  }
  const latest = samples[samples.length - 1] as SampleRow;
  writeCurrentCulprits(samples, procs);

  console.log(`Samples recorded: ${samples.length}`);
  console.log(`Latest sample: #${latest.id} at ${formatTimestamp(latest.ts)}`);
  console.log(`Cgroup memory current: ${humanizeBytes(Number(latest.current))}`);
  console.log(latest.max === "max" ? "Cgroup memory max: unlimited" : `Cgroup memory max: ${humanizeBytes(Number(latest.max))}`);
  console.log(`Current culprit summary: ${currentCulpritsFile}`);

  const topLine = readFileSync(currentCulpritsFile, "utf8").split("\n")[1];
  if (topLine) {
    const [label, current, delta, peak] = topLine.split("\t");
    console.log(`Top current culprit: ${label} | current ${current} | delta ${delta} | peak ${peak}`);
  }
}

// --- main loop ---

mkdirSync(stateDir, { recursive: true });
if (resetState) {
  for (const f of [samplesFile, processesFile, currentCulpritsFile]) {
    try { rmSync(f, { force: true }); } catch { /* absent */ }
  }
}
for (const f of [samplesFile, processesFile]) closeSync(openSync(f, "a"));

// Single-instance lock: O_EXCL lockfile with a stale-lock reclaim (the bash
// tool used flock, which has no TS equivalent — see Tooling-Standards).
try {
  if (existsSync(lockFile) && Date.now() - statSync(lockFile).mtimeMs > 30_000) {
    rmSync(lockFile, { force: true });
  }
  writeFileSync(lockFile, String(process.pid), { flag: "wx" });
} catch {
  die(`Another memory watch is already running in ${stateDir}`);
}
process.on("exit", () => { try { rmSync(lockFile, { force: true }); } catch { /* gone */ } });

const sleepSeconds = intervalMinutes * 60;
for (;;) {
  const { samples } = loadState();
  const sampleId = nextSampleId(samples);
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const cgroupCurrent = readCgroupValue("/sys/fs/cgroup/memory.current", "/sys/fs/cgroup/memory.usage_in_bytes");
  const cgroupMax = readCgroupValue("/sys/fs/cgroup/memory.max", "/sys/fs/cgroup/memory.limit_in_bytes");
  appendFileSync(samplesFile, `S\t${sampleId}\t${timestamp}\t${cgroupCurrent}\t${cgroupMax}\n`);
  collectProcessSnapshot(String(sampleId));
  console.log(`Captured sample #${sampleId} into ${stateDir}`);
  renderReport();
  if (once) break;
  spawnSync("sleep", [String(sleepSeconds)], { stdio: "ignore" });
}
