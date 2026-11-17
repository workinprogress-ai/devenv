// spec-dependency-check: dependency line forms, numeric group comparison and
// duplicate ids (the original bats port lives in final-bats-row.test.ts).
import { afterAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runTool } from "./harness/index.ts";

const dir = mkdtempSync(join(tmpdir(), "specdep-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

function check(name: string, ...lines: string[]): { status: number; out: { errors: { type: string; detail: string }[]; edges: number; ok: boolean } } {
  const f = join(dir, name);
  writeFileSync(f, lines.join("\n") + "\n");
  const r = runTool("spec-dependency-check", [f]);
  return { status: r.status, out: JSON.parse(r.stdout.trim().split("\n").pop() as string) };
}

describe("spec-dependency-check", () => {
  it("parses the bold Dependencies line of the specifications template", () => {
    const r = check("bold.md", "#### SPEC-001: A", "**Dependencies:** None", "#### SPEC-002: B", "**Dependencies:** [SPEC-001](#spec-001-a)");
    expect(r.status).toBe(0);
    expect(r.out.edges).toBe(1);
    expect(r.out.errors).toEqual([]);
  });

  it("flags a missing target on a bold Dependencies line", () => {
    const r = check("bold-unknown.md", "#### SPEC-001: A", "**Dependencies:** [SPEC-099](#spec-099)");
    expect(r.status).toBe(1);
    expect(r.out.errors[0]?.type).toBe("unknown");
  });

  it("accepts the documented Depends on: line", () => {
    const r = check("dependson.md", "## SPEC-001", "Depends on: SPEC-002", "## SPEC-002");
    expect(r.status).toBe(0);
    expect(r.out.edges).toBe(1);
  });

  it("treats None as no dependency and ignores a cross-doc file suffix", () => {
    const r = check("none.md", "## SPEC-001", "Dependencies: None", "## SPEC-002", "Dependencies: SPEC-001 (Specifications-x-001.md)");
    expect(r.status).toBe(0);
    expect(r.out.edges).toBe(1);
  });

  it("compares groups numerically (P10 is later than P2)", () => {
    const ok = check("group-num-ok.md", "## SPEC-001", "Group: P10", "Dependencies: SPEC-002", "## SPEC-002", "Group: P2");
    expect(ok.status).toBe(0);
    const bad = check("group-num-bad.md", "## SPEC-001", "Group: P2", "Dependencies: SPEC-002", "## SPEC-002", "Group: P10");
    expect(bad.status).toBe(1);
    expect(bad.out.errors[0]?.type).toBe("group-order");
  });

  it("reports a SPEC id defined twice", () => {
    const r = check("dup.md", "## SPEC-001: A", "## SPEC-001: B");
    expect(r.status).toBe(1);
    expect(r.out.errors.map((e) => e.type)).toContain("duplicate");
  });
});
