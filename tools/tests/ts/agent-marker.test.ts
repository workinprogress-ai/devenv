// agent-marker: the grammar for permanent, plan-less accepted limits,
// `AGENT(<kind>): <limit> — upgrade when <trigger>`, recognised only inside
// comment syntax. Only the `shortcut` kind is defined.
import { describe, expect, it } from "vitest";
import { AGENT_MARKER_KINDS, parseAgentMarkers } from "../../lib/core/agent-marker.ts";

describe("core/agent-marker", () => {
  it("defines only the shortcut kind", () => {
    expect([...AGENT_MARKER_KINDS]).toEqual(["shortcut"]);
  });

  describe("accepts a well-formed marker in each comment syntax", () => {
    const body = "O(n^2) scan, fine under 1k rows — upgrade when lists exceed 10k rows";
    const forms: Array<[string, string]> = [
      ["//", `// AGENT(shortcut): ${body}`],
      ["#", `# AGENT(shortcut): ${body}`],
      ["--", `-- AGENT(shortcut): ${body}`],
      ["<!-- -->", `<!-- AGENT(shortcut): ${body} -->`],
    ];
    for (const [name, line] of forms) {
      it(name, () => {
        const r = parseAgentMarkers(line);
        expect(r.malformed).toEqual([]);
        expect(r.markers).toEqual([
          { line: 1, kind: "shortcut", limit: "O(n^2) scan, fine under 1k rows", trigger: "lists exceed 10k rows" },
        ]);
      });
    }
  });

  it("accepts an indented marker and a trailing comment after code", () => {
    const r = parseAgentMarkers(["function f() {", "  // AGENT(shortcut): linear scan — upgrade when n > 1000", "  g(); // AGENT(shortcut): no retry — upgrade when the API flakes", "}"].join("\n"));
    expect(r.malformed).toEqual([]);
    expect(r.markers.map((m) => m.line)).toEqual([2, 3]);
    expect(r.markers[1]).toMatchObject({ limit: "no retry", trigger: "the API flakes" });
  });

  it("accepts a hyphen or en dash before 'upgrade when', case-insensitively", () => {
    for (const sep of ["—", "–", "-", "--"]) {
      const r = parseAgentMarkers(`// AGENT(shortcut): the limit ${sep} Upgrade When the trigger fires`);
      expect(r.malformed, sep).toEqual([]);
      expect(r.markers[0], sep).toMatchObject({ limit: "the limit", trigger: "the trigger fires" });
    }
  });

  it("reports a marker without an 'upgrade when' trigger as malformed", () => {
    for (const line of [
      "// AGENT(shortcut): linear scan only",
      "// AGENT(shortcut): linear scan — upgrade when",
      "// AGENT(shortcut): linear scan — upgrade when   ",
      "<!-- AGENT(shortcut): linear scan — upgrade when -->",
    ]) {
      const r = parseAgentMarkers(line);
      expect(r.markers, line).toEqual([]);
      expect(r.malformed, line).toEqual([{ line: 1, reason: "missing-trigger", text: line.trim() }]);
    }
  });

  it("reports an empty limit as malformed", () => {
    const line = "// AGENT(shortcut): — upgrade when n grows";
    expect(parseAgentMarkers(line).malformed).toEqual([{ line: 1, reason: "empty-limit", text: line }]);
  });

  it("reports an unknown or empty kind as malformed", () => {
    for (const kind of ["debt", "Shortcut", "", "shortcut,debt"]) {
      const line = `// AGENT(${kind}): the limit — upgrade when it hurts`;
      const r = parseAgentMarkers(line);
      expect(r.markers, kind).toEqual([]);
      expect(r.malformed, kind).toEqual([{ line: 1, reason: "unknown-kind", text: line }]);
    }
  });

  it("reports the bare form without parentheses as malformed", () => {
    const line = "// AGENT: the limit — upgrade when it hurts";
    expect(parseAgentMarkers(line).malformed).toEqual([{ line: 1, reason: "unknown-kind", text: line }]);
  });

  describe("is comment-scoped", () => {
    it("ignores marker text in prose, inline code and string literals", () => {
      const text = [
        "Use `// AGENT(shortcut): <limit> — upgrade when <trigger>` for accepted limits.",
        "The AGENT(shortcut): form is described below.",
        'const s = "x"; const t = "AGENT(shortcut): a — upgrade when b";',
        "AGENT(shortcut): a — upgrade when b",
      ].join("\n");
      expect(parseAgentMarkers(text)).toEqual({ markers: [], malformed: [] });
    });

    it("does not treat the plan-scoped TODO:DEVENV marker as an agent marker", () => {
      // Built in two pieces so a scan for plan-scoped markers does not report this fixture.
      const line = `// TODO:DEVENV${"[plan-1]"}: swap provider — remove when #40 lands`;
      expect(parseAgentMarkers(line)).toEqual({ markers: [], malformed: [] });
    });

    it("requires the marker to start the comment text", () => {
      const line = "// see AGENT(shortcut): a — upgrade when b";
      expect(parseAgentMarkers(line)).toEqual({ markers: [], malformed: [] });
    });
  });

  it("numbers lines from 1 across LF and CRLF input and keeps order", () => {
    const text = "a\r\n// AGENT(shortcut): one — upgrade when x\r\n\r\n# AGENT(shortcut): two — upgrade when y\r\n";
    const r = parseAgentMarkers(text);
    expect(r.markers.map((m) => [m.line, m.limit, m.trigger])).toEqual([
      [2, "one", "x"],
      [4, "two", "y"],
    ]);
  });

  it("returns both lists empty for text with no markers", () => {
    expect(parseAgentMarkers("")).toEqual({ markers: [], malformed: [] });
    expect(parseAgentMarkers("plain text\n// ordinary comment")).toEqual({ markers: [], malformed: [] });
  });
});
