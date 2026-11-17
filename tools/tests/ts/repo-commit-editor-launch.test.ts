// An editor candidate that is on PATH but cannot launch (the devcontainer `code`
// shim exits 127 when no VS Code remote-cli follows it on PATH) must not end the
// commit: the next candidate is tried, and a launch failure is reported as an
// editor failure, never as a pre-commit hook rejection. Real git in throwaway
// fixture repos; the pty comes from util-linux `script` via the shared harness.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  createRepoCommitHarness,
  harnessGit,
  harnessHeadCount,
  harnessHeadSubject,
  harnessRunTool,
  harnessSetEditorMode,
  harnessStageFile,
  type Harness,
} from "./harness/repo-commit.ts";

let h: Harness;

beforeEach(() => {
  h = createRepoCommitHarness({ seed: { subject: "chore: base", file: "base.txt" } });
});
afterEach(() => h.dispose());

function stubBin(name: string, body: string): string {
  const dir = join(h.root, "stubs");
  mkdirSync(dir, { recursive: true });
  const p = join(dir, name);
  writeFileSync(p, body);
  chmodSync(p, 0o755);
  return dir;
}

describe("editor candidate that exists but cannot launch", () => {
  it("falls through to the next candidate instead of failing the commit", () => {
    // `code` on PATH behaves like the devcontainer shim without a remote-cli
    stubBin("code", "#!/bin/sh\necho 'code or code-insiders is not installed' >&2\nexit 127\n");
    // nano stands in for a working terminal editor: leaves the preloaded message as saved
    const dir = stubBin("nano", "#!/bin/sh\nexit 0\n");
    harnessGit(h, "config", "core.editor", "code --wait");
    harnessStageFile(h, "a.txt", "a\n");
    const before = harnessHeadCount(h);

    const r = harnessRunTool(h, ["feat: add a"], {
      envEditor: "",
      env: { PATH: `${dir}:${process.env.PATH ?? ""}` },
    });

    expect(r.out).toContain("opening editor: nano");
    expect(r.status).toBe(0);
    expect(harnessHeadCount(h)).toBe(before + 1);
    expect(harnessHeadSubject(h)).toBe("feat: add a");
  });
});

describe("failure classification after a passing hook", () => {
  it("reports a failed editor as an editor failure, not a hook rejection", () => {
    // a passing hook that talks on stderr, as real hook suites do
    const hook = join(h.repo, ".git", "hooks", "pre-commit");
    writeFileSync(hook, "#!/bin/sh\necho 'pre-commit hook: all checks passed' >&2\nexit 0\n");
    chmodSync(hook, 0o755);
    harnessSetEditorMode(h, "abort"); // exits 1: git reports a problem with the editor
    harnessStageFile(h, "a.txt", "a\n");
    const before = harnessHeadCount(h);

    const r = harnessRunTool(h, ["feat: add a"]);

    expect(r.status).not.toBe(0);
    expect(r.out).not.toContain("rejected by a pre-commit hook");
    expect(r.out).toContain("editor");
    expect(harnessHeadCount(h)).toBe(before);
  });
});
