// Characterization tests: body-source resolution across the body-source
// tools. These lock the CURRENT observable behavior of the shared
// lib/core/body-source.ts resolver — the historical per-tool drift in the
// '-' leg's empty-refusal was closed by the adoption; the uniform refusal
// is now the contract these tests pin.
//
// Tools covered: issue-comment, pr-comment, issue-comment-update,
// pr-thread-reply, issue-update, issue-create, pr-create-for-review.
// Suite shape follows the house pattern (stubbed gh + git on PATH,
// DEVENV_REPO pinned, mutation log) — this file is scaffolding for the
// extraction and its assertions evolve with the tools, they are not
// discarded.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const TS_DIR = join(fileURLToPath(new URL(".", import.meta.url)), "../../ts");

function toolPath(name: string): string {
  return join(TS_DIR, `${name}.ts`);
}

let stubDir = "";
let repoRoot = "";

function installStubs(): void {
  // gh: auth-status ok, everything else logs and succeeds. Body-source
  // behavior never depends on the API result; the log proves the call shape.
  writeFileSync(
    join(stubDir, "gh"),
    [
      "#!/usr/bin/env bash",
      'if [ "$1" = "auth" ] && [ "$2" = "status" ]; then exit 0; fi',
      'printf \'%s\\n\' "gh $*" >> "' + join(stubDir, "calls.log") + '"',
      "exit 0",
      "",
    ].join("\n"),
    { mode: 0o755 },
  );
  writeFileSync(
    join(stubDir, "git"),
    [
      "#!/usr/bin/env bash",
      'if [ "$1" = "rev-parse" ] && [ "$2" = "--show-toplevel" ]; then printf \'%s\\n\' "__REPOROOT__"; exit 0; fi',
      'if [ "$1" = "rev-parse" ]; then exit 0; fi',
      'if [ "$1" = "symbolic-ref" ]; then printf \'%s\\n\' "refs/heads/master"; exit 0; fi',
      'if [ "$1" = "status" ]; then exit 0; fi',
      "exit 0",
      "",
    ].join("\n").replaceAll("__REPOROOT__", repoRoot),
    { mode: 0o755 },
  );
}

function run(
  tool: string,
  args: string[],
  opts: { stdin?: string; env?: Record<string, string> } = {},
): { status: number; stdout: string; stderr: string; output: string } {
  const r = spawnSync("node", [toolPath(tool), ...args], {
    encoding: "utf8",
    input: opts.stdin ?? "",
    cwd: repoRoot,
    env: {
      ...process.env,
      PATH: `${stubDir}:${process.env.PATH ?? ""}`,
      DEVENV_REPO: "org/repo",
      ...opts.env,
    } as NodeJS.ProcessEnv,
  });
  const stdout = r.stdout ?? "";
  const stderr = r.stderr ?? "";
  return { status: r.status ?? 1, stdout, stderr, output: stdout + stderr };
}

beforeEach(() => {
  stubDir = mkdtempSync(join(tmpdir(), "bsrc-stub-"));
  repoRoot = mkdtempSync(join(tmpdir(), "bsrc-repo-"));
  installStubs();
});

