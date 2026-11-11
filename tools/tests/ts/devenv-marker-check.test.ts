// Port of tools/tests/scripts/test_devenv_marker_check.bats (26 tests).
// devenv-marker-check: gate mode (plan-bounded FIXME blocks; conditioned TODO
// sanctioned), --all audit, --todo-report finder, exclusions, copilot/ scope,
// --marker REGEX custom sweeps.
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const ROOT = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))));
const TOOLS = join(ROOT, "tools");
const SCRIPT = join(TOOLS, "ts", "devenv-marker-check.ts");

let TMP = "";
let WORK_DIR = "";

beforeEach(() => {
  TMP = mkdtempSync(join(tmpdir(), `dmc-${Date.now()}-${Math.random().toString(36).slice(2)}`));
  WORK_DIR = join(TMP, "work");
  mkdirSync(WORK_DIR, { recursive: true });
});

afterEach(() => {
  rmSync(TMP, { recursive: true, force: true });
});

function write(name: string, content: string): void {
  const f = join(WORK_DIR, name);
  mkdirSync(dirname(f), { recursive: true });
  writeFileSync(f, `${content}\n`);
}

function run(args: string[]): { status: number; out: string } {
  const r = spawnSync("node", [SCRIPT, ...args], { encoding: "utf8" });
  return { status: r.status ?? 1, out: (r.stdout ?? "") + (r.stderr ?? "") };
}

