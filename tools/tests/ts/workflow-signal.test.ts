// Tests for workflow-signal.ts — the TypeScript port of the bash tool.
// Black-box port of tools/tests/scripts/test_workflow_signal.bats: same
// scenarios, same assertions, TS-tool specifics (node runner, vitest).
// The WORKFLOW_SIGNAL_TOOLS seam points the tool at a fixture tools root
// whose internal/ holds executable _on_*.sh stubs that log
// "DISPATCH <event> <issue>" — the exact contract the bats suite asserts.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync, readFileSync, rmSync, statSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const TOOL = join(fileURLToPath(new URL(".", import.meta.url)), "../../ts/workflow-signal.ts");
const REAL_INTERNAL = join(fileURLToPath(new URL(".", import.meta.url)), "../../internal");
const EVENTS_MODULE = join(
  fileURLToPath(new URL(".", import.meta.url)),
  "../../lib/domain/events.ts",
);

let fakeRoot: string;
let fakeInternal: string;
let logFile: string;
let entryDirOverridden = false;

function makeFakeEvent(event: string, body?: string): void {
  const script =
    body ??
    `#!/usr/bin/env bash\necho "DISPATCH ${event} $1" >> ${JSON.stringify(logFile)}\nexit 0\n`;
  writeFileSync(join(fakeInternal, `${event}.sh`), script);
  chmodSync(join(fakeInternal, `${event}.sh`), 0o755);
}

// The tool's entry-point existence check consults the on-disk event dir, and
// --list unions it with configured events. On the real tree, event scripts
// live in <tools>/internal — the seam swaps that root wholesale, so only the
// fake's events exist. Tests that need configured-listing run against the
// real tree without the override.
function runTool(args: string[]): { status: number; stdout: string; stderr: string; output: string } {
  // spawnSync (not execFileSync): failure runs must still capture stderr.
  // The seam points at the directory holding the _on_*.sh entry points —
  // the internal/ dir itself, exactly as the bats harness sets it.
  const env: Record<string, string> = { ...process.env } as Record<string, string>;
  if (entryDirOverridden) env["WORKFLOW_SIGNAL_TOOLS"] = fakeInternal;
  const r = spawnSync("node", [TOOL, ...args], {
    encoding: "utf8",
    input: "",
    stdio: ["pipe", "pipe", "pipe"],
    env,
  });
  const stdout = r.stdout ?? "";
  const stderr = r.stderr ?? "";
  return { status: r.status ?? 1, stdout, stderr, output: stdout + stderr };
}

function configuredEventNames(): string[] {
  const r = spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `import { eventNames } from ${JSON.stringify(EVENTS_MODULE)};\nfor (const n of eventNames()) console.log(n);`,
    ],
    { encoding: "utf8" },
  );
  expect(r.status).toBe(0);
  return (r.stdout ?? "").split("\n").filter((l) => l.trim() !== "");
}

function realEventExecutable(event: string): boolean {
  try {
    return statSync(join(REAL_INTERNAL, `${event}.sh`)).isFile();
  } catch {
    return false;
  }
}

beforeEach(() => {
  fakeRoot = mkdtempSync(join(tmpdir(), "wf-signal-"));
  fakeInternal = join(fakeRoot, "internal");
  mkdirSync(fakeInternal, { recursive: true });
  logFile = join(fakeRoot, "log");
  for (const ev of ["_on_staging_deploy", "_on_production_deploy", "_on_begin_review"]) {
    makeFakeEvent(ev);
  }
});

afterEach(() => {
  entryDirOverridden = false;
  rmSync(fakeRoot, { recursive: true, force: true });
});

describe("--list", () => {
  it("exposes every configured event with an executable script", () => {
    // On the real tree: every event configured in skill-events.yml must have
    // an executable backing script (tools/internal/<event>.sh), and --list
    // must advertise exactly that set (configured ∪ executable).
    const names = configuredEventNames();
    expect(names.length).toBeGreaterThan(0);
    for (const ev of names) {
      expect(realEventExecutable(ev), `configured event '${ev}' has no executable script`).toBe(true);
    }
    const r = runTool(["--list"]);
    expect(r.status).toBe(0);
    expect(r.stdout.split("\n").filter((l) => l.trim() !== "").sort()).toEqual([...names].sort());
  });

  it("excludes the dispatcher entry point from --list", () => {
    const r = runTool(["--list"]);
    expect(r.status).toBe(0);
    expect(r.output).not.toContain("_on_event_dispatch");
  });

  it("unions on-disk events into the listing under the seam", () => {
    entryDirOverridden = true;
    const r = runTool(["--list"]);
    expect(r.status).toBe(0);
    for (const ev of ["_on_staging_deploy", "_on_production_deploy", "_on_begin_review"]) {
      expect(r.stdout).toContain(ev);
    }
  });
});

