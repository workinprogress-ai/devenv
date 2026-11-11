// next-id: in-document and filename modes, with the prefix treated as a literal
// token that must start at an identifier boundary.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const SCRIPT = join(__dirname, "../../ts/next-id.ts");

let dir = "";

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "next-id-"));
});

afterEach(() => rmSync(dir, { recursive: true, force: true }));

function run(args: string[]): { status: number; out: string } {
  const r = spawnSync("node", [SCRIPT, ...args], { encoding: "utf8" });
  return { status: r.status ?? 1, out: (r.stdout ?? "").trim() };
}

function doc(content: string): string {
  const f = join(dir, "doc.md");
  writeFileSync(f, content);
  return f;
}

describe("next-id in-document mode", () => {
  it("finds the next zero-padded id", () => {
    expect(run(["--file", doc("SPEC-001 SPEC-007"), "--prefix", "SPEC-"]).out).toBe("008");
  });

  it("requires a left boundary: MAC-12 does not count as AC-12", () => {
    expect(run(["--file", doc("AC-3 MAC-12"), "--prefix", "AC-"]).out).toBe("4");
  });

  it("a token at the start of a line or after punctuation still counts", () => {
    expect(run(["--file", doc("(AC-5)\nAC-9"), "--prefix", "AC-"]).out).toBe("10");
  });

  it("treats regex metacharacters in the prefix literally", () => {
    const f = doc("AxB-9 A.B-2 C++-4");
    expect(run(["--file", f, "--prefix", "A.B-"]).out).toBe("3");
    expect(run(["--file", f, "--prefix", "C++-"]).out).toBe("5");
  });

  it("escapes every metacharacter, not only plus", () => {
    const f = doc("Q(1)-5 Q1-8 [R]-3 R-7");
    expect(run(["--file", f, "--prefix", "Q(1)-"]).out).toBe("6");
    expect(run(["--file", f, "--prefix", "[R]-"]).out).toBe("4");
  });
});
