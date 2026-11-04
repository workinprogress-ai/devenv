// Port of tools/tests/scripts/test_roadmap_parse.bats (7 tests).
// roadmap-parse: step extraction (phase/title/status), issue-ref
// canonicalization to org/repo#N, UNRESOLVED flagging, dependency capture,
// exit contracts.
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const ROOT = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))));
const TOOLS = join(ROOT, "tools");

let TMP = "";
let ROADMAP = "";

const ROADMAP_MD = [
  "# Roadmap: Test System",
  "",
  "## Phases",
  "",
  "### PHASE-01: Foundation",
  "",
  "## Steps",
  "",
  "### STEP-01: Build the thing",
  "",
  "**Status**: 🟡 In progress — 3/10 tasks (30%)",
  "**Issues**: workinprogress-ai/service.foo#101",
  "**Component**: `service.foo`",
  "**Depends on**: None",
  "",
  "<One paragraph.>",
  "",
  "---",
  "",
  "### STEP-02: Add events",
  "",
  "**Status**: ⬜ Not started",
  "**Issues**: workinprogress-ai/service.foo#102",
  "service.bar#205",
  "#999",
  "**Component**: `service.bar`",
  "**Depends on**: [STEP-01](#step-01-build-the-thing)",
  "",
  "<One paragraph.>",
  "",
].join("\n");

beforeEach(() => {
  TMP = mkdtempSync(join(tmpdir(), `rmupdate-${Date.now()}-${Math.random().toString(36).slice(2)}`));
  ROADMAP = join(TMP, "roadmap.md");
  writeFileSync(ROADMAP, ROADMAP_MD);
});

afterEach(() => {
  rmSync(TMP, { recursive: true, force: true });
});

function parse(args: string[]): { status: number; out: string } {
  const r = spawnSync(join(TOOLS, "roadmap-parse"), args, { encoding: "utf8" });
  return { status: r.status ?? 1, out: (r.stdout ?? "") + (r.stderr ?? "") };
}

function jqOut(json: string, args: string[]): string {
  return (spawnSync("jq", args, { input: json, encoding: "utf8" }).stdout ?? "").trim();
}

describe("scripts/roadmap-parse", () => {
  it("parses steps with phase, title, status", () => {
    const r = parse([ROADMAP, "--org", "workinprogress-ai"]);
    expect(r.status).toBe(0);
    expect(jqOut(r.out, ["-r", "[.steps[].step] | join(\",\")"])).toBe("STEP-01,STEP-02");
    expect(jqOut(r.out, ["-r", "[.steps[].phase] | unique | join(\",\")"])).toBe("PHASE-01");
    expect(jqOut(r.out, ["-r", ".steps[1].title"])).toBe("Add events");
  });

  it("canonicalizes bare #N and repo#N refs to org/repo#N", () => {
    const r = parse([ROADMAP, "--org", "workinprogress-ai"]);
    expect(r.status).toBe(0);
    expect(r.out).toContain('"workinprogress-ai/service.foo#101"');
    expect(r.out).toContain('"workinprogress-ai/service.foo#102"');
    expect(r.out).toContain('"workinprogress-ai/service.bar#205"');
  });

  it("bare #N without --repo is flagged UNRESOLVED", () => {
    const r = parse([ROADMAP, "--org", "workinprogress-ai"]);
    expect(r.status).toBe(0);
    expect(r.out).toContain("UNRESOLVED:#999");
  });

  it("STEP-02 extracts both issues and the STEP-01 dependency", () => {
    const r = parse([ROADMAP, "--org", "workinprogress-ai"]);
    expect(r.status).toBe(0);
    const step2 = jqOut(r.out, ["-c", '.steps[] | select(.step == "STEP-02")']);
    expect(jqOut(step2, ["-r", ".issues | length"])).toBe("3");
    expect(jqOut(step2, ["-r", ".dependencies[0]"])).toBe("STEP-01");
  });

  it("STEP-01 status is preserved from the artifact", () => {
    const r = parse([ROADMAP, "--org", "workinprogress-ai"]);
    expect(r.status).toBe(0);
    const step1 = jqOut(r.out, ["-c", '.steps[] | select(.step == "STEP-01")']);
    expect(jqOut(step1, ["-r", ".status"])).toContain("In progress");
  });

  it("missing roadmap file exits 2 (canonical invalid-args contract)", () => {
    const r = parse([join(TMP, "nope.md")]);
    expect(r.status).toBe(2);
  });

  it("--help describes pass-through status, not a precedence engine it does not have", () => {
    const r = parse(["--help"]);
    expect(r.status).toBe(0);
    expect(r.out).not.toContain("Status precedence");
    expect(r.out).toContain("as written");
    expect(r.out).toContain("does not compute");
  });
});
