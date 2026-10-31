// Tests for issue-artifact-select.ts — the single-artifact resolution
// contract over a stubbed gh: doc-id exact match, single-match, --latest,
// ambiguity (exit 5), conflict (exit 3), and output formats.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const TOOL = join(fileURLToPath(new URL(".", import.meta.url)), "../../ts/issue-artifact-select.ts");

let stubDir = "";
let responses = "";

function installGhStub(): void {
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
  writeFileSync(join(stubDir, "gh"), lines.join("\n").replaceAll("__RESPONSES__", responses), { mode: 0o755 });
}

function artifactComment(opts: {
  id: number;
  docId: string;
  artifactType?: string;
  title?: string;
  updatedAt?: string;
}): string {
  const header = [
    "<!-- DEVENV_ARTIFACT_V1",
    `doc_id: ${opts.docId}`,
    `artifact_type: ${opts.artifactType ?? "plan"}`,
    "issue_number: 42",
    "-->",
    "",
    ...(opts.title !== undefined ? [`# ${opts.title}`, ""] : []),
    "Body.",
  ].join("\n");
  return JSON.stringify({
    id: opts.id,
    body: header,
    user: { login: "octocat" },
    created_at: "2026-01-01T00:00:00Z",
    updated_at: opts.updatedAt ?? "2026-01-02T00:00:00Z",
    url: `https://github.com/org/repo/issues/comments/${opts.id}`,
    issue_url: "https://github.com/org/repo/issues/42",
  });
}

function runTool(args: string[]): { status: number; stdout: string; stderr: string; output: string } {
  const r = spawnSync("node", [TOOL, ...args], {
    encoding: "utf8",
    input: "",
    env: { ...process.env, PATH: `${stubDir}:${process.env.PATH ?? ""}`, DEVENV_REPO: "org/repo" },
  });
  const stdout = r.stdout ?? "";
  const stderr = r.stderr ?? "";
  return { status: r.status ?? 1, stdout, stderr, output: stdout + stderr };
}

describe("issue-artifact-select", () => {
  beforeEach(() => {
    stubDir = mkdtempSync(join(tmpdir(), "ias-stub-"));
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

  it("rule 1: --doc-id selects that exact artifact (json format)", () => {
    writeFileSync(
      responses,
      `issues/42/comments\t[${artifactComment({ id: 7, docId: "dv1:wanted" })},${artifactComment({ id: 8, docId: "dv1:other" })}]\n`,
    );
    const r = runTool(["--issue", "42", "--doc-id", "dv1:wanted"]);
    expect(r.status).toBe(0);
    const out = JSON.parse(r.stdout) as Record<string, unknown>;
    expect(out["doc_id"]).toBe("dv1:wanted");
    expect(out["comment_id"]).toBe(7);
    expect("body" in out).toBe(false);
  });

  it("rule 1 miss: no artifact for the doc_id exits 1", () => {
    writeFileSync(responses, `issues/42/comments\t[${artifactComment({ id: 7, docId: "dv1:other" })}]\n`);
    const r = runTool(["--issue", "42", "--doc-id", "dv1:wanted"]);
    expect(r.status).toBe(1);
    expect(r.output).toContain("No artifact found for doc_id");
  });

  it("rule 2: a single filtered match is selected without --latest", () => {
    writeFileSync(responses, `issues/42/comments\t[${artifactComment({ id: 9, docId: "dv1:only", artifactType: "research" })}]\n`);
    const r = runTool(["--issue", "42", "--artifact-type", "research"]);
    expect(r.status).toBe(0);
    const out = JSON.parse(r.stdout) as Record<string, unknown>;
    expect(out["comment_id"]).toBe(9);
  });

  it("rule 4: multiple matches without --latest exit 5 with an ambiguity report", () => {
    writeFileSync(
      responses,
      `issues/42/comments\t[${artifactComment({ id: 1, docId: "dv1:a", title: "A" })},${artifactComment({ id: 2, docId: "dv1:b", title: "B" })}]\n`,
    );
    const r = runTool(["--issue", "42"]);
    expect(r.status).toBe(5);
    const out = JSON.parse(r.stdout) as { action: string; matches: Array<{ doc_id: string }> };
    expect(out.action).toBe("ambiguous");
    expect(out.matches.length).toBe(2);
  });

  it("rule 3: --latest picks the most recently updated", () => {
    writeFileSync(
      responses,
      `issues/42/comments\t[${artifactComment({ id: 1, docId: "dv1:older", updatedAt: "2026-01-02T00:00:00Z" })},${artifactComment({ id: 2, docId: "dv1:newer", updatedAt: "2026-01-05T00:00:00Z" })}]\n`,
    );
    const r = runTool(["--issue", "42", "--latest", "--format", "comment-id"]);
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toBe("2");
  });

  it("duplicate doc_ids exit 3 with a conflict report", () => {
    writeFileSync(
      responses,
      `issues/42/comments\t[${artifactComment({ id: 3, docId: "dv1:dup" })},${artifactComment({ id: 4, docId: "dv1:dup" })}]\n`,
    );
    const r = runTool(["--issue", "42", "--doc-id", "dv1:dup"]);
    expect(r.status).toBe(3);
    const out = JSON.parse(r.stdout) as { action: string; matches: number[] };
    expect(out.action).toBe("conflict");
    expect(out.matches).toEqual([3, 4]);
  });

  it("output formats: doc-id and url emit bare values", () => {
    writeFileSync(responses, `issues/42/comments\t[${artifactComment({ id: 7, docId: "dv1:one" })}]\n`);
    const docId = runTool(["--issue", "42", "--format", "doc-id"]);
    expect(docId.stdout.trim()).toBe("dv1:one");
    const url = runTool(["--issue", "42", "--format", "url"]);
    expect(url.stdout.trim()).toBe("https://github.com/org/repo/issues/comments/7");
  });

  it("no artifacts at all exits 1", () => {
    const r = runTool(["--issue", "42"]);
    expect(r.status).toBe(1);
    expect(r.output).toContain("No artifacts matched");
  });

  it("an invalid format is a misuse failure", () => {
    expect(runTool(["--issue", "42", "--format", "bogus"]).status).toBe(2);
  });

  it("an unknown flag exits 2", () => {
    expect(runTool(["--bogus"]).status).toBe(2);
  });
});
