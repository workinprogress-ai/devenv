// lint-scripts scope tests (port of test_lint_scripts_scope.bats): which
// files get shellchecked — top-level infra scripts under repos/ are included;
// repository clones beneath it (other people's code) are not; scratch and
// vendored trees are excluded; extensionless shebang scripts are included.
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const TOOL = join(__dirname, "../../ts/lint-scripts.ts");

// Not under /tmp: lint-scripts excludes any */tmp/* path by design.
let scopeRoot = "";

function runLint(): { status: number; out: string } {
  const r = spawnSync("node", [TOOL, "--no-color", "-d", scopeRoot], {
    encoding: "utf8",
    env: { ...process.env, PROJECT_ROOT: scopeRoot },
  });
  return { status: r.status ?? 1, out: (r.stdout ?? "") + (r.stderr ?? "") };
}

function write(p: string, content: string): void {
  const full = join(scopeRoot, p);
  mkdirSync(join(full, ".."), { recursive: true });
  writeFileSync(full, content);
}

function cleanScript(): void {
  // An unguarded cd is a shellcheck *warning* (SC2164) — the default lint
  // severity, so this file fails the default run.
  write("repos/top-level.sh", "#!/bin/bash\ncd /nonexistent-dir\necho done\n");
  write("repos/some-clone/scripts/inner.sh", "#!/bin/bash\ncd /nonexistent-dir\necho done\n");
  write("tools/clean.sh", "#!/bin/bash\necho ok\n");
}

beforeEach(() => {
  scopeRoot = join(process.cwd(), ".local-artifacts", `lint-scope-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  rmSync(scopeRoot, { recursive: true, force: true });
  mkdirSync(scopeRoot, { recursive: true });
  cleanScript();
});

afterEach(() => {
  rmSync(scopeRoot, { recursive: true, force: true });
});

describe("lint-scripts scope", () => {
  it("lint-scripts shellchecks a top-level script under repos/", () => {
    expect(runLint().out).toContain("repos/top-level.sh");
  });

  it("a lint failure in a top-level repos/ script fails the run", () => {
    expect(runLint().status).not.toBe(0);
  });

  it("lint-scripts does not descend into a repository clone under repos/", () => {
    expect(runLint().out).not.toContain("some-clone/scripts/inner.sh");
  });

  it("with a clean top-level repos/ script and a dirty clone, the run passes", () => {
    write("repos/top-level.sh", "#!/bin/bash\necho fine\n");
    const r = runLint();
    expect(r.status).toBe(0);
    expect(r.out).toContain("repos/top-level.sh");
  });

  it("lint-scripts does not descend into .local-artifacts (local scratch, never committed)", () => {
    write(".local-artifacts/work/scratch.sh", "#!/bin/bash\ncd /nonexistent-dir\n");
    write("tools/sub/.local-artifacts/nested.sh", "#!/bin/bash\ncd /nonexistent-dir\n");
    write(".local-artifacts/extensionless", "#!/bin/bash\ncd /nonexistent-dir\n");
    const r = runLint();
    expect(r.out).not.toContain("scratch.sh");
    expect(r.out).not.toContain("nested.sh");
    expect(r.out).not.toContain(".local-artifacts/extensionless");
  });

  it("lint-scripts does not descend into .pnpm-store (pnpm package store, vendored scripts)", () => {
    write(".pnpm-store/v10/files/08/vendor.sh", "#!/bin/bash\ncd /nonexistent-dir\n");
    write(".pnpm-store/v10/files/08/runner-exec", "#!/usr/bin/env sh\ncd /nonexistent-dir\n");
    // pnpm ships PowerShell launchers with this exact shebang shape; a pwsh
    // shebang also matches the extensionless scanner's '^#!.*sh' grep, so the
    // store exclusion is what keeps it out — not shebang detection.
    write(".pnpm-store/v10/files/08/pwsh-launcher", "#!/usr/bin/env pwsh\nif (-not (Test-Path $NODE_EXE)) { exit 1 }\n");
    write("repos/top-level.sh", "#!/bin/bash\necho fine\n");
    const r = runLint();
    expect(r.status).toBe(0);
    expect(r.out).not.toContain("vendor.sh");
    expect(r.out).not.toContain("runner-exec");
    expect(r.out).not.toContain("pwsh-launcher");
  });

  it("--no-color works (it used to abort assigning to readonly colour variables)", () => {
    const r = runLint();
    expect(r.out).not.toContain("readonly variable");
    expect(r.out).not.toContain("\u001B[");
  });

  it("lint-scripts shellchecks an extensionless script that has a shell shebang", () => {
    // Extensionless scripts (tools/scripts/git-*, the root setup) carry a
    // shell shebang instead of a .sh suffix; those are shellchecked too, and
    // a file with no shell shebang is not.
    write("tools/git-thing", "#!/bin/bash\ncd /nonexistent-dir\necho done\n");
    const r = runLint();
    expect(r.out).toContain("tools/git-thing");
    expect(r.status).not.toBe(0);
  });

  it("an extensionless script with an env-style shell shebang is shellchecked", () => {
    write("setup", "#!/usr/bin/env bash\ncd /nonexistent-dir\n");
    const r = runLint();
    expect(r.out).toContain("setup");
    expect(r.status).not.toBe(0);
  });

  it("an extensionless file without a shell shebang is left alone", () => {
    write("tools/NOTES", "just some notes\ncd /nonexistent-dir\n");
    write("tools/pytool", "#!/usr/bin/env python3\nprint(1)\n");
    write("repos/top-level.sh", "#!/bin/bash\necho fine\n");
    const r = runLint();
    expect(r.status).toBe(0);
    expect(r.out).not.toContain("tools/NOTES");
    expect(r.out).not.toContain("tools/pytool");
  });
});