afterEach(() => {
  rmSync(stubDir, { recursive: true, force: true });
  rmSync(repoRoot, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// issue-comment — the reference implementation of the source contract
// ---------------------------------------------------------------------------

describe("issue-comment body source (current behavior)", () => {
  it("inline --body posts the given text", () => {
    const r = run("issue-comment", ["123", "--body", "hello body"]);
    expect(r.status).toBe(0);
    expect(r.output).not.toContain("Refusing");
  });

  it("piped stdin with no flag auto-reads and posts", () => {
    const r = run("issue-comment", ["123"], { stdin: "from pipe" });
    expect(r.status).toBe(0);
  });

  it("empty piped stdin is a hard refusal (exit 2)", () => {
    const r = run("issue-comment", ["123"], { stdin: "   \n  " });
    expect(r.status).toBe(2);
    expect(r.output).toContain("Refusing empty stdin body");
  });

  it("--body-file - reads stdin; EMPTY stdin is REFUSED (uniform empty-refusal contract of the shared resolver)", () => {
    const r = run("issue-comment", ["123", "--body-file", "-"], { stdin: "  \n" });
    expect(r.status).toBe(2);
    expect(r.output).toContain("Refusing empty stdin body");
  });

  it("two source flags refuse with usage error", () => {
    const r = run("issue-comment", ["123", "--body", "a", "--body-file", "f.md"]);
    expect(r.status).toBe(2);
    expect(r.output).toContain("Only one");
  });
});

// ---------------------------------------------------------------------------
// pr-comment — same contract surface, separate implementation
// ---------------------------------------------------------------------------

describe("pr-comment body source (current behavior)", () => {
  it("inline --body accepted", () => {
    const r = run("pr-comment", ["7", "--body", "review note"]);
    expect(r.status).toBe(0);
  });

  it("empty piped stdin refuses", () => {
    const r = run("pr-comment", ["7"], { stdin: " " });
    expect(r.status).toBe(2);
    expect(r.output).toContain("Refusing empty stdin body");
  });
});

// ---------------------------------------------------------------------------
// issue-comment-update — the second historically divergent tool
// ---------------------------------------------------------------------------

describe("issue-comment-update body source (current behavior)", () => {
  it("--body-file - with EMPTY stdin is REFUSED (uniform empty-refusal contract of the shared resolver)", () => {
    const r = run("issue-comment-update", ["999", "--body-file", "-"], { stdin: " \n" });
    expect(r.status).toBe(2);
    expect(r.output).toContain("Refusing empty stdin body");
  });

  it("empty piped stdin (no flag) refuses", () => {
    const r = run("issue-comment-update", ["999"], { stdin: "\t\n" });
    expect(r.status).toBe(2);
    expect(r.output).toContain("Refusing empty stdin body");
  });
});

// ---------------------------------------------------------------------------
// pr-thread-reply
// ---------------------------------------------------------------------------

describe("pr-thread-reply body source (current behavior)", () => {
  it("inline body accepted", () => {
    const r = run("pr-thread-reply", ["7", "--comment-id", "55", "--body", "reply text"]);
    expect(r.status).toBe(0);
  });

  it("--body-file - with EMPTY stdin is REFUSED (uniform empty-refusal contract of the shared resolver)", () => {
    const r = run("pr-thread-reply", ["7", "--comment-id", "55", "--body-file", "-"], { stdin: "" });
    expect(r.status).toBe(2);
    expect(r.output).toContain("Refusing empty stdin body");
  });
});

// ---------------------------------------------------------------------------
// issue-update
// ---------------------------------------------------------------------------

describe("issue-update body source (current behavior)", () => {
  it("--body-file - reads stdin (non-empty)", () => {
    const r = run("issue-update", ["5", "--body-file", "-"], { stdin: "new body" });
    expect(r.status).toBe(0);
  });

  it("--body-file - with EMPTY stdin is REFUSED (uniform empty-refusal contract of the shared resolver)", () => {
    const r = run("issue-update", ["5", "--body-file", "-"], { stdin: "" });
    expect(r.status).toBe(2);
    expect(r.output).toContain("Refusing empty stdin body");
  });
});

// ---------------------------------------------------------------------------
// issue-create
// ---------------------------------------------------------------------------

describe("issue-create body source (current behavior)", () => {
  it("--body-file - with EMPTY stdin REFUSES (issue-create is the strict implementation)", () => {
    const r = run("issue-create", ["-t", "char title", "--body-file", "-"], { stdin: "  " });
    expect(r.status).toBe(2);
    expect(r.output).toContain("Refusing");
  });

  it("empty --body refuses", () => {
    const r = run("issue-create", ["-t", "char title", "--body", "   "]);
    expect(r.status).toBe(2);
  });
});