describe("scripts/devenv-marker-check", () => {
  // -------------------------------------------------------------------------
  // Gate mode (default): plan-bounded FIXME(DEVENV[...]) blocks; cross-plan
  // TODO(DEVENV[...]) is sanctioned to ship and must NOT block.
  // -------------------------------------------------------------------------

  it("gate mode: FIXME(DEVENV[ marker fails the gate", () => {
    write("a.cs", "// FIXME(DEVENV[Plan-issue-1-001]): temporary stub");
    expect(run([WORK_DIR]).status).toBe(1);
  });

  it("gate mode: condition-bearing TODO(DEVENV[ marker does NOT block", () => {
    write("a.cs", "// TODO(DEVENV[Plan-issue-1-001]): swap provider — remove when #40 is merged");
    expect(run([WORK_DIR]).status).toBe(0);
  });

  it("gate mode: clean tree passes", () => {
    write("a.cs", "int x = 1;");
    const r = run([WORK_DIR]);
    expect(r.status).toBe(0);
    expect(r.out).toContain("Clean:");
  });

  // -------------------------------------------------------------------------
  // --all audit mode: FIXME, TODO, and bare forms are all reported.
  // -------------------------------------------------------------------------

  it("--all: reports FIXME and TODO and bare forms", () => {
    write("a.cs", "// FIXME(DEVENV[p1]): a\n// TODO(DEVENV[p1]): b — remove when x\n// DEVENV[p1]: bare");
    const r = run(["--all", WORK_DIR]);
    expect(r.status).toBe(1);
    expect(r.out).toContain("FIXME(DEVENV[p1]): a");
    expect(r.out).toContain("TODO(DEVENV[p1]): b");
    expect(r.out).toContain("DEVENV[p1]: bare");
  });

  it("--all: clean tree passes", () => {
    write("a.cs", "int x = 1;");
    expect(run(["--all", WORK_DIR]).status).toBe(0);
  });

  // -------------------------------------------------------------------------
  // --todo-report finder mode: lists TODOs, warns on missing discharge
  // condition and malformed (no-plan-key) entries; always exit 0.
  // -------------------------------------------------------------------------

  it("--todo-report: lists conditioned TODO and exits 0 with no warning", () => {
    write("a.cs", "// TODO(DEVENV[p1]): swap provider — remove when #40 is merged");
    const r = run(["--todo-report", WORK_DIR]);
    expect(r.status).toBe(0);
    expect(r.out).toContain("TODO(DEVENV[p1]): swap provider");
    expect(r.out).not.toContain("missing a discharge condition");
  });

  it("--todo-report: warns when a TODO lacks a discharge condition", () => {
    write("a.cs", "// TODO(DEVENV[p1]): swap provider once #40 lands");
    const r = run(["--todo-report", WORK_DIR]);
    expect(r.status).toBe(0);
    expect(r.out).toContain("missing a discharge condition");
  });

  it("--todo-report: warns on malformed TODO(DEVENV) without a plan key", () => {
    write("a.cs", "// TODO(DEVENV) Review for changes");
    const r = run(["--todo-report", WORK_DIR]);
    expect(r.status).toBe(0);
    expect(r.out).toContain("without a plan key");
  });

  it("--todo-report: no markers yields a clean message", () => {
    write("a.cs", "int x = 1;");
    const r = run(["--todo-report", WORK_DIR]);
    expect(r.status).toBe(0);
    expect(r.out).toContain("No scoped TODO(DEVENV markers found");
  });

  it("--todo-report: FIXME(DEVENV markers are not reported", () => {
    write("a.cs", "// FIXME(DEVENV[p1]): stub");
    const r = run(["--todo-report", WORK_DIR]);
    expect(r.status).toBe(0);
    expect(r.out).toContain("No scoped TODO(DEVENV markers found");
  });

  // -------------------------------------------------------------------------
  // Option interactions.
  // -------------------------------------------------------------------------

  it("--ac and --todo-report are mutually exclusive", () => {
    const r = run(["--ac", "--todo-report", WORK_DIR]);
    expect(r.status).toBe(2);
    expect(r.out).toContain("mutually exclusive");
  });

  it("--all cannot be combined with finder modes", () => {
    expect(run(["--all", "--todo-report", WORK_DIR]).status).toBe(2);
    expect(run(["--all", "--ac", WORK_DIR]).status).toBe(2);
  });

  // -------------------------------------------------------------------------
  // Default noise-class exclusions (cache, node_modules, .git, repos) and the
  // --no-exclude escape hatch for exhaustive audits.
  // -------------------------------------------------------------------------

  it("default gate skips markers under excluded dirs (cache/repos/node_modules/.git)", () => {
    mkdirSync(join(WORK_DIR, "src"), { recursive: true });
    mkdirSync(join(WORK_DIR, "cache", "devenv"), { recursive: true });
    mkdirSync(join(WORK_DIR, "repos", "devenv"), { recursive: true });
    mkdirSync(join(WORK_DIR, "node_modules", "pkg"), { recursive: true });
    mkdirSync(join(WORK_DIR, ".git", "hooks"), { recursive: true });
    write("src/a.cs", "// FIXME(DEVENV[p1]): real marker in scanned path");
    write("cache/devenv/a.cs", "// FIXME(DEVENV[p1]): cache clone copy");
    write("repos/devenv/a.cs", "// FIXME(DEVENV[p1]): repo clone copy");
    write("node_modules/pkg/a.cs", "// FIXME(DEVENV[p1]): vendored copy");
    write(".git/hooks/pre-commit", "// FIXME(DEVENV[p1]): vcs internals");
    const r = run([WORK_DIR]);
    expect(r.status).toBe(1);
    expect(r.out).toContain("src/a.cs");
    expect(r.out).not.toContain("cache/devenv");
    expect(r.out).not.toContain("repos/devenv");
    expect(r.out).not.toContain("node_modules");
    expect(r.out).not.toContain(".git/");
  });

  it("--todo-report also honors exclusions", () => {
    mkdirSync(join(WORK_DIR, "repos", "devenv"), { recursive: true });
    write("repos/devenv/a.cs", "// TODO(DEVENV[p1]): clone copy — remove when x");
    const r = run(["--todo-report", WORK_DIR]);
    expect(r.status).toBe(0);
    expect(r.out).toContain("No scoped TODO(DEVENV markers found");
  });

  it("--no-exclude scans excluded dirs too", () => {
    mkdirSync(join(WORK_DIR, "cache", "devenv"), { recursive: true });
    write("cache/devenv/a.cs", "// FIXME(DEVENV[p1]): cache clone copy");
    const r = run(["--no-exclude", WORK_DIR]);
    expect(r.status).toBe(1);
    expect(r.out).toContain("cache/devenv/a.cs");
  });

  it("--no-exclude --all audits every form everywhere", () => {
    mkdirSync(join(WORK_DIR, "repos", "devenv"), { recursive: true });
    write("repos/devenv/a.cs", "// TODO(DEVENV[p1]): clone copy — remove when x");
    const r = run(["--no-exclude", "--all", WORK_DIR]);
    expect(r.status).toBe(1);
    expect(r.out).toContain("TODO(DEVENV[p1]): clone copy");
  });

  it("explicitly naming an excluded path still scans it", () => {
    mkdirSync(join(WORK_DIR, "repos", "devenv"), { recursive: true });
    write("repos/devenv/a.cs", "// FIXME(DEVENV[p1]): explicit target");
    const r = run([join(WORK_DIR, "repos", "devenv")]);
    expect(r.status).toBe(1);
    expect(r.out).toContain("explicit target");
  });

  it("plain TODO/FIXME comments never match in any mode", () => {
    write("a.cs", "// TODO: normal todo\n# FIXME: normal fixme\n// TODO no colon");
    expect(run([WORK_DIR]).status).toBe(0);
    expect(run(["--all", WORK_DIR]).status).toBe(0);
    const r = run(["--todo-report", WORK_DIR]);
    expect(r.status).toBe(0);
    expect(r.out).toContain("No scoped TODO(DEVENV markers found");
  });

  // -------------------------------------------------------------------------
  // copilot/ scope (option C): gate and --all modes exclude copilot/ by default
  // (skill files carry example markers by design); --include-copilot restores
  // scanning; --todo-report and --ac always scan copilot/.
  // -------------------------------------------------------------------------

  it("gate mode: markers under copilot/ are ignored by default", () => {
    mkdirSync(join(WORK_DIR, "copilot"), { recursive: true });
    write("copilot/skill.md", "// FIXME:DEVENV[p1]: example marker in docs");
    expect(run([WORK_DIR]).status).toBe(0);
  });

  it("gate mode: markers under docs/ still block (not exempt)", () => {
    mkdirSync(join(WORK_DIR, "docs"), { recursive: true });
    write("docs/real.md", "// FIXME:DEVENV[p1]: real marker in docs");
    expect(run([WORK_DIR]).status).toBe(1);
  });

  it("gate mode: --include-copilot restores blocking under copilot/", () => {
    mkdirSync(join(WORK_DIR, "copilot"), { recursive: true });
    write("copilot/skill.md", "// FIXME:DEVENV[p1]: example marker in docs");
    expect(run(["--include-copilot", WORK_DIR]).status).toBe(1);
  });

  it("--todo-report always scans copilot/ (colon form detected)", () => {
    mkdirSync(join(WORK_DIR, "copilot"), { recursive: true });
    write("copilot/skill.md", "// TODO:DEVENV[p1]: swap — remove when #40 merged");
    const r = run(["--todo-report", WORK_DIR]);
    expect(r.status).toBe(0);
    expect(r.out).toContain("swap");
  });

  // -------------------------------------------------------------------------
  // --marker REGEX: the custom marker is what gets scanned (it used to be parsed
  // and then ignored, so a hunt cleanup sweep checked FIXME markers instead).
  // -------------------------------------------------------------------------

  it("--marker: a matching custom marker fails the gate", () => {
    write("a.cs", "int x; // DEVENV[bug-hunt] instrumentation");
    const r = run(["--marker", "DEVENV\\[bug-hunt\\]", WORK_DIR]);
    expect(r.status).toBe(1);
    expect(r.out).toContain("a.cs:1:");
  });

  it("--marker: a FIXME marker with a different key does not trip the custom sweep", () => {
    write("a.cs", "int x; // FIXME:DEVENV[other-plan]: unrelated");
    expect(run(["--marker", "DEVENV\\[bug-hunt\\]", WORK_DIR]).status).toBe(0);
  });

  it("--marker with --require succeeds only when the custom marker is present", () => {
    write("a.cs", "int x; // DEVENV[bug-hunt] here");
    expect(run(["--marker", "DEVENV\\[bug-hunt\\]", "--require", WORK_DIR]).status).toBe(0);
    expect(run(["--marker", "DEVENV\\[absent-key\\]", "--require", WORK_DIR]).status).toBe(1);
  });

  it("--marker: the default gate (no --marker) still scans FIXME markers only", () => {
    write("a.cs", "int x; // DEVENV[bug-hunt] bare form");
    expect(run([WORK_DIR]).status).toBe(0);
  });
});
