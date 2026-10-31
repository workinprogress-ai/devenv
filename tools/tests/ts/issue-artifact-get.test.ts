// Tests for issue-artifact-get.ts — artifact resolution by doc_id. gh is
// stubbed on PATH with a response-table fixture (the tool runs as a child
// process, so in-process vi.mock cannot reach it). Cases pin the output
// field set, the 0/1/many match contract, and the write-body behavior.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// The tool executes as a child process; resolve its path from this suite's
// location (tests/ts/ → scripts/), the same derivation every sibling uses.
const TOOL = join(fileURLToPath(new URL(".", import.meta.url)), "../../ts/issue-artifact-get.ts");

let stubDir = "";
let responses = "";

function installGhStub(): void {
  // Array-join build with an explicit placeholder token: replaceAll on the
  // bare env-var name would corrupt the bash "$VAR" references (the "$"
  // survives and the path splices in after it), so the emitted script uses
  // __RESPONSES__ as the substitution point.
  const lines = [
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
  ];
  const script = lines.join("\n").replaceAll("__RESPONSES__", responses);
  writeFileSync(join(stubDir, "gh"), script, { mode: 0o755 });
}

function setResponses(comments: string): void {
  writeFileSync(responses, `issues/42/comments\t${comments}\n`);
}

function comment(
  id: number,
  docId: string | null,
  body = "content",
): string {
  const docLine = docId === null ? "" : `doc_id: ${docId}\nartifact_type: plan\nissue_number: 42\n`;
  // Real newlines in the body: JSON.stringify encodes them as \n escapes and
  // the tool's JSON.parse decodes them back, matching gh's actual wire shape.
  const full = `<!-- DEVENV_ARTIFACT_V1\n${docLine}-->\n\n${body}`;
  return JSON.stringify({
    id,
    body: full,
    user: { login: "octocat" },
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-02T00:00:00Z",
    url: `https://github.com/org/repo/issues/comments/${id}`,
    issue_url: "https://github.com/org/repo/issues/42",
  });
}

function runTool(args: string[]): { status: number; stdout: string; stderr: string; output: string } {
  const r = spawnSync("node", [TOOL, ...args], {
    encoding: "utf8",
    input: "",
    env: {
      ...process.env,
      PATH: `${stubDir}:${process.env.PATH ?? ""}`,
      DEVENV_REPO: "org/repo",
    },
  });
  const stdout = r.stdout ?? "";
  const stderr = r.stderr ?? "";
  return { status: r.status ?? 1, stdout, stderr, output: stdout + stderr };
}

describe("issue-artifact-get", () => {
  beforeEach(() => {
    stubDir = mkdtempSync(join(tmpdir(), "iag-stub-"));
    responses = join(stubDir, "responses.tsv");
    writeFileSync(responses, "");
    installGhStub();
    process.env.PATH = `${stubDir}:${process.env.PATH ?? ""}`;
  });

  const savedPath = process.env.PATH;
  afterEach(() => {
    rmSync(stubDir, { recursive: true, force: true });
    process.env.PATH = savedPath;
  });

  it("resolves a single artifact and emits the exact bash field set (preview mode)", () => {
    setResponses(`[${comment(111, "dv1:org/repo:issue-42:plan:p-001")}]`);
    const r = runTool(["--issue", "42", "--doc-id", "dv1:org/repo:issue-42:plan:p-001"]);
    expect(r.status).toBe(0);
    const out = JSON.parse(r.stdout) as Record<string, unknown>;
    expect(out["issue_number"]).toBe(42);
    expect(out["doc_id"]).toBe("dv1:org/repo:issue-42:plan:p-001");
    expect(out["comment_id"]).toBe(111);
    expect(out["artifact_type"]).toBe("plan");
    expect(out["author"]).toBe("octocat");
    expect(out["createdAt"]).toBe("2026-01-01T00:00:00Z");
    expect(out["url"]).toBe("https://github.com/org/repo/issues/comments/111");
    expect(typeof out["bodyPreview"]).toBe("string");
    expect("body" in out).toBe(false);
    const header = out["header"] as Record<string, string>;
    expect(header["doc_id"]).toBe("dv1:org/repo:issue-42:plan:p-001");
    expect(header["issue_number"]).toBe("42");
  });

  it("--full swaps bodyPreview for the full body", () => {
    setResponses(`[${comment(111, "dv1:k", "full-body-text")}]`);
    const r = runTool(["--issue", "42", "--doc-id", "dv1:k", "--full"]);
    const out = JSON.parse(r.stdout) as Record<string, unknown>;
    expect(out["body"]).toContain("full-body-text");
    expect("bodyPreview" in out).toBe(false);
  });

  it("no match exits 1 with a named message", () => {
    setResponses(`[${comment(111, "dv1:other")}]`);
    const r = runTool(["--issue", "42", "--doc-id", "dv1:wanted"]);
    expect(r.status).toBe(1);
    expect(r.output).toContain("No artifact comment found for doc_id");
  });

  it("duplicate doc_ids exit 3 with a conflict report listing comment ids", () => {
    setResponses(`[${comment(1, "dv1:dup")},${comment(2, "dv1:dup")}]`);
    const r = runTool(["--issue", "42", "--doc-id", "dv1:dup"]);
    expect(r.status).toBe(3);
    const out = JSON.parse(r.stdout) as { action: string; matches: number[] };
    expect(out.action).toBe("conflict");
    expect(out.matches).toEqual([1, 2]);
  });

  it("--write-body writes the raw body and adds bodyFile", () => {
    const dir = mkdtempSync(join(tmpdir(), "iag-out-"));
    const target = join(dir, "body.md");
    setResponses(`[${comment(111, "dv1:w", "# written body")}]`);
    const r = runTool(["--issue", "42", "--doc-id", "dv1:w", "--write-body", target]);
    expect(r.status).toBe(0);
    expect(readFileSync(target, "utf8")).toContain("# written body");
    const out = JSON.parse(r.stdout) as Record<string, unknown>;
    expect(out["bodyFile"]).toBe(target);
    rmSync(dir, { recursive: true, force: true });
  });

  it("--write-body into a missing directory is a misuse failure", () => {
    setResponses(`[${comment(111, "dv1:w2")}]`);
    const r = runTool(["--issue", "42", "--doc-id", "dv1:w2", "--write-body", "/nonexistent-dir-xyz/b.md"]);
    expect(r.status).toBe(2);
    expect(r.output).toContain("Directory does not exist");
  });

  it("a non-numeric issue is a misuse failure", () => {
    const r = runTool(["--issue", "4x2", "--doc-id", "dv1:x"]);
    expect(r.status).toBe(2);
  });

  it("a missing doc-id is a misuse failure", () => {
    const r = runTool(["--issue", "42"]);
    expect(r.status).toBe(2);
  });

  it("--pretty pretty-prints the JSON", () => {
    setResponses(`[${comment(111, "dv1:pretty")}]`);
    const r = runTool(["--issue", "42", "--doc-id", "dv1:pretty", "--pretty"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("\n  ");
  });

  it("an unknown flag exits 2", () => {
    const r = runTool(["--bogus"]);
    expect(r.status).toBe(2);
  });
});
