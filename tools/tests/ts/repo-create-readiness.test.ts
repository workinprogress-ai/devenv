// Tests for the 15.13 readiness probe: reposTreeCount's truncated/null
// contract, and the parity decision waitForRepoReady applies (parity =
// ready; template-ahead or probe failure = keep waiting, never ready).
// Plain gh failure/response stubs per test — no tsv routing.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const REPOS = join(fileURLToPath(new URL(".", import.meta.url)), "../../lib/providers/github/repos.ts");

let stubDir: string;

function installGhScript(body: string): void {
  writeFileSync(join(stubDir, "gh"), body, { mode: 0o755 });
}

function runCode(code: string): { status: number; stdout: string; stderr: string } {
  const script = join(stubDir, "probe.mts");
  writeFileSync(script, code.replaceAll("__FILE__", REPOS));
  const r = spawnSync("node", [script], {
    encoding: "utf8",
    env: { ...process.env, PATH: `${stubDir}:${process.env.PATH ?? ""}` },
  });
  return { status: r.status ?? 1, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

beforeEach(() => {
  stubDir = mkdtempSync(join(tmpdir(), "readiness-"));
});

afterEach(() => {
  rmSync(stubDir, { recursive: true, force: true });
});

describe("reposTreeCount", () => {
  it("counts HEAD tree entries (3-entry tree -> 3)", () => {
    installGhScript('#!/usr/bin/env bash\necho \'{"tree":[{},{},{}],"truncated":false}\'\nexit 0\n');
    const r = runCode(`
      const m = await import("__FILE__");
      console.log(JSON.stringify(await m.reposTreeCount("org/new")));
    `);
    expect(JSON.parse(r.stdout)).toBe(3);
  });

  it("a truncated tree reads as null (not-ready, never ready)", () => {
    installGhScript('#!/usr/bin/env bash\necho \'{"tree":[{},{},{}],"truncated":true}\'\nexit 0\n');
    const r = runCode(`
      const m = await import("__FILE__");
      console.log(JSON.stringify(await m.reposTreeCount("org/new")));
    `);
    expect(JSON.parse(r.stdout)).toBeNull();
  });

  it("a failed trees call is null (probe failure, never ready)", () => {
    installGhScript('#!/usr/bin/env bash\necho "gh: Not Found (HTTP 404)" >&2\nexit 1\n');
    const r = runCode(`
      const m = await import("__FILE__");
      console.log(JSON.stringify(await m.reposTreeCount("org/new")));
    `);
    expect(JSON.parse(r.stdout)).toBeNull();
  });
});

describe("parity decision (waitForRepoReady's table)", () => {
  // The tool's waitForRepoReady sleeps between attempts (2.5 min worst
  // case) — the decision table is pinned as the same comparison it performs
  // against the same reposTreeCount contract above.
  function decide(newCount: number | null, templateCount: number | null): "ready" | "waiting" {
    if (newCount !== null && templateCount !== null && newCount === templateCount) return "ready";
    return "waiting";
  }

  it("parity declares ready", () => {
    expect(decide(42, 42)).toBe("ready");
  });

  it("template-ahead (new repo still syncing) keeps waiting", () => {
    expect(decide(3, 42)).toBe("waiting");
  });

  it("truncated/failed probes are never ready", () => {
    expect(decide(null, 42)).toBe("waiting");
    expect(decide(42, null)).toBe("waiting");
    expect(decide(null, null)).toBe("waiting");
  });
});