describe("signal dispatch (seam mode)", () => {
  beforeEach(() => {
    entryDirOverridden = true;
  });

  it("normalizes bare event name to _on_<name>", () => {
    const r = runTool(["staging-deploy", "101"]);
    expect(r.status).toBe(0);
    expect(readFileSync(logFile, "utf8")).toContain("DISPATCH _on_staging_deploy 101");
  });

  it("accepts underscores without _on_ prefix", () => {
    const r = runTool(["begin_review", "105"]);
    expect(r.status).toBe(0);
    expect(readFileSync(logFile, "utf8")).toContain("DISPATCH _on_begin_review 105");
  });

  it("accepts the full _on_ form verbatim", () => {
    const r = runTool(["_on_begin_review", "107"]);
    expect(r.status).toBe(0);
    expect(readFileSync(logFile, "utf8")).toContain("DISPATCH _on_begin_review 107");
  });

  it("batches multiple issues after one event", () => {
    const r = runTool(["_on_staging_deploy", "101", "102", "103"]);
    expect(r.status).toBe(0);
    const log = readFileSync(logFile, "utf8");
    expect(log).toContain("DISPATCH _on_staging_deploy 101");
    expect(log).toContain("DISPATCH _on_staging_deploy 102");
    expect(log).toContain("DISPATCH _on_staging_deploy 103");
  });

  it("handles mixed batches (repeated event groups)", () => {
    const r = runTool(["_on_begin_review", "201", "_on_staging_deploy", "202", "203"]);
    expect(r.status).toBe(0);
    const log = readFileSync(logFile, "utf8");
    expect(log).toContain("DISPATCH _on_begin_review 201");
    expect(log).toContain("DISPATCH _on_staging_deploy 202");
    expect(log).toContain("DISPATCH _on_staging_deploy 203");
  });

  it("unknown event is a hard error naming the normalized form", () => {
    const r = runTool(["bogus-event", "1"]);
    expect(r.status).not.toBe(0);
    expect(r.output).toContain("Unknown event");
  });

  it("issue number before any event is a usage error", () => {
    const r = runTool(["101"]);
    expect(r.status).not.toBe(0);
    expect(r.output).toContain("before any event");
  });

  it("event without issues is a usage error", () => {
    const r = runTool(["staging-deploy"]);
    expect(r.status).not.toBe(0);
  });

  it("one failing issue does not block the rest of the batch", () => {
    // The seam contract: a non-zero stub exit is a failed write. Refuse only
    // issue 102 — the batch must continue past it (best-effort).
    makeFakeEvent(
      "_on_staging_deploy",
      `#!/usr/bin/env bash\nif [ "$1" = "102" ]; then echo "workflow write failed for issue 102" >&2; exit 1; fi\necho "DISPATCH _on_staging_deploy $1" >> ${JSON.stringify(logFile)}\nexit 0\n`,
    );
    const r = runTool(["_on_staging_deploy", "101", "102", "103"]);
    expect(r.status).toBe(1);
    const log = readFileSync(logFile, "utf8");
    expect(log).toContain("DISPATCH _on_staging_deploy 101");
    expect(log).not.toContain("DISPATCH _on_staging_deploy 102");
    expect(log).toContain("DISPATCH _on_staging_deploy 103");
  });

  it("failed write is reported as failed with the warning shown", () => {
    // The stub reports the failed write itself (best-effort dispatcher
    // contract): WARNING on stderr, exit 0 — the tool must not claim success.
    makeFakeEvent(
      "_on_production_deploy",
      `#!/usr/bin/env bash\necho "WARNING: workflow write 'Production' failed for issue #105 (best-effort, continuing)" >&2\nexit 0\n`,
    );
    const r = runTool(["production-deploy", "105"]);
    expect(r.status).not.toBe(0);
    expect(r.output).not.toContain("signalled _on_production_deploy for issue #105");
    expect(r.output).toContain("workflow write 'Production' failed");
  });

  it("successful write is reported as signalled", () => {
    const r = runTool(["_on_staging_deploy", "300"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("signalled _on_staging_deploy for issue #300");
  });
});

describe("interactive fallback (non-TTY contract)", () => {
  // The bash original's fzf-less numbered menu (scripted-input tests) maps
  // to non-TTY fallback assertions here, per the artifact-clean D4
  // convention: clack requires a TTY; the deterministic tool-level contract
  // is "never prompt, never dispatch, exit clean via the declared
  // fallback". Interactive-picker behavior itself is covered by the ui/
  // library's own PTY-driven tests.
  beforeEach(() => {
    entryDirOverridden = true;
  });

  it("zero args non-TTY: resolves the declared fallback — cancel, exit 0, no dispatch", () => {
    const r = runTool([]);
    expect(r.status).toBe(0);
    expect(r.output).toContain("Cancelled.");
    expect(existsSync(logFile)).toBe(false);
  });

  it("piped stdin does not become a selection (non-TTY never dispatches)", () => {
    // Any piped "menu input" is ignored on the non-TTY path — dispatch only
    // happens through explicit argv or a real interactive pick.
    const env: Record<string, string> = { ...process.env } as Record<string, string>;
    env["WORKFLOW_SIGNAL_TOOLS"] = fakeInternal;
    const r = spawnSync("node", [TOOL], {
      encoding: "utf8",
      input: "2\n101 102\n",
      stdio: ["pipe", "pipe", "pipe"],
      env,
    });
    expect(r.status ?? 1).toBe(0);
    expect(existsSync(logFile)).toBe(false);
  });
});
