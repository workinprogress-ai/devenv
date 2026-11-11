// lint-documentation: the verdict covers both markdownlint and the relative
// link check; explicit paths are normalised; tools/** markdown is in scope.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

vi.setConfig({ testTimeout: 120_000, hookTimeout: 60_000 });

const ROOT = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))));
const SCRIPT = join(ROOT, "tools", "ts", "lint-documentation.ts");

let repo = "";

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), "lintdoc-"));
  spawnSync("git", ["init", "-q", repo]);
});

afterEach(() => rmSync(repo, { recursive: true, force: true }));

function write(name: string, content: string): void {
  const f = join(repo, name);
  mkdirSync(dirname(f), { recursive: true });
  writeFileSync(f, content);
}

function run(cwd: string, args: string[]): { status: number; out: string } {
  const r = spawnSync("node", [SCRIPT, ...args], { cwd, encoding: "utf8" });
  return { status: r.status ?? 1, out: (r.stdout ?? "") + (r.stderr ?? "") };
}

describe("lint-documentation", () => {
  it("a clean file passes", () => {
    write("a.md", "# A\n\ntext\n");
    expect(run(repo, ["a.md"]).status).toBe(0);
  });

  it("a broken link fails and no success banner is printed first", () => {
    write("a.md", "# A\n\nsee [x](missing.md)\n");
    const r = run(repo, ["a.md"]);
    expect(r.status).toBe(1);
    expect(r.out).toContain("BROKEN LINK");
    expect(r.out).not.toContain("completed successfully");
  });

  it("a markdownlint failure still runs the link check and reports both", () => {
    write("a.md", "text before heading\n\n# A\n");
    write("b.md", "# B\n\nsee [x](missing.md)\n");
    const r = run(repo, ["a.md", "b.md"]);
    expect(r.status).toBe(1);
    expect(r.out).toContain("MD041");
    expect(r.out).toContain("BROKEN LINK");
  });

  it("external .md URLs are not treated as relative links", () => {
    write("a.md", "# A\n\nsee [x](https://example.com/guide.md)\n");
    const r = run(repo, ["a.md"]);
    expect(r.status).toBe(0);
    expect(r.out).toContain("0 failure(s)");
  });

  it("./relative and absolute paths are normalised", () => {
    write("a.md", "# A\n\ntext\n");
    for (const arg of ["./a.md", join(repo, "a.md")]) {
      const r = run(repo, [arg]);
      expect(r.status).toBe(0);
      expect(r.out).toContain(" - a.md");
    }
  });

  it("devenv root: tools/** markdown is linted, not reported as 'No markdown files'", () => {
    for (const arg of [
      "tools/tests/README.md",
      "./tools/lib/providers/README.md",
      join(ROOT, "tools", "lib", "providers", "CONTRACT.md"),
    ]) {
      const r = run(ROOT, [arg]);
      expect(r.out).not.toContain("No markdown files");
      expect(r.out).toContain("Running markdown linting on:");
    }
  });
});
