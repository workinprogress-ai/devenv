// Tests for artifact-header.ts — the --set / --stamp rewrite of a
// DEVENV_ARTIFACT_V1 header block.
import { describe, it, expect } from "vitest";
import { writeFileSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { runTool, tmpDir } from "./harness/index.ts";
import { parseHeaderJson, headerField } from "../../lib/domain/artifacts.ts";

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

// Each shape: the header lines as written, the body that follows, and the
// header lines expected after `--set owner=z --set issue_number=8`.
const BODY = "\nBody text\nissue_number: 99\nowner: body\n-->\n";
const shapes: Record<string, { text: string; expected: string }> = {
  bare: {
    text: "<!-- DEVENV_ARTIFACT_V1\ndoc_id: dv1:a\nissue_number: 7\n-->" + BODY,
    expected: "<!-- DEVENV_ARTIFACT_V1\ndoc_id: dv1:a\nissue_number: 8\nowner: z\n-->" + BODY,
  },
  inline: {
    text: "<!-- DEVENV_ARTIFACT_V1\ndoc_id: dv1:a\nissue_number: 7 -->" + BODY,
    expected: "<!-- DEVENV_ARTIFACT_V1\ndoc_id: dv1:a\nowner: z\nissue_number: 8 -->" + BODY,
  },
  indented: {
    text: "<!-- DEVENV_ARTIFACT_V1\ndoc_id: dv1:a\nissue_number: 7\n  -->" + BODY,
    expected: "<!-- DEVENV_ARTIFACT_V1\ndoc_id: dv1:a\nissue_number: 8\nowner: z\n  -->" + BODY,
  },
  "blank and comment lines": {
    text: "<!-- DEVENV_ARTIFACT_V1\ndoc_id: dv1:a\n\n# note\nissue_number: 7\n-->" + BODY,
    expected: "<!-- DEVENV_ARTIFACT_V1\ndoc_id: dv1:a\n\n# note\nissue_number: 8\nowner: z\n-->" + BODY,
  },
  unclosed: {
    text: "<!-- DEVENV_ARTIFACT_V1\ndoc_id: dv1:a\nissue_number: 7\nprose line\nissue_number: 99\n",
    expected: "<!-- DEVENV_ARTIFACT_V1\ndoc_id: dv1:a\nissue_number: 8\nowner: z\nprose line\nissue_number: 99\n",
  },
};

describe("artifact-header writer agrees with the reader bounds", () => {
  for (const [name, { text, expected }] of Object.entries(shapes)) {
    for (const eol of ["\n", "\r\n"]) {
      it(`${name} header (${eol === "\n" ? "LF" : "CRLF"}): --set rewrites only header lines and reads back`, () => {
        const dir = tmpDir("ah-");
        try {
          const file = join(dir, "a.md");
          const crlf = (t: string): string => t.replaceAll("\n", eol);
          writeFileSync(file, crlf(text));
          const args = [file, "--set", "owner=z", "--set", "issue_number=8"];
          const r = runTool("artifact-header", args);
          expect(r.status).toBe(0);
          const after = readFileSync(file, "utf8");
          expect(after).toBe(crlf(expected));
          expect(parseHeaderJson(after)).toMatchObject({ doc_id: "dv1:a", issue_number: "8", owner: "z" });
          expect(JSON.parse(r.stdout).header).toEqual(parseHeaderJson(after));
          // A second --set of the same keys replaces rather than duplicates.
          expect(runTool("artifact-header", [file, "--set", "owner=y", "--set", "issue_number=9"]).status).toBe(0);
          const again = readFileSync(file, "utf8");
          expect(again).toBe(crlf(expected.replace("owner: z", "owner: y").replace("issue_number: 8", "issue_number: 9")));
          expect(headerField(again, "owner")).toBe("y");
        } finally {
          rmSync(dir, { recursive: true, force: true });
        }
      });
    }
  }

  it("--stamp rewrites updated_at_utc on an inline-closed header and keeps the comment closed", () => {
    const dir = tmpDir("ah-");
    try {
      const file = join(dir, "a.md");
      writeFileSync(file, "<!-- DEVENV_ARTIFACT_V1\ndoc_id: dv1:a\nupdated_at_utc: 2000-01-01T00:00:00Z -->\nissue_number: 99\n");
      expect(runTool("artifact-header", [file, "--stamp", "--set", "issue_number=8"]).status).toBe(0);
      const lines = readFileSync(file, "utf8").split("\n");
      expect(lines[0]).toBe("<!-- DEVENV_ARTIFACT_V1");
      expect(lines[1]).toBe("doc_id: dv1:a");
      expect(lines[2]).toBe("issue_number: 8");
      expect(lines[3]).toMatch(/^updated_at_utc: \d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ -->$/);
      expect(lines[4]).toBe("issue_number: 99");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("exits non-zero and leaves the file alone when there is no valid header", () => {
    const dir = tmpDir("ah-");
    try {
      const file = join(dir, "a.md");
      const text = "<!-- DEVENV_ARTIFACT_V1\nprose first\ndoc_id: dv1:a\n-->\n";
      writeFileSync(file, text);
      expect(runTool("artifact-header", [file, "--set", "owner=z"]).status).not.toBe(0);
      expect(readFileSync(file, "utf8")).toBe(text);
      writeFileSync(file, "no marker here\n");
      expect(runTool("artifact-header", [file, "--stamp"]).status).not.toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
