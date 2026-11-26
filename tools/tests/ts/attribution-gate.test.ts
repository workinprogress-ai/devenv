// attribution-gate: the one call every body-taking tool makes before it posts.
// It logs the instruction-style rejection and tells the caller to stop.
import { afterEach, describe, expect, it, vi } from "vitest";
import { rejectAttribution } from "../../lib/core/attribution-gate.ts";

const TRAILER = "Co-Authored-By: Claude <noreply@anthropic.com>";

function captureStderr(): { text: () => string } {
  const chunks: string[] = [];
  vi.spyOn(process.stderr, "write").mockImplementation((c: string | Uint8Array) => {
    chunks.push(String(c));
    return true;
  });
  return { text: () => chunks.join("") };
}

afterEach(() => vi.restoreAllMocks());

describe("core/attribution-gate", () => {
  it("returns false and logs nothing for a clean body", () => {
    const err = captureStderr();
    expect(rejectAttribution("Fixes the retry loop.\n\nSee `Co-Authored-By` discussion.", "issue body")).toBe(false);
    expect(err.text()).toBe("");
  });

  it("returns true and logs the instruction-style rejection, naming the kind of text and the line", () => {
    const err = captureStderr();
    expect(rejectAttribution(`Summary.\n\n${TRAILER}`, "pull request body")).toBe(true);
    expect(err.text()).toContain("AI attribution is not allowed in a pull request body");
    expect(err.text()).toContain(`line 3: ${TRAILER}`);
    expect(err.text()).toMatch(/Remove these lines/);
  });

  it("passes a body that quotes an example in a fenced block", () => {
    captureStderr();
    expect(rejectAttribution(["Rejects:", "", "```", TRAILER, "```"].join("\n"), "issue comment")).toBe(false);
  });
});
