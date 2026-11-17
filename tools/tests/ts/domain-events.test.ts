import { tmpdir } from "node:os";
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { join } from "node:path";
// Behavioral tests for domain/events: the config read side and the PR write side.
import { describe, expect, it } from "vitest";
import {
  eventStatusFor,
  eventNames,
  prEventFor,
  parseLinkedIssues,
  signalPrEvents,
} from "../../lib/domain/events.ts";
import { pathWithStubs, stubGh } from "./harness/index.ts";

describe("read side (config)", () => {
  it("reads the Status token for a configured event", () => {
    // The shipped config carries the standard lifecycle events.
    const status = eventStatusFor("_on_begin_planning");
    expect(status).not.toBeNull();
    expect(status).toMatch(/^[A-Za-z-]+$/); // hyphenated single token
  });

  it("returns null for an unknown event (warn-and-continue contract)", () => {
    expect(eventStatusFor("_on_definitely_not_an_event")).toBeNull();
  });

  it("lists configured event names", () => {
    const names = eventNames();
    expect(names.length).toBeGreaterThan(3);
    expect(names).toContain("_on_merge");
    // no nested keys leaked in
    expect(names.every((n) => !n.includes("status"))).toBe(true);
  });
});

describe("write side (PR signals)", () => {
  it("maps lifecycle points to events", () => {
    expect(prEventFor("created")).toBe("_on_begin_review");
    expect(prEventFor("merged")).toBe("_on_merge");
  });

  it("parses closing keywords into deduplicated issue numbers", () => {
    const body = [
      "Does the thing.",
      "",
      "Closes #1",
      "fixed #2 and Fixes: #2 (dup)",
      "resolves #3",
      "no key: #4",
    ].join("\n");
    expect(parseLinkedIssues(body)).toEqual(["1", "2", "3"]);
  });

  it("caps parsed issues at 10", () => {
    const body = Array.from({ length: 15 }, (_, i) => `Closes #${i + 1}`).join("\n");
    expect(parseLinkedIssues(body).length).toBe(10);
  });

  it("signalPrEvents is best-effort: a body with no issues fires nothing", () => {
    const r = signalPrEvents("created", "no linked issues here");
    expect(r.fired).toEqual([]);
    expect(r.warnings).toEqual([]);
  });

  it("signalPrEvents fires per linked issue; failures land in warnings", () => {
    // The _on_* scripts are real; firing against arbitrary issue numbers in
    // this repo is best-effort — outcomes vary with provider auth. The
    // contract under test: never throws, per-issue outcomes classified.
    const body = "Closes #999999999";
    // The event write now reaches the provider, so gh is a stub: the real
    // scripts run, no backend is contacted.
    const ghDir = mkdtempSync(join(tmpdir(), "ev-signal-gh-"));
    const savedEnv = { PATH: process.env.PATH, DEVENV_REPO: process.env.DEVENV_REPO };
    let r: ReturnType<typeof signalPrEvents>;
    try {
      stubGh(ghDir);
      process.env.PATH = pathWithStubs(ghDir);
      process.env.DEVENV_REPO = "org/repo";
      r = signalPrEvents("created", body);
    } finally {
      process.env.PATH = savedEnv.PATH;
      if (savedEnv.DEVENV_REPO === undefined) delete process.env.DEVENV_REPO;
      else process.env.DEVENV_REPO = savedEnv.DEVENV_REPO;
      rmSync(ghDir, { recursive: true, force: true });
    }
    expect(r.fired.length + r.warnings.length).toBe(1);
    // Sharpened: a fired outcome must be a genuine success (the real script
    // exits 0 only on a real signal); a warning must carry the issue number
    // so a silent-success regression cannot masquerade as correct failure.
    if (r.warnings.length === 1) {
      expect(r.warnings[0]).toContain("#999999999");
    } else {
      expect(r.fired[0]?.issue).toBe("999999999");
    }
  });

  it("signalPrEventsForPr requests the PR body through the provider facade", async () => {
    // Verified through a PATH stub with an argv log: the real gh is never
    // contacted, and the module's own call path is what executes. The body
    // links no issue, so no signal script runs.
    
    const stubDir = mkdtempSync(join(tmpdir(), "ev-argv-"));
    writeFileSync(
      join(stubDir, "gh"),
      [
        "#!/usr/bin/env bash",
        'printf \'%s\\n\' "gh $*" >> "__LOG__"',
        'if [ "$1 $2" = "auth status" ]; then exit 0; fi',
        'if [ "$1 $2" = "pr view" ]; then echo \'{"body":"no linked issues"}\'; exit 0; fi',
        "exit 0",
        "",
      ].join("\n").replaceAll("__LOG__", join(stubDir, "calls.log")),
      { mode: 0o755 },
    );
    const savedPath = process.env.PATH;
    try {
      process.env.PATH = `${stubDir}:${savedPath ?? ""}`;
      const { signalPrEventsForPr } = await import("../../lib/domain/events.ts");
      const r = await signalPrEventsForPr("created", "1", "org/repo");
      expect(r.fired).toEqual([]);
      const log = join(stubDir, "calls.log");
      expect(readFileSync(log, "utf8")).toContain("gh pr view 1 --json body -R org/repo");
    } finally {
      process.env.PATH = savedPath;
      rmSync(stubDir, { recursive: true, force: true });
    }
  });

});
// ---------------------------------------------------------------------------
// 15.104: config paths resolve to files that EXIST on disk, from a foreign
// cwd (the file:// URL pass-through used to resolve via the cwd walk and
// adopt the wrong checkout or throw outside devenv).
// ---------------------------------------------------------------------------

describe("skillEventsConfigPath real-path contract", () => {
  it("resolves a path that exists on disk from a foreign cwd", async () => {
    const { chdir } = await import("node:process");
    const { existsSync } = await import("node:fs");
    const savedCwd = process.cwd();
    try {
      // A cwd with no devenv shape above it: the old cwd-walk resolution
      // throws here; the file://-correct path resolves the real checkout.
      chdir("/tmp");
      const { skillEventsConfigPath } = await import("../../lib/domain/events.ts");
      const p = skillEventsConfigPath();
      expect(existsSync(p)).toBe(true);
      expect(p).toContain("config/skill-events.yml");
    } finally {
      chdir(savedCwd);
    }
  });
});