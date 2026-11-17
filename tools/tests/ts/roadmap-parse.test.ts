// roadmap-parse: step extraction (phase/title/status), issue-ref
// canonicalization to org/repo#N, UNRESOLVED flagging, dependency capture,
// exit contracts.
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { toolScript, runTool } from "./harness/index.ts";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });


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
  const r = spawnSync("node", [toolScript("roadmap-parse"), ...args], { encoding: "utf8" });
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

// A DEVENV_ROOT whose config names a provider but no organisation, with no seed file.
function noOrgEnv(): Record<string, string> {
  const root = join(TMP, "noorg-root");
  mkdirSync(root, { recursive: true });
  writeFileSync(join(root, "devenv.config"), "[provider]\nname=github\n");
  return { DEVENV_ROOT: root };
}

function writeRoadmap(name: string, text: string): string {
  const f = join(TMP, name);
  writeFileSync(f, text);
  return f;
}

describe("scripts/roadmap-parse line endings", () => {
  it("parses a CRLF roadmap identically to its LF twin", () => {
    const crlf = writeRoadmap("crlf.md", ROADMAP_MD.replace(/\n/g, "\r\n"));
    const lf = parse([ROADMAP, "--org", "acme"]);
    const cr = parse([crlf, "--org", "acme"]);
    expect(cr.status).toBe(0);
    const norm = (o: string, f: string) => JSON.parse(o.replace(f, "FILE"));
    expect(norm(cr.out, crlf)).toEqual(norm(lf.out, ROADMAP));
    expect(jqOut(cr.out, ["-r", ".steps[0].phase"])).toBe("PHASE-01");
  });

  it("ends a CRLF step body at a --- separator", () => {
    const text = [
      "### PHASE-01: Foundation",
      "### STEP-01: First",
      "**Status**: Done",
      "---",
      "**Depends on**: STEP-09",
      "### STEP-02: Second",
      "**Status**: Open",
      "",
    ].join("\r\n");
    const f = writeRoadmap("sep.md", text);
    const r = parse([f, "--org", "acme"]);
    expect(r.status).toBe(0);
    expect(jqOut(r.out, ["-c", ".steps[0].dependencies"])).toBe("[]");
    expect(jqOut(r.out, ["-r", ".steps[1].status"])).toBe("Open");
  });
});

describe("scripts/roadmap-parse organisation resolution", () => {
  it("refuses a repo#N ref with exit 2 naming --org when no organisation resolves", () => {
    const f = writeRoadmap("rel.md", "### STEP-01: A\n**Issues**: service.bar#205\n");
    const r = runTool("roadmap-parse", [f], { env: noOrgEnv() });
    expect(r.status).toBe(2);
    expect(r.output).toContain("--org");
    const ok = runTool("roadmap-parse", [f, "--org", "acme"], { env: noOrgEnv() });
    expect(ok.status).toBe(0);
    expect(ok.stdout).toContain('"acme/service.bar#205"');
  });

  it("refuses a bare #N ref with --repo when no organisation resolves", () => {
    const f = writeRoadmap("bare-repo.md", "### STEP-01: A\n**Issues**: #7\n");
    const r = runTool("roadmap-parse", [f, "--repo", "svc"], { env: noOrgEnv() });
    expect(r.status).toBe(2);
    expect(r.output).toContain("--org");
  });

  it("parses a bare #N ref without --repo as UNRESOLVED even with no organisation", () => {
    const f = writeRoadmap("bare.md", "### STEP-01: A\n**Issues**: #7\n");
    const r = runTool("roadmap-parse", [f], { env: noOrgEnv() });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("UNRESOLVED:#7");
  });

  it("resolves repo#N through the first canonical org reference in the file", () => {
    const f = writeRoadmap(
      "canon.md",
      "### STEP-01: A\n**Issues**: acme/service#1\n### STEP-02: B\n**Issues**: other#2\n",
    );
    const r = runTool("roadmap-parse", [f], { env: noOrgEnv() });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('"acme/other#2"');
  });
});
