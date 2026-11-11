// Unit suite for the shared issue-reference parsing module: bare/URL issue refs.
import { describe, expect, it } from "vitest";
import { issueNumberFromRef } from "../../lib/domain/issues/refs.ts";

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
