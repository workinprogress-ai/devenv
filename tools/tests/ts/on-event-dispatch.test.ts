// Port of tools/tests/scripts/test_on_event_dispatch.bats +
// test_on_events_write.bats — the process-level contract of the _on_*
// dispatcher entry point (tools/internal/_on_event_dispatch.ts).
//
// The graph/write layers beneath it (onEvent resolution, --devenv override
// rule, rollup climb, best-effort) are pinned by workflow-orchestration.test.ts
// against the same seams; this suite locks the dispatcher shell itself:
// usage errors, unknown-event tolerance, the configured-event write reaching
// the wrapper with --all-projects/--safe fan-out, and best-effort exit 0.
// The write tests stub the project-update-issue wrapper via the
// WORKFLOW_CORE_TOOLS seam (hermetic, no gh/jq in the loop); the wrapper's
// own gate-ordering contract belongs to the wrapper's suite.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync, chmodSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { useProviderDown } from "./harness/index.ts";

// These suites assert behaviour when the provider is down or unauthenticated; the
// failure is stubbed so the regular run never starts a real gh or az.
useProviderDown();

const ROOT = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))));
const DISPATCH = join(ROOT, "tools", "internal", "_on_event_dispatch.ts");
const EVENTS_MODULE = join(ROOT, "tools", "lib", "domain", "events.ts");

let TMP = "";
let STUB_DIR = "";
let CALLS_LOG = "";

function eventStatusFor(name: string): string | null {
  const script =
    `import { eventStatusFor } from ${JSON.stringify(EVENTS_MODULE)};\n` +
    `const s = eventStatusFor(${JSON.stringify(name)});\n` +
    `process.stdout.write(s === null ? "NULL" : s);\n`;
  const r = spawnSync(process.execPath, ["--input-type=module", "-e", script], { encoding: "utf8" });
  const out = (r.stdout ?? "").trim();
  return out === "NULL" ? null : out;
}

function writeConfig(skillEvents = true): void {
  const config =
    `[provider]\nname=github\n[organization]\norg=test-org\n` +
    `[workflows]\nstatus_workflow=TBD,To-Groom,Ready,Implementing,Review,Staged,Staging,Production\n` +
    (skillEvents
      ? `[issues]\ntypes=Task,Bug\nskill_events:\n  _on_begin_review:\n    status: To-Groom\n  _on_merge:\n    status: Production\n`
      : "");
  writeFileSync(join(TMP, "devroot", "devenv.config"), config);
}

function writeWrapper(body: string): void {
  writeFileSync(join(STUB_DIR, "project-update-issue"), `#!/usr/bin/env bash\necho "CALL $*" >> ${JSON.stringify(CALLS_LOG)}\n${body}\n`);
  chmodSync(join(STUB_DIR, "project-update-issue"), 0o755);
}

function dispatch(args: string[], extraEnv: Record<string, string> = {}): { status: number; stdout: string; stderr: string; out: string } {
  const r = spawnSync(process.execPath, [DISPATCH, ...args], {
    cwd: TMP,
    encoding: "utf8",
    input: "",
    env: {
      ...process.env,
      DEVENV_ROOT: join(TMP, "devroot"),
      WORKFLOW_CORE_TOOLS: STUB_DIR,
      ...extraEnv,
    },
  });
  delete process.env["DEVENV_REPO"];
  return { status: r.status ?? 1, stdout: r.stdout ?? "", stderr: r.stderr ?? "", out: (r.stdout ?? "") + (r.stderr ?? "") };
}

function calls(): string[] {
  try {
    return readFileSync(CALLS_LOG, "utf8")
      .split("\n")
      .filter((l) => l.trim() !== "")
      .map((l) => l.replace(/^CALL /, ""));
  } catch {
    return [];
  }
}

beforeEach(() => {
  TMP = mkdtempSync(join(tmpdir(), `onevent-${Date.now()}-${Math.random().toString(36).slice(2)}`));
  mkdirSync(join(TMP, "devroot"), { recursive: true });
  STUB_DIR = join(TMP, "bin");
  mkdirSync(STUB_DIR, { recursive: true });
  CALLS_LOG = join(TMP, "calls.log");
  writeConfig();
  writeWrapper("exit 0");
});

afterEach(() => {
  rmSync(TMP, { recursive: true, force: true });
  delete process.env["DEVENV_REPO"];
  delete process.env["WORKFLOW_CORE_TOOLS"];
  delete process.env["DEVENV_ROOT"];
});

describe("_on_event_dispatch.ts (bats pair port)", () => {
  // ── usage contract ──────────────────────────────────────────────────────

  it("no args is a usage error", () => {
    const r = dispatch([]);
    expect(r.status).not.toBe(0);
    expect(r.out).toContain("Usage");
  });

  it("missing issue number is a usage error", () => {
    const r = dispatch(["_on_begin_review"]);
    expect(r.status).not.toBe(0);
    expect(r.out).toContain("Usage");
  });

  it("a non-numeric issue number is a usage error", () => {
    const r = dispatch(["_on_begin_review", "abc"]);
    expect(r.status).not.toBe(0);
    expect(r.out).toContain("not a number");
  });

  // ── schema tolerance ────────────────────────────────────────────────────

  it("unknown event warns and exits 0 (tolerance)", () => {
    const r = dispatch(["_on_unknown_event", "42"]);
    expect(r.status).toBe(0);
    expect(r.out).toContain("Unknown event");
    expect(calls()).toHaveLength(0);
  });

  // ── configured-event write path ─────────────────────────────────────────

  it("configured event succeeds quietly via the workflow library", () => {
    // Happy path is silent (write noise suppressed): rc 0 and no
    // unknown-event complaint — not a specific output line.
    const r = dispatch(["_on_begin_review", "42"]);
    expect(r.status).toBe(0);
    expect(r.out).not.toContain("Unknown event");
  });

  it("dispatcher invokes the wrapper with resolved status and safe fan-out", () => {
    const r = dispatch(["_on_begin_review", "44"]);
    expect(r.status).toBe(0);
    const all = calls().join("\n");
    expect(all).toContain(`--status ${String(eventStatusFor("_on_begin_review"))}`);
    // Safe fan-out: every project, unreadable ones skipped-and-reported.
    expect(all).toContain("--all-projects");
    expect(all).toContain("--safe");
  });

  it("event write fires without DEVENV_REPO: the override travels with the call", () => {
    // Regression context (workflow status write dead from devenv cwd): with
    // no DEVENV_REPO the write must still proceed — the graph supplies the
    // --devenv override so the wrapper's safety gate sees an explicit target
    // (the wrapper-internal gate ordering is pinned by the wrapper's suite).
    const r = dispatch(["_on_begin_review", "44"], { DEVENV_REPO: "" });
    delete process.env["DEVENV_REPO"];
    expect(r.status).toBe(0);
    expect(r.out).not.toContain("workflow write");
    expect(calls().join("\n")).toContain("--devenv");
  });

  // ── best-effort (D-008) ─────────────────────────────────────────────────

  it("wrapper failure is best-effort: warn + exit 0 (D-008)", () => {
    writeWrapper("exit 1");
    const r = dispatch(["_on_begin_review", "44"]);
    // Contract: the dispatcher exits 0 no matter what the wrapper did; a
    // hard crash is the only unacceptable outcome. A read failure under
    // --safe is a no-op success, so either the fan-out rollup line or the
    // best-effort warning may appear.
    expect(r.status).toBe(0);
    expect(r.out.includes("(all projects)") || r.out.includes("best-effort") || r.out.includes("workflow write")).toBe(true);
  });
});
