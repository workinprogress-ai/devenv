// Behavioral tests for core/versioning. The pinned bash contract: comparisons
// use the numeric MAJOR.MINOR.PATCH core; pre-release/build suffixes are
// ignored; missing parts default to 0.
import { describe, expect, it } from "vitest";
import {
  compareVersions,
  versionGte,
  checkGitVersion,
  requireScriptVersion,
} from "../../lib/core/versioning.ts";

describe("compareVersions", () => {
  it("orders major, minor, patch", () => {
    expect(compareVersions("2.0.0", "1.9.9")).toBe("greater");
    expect(compareVersions("1.10.0", "1.9.0")).toBe("greater");
    expect(compareVersions("1.2.4", "1.2.3")).toBe("greater");
    expect(compareVersions("1.2.3", "1.2.4")).toBe("less");
    expect(compareVersions("1.2.3", "1.2.3")).toBe("equal");
  });

  it("ignores pre-release and build suffixes", () => {
    expect(compareVersions("1.2.3-rc.1", "1.2.3")).toBe("equal");
    expect(compareVersions("1.2.3+build5", "1.2.3")).toBe("equal");
    expect(compareVersions("24.18.0", "24.18")).toBe("equal");
  });

  it("defaults missing parts to 0", () => {
    expect(compareVersions("1.2", "1.2.0")).toBe("equal");
    expect(compareVersions("1", "1.0.0")).toBe("equal");
  });

  it("compares numerically, not lexically", () => {
    expect(compareVersions("1.9.0", "1.10.0")).toBe("less");
    expect(compareVersions("2.0.0", "10.0.0")).toBe("less");
  });
});

describe("versionGte", () => {
  it("is gte, not gt", () => {
    expect(versionGte("1.2.3", "1.2.3")).toBe(true);
    expect(versionGte("1.2.4", "1.2.3")).toBe(true);
    expect(versionGte("1.2.2", "1.2.3")).toBe(false);
  });
});

describe("requireScriptVersion", () => {
  it("returns null when satisfied, reason when not", () => {
    expect(requireScriptVersion("1.5.0", "1.4.0", "my-tool")).toBeNull();
    const reason = requireScriptVersion("1.3.0", "1.4.0", "my-tool");
    expect(reason).toContain("my-tool version 1.4.0 or higher required");
    expect(reason).toContain("Current: 1.3.0");
  });
});

describe("checkGitVersion", () => {
  it("passes in a container with git installed", () => {
    expect(checkGitVersion("2.0")).toBeNull();
  });
  it("fails against an impossible floor", () => {
    const reason = checkGitVersion("99.0.0");
    expect(reason).toContain("99.0.0 or higher");
  });
});
