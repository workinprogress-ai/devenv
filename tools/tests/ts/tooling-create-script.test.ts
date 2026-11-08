// tooling-create-script generation test — locks the F020 gap's permanent
// closure: a generated tool is born on the shared libs (toolCli + house
// flags), its imports resolve from the output directory, and it executes
// (syntax + --help + -v) without any manual fixing.
import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))));
const GENERATOR = join(ROOT, "tools", "ts", "tooling-create-script.ts");
const TEMPLATE = join(ROOT, "tools", "templates", "script-template.ts");

function runNode(args: string[], opts?: { cwd?: string }): { status: number; out: string } {
  const r = spawnSync("node", args, { encoding: "utf8", cwd: opts?.cwd, input: "" });
  return { status: r.status ?? 1, out: (r.stdout ?? "") + (r.stderr ?? "") };
}

describe("tooling-create-script generation", () => {
  it("the TS template is the only template (bash lane deleted)", () => {
    expect(existsSync(TEMPLATE)).toBe(true);
    expect(existsSync(join(ROOT, "tools", "templates", "script-template.sh"))).toBe(false);
  });

  it("the template carries the house scaffold (toolCli + usageCommonFlags)", () => {
    const src = spawnSync("cat", [TEMPLATE], { encoding: "utf8" }).stdout ?? "";
    expect(src).toContain("toolCli");
    expect(src).toContain("usageCommonFlags");
    // The substitution placeholder replaces DEVENV_TOOLS at generation time;
    // no unresolved placeholder may remain in the template's own imports.
    expect(src).not.toContain("DEVENV_TOOLS/lib");
  });

  it("generates a runnable tool: imports resolve, --help renders house flags, -v exits 0", () => {
    const dir = mkdtempSync(join(tmpdir(), "tcs-gen-"));
    try {
      // Generate into a directory INSIDE this checkout so the computed
      // relative import is representative of real use (not a /tmp escape).
      const outDir = join(ROOT, "tmp", "gen-test-fixture");
      rmSync(outDir, { recursive: true, force: true });
      const gen = runNode([GENERATOR, "-d", outDir, "sample-generated-tool"]);
      expect(gen.status, gen.out).toBe(0);
      const outFile = join(outDir, "sample-generated-tool.ts");
      expect(existsSync(outFile)).toBe(true);

      const content = spawnSync("cat", [outFile], { encoding: "utf8" }).stdout ?? "";
      // Born on the libs: toolCli scaffold present, placeholder resolved.
      expect(content).toContain("toolCli({");
      expect(content).not.toContain("REL_LIB");
      expect(content).toMatch(/from "[./]+(?:tools\/)?lib\/core\/cli\.ts"/);

      // Syntax: node itself accepts the file.
      expect(runNode(["--check", outFile]).status).toBe(0);

      // Behavior: --help renders the house block; -v prints the version.
      const help = runNode([outFile, "--help"]);
      expect(help.status).toBe(0);
      expect(help.out).toContain("-h, --help");
      expect(help.out).toContain("-v, --version");
      expect(help.out).toContain("-V, --verbose");
      const version = runNode([outFile, "-v"]);
      expect(version.status).toBe(0);
      expect(version.out.trim()).toBe("1.0.0");

      rmSync(outDir, { recursive: true, force: true });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("unknown options exit 2 with the house usage hint", () => {
    const outDir = join(ROOT, "tmp", "gen-test-fixture2");
    rmSync(outDir, { recursive: true, force: true });
    const gen = runNode([GENERATOR, "-d", outDir, "opt-probe-tool"]);
    expect(gen.status).toBe(0);
    const outFile = join(outDir, "opt-probe-tool.ts");
    const r = runNode([outFile, "--definitely-not-a-flag"]);
    expect(r.status).toBe(2);
    expect(r.out).toContain("Use --help for usage information");
    rmSync(outDir, { recursive: true, force: true });
  });

  it("--lang is gone: the flag errors instead of selecting a template", () => {
    const dir = mkdtempSync(join(tmpdir(), "tcs-lang-"));
    const r = runNode([GENERATOR, "-d", dir, "x", "--lang", "bash"]);
    expect(r.status).not.toBe(0);
    rmSync(dir, { recursive: true, force: true });
  });
});
