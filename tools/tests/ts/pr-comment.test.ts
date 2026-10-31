// Regression for the review-round-2 Blocker: pr-comment --body-file must
// post the file's CONTENT (the sync->async conversion dropped the file from
// the facade call, posting an empty comment while dry-run showed content).
// Piped stdin and --body must keep posting their text.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const TOOL = join(fileURLToPath(new URL(".", import.meta.url)), "../../ts/pr-comment.ts");

let stubDir = "";
let repoRoot = "";

function installGhStub(): void {
  writeFileSync(
    join(stubDir, "gh"),
    [
      "#!/usr/bin/env bash",
      `printf 'gh %s\\n' "$*" >> "${join(stubDir, "calls.log")}"`,
      '[ "$1" = auth ] && exit 0',
      "exit 0",
      "",
    ].join("\n"),
    { mode: 0o755 },
  );
  writeFileSync(
    join(stubDir, "git"),
    [
      "#!/usr/bin/env bash",
      `if [ "$1" = "rev-parse" ]; then printf '%s\\n' "${repoRoot}"; exit 0; fi`,
      "exit 0",
      "",
    ].join("\n"),
    { mode: 0o755 },
  );
}

function ghCalls(): string[] {
  const log = join(stubDir, "calls.log");
  if (!existsSync(log)) return [];
  return readFileSync(log, "utf8").split("\n").filter((l) => l.startsWith("gh pr comment"));
}

function runTool(args: string[], input = ""): { status: number; stdout: string; stderr: string } {
  const r = spawnSync("node", [TOOL, ...args], {
    encoding: "utf8",
    input,
    cwd: repoRoot,
    env: { ...process.env, PATH: `${stubDir}:${process.env.PATH ?? ""}`, DEVENV_ROOT: stubDir, DEVENV_REPO: "org/repo" },
  });
  return { status: r.status ?? 1, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

describe("pr-comment body sources", () => {
  beforeEach(() => {
    stubDir = mkdtempSync(join(tmpdir(), "prc-stub-"));
    repoRoot = mkdtempSync(join(tmpdir(), "prc-repo-"));
    writeFileSync(join(stubDir, "devenv.config"), "[provider]\nname=github\n");
    installGhStub();
  });

  afterEach(() => {
    rmSync(stubDir, { recursive: true, force: true });
    rmSync(repoRoot, { recursive: true, force: true });
  });

  it("--body-file posts the file's CONTENT, never empty", () => {
    const body = join(stubDir, "body.md");
    writeFileSync(body, "hello from file");
    const r = runTool(["123", "--body-file", body]);
    expect(r.status).toBe(0);
    const calls = ghCalls();
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain("--body hello from file");
  });

  it("piped stdin posts its content", () => {
    const r = runTool(["124"], "piped body");
    expect(r.status).toBe(0);
    expect(ghCalls()[0]).toContain("--body piped body");
  });

  it("--body posts its text", () => {
    const r = runTool(["125", "--body", "flag body"]);
    expect(r.status).toBe(0);
    expect(ghCalls()[0]).toContain("--body flag body");
  });
});
