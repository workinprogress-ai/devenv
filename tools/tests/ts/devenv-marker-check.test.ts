// devenv-marker-check: gate mode (plan-bounded FIXME blocks; conditioned TODO
// sanctioned), --all audit, --todo-report finder, exclusions, copilot/ scope,
// --marker REGEX custom sweeps.
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync, rmSync } from "node:fs";
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

  // The marker tool's own usage text and its test fixtures spell out the marker
  // syntax, so gate and audit scans skip exactly those two files.
  it("gate mode: the marker tool's own source and test are not scanned", () => {
    write("tools/ts/devenv-marker-check.ts", "// FIXME:DEVENV[p1]: usage text spelling the syntax");
    write("tools/tests/ts/devenv-marker-check.test.ts", "// FIXME:DEVENV[p1]: fixture spelling the syntax");
    expect(run([WORK_DIR]).status).toBe(0);
  });

  it("gate mode: scanning the tools directory itself still skips the two files", () => {
    write("tools/ts/devenv-marker-check.ts", "// FIXME:DEVENV[p1]: usage text spelling the syntax");
    expect(run([join(WORK_DIR, "tools")]).status).toBe(0);
  });

  it("gate mode: a real marker in any other file under tools/ still blocks", () => {
    write("tools/ts/devenv-marker-check.ts", "// FIXME:DEVENV[p1]: usage text spelling the syntax");
    write("tools/ts/other.ts", "// FIXME:DEVENV[p1]: real marker");
    const r = run([WORK_DIR]);
    expect(r.status).toBe(1);
    expect(r.out).toContain("other.ts");
    expect(r.out).not.toContain("devenv-marker-check.ts");
  });

  it("--no-exclude scans the marker tool's own files too", () => {
    write("tools/ts/devenv-marker-check.ts", "// FIXME:DEVENV[p1]: usage text spelling the syntax");
    expect(run(["--no-exclude", WORK_DIR]).status).toBe(1);
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

  it("--marker: an invalid regex exits 2 with a stderr hint, not a crash", () => {
    write("a.cs", "int x;");
    const r = spawnSync("node", [SCRIPT, "--marker", "(", WORK_DIR], { encoding: "utf8" });
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("--marker");
    expect(r.stderr).not.toContain("SyntaxError");
  });

  // Exclusions are relative to the scan root: a nested source directory that
  // merely shares a noise-class name is real code and must be scanned.
  it("a nested src/cache or src/repos directory is still scanned", () => {
    write("src/cache/a.cs", "// FIXME:DEVENV[p1]: nested cache");
    write("src/repos/b.cs", "// FIXME:DEVENV[p1]: nested repos");
    const r = run([WORK_DIR]);
    expect(r.status).toBe(1);
    expect(r.out).toContain("src/cache/a.cs");
    expect(r.out).toContain("src/repos/b.cs");
  });

  it("a nested node_modules directory stays excluded", () => {
    write("pkg/node_modules/x/a.cs", "// FIXME:DEVENV[p1]: vendored");
    expect(run([WORK_DIR]).status).toBe(0);
  });

  it("symlinked directories are not followed (no double reporting)", () => {
    write("real/a.cs", "// FIXME:DEVENV[p1]: once");
    symlinkSync(join(WORK_DIR, "real"), join(WORK_DIR, "alias"));
    const r = run([WORK_DIR]);
    expect(r.status).toBe(1);
    expect(r.out).toContain("real/a.cs");
    expect(r.out).not.toContain("alias/a.cs");
  });

  // -------------------------------------------------------------------------
  // --agent-report finder mode: permanent accepted-limit markers,
  // `AGENT(shortcut): <limit> — upgrade when <trigger>`, comment-scoped.
  // -------------------------------------------------------------------------

  describe("--agent-report", () => {
    const GOOD = "AGENT(shortcut): linear scan — upgrade when lists pass 10k rows";

    it("lists a well-formed marker in each comment syntax and exits 0 without a warning", () => {
      write("a.ts", `// ${GOOD}`);
      write("b.sh", `# ${GOOD}`);
      write("c.sql", `-- ${GOOD}`);
      write("d.html", `<!-- ${GOOD} -->`);
      const r = run(["--agent-report", WORK_DIR]);
      expect(r.status).toBe(0);
      for (const f of ["a.ts:1:", "b.sh:1:", "c.sql:1:", "d.html:1:"]) expect(r.out).toContain(f);
      expect(r.out).not.toMatch(/malformed/i);
    });

    it("tags a marker without an upgrade-when trigger as malformed, warns, and still exits 0", () => {
      write("a.ts", "// AGENT(shortcut): linear scan only");
      write("b.ts", "// AGENT(shortcut): linear scan — upgrade when");
      const r = run(["--agent-report", WORK_DIR]);
      expect(r.status).toBe(0);
      expect(r.out).toContain("a.ts:1:[malformed: missing-trigger]");
      expect(r.out).toContain("b.ts:1:[malformed: missing-trigger]");
      expect(r.out).toMatch(/2 malformed AGENT marker/);
    });

    it("tags an unknown kind and an empty limit as malformed", () => {
      write("a.ts", "// AGENT(debt): a limit — upgrade when it hurts");
      write("b.ts", "// AGENT(shortcut): — upgrade when it hurts");
      const r = run(["--agent-report", WORK_DIR]);
      expect(r.out).toContain("a.ts:1:[malformed: unknown-kind]");
      expect(r.out).toContain("b.ts:1:[malformed: empty-limit]");
    });

    it("is comment-scoped: prose, inline code and a plan-scoped TODO are not reported", () => {
      write("notes.md", ["Use `// AGENT(shortcut): <limit> — upgrade when <trigger>` for accepted limits.", "AGENT(shortcut): a — upgrade when b"].join("\n"));
      write("a.ts", "// TODO:DEVENV[plan-1]: swap provider — remove when #40 is merged");
      const r = run(["--agent-report", WORK_DIR]);
      expect(r.status).toBe(0);
      expect(r.out).toContain("No AGENT markers found");
      expect(r.out).not.toContain("notes.md:");
    });

    it("reports the line number of each marker", () => {
      write("a.ts", ["const x = 1;", "", `  g(); // ${GOOD}`].join("\n"));
      expect(run(["--agent-report", WORK_DIR]).out).toContain("a.ts:3:");
    });

    it("skips copilot/ by default (doc examples live there) and scans it with --include-copilot", () => {
      write("copilot/doc.md", `// ${GOOD}`);
      write("src/a.ts", `// ${GOOD}`);
      const def = run(["--agent-report", WORK_DIR]);
      expect(def.out).toContain("src/a.ts:1:");
      expect(def.out).not.toContain("copilot/doc.md");
      expect(run(["--agent-report", "--include-copilot", WORK_DIR]).out).toContain("copilot/doc.md:1:");
    });

    it("never changes the gate: an AGENT marker does not fail the default gate", () => {
      write("a.ts", `// ${GOOD}`);
      expect(run([WORK_DIR]).status).toBe(0);
    });

    it("is mutually exclusive with the other finder and gate modes", () => {
      write("a.ts", `// ${GOOD}`);
      for (const other of ["--ac", "--todo-report", "--all"]) {
        const r = run(["--agent-report", other, WORK_DIR]);
        expect(r.status, other).toBe(2);
      }
    });
  });
});
