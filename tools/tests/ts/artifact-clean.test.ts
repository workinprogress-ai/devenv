// Tests for artifact-clean.ts — the TypeScript port of the bash tool.
// Black-box port of tools/tests/scripts/test_artifact_clean.bats: same
// scenarios, same assertions, TS-tool specifics (node runner, vitest).
// The bash original's fzf-mocked interactive tests map to non-TTY fallback
// assertions here: D4 replaced fzf with clack, and clack requires a TTY —
// the non-TTY contract (never prompt, never delete without -y) is the
// behavior vitest can assert deterministically. Interactive-picker behavior
// itself is covered by the ui/ library's own PTY-driven tests.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const TOOL = join(fileURLToPath(new URL(".", import.meta.url)), "../../scripts/artifact-clean.ts");

let workDir: string;
let folder: string;

function runTool(args: string[], opts: { stdin?: string } = {}): { status: number; stdout: string; stderr: string; output: string } {
  // bats' $output combines stdout+stderr; mirror that so assertions match
  // the ported suite's semantics regardless of which stream a line uses.
  // spawnSync (not execFileSync): exit-0 runs must still capture stderr.
  const r = spawnSync("node", [TOOL, ...args], {
    encoding: "utf8",
    input: opts.stdin ?? "",
    stdio: ["pipe", "pipe", "pipe"],
  });
  const stdout = r.stdout ?? "";
  const stderr = r.stderr ?? "";
  return { status: r.status ?? 1, stdout, stderr, output: stdout + stderr };
}

beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), "artifact-clean-test-"));
  mkdirSync(join(workDir, "repo", ".local-artifacts"), { recursive: true });
  folder = join(workDir, "repo", ".local-artifacts");
  for (const f of [
    "tmp1.md", "tmp2.md", "session_memory-design.md",
    "Plan-issue-33-001.md", "Roadmap-22.md", "random-notes.md",
  ]) writeFileSync(join(folder, f), "x");
});

afterEach(() => {
  rmSync(workDir, { recursive: true, force: true });
});

describe("artifact-clean (TS pilot port)", () => {
  it("--list reports all four families and deletes nothing", () => {
    const r = runTool([join(workDir, "repo"), "--list"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("[ephemeral] would clean 2");
    expect(r.stdout).toContain("[session] would clean 1");
    expect(r.stdout).toContain("[working] would clean 2");
    expect(r.stdout).toContain("[other] would clean 1");
    expect(existsSync(join(folder, "tmp1.md"))).toBe(true);
  });

  it("--tmp deletes ephemeral files without confirmation, nothing else", () => {
    const r = runTool([join(workDir, "repo"), "--tmp"]);
    expect(r.status).toBe(0);
    expect(existsSync(join(folder, "tmp1.md"))).toBe(false);
    expect(existsSync(join(folder, "tmp2.md"))).toBe(false);
    expect(existsSync(join(folder, "session_memory-design.md"))).toBe(true);
    expect(existsSync(join(folder, "Plan-issue-33-001.md"))).toBe(true);
  });

  it("--working -y deletes working copies only", () => {
    const r = runTool([join(workDir, "repo"), "--working", "-y"]);
    expect(r.status).toBe(0);
    expect(existsSync(join(folder, "Plan-issue-33-001.md"))).toBe(false);
    expect(existsSync(join(folder, "Roadmap-22.md"))).toBe(false);
    expect(existsSync(join(folder, "tmp1.md"))).toBe(true);
    expect(existsSync(join(folder, "random-notes.md"))).toBe(true);
  });

  it("--working without -y and without TTY refuses to delete", () => {
    const r = runTool([join(workDir, "repo"), "--working"]);
    expect(r.status).toBe(0);
    expect(r.output).toContain("need confirmation");
    expect(existsSync(join(folder, "Plan-issue-33-001.md"))).toBe(true);
  });

  it("--all -y clears every family including other", () => {
    const r = runTool([join(workDir, "repo"), "--all", "-y"]);
    expect(r.status).toBe(0);
    expect(existsSync(folder) && Object.keys(readdirSafe(folder)).length).toBe(0);
  });

  it("no flags with no TTY defaults to list-only (never prompts, never deletes)", () => {
    const r = runTool([join(workDir, "repo")]);
    expect(r.status).toBe(0);
    expect(r.output).toContain("list-only");
    expect(existsSync(join(folder, "tmp1.md"))).toBe(true);
    expect(existsSync(join(folder, "random-notes.md"))).toBe(true);
  });

  it("path without an artifact folder exits 2", () => {
    mkdirSync(join(workDir, "plain"));
    const r = runTool([join(workDir, "plain")]);
    expect(r.status).toBe(2);
  });

  it("accepts the .local-artifacts folder itself as target", () => {
    const r = runTool([folder, "--list"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("[ephemeral] would clean 2");
  });

  it("unknown option exits 2 (canonical invalid-args contract)", () => {
    const r = runTool(["--bogus", join(workDir, "repo")]);
    expect(r.status).toBe(2);
  });

  it("--version prints version", () => {
    const r = runTool(["--version"]);
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("--interactive without TTY falls back to list-only (never deletes)", () => {
    const r = runTool([join(workDir, "repo"), "--interactive"]);
    expect(r.status).toBe(0);
    expect(existsSync(join(folder, "tmp1.md"))).toBe(true);
    expect(existsSync(join(folder, "random-notes.md"))).toBe(true);
  });

  it("--keep-tmp --tmp without TTY: refuses rather than silently deleting", () => {
    const r = runTool([join(workDir, "repo"), "--keep-tmp", "--tmp"]);
    expect(r.status).toBe(0);
    expect(existsSync(join(folder, "tmp1.md"))).toBe(true);
    expect(existsSync(join(folder, "tmp2.md"))).toBe(true);
    expect(r.output).toContain("skipped (nothing auto-deleted)");
  });

  it("--keep-tmp --tmp -y: still deletes (explicit confirmation path)", () => {
    const r = runTool([join(workDir, "repo"), "--keep-tmp", "--tmp", "-y"]);
    expect(r.status).toBe(0);
    expect(existsSync(join(folder, "tmp1.md"))).toBe(false);
    expect(existsSync(join(folder, "tmp2.md"))).toBe(false);
    // Working copies untouched — only the tmp family was targeted
    expect(existsSync(join(folder, "Plan-issue-33-001.md"))).toBe(true);
  });

  // ------------------------------------------------------------------------
  // Deliverables are retained work product, never cleanup fodder
  // ------------------------------------------------------------------------

  function makeDeliverables(): void {
    for (const f of [
      "research-001-claude-code-interop.md",
      "bug-hunt-azure-git-npm-auth.md",
      "TECH_DEBT_AUDIT.md",
    ]) writeFileSync(join(folder, f), "x");
  }

  it("--all -y never deletes deliverables (research, bug-hunt, tech-debt audit)", () => {
    makeDeliverables();
    const r = runTool([join(workDir, "repo"), "--all", "-y"]);
    expect(r.status).toBe(0);
    expect(existsSync(join(folder, "research-001-claude-code-interop.md"))).toBe(true);
    expect(existsSync(join(folder, "bug-hunt-azure-git-npm-auth.md"))).toBe(true);
    expect(existsSync(join(folder, "TECH_DEBT_AUDIT.md"))).toBe(true);
    // The rest of the sweep still happens.
    expect(existsSync(join(folder, "random-notes.md"))).toBe(false);
    expect(existsSync(join(folder, "Plan-issue-33-001.md"))).toBe(false);
  });

  it("the sweep says which deliverables it kept and how to include them", () => {
    makeDeliverables();
    const r = runTool([join(workDir, "repo"), "--all", "-y"]);
    expect(r.status).toBe(0);
    expect(r.output).toContain("[deliverable] kept 3 protected file(s)");
    expect(r.output).toContain("--include-deliverables");
  });

  it("--list reports deliverables as protected, not as cleanable 'other'", () => {
    makeDeliverables();
    const r = runTool([join(workDir, "repo"), "--list"]);
    expect(r.status).toBe(0);
    expect(r.output).toContain("[other] would clean 1");
    expect(r.output).toContain("[deliverable] kept 3 protected file(s)");
    expect(existsSync(join(folder, "TECH_DEBT_AUDIT.md"))).toBe(true);
  });

  it("--all -y --include-deliverables is the explicit override that deletes them", () => {
    makeDeliverables();
    const r = runTool([join(workDir, "repo"), "--all", "-y", "--include-deliverables"]);
    expect(r.status).toBe(0);
    expect(existsSync(join(folder, "research-001-claude-code-interop.md"))).toBe(false);
    expect(existsSync(join(folder, "bug-hunt-azure-git-npm-auth.md"))).toBe(false);
    expect(existsSync(join(folder, "TECH_DEBT_AUDIT.md"))).toBe(false);
  });

  it("--include-deliverables alone does not delete without -y or a confirmation", () => {
    makeDeliverables();
    const r = runTool([join(workDir, "repo"), "--all", "--include-deliverables"]);
    expect(r.status).toBe(0);
    expect(existsSync(join(folder, "TECH_DEBT_AUDIT.md"))).toBe(true);
    expect(existsSync(join(folder, "random-notes.md"))).toBe(true);
  });

  it("family-only sweeps (--working, --session, --tmp) leave deliverables alone", () => {
    makeDeliverables();
    const r = runTool([join(workDir, "repo"), "--tmp", "--session", "--working", "-y"]);
    expect(r.status).toBe(0);
    expect(existsSync(join(folder, "research-001-claude-code-interop.md"))).toBe(true);
    expect(existsSync(join(folder, "bug-hunt-azure-git-npm-auth.md"))).toBe(true);
    expect(existsSync(join(folder, "TECH_DEBT_AUDIT.md"))).toBe(true);
  });

  it("pair's pairing-state files are session memory, swept with --session", () => {
    writeFileSync(join(folder, "pairing-state-issue-7.md"), "x");
    const list = runTool([join(workDir, "repo"), "--list"]);
    expect(list.stdout).toContain("[session] would clean 2");
    const r = runTool([join(workDir, "repo"), "--session", "-y"]);
    expect(r.status).toBe(0);
    expect(existsSync(join(folder, "pairing-state-issue-7.md"))).toBe(false);
    expect(existsSync(join(folder, "session_memory-design.md"))).toBe(false);
  });

  it("session-state registry files classify as session and sweep with --session", () => {
    writeFileSync(join(folder, "session-state-Plan-issue-42-001.md"), "x");
    writeFileSync(join(folder, "session-state-adhoc-debugging.md"), "x");
    const list = runTool([join(workDir, "repo"), "--list"]);
    expect(list.stdout).toContain("[session] would clean 3");
    const r = runTool([join(workDir, "repo"), "--session", "-y"]);
    expect(r.status).toBe(0);
    expect(existsSync(join(folder, "session-state-Plan-issue-42-001.md"))).toBe(false);
    expect(existsSync(join(folder, "session-state-adhoc-debugging.md"))).toBe(false);
  });

  it("an unknown option is still rejected", () => {
    const r = runTool([join(workDir, "repo"), "--include-deliverable"]);
    expect(r.status).toBe(2);
  });
});

function readdirSafe(dir: string): string[] {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}
