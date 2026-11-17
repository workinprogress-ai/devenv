// Tests for artifact-header.ts — the --set / --stamp rewrite of a
// DEVENV_ARTIFACT_V1 header block.
import { describe, it, expect } from "vitest";
import { writeFileSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { runTool, tmpDir } from "./harness/index.ts";

describe("artifact-header --set", () => {
  it("replaces a hyphenated key on repeat instead of duplicating it", () => {
    const dir = tmpDir("ah-");
    try {
      const file = join(dir, "a.md");
      writeFileSync(file, "<!-- DEVENV_ARTIFACT_V1\ndoc_id: dv1:a\n-->\n\nbody\n");
      expect(runTool("artifact-header", [file, "--set", "my-key=1"]).status).toBe(0);
      expect(runTool("artifact-header", [file, "--set", "my-key=2"]).status).toBe(0);
      const lines = readFileSync(file, "utf8").split("\n").filter((l) => l.startsWith("my-key"));
      expect(lines).toEqual(["my-key: 2"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
