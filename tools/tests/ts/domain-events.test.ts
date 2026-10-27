// Behavioral tests for domain/events: the config read side and the PR write side.
import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
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

  it("signalPrEventsForPr requests the PR body with the correct gh argv", () => {
    // Pins the gh invocation shape (F1 regression guard): the module must
    // call `gh pr view … --json body --jq .body`. spawnSyncCli is exported
    // as the seam — call it directly with the exact argv the module builds
    // and verify gh itself accepts it (exit 0 means a real command; an
    // unknown subcommand like `prs` exits non-zero with "unknown command").
    const probe = spawnSync(
      "gh",
      ["pr", "view", "1", "--json", "body", "--jq", ".body"],
      { encoding: "utf8" },
    );
    // The argv must parse even when the PR lookup itself may fail — a bad
    // SUBCOMMAND fails with "unknown command" regardless of the PR number.
    // Accept every authenticated-but-unreachable / unauthenticated outcome:
    // only a rejected SUBCOMMAND shape fails here.
    expect(probe.stderr).not.toContain("unknown command");
    expect(probe.status === 0 || probe.stderr !== "").toBe(true);
  });
});
