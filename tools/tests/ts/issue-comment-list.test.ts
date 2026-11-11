// Tests for issue-comment-list.ts — enumeration + formatting contract over
// a stubbed gh: per-line JSON (default), pretty array, preview/full body,
// and the devenv gate. First suite on the shared harness (runTool /
// stubGh / stubGit / tmpDir): the harness's contract test.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

import { runTool, stubGh, stubGit, pathWithStubs, tmpDir, rmrf } from "./harness/index.ts";

let stubDir = "";
let responses = "";
let repoRoot = "";

// The suite's behavioral stub (mode-driven responses) rides the factory:
// stubGh takes the whole script body when a suite needs custom modes.
function installStubs(): void {
  stubGh(
    stubDir,
    [
      "#!/usr/bin/env bash",
      'if [ -s "__RESPONSES__" ]; then',
      "  while IFS= read -r line; do",
      '    [ -z "$line" ] && continue',
      `    key="\${line%%$'\\t'*}"`,
      `    val="\${line#*$'\\t'}"`,
      '    case "gh $*" in',
      `      *"$key"*) printf '%s\\n' "$val"; exit 0 ;;`,
      "    esac",
      `  done < "__RESPONSES__"`,
      "fi",
      "printf '[]\\n'",
      "exit 0",
      "",
    ]
      .join("\n")
      .replaceAll("__RESPONSES__", responses),
  );
  stubGit(stubDir, repoRoot, undefined);
}

function setComments(comments: string): void {
  writeFileSync(responses, `issues/42/comments\t${comments}\n`);
}

function run(args: string[], opts: { clearRepo?: boolean } = {}): { status: number; stdout: string; stderr: string; output: string } {
  const env: Record<string, string | undefined> = {
    PATH: pathWithStubs(stubDir),
    DEVENV_REPO: "org/repo",
  };
  if (opts.clearRepo) delete env["DEVENV_REPO"];
  return runTool("issue-comment-list", args, { env, cwd: repoRoot });
}

describe("issue-comment-list", () => {
  beforeEach(() => {
    stubDir = tmpDir("icl-stub");
    responses = join(stubDir, "responses.tsv");
    repoRoot = tmpDir("icl-repo");
    writeFileSync(responses, "");
    installStubs();
  });

  afterEach(() => {
    rmrf(stubDir);
    rmrf(repoRoot);
  });

  it("emits one JSON object per comment with the bash field set (preview default)", () => {
    const c = JSON.stringify({
      id: 5,
      body: "hello",
      user: { login: "octocat" },
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-02T00:00:00Z",
      url: "https://x/5",
    });
    setComments(`[${c}]`);
    const r = run(["42"]);
    expect(r.status).toBe(0);
    const lines = r.stdout.trim().split("\n").map((l) => JSON.parse(l) as Record<string, unknown>);
    expect(lines.length).toBe(1);
    expect(lines[0]?.["id"]).toBe(5);
    expect(lines[0]?.["author"]).toBe("octocat");
    expect(lines[0]?.["createdAt"]).toBe("2026-01-01T00:00:00Z");
    expect(lines[0]?.["bodyPreview"]).toBe("hello");
    expect("body" in (lines[0] as object)).toBe(false);
    expect(lines[0]?.["url"]).toBe("https://x/5");
  });

  it("bodyPreview truncates at 256 chars with the ellipsis", () => {
    const c = JSON.stringify({ id: 1, body: "x".repeat(300), user: { login: "a" }, created_at: "c", updated_at: "u", url: "u" });
    setComments(`[${c}]`);
    const out = JSON.parse(run(["42"]).stdout.trim()) as Record<string, unknown>;
    const preview = out["bodyPreview"] as string;
    expect(preview.length).toBe(257);
    expect(preview.endsWith("…")).toBe(true);
  });

  it("--full swaps bodyPreview for the complete body", () => {
    const c = JSON.stringify({ id: 1, body: "x".repeat(300), user: { login: "a" }, created_at: "c", updated_at: "u", url: "u" });
    setComments(`[${c}]`);
    const lines = run(["42", "--full"]).stdout.trim().split("\n").map((l) => JSON.parse(l) as Record<string, unknown>);
    expect((lines[0]?.["body"] as string).length).toBe(300);
    expect("bodyPreview" in (lines[0] as object)).toBe(false);
  });

  it("--pretty emits a JSON array", () => {
    setComments(`[${JSON.stringify({ id: 1, body: "b", user: { login: "a" }, created_at: "c", updated_at: "u", url: "u" })}]`);
    const out = JSON.parse(run(["42", "--pretty"]).stdout) as unknown[];
    expect(Array.isArray(out)).toBe(true);
    expect(out.length).toBe(1);
  });

  it("an empty comment list prints nothing (default mode)", () => {
    const r = run(["42"]);
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toBe("");
  });

  it("a missing issue number is misuse (exit 2) with the usage hint", () => {
    const r = run([], { clearRepo: true });
    expect(r.status).toBe(2);
    expect(r.output).toContain("Issue number is required");
  });

  it("an unknown flag is misuse (exit 2)", () => {
    expect(run(["42", "--bogus"]).status).toBe(2);
  });
});
