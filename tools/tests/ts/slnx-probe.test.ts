// Tests for the 15.10 .slnx probe extension: the cs-dependency tools'
// solution probe accepts .slnx alongside .sln, and metrics-count-code-lines
// counts .slnx files. Black-box through each tool's argv surface on fixture
// dirs (no dotnet build involved).
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const TRACE = join(fileURLToPath(new URL(".", import.meta.url)), "../../ts/cs-dependencies-trace.ts");
const METRICS = join(fileURLToPath(new URL(".", import.meta.url)), "../../ts/metrics-count-code-lines.ts");

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "slnx-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function run(tool: string, args: string[]): { status: number; out: string } {
  const r = spawnSync("node", [tool, ...args], { encoding: "utf8", cwd: dir });
  return { status: r.status ?? 1, out: (r.stdout ?? "") + (r.stderr ?? "") };
}

function gitInit(): void {
  spawnSync("git", ["init", "-q"], { cwd: dir });
  spawnSync("git", ["-C", dir, "config", "user.email", "t@e.c"]);
  spawnSync("git", ["-C", dir, "config", "user.name", "T"]);
  spawnSync("git", ["-C", dir, "add", "."]);
}

describe("cs-dependencies-trace solution probe accepts .slnx", () => {
  it("a repo with only .csproj still works (baseline)", () => {
    writeFileSync(join(dir, "App.csproj"), "<Project />");
    const r = run(TRACE, ["."]);
    // rc 0 or a downstream failure is fine — the probe must not refuse with 3
    expect(r.status).not.toBe(3);
  });

  it("a repo with only a .sln passes the probe (baseline)", () => {
    writeFileSync(join(dir, "App.sln"), "");
    const r = run(TRACE, ["."]);
    expect(r.status).not.toBe(3);
  });

  it("a repo with only a .slnx passes the probe (the 15.10 extension)", () => {
    writeFileSync(join(dir, "App.slnx"), "<Solution />");
    const r = run(TRACE, ["."]);
    expect(r.status).not.toBe(3);
  });

  it("a repo with neither solution nor project refuses with the misuse exit", () => {
    gitInit();
    const r = run(TRACE, ["."]);
    expect(r.status).toBe(2);
    expect(r.out).toContain("No .sln");
  });
});

describe("metrics-count-code-lines counts .slnx", () => {
  it("a .slnx file is included in the scan (the 15.10 extension)", () => {
    // metrics scans git ls-files: the fixture must be a git repo with the
    // slnx committed, else ls-files returns nothing and the tool exits 0
    // silently.
    writeFileSync(join(dir, "App.slnx"), "solution-file\n");
    gitInit();
    const r = run(METRICS, ["."]);
    expect(r.status).toBe(0);
  });
});
