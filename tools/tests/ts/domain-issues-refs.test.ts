// Unit suite for the shared issue-reference parsing module: bare/URL issue
// refs, and the child_of map parser against both YAML forms (inline list and
// block list), quoted names, and out-of-types content.
import { describe, expect, it } from "vitest";
import { childOfMapFrom, issueNumberFromRef } from "../../lib/domain/issues/refs.ts";

describe("issueNumberFromRef", () => {
  it("parses a bare number", () => {
    expect(issueNumberFromRef("42")).toBe(42);
  });

  it("parses a web URL ending in the number", () => {
    expect(issueNumberFromRef("https://github.com/org/repo/issues/42")).toBe(42);
  });

  it("parses a URL with a query/fragment suffix", () => {
    expect(issueNumberFromRef("https://github.com/org/repo/issues/42?foo=1#bar")).toBe(42);
  });

  it("returns null for non-numeric and malformed input", () => {
    expect(issueNumberFromRef("abc")).toBeNull();
    expect(issueNumberFromRef("https://github.com/org/repo/wiki")).toBeNull();
    expect(issueNumberFromRef("")).toBeNull();
  });
});

describe("childOfMapFrom", () => {
  const configWith = (childOfBlock: string): string => `types:
${childOfBlock}
other_top_level:
  key: value
`;

  it("parses the inline child_of list form", () => {
    const map = childOfMapFrom(configWith(`  - name: Task
    child_of: [Epic, Feature]
  - name: Bug
    child_of: []
`));
    expect(map.get("Task")).toEqual(["Epic", "Feature"]);
    expect(map.get("Bug")).toEqual([]);
  });

  it("parses the block child_of list form", () => {
    const map = childOfMapFrom(configWith(`  - name: Task
    child_of:
      - Epic
      - Feature
`));
    expect(map.get("Task")).toEqual(["Epic", "Feature"]);
  });

  it("unquotes quoted type names and quoted list items", () => {
    const map = childOfMapFrom(configWith(`  - name: "Task"
    child_of: ['Epic', "Feature"]
`));
    expect(map.get("Task")).toEqual(["Epic", "Feature"]);
  });

  it("stops at the first non-indented key after the types list", () => {
    const map = childOfMapFrom(configWith(`  - name: Task
    child_of: [Epic]
`));
    expect(map.has("Task")).toBe(true);
    expect(map.size).toBe(1);
  });

  it("returns an empty map for content without a types list", () => {
    expect(childOfMapFrom("nothing: here\n").size).toBe(0);
  });

  it("a later name entry resets the child_of accumulator (no bleed across records)", () => {
    const map = childOfMapFrom(configWith(`  - name: A
    child_of:
      - Epic
  - name: B
`));
    expect(map.get("A")).toEqual(["Epic"]);
    expect(map.has("B")).toBe(false);
  });

  it("a sibling list field after a block child_of does not bleed its items", () => {
    const map = childOfMapFrom(`types:
  - name: Task
    child_of:
      - Epic
    labels:
      - foo
      - bar
`);
    expect(map.get("Task")).toEqual(["Epic"]);
  });
});
