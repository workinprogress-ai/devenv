// Tests for lib/domain/issues/types.ts — the one issues-config loader and the
// one type resolution every issue tool shares.
import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { childOfMap, issueTypeNames, parseIssuesConfig, resolveIssueType } from "../../lib/domain/issues/types.ts";

const dirs: string[] = [];
const savedConfig = process.env["ISSUES_CONFIG"];

function useConfig(content: string): void {
  const dir = mkdtempSync(join(tmpdir(), "dit-"));
  dirs.push(dir);
  const p = join(dir, "issues-config.yml");
  writeFileSync(p, content);
  process.env["ISSUES_CONFIG"] = p;
}

afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  if (savedConfig === undefined) delete process.env["ISSUES_CONFIG"];
  else process.env["ISSUES_CONFIG"] = savedConfig;
});

describe("parseIssuesConfig", () => {
  it("reads names, descriptions and both child_of forms with a real YAML reader", () => {
    const types = parseIssuesConfig(
      [
        "types:",
        "  - name: Bug",
        '    description: "A: defect # not a comment"',
        "    child_of: [Epic]",
        "  - name: Task",
        "    labels:",
        "      - sibling",
        "    child_of:",
        "      - Epic",
        "      - Task",
        "",
      ].join("\n"),
    );
    expect(types).toEqual([
      { name: "Bug", description: "A: defect # not a comment", childOf: ["Epic"] },
      { name: "Task", childOf: ["Epic", "Task"] },
    ]);
  });

  it("rejects malformed YAML and a missing types list with a named error", () => {
    expect(() => parseIssuesConfig("types: [unclosed")).toThrow(/issues config/i);
    expect(() => parseIssuesConfig("other: 1\n")).toThrow(/types/);
  });
});

describe("resolveIssueType", () => {
  it("matches names case-insensitively and resolves aliases onto the configured vocabulary", () => {
    useConfig("types:\n  - name: Bug\n  - name: Feature\n  - name: Task\n");
    expect(resolveIssueType("task")).toBe("Task");
    expect(resolveIssueType("STORY")).toBe("Feature");
    expect(resolveIssueType("chore")).toBe("Task");
  });

  it("refuses an alias whose target is not configured", () => {
    useConfig("types:\n  - name: Bug\n  - name: Task\n");
    expect(resolveIssueType("story")).toBeNull();
    expect(issueTypeNames()).toEqual(["Bug", "Task"]);
  });

  it("childOfMap reads the same file", () => {
    useConfig("types:\n  - name: Task\n    child_of: [Epic, Task]\n  - name: Epic\n");
    expect(childOfMap().get("Task")).toEqual(["Epic", "Task"]);
    expect(childOfMap().has("Epic")).toBe(false);
  });
});
