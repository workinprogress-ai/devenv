// pr-thread-reply and pr-review-comment reject AI attribution in the comment
// body with exit 2 before any provider call. The other body-taking tools carry
// the same case in their own suites; these two have no general suite, so they
// share one stubbed-gh fixture here.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathWithStubs, runTool } from "./harness/index.ts";

const ATTRIBUTED = "Looks good.\n\nCo-Authored-By: Claude <noreply@anthropic.com>";

let stubDir = "";
let repoRoot = "";

function installStubs(): void {
  writeFileSync(
    join(stubDir, "gh"),
    ["#!/usr/bin/env bash", `printf 'gh %s\\n' "$*" >> "${join(stubDir, "calls.log")}"`, "exit 0", ""].join("\n"),
    { mode: 0o755 },
  );
  writeFileSync(
    join(stubDir, "git"),
    ["#!/usr/bin/env bash", `if [ "$1" = "rev-parse" ]; then printf '%s\\n' "${repoRoot}"; exit 0; fi`, "exit 0", ""].join("\n"),
    { mode: 0o755 },
  );
  writeFileSync(join(stubDir, "devenv.config"), "[provider]\nname=github\n");
}

/** Every gh call except the authentication probe. */
function providerCalls(): string[] {
  const log = join(stubDir, "calls.log");
  if (!existsSync(log)) return [];
  return readFileSync(log, "utf8")
    .split("\n")
    .filter((l) => l.startsWith("gh ") && !l.startsWith("gh auth"));
}

function run(tool: string, args: string[]): { status: number; output: string } {
  const r = runTool(tool, args, {
    cwd: repoRoot,
    env: { PATH: pathWithStubs(stubDir), DEVENV_ROOT: stubDir, DEVENV_REPO: "org/repo" },
  });
  return { status: r.status, output: r.output };
}

beforeEach(() => {
  stubDir = mkdtempSync(join(tmpdir(), "abl-stub-"));
  repoRoot = mkdtempSync(join(tmpdir(), "abl-repo-"));
  installStubs();
});

afterEach(() => {
  rmSync(stubDir, { recursive: true, force: true });
  rmSync(repoRoot, { recursive: true, force: true });
});

describe("attribution body lint", () => {
  it("pr-thread-reply rejects an attributed body, live or dry-run, and calls nothing", () => {
    for (const extra of [[], ["--dry-run"]]) {
      const r = run("pr-thread-reply", ["12", "--comment-id", "34", "--body", ATTRIBUTED, ...extra]);
      expect(r.status, extra.join(" ")).toBe(2);
      expect(r.output).toContain("AI attribution is not allowed in a pull request comment");
    }
    expect(providerCalls()).toEqual([]);
  });

  it("pr-review-comment rejects an attributed body, inline or from a file, and calls no provider verb", () => {
    const file = join(stubDir, "attributed.md");
    writeFileSync(file, ATTRIBUTED);
    for (const source of [["--body", ATTRIBUTED], ["--body-file", file]]) {
      const r = run("pr-review-comment", ["12", "--file", "src/a.ts", "--line", "3", ...source]);
      expect(r.status, source[0]).toBe(2);
      expect(r.output).toContain("AI attribution is not allowed in a review comment");
    }
    expect(providerCalls()).toEqual([]);
  });

  it("both tools still accept a body that merely discusses attribution", () => {
    const discussion = "Rejects `Co-Authored-By` trailers that name an AI identity.";
    const r = run("pr-review-comment", ["12", "--file", "src/a.ts", "--line", "3", "--dry-run", "--body", discussion]);
    expect(r.output).not.toContain("AI attribution is not allowed");
  });
});
