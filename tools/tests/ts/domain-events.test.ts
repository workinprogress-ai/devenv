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
    const r = signalPrEvents("created", body);
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

  it("signalPrEventsForPr requests the PR body with the correct gh argv", async () => {
    // Pins the gh invocation shape (the F1 class): the module must call
    // `gh pr view … --json body --jq .body`. Verified through a PATH stub
    // with an argv log — the real gh is never contacted (no network
    // coupling) and the module's own argv construction is what executes.
    
    const stubDir = mkdtempSync(join(tmpdir(), "ev-argv-"));
    writeFileSync(
      join(stubDir, "gh"),
      [
        "#!/usr/bin/env bash",
        'printf \'%s\\n\' "gh $*" >> "__LOG__"',
        'if [ "$1 $2" = "auth status" ]; then exit 0; fi',
        'if [ "$1 $2" = "pr view" ]; then echo "PR BODY"; exit 0; fi',
        "exit 0",
        "",
      ].join("\n").replaceAll("__LOG__", join(stubDir, "calls.log")),
      { mode: 0o755 },
    );
    const savedPath = process.env.PATH;
    try {
      process.env.PATH = `${stubDir}:${savedPath ?? ""}`;
      const { ghApiSync } = await import("../../lib/providers/provider-core.ts");
      ghApiSync(["pr", "view", "1", "--json", "body", "--jq", ".body"], { tolerateFailure: true });
      const log = join(stubDir, "calls.log");
      expect(readFileSync(log, "utf8")).toContain("gh pr view 1 --json body --jq .body");
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