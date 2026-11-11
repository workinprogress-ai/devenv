// Tests for issue-label-create.ts — idempotent create / --update / --seed
// over a stubbed gh with a mutation log.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runTool as runHarness, pathWithStubs } from "./harness/index.ts";

const TOOL = "issue-label-create";

let stubDir = "";
let responses = "";
let repoRoot = "";

function installGhStub(): void {
  writeFileSync(
    join(stubDir, "git"),
    [
      "#!/usr/bin/env bash",
      `if [ "$1" = "rev-parse" ]; then printf '%s\\n' "${repoRoot}"; exit 0; fi`,
      "exit 0",
      "",
    ].join("\n"),
    { mode: 0o755 },
  );
  writeFileSync(
    join(stubDir, "gh"),
    [
      "#!/usr/bin/env bash",
      'printf \'%s\\n\' "gh $*" >> "__CALLS__"',
      `case "$*" in *"label create"*FAILME*) echo boom >&2; exit 1 ;; esac`,
      `if [ "$1" = "rev-parse" ]; then printf '%s\\n' "${repoRoot}"; exit 0; fi`,
      'if [ -s "__RESPONSES__" ]; then',
      "  while IFS= read -r line; do",
      '    [ -z "$line" ] && continue',
      `    key="\${line%%$'\\t'*}"`,
      `    val="\${line#*$'\\t'}"`,
      '    case "gh $*" in',
      `      *"$key"*) printf '%s\\n' "$val"; exit 0 ;;`,
      "    esac",
      `  done < "__RESPONSES__"`,
      "fi",
      "exit 0",
      "",
    ].join("\n").replaceAll("__RESPONSES__", responses).replaceAll("__CALLS__", join(stubDir, "calls.log")),
    { mode: 0o755 },
  );
}

function ghCalls(): string[] {
  const log = join(stubDir, "calls.log");
  return existsSync(log) ? readFileSync(log, "utf8").split("\n").filter((l) => l.startsWith("gh ")) : [];
}

function useSeedConfig(yaml: string): string {
  const p = join(stubDir, "labels-config.yml");
  writeFileSync(p, yaml);
  return p;
}

function setExisting(names: string[]): void {
  writeFileSync(responses, `label list\t${JSON.stringify(names.map((n) => ({ name: n })))}\n`);
}

function runTool(args: string[], env: Record<string, string> = {}): { status: number; stdout: string; stderr: string; output: string } {
  // Thin wrapper over the shared harness: the suite keeps its name and
  // env shape; the spawn boilerplate lives in one place.
  return runHarness(TOOL, args, { env: { PATH: pathWithStubs(stubDir), DEVENV_REPO: "org/repo", ...env }, cwd: repoRoot });
}

describe("issue-label-create", () => {
  beforeEach(() => {
    stubDir = mkdtempSync(join(tmpdir(), "ilc-stub-"));
    responses = join(stubDir, "responses.tsv");
    repoRoot = mkdtempSync(join(tmpdir(), "ilc-repo-"));
    writeFileSync(responses, "");
    installGhStub();
    process.env.PATH = `${stubDir}:${process.env.PATH ?? ""}`;
  });

  const savedPath = process.env.PATH;
  afterEach(() => {
    rmSync(stubDir, { recursive: true, force: true });
    rmSync(repoRoot, { recursive: true, force: true });
    process.env.PATH = savedPath;
  });

  it("a new label is created with color and description", () => {
    setExisting([]);
    const r = runTool(["area/auth", "--color", "1d76db", "--description", "Auth area"]);
    expect(r.status).toBe(0);
    expect(r.output).toContain("Created label: area/auth");
  });

  it("an existing label is skipped with exit 0 (idempotent)", () => {
    setExisting(["needs-triage"]);
    const r = runTool(["needs-triage", "--color", "ededed"]);
    expect(r.status).toBe(0);
    expect(r.output).toContain("Label already exists (skipped)");
  });

  it("--update on an existing label updates instead of skipping", () => {
    setExisting(["needs-triage"]);
    const r = runTool(["needs-triage", "--color", "0e8a16", "--update"]);
    expect(r.status).toBe(0);
    expect(r.output).toContain("Updated label: needs-triage");
  });

  it("dry-run previews the create without writing", () => {
    setExisting([]);
    const r = runTool(["preview-me", "--dry-run"]);
    expect(r.status).toBe(0);
    expect(r.output).toContain("[DRY RUN] Would create label: preview-me");
  });

  it("dry-run previews the update for an existing label with --update", () => {
    setExisting(["exists"]);
    const r = runTool(["exists", "--color", "abc123", "--update", "--dry-run"]);
    expect(r.status).toBe(0);
    expect(r.output).toContain("[DRY RUN] Would update label: exists");
  });

  it("a malformed color is refused (6-digit hex, no #)", () => {
    expect(runTool(["x", "--color", "#ff0000"]).status).toBe(2);
    expect(runTool(["x", "--color", "zzz111"]).status).toBe(2);
  });

  it("no NAME and no --seed is a misuse failure", () => {
    expect(runTool([]).status).toBe(2);
  });

  it("an unknown flag exits 2", () => {
    expect(runTool(["x", "--bogus"]).status).toBe(2);
  });

  const SEED = [
    "labels:",
    "  - name: alpha",
    '    color: "ededed"',
    '    description: "First"',
    "  - name: Beta",
    '    color: "0e8a16"',
    "  - name: gamma",
    "",
  ].join("\n");

  it("--seed lists the existing labels once and compares names case-insensitively", () => {
    setExisting(["alpha", "beta"]);
    const r = runTool(["--seed"], { LABELS_CONFIG: useSeedConfig(SEED) });
    expect(r.status).toBe(0);
    expect(ghCalls().filter((c) => c.includes("label list"))).toHaveLength(1);
    const creates = ghCalls().filter((c) => c.includes("label create"));
    expect(creates).toHaveLength(1);
    expect(creates[0]).toContain("gamma");
    expect(r.output).toContain("Label already exists (skipped): Beta");
  });

  it("--seed refuses a malformed entry before creating anything", () => {
    setExisting([]);
    const bad = SEED.replace('"0e8a16"', '"#zzz"');
    const r = runTool(["--seed"], { LABELS_CONFIG: useSeedConfig(bad) });
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("Invalid color");
    expect(r.stderr).toContain("Beta");
    expect(ghCalls().filter((c) => c.includes("label create"))).toEqual([]);
  });

  it("--seed keeps going after one label fails and reports the failure at the end", () => {
    setExisting([]);
    const cfg = SEED.replace("name: alpha", "name: FAILME");
    const r = runTool(["--seed"], { LABELS_CONFIG: useSeedConfig(cfg) });
    expect(r.status).toBe(1);
    expect(ghCalls().filter((c) => c.includes("label create"))).toHaveLength(3);
    expect(r.output).toContain("Seed finished with 1 failure");
  });

  it("--seed without a labels list is a named failure", () => {
    const r = runTool(["--seed"], { LABELS_CONFIG: useSeedConfig("other: 1\n") });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("No labels defined");
  });
});
