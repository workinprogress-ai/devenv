// Tests for issue-artifact-upsert.ts — the create-or-update-by-doc_id
// contract over a stubbed gh with a mutation log: resolution order
// (--issue > header > doc_id), mismatch refusals, stamping, dry-run,
// update/create paths, and the conflict rule.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const TOOL = join(fileURLToPath(new URL(".", import.meta.url)), "../../scripts/issue-artifact-upsert.ts");

let stubDir = "";
let responses = "";
let mutations = "";

function installGhStub(): void {
  const lines = [
    "#!/usr/bin/env bash",
    // Capture the full argv BEFORE any shifting: the case match below keys
    // on it (shifting first left "$*" empty and every lookup fell through).
    'argv_all="gh $*"',
    'if [ "$1" = "auth" ] && [ "$2" = "status" ]; then exit 0; fi',
    'if [ "$1" != "api" ]; then echo "unexpected: $*" >&2; exit 1; fi',
    'echo "$argv_all" >> "__MUTATIONS__"',
    'for prev in "$@"; do',
    '  [ "$prev" = "--input" ] && shift_done=1 && break',
    'done',
    'if [ "${shift_done:-0}" = "1" ]; then',
    '  cat >> "__MUTATIONS__"',
    '  shift_done=0',
    'fi',
    'method="GET"',
    'shift',
    'while [ "$#" -gt 0 ]; do',
    '  case "$1" in',
    '    --paginate) ;;',
    '    -X) method="$2"; shift ;;',
    '    -f) shift ;;',
    '    -F) shift ;;',
    '  esac',
    '  shift',
    'done',
    'if [ "$method" = "PATCH" ] || [ "$method" = "POST" ]; then',
    `  printf '{"id": 999, "url": "https://github.com/org/repo/issues/comments/999"}\\n'`,
    '  exit 0',
    'fi',
    'if [ -s "__RESPONSES__" ]; then',
    '  while IFS= read -r line; do',
    '    [ -z "$line" ] && continue',
    `    key="\${line%%$'\\t'*}"`,
    `    val="\${line#*$'\\t'}"`,
    '    case "$argv_all" in',
    `      *"$key"*) printf '%s\\n' "$val"; exit 0 ;;`,
    '    esac',
    `  done < "__RESPONSES__"`,
    'fi',
    `printf '[]\\n'`,
    'exit 0',
    "",
  ];
  const script = lines.join("\n")
    .replaceAll("__MUTATIONS__", mutations)
    .replaceAll("__RESPONSES__", responses);
  writeFileSync(join(stubDir, "gh"), script, { mode: 0o755 });
}

function artifactBody(docId: string, opts: { issue?: number | "none" | null; stamp?: boolean } = {}): string {
  const header = [
    "<!-- DEVENV_ARTIFACT_V1",
    `doc_id: ${docId}`,
    ...(opts.issue !== undefined ? [`issue_number: ${opts.issue}`] : []),
    "artifact_type: plan",
    ...(opts.stamp === true ? ["updated_at_utc: 2000-01-01T00:00:00Z"] : []),
    "-->",
    "",
    "# Artifact",
    "",
    "Body.",
  ].join("\n");
  return header;
}

function runTool(args: string[], opts: { stdin?: string } = {}): { status: number; stdout: string; stderr: string; output: string } {
  const r = spawnSync("node", [TOOL, ...args], {
    encoding: "utf8",
    input: opts.stdin ?? "",
    env: { ...process.env, PATH: `${stubDir}:${process.env.PATH ?? ""}`, DEVENV_REPO: "org/repo" },
  });
  const stdout = r.stdout ?? "";
  const stderr = r.stderr ?? "";
  return { status: r.status ?? 1, stdout, stderr, output: stdout + stderr };
}

function ghCalls(): string[] {
  if (!existsSync(mutations)) return [];
  return readFileSync(mutations, "utf8").split("\n").filter((l) => l.startsWith("gh "));
}

describe("issue-artifact-upsert", () => {
  beforeEach(() => {
    stubDir = mkdtempSync(join(tmpdir(), "iau-stub-"));
    responses = join(stubDir, "responses.tsv");
    mutations = join(stubDir, "mutations.log");
    writeFileSync(responses, "");
    installGhStub();
    process.env.PATH = `${stubDir}:${process.env.PATH ?? ""}`;
  });

  afterEach(() => {
    rmSync(stubDir, { recursive: true, force: true });
  });

  it("create path: no existing match posts a new comment and reports created", () => {
    writeFileSync(responses, "issues/42/comments\t[]\n");
    const r = runTool(["--issue", "42", "--body", artifactBody("dv1:new")]);
    expect(r.status).toBe(0);
    const out = JSON.parse(r.stdout) as Record<string, unknown>;
    expect(out["action"]).toBe("created");
    expect(out["issue_number"]).toBe(42);
    expect(out["comment_id"]).toBe(999);
    expect(ghCalls().some((c) => c.includes("-X POST"))).toBe(true);
  });

  it("update path: one doc_id match edits that comment and reports updated", () => {
    const existing = artifactBody("dv1:exists");
    const commentsJson = JSON.stringify([
      { id: 777, body: existing, url: "https://x/777" },
    ]);
    writeFileSync(responses, `issues/42/comments\t${commentsJson}\n`);
    const r = runTool(["--issue", "42", "--body", artifactBody("dv1:exists")]);
    expect(r.status).toBe(0);
    expect(ghCalls().some((c) => c.includes("-X PATCH"))).toBe(true);
  });

  it("conflict path: two doc_id matches exit 3 with the id list", () => {
    const existing = artifactBody("dv1:dup");
    const commentsJson = JSON.stringify([
      { id: 1, body: existing },
      { id: 2, body: existing },
    ]);
    writeFileSync(responses, `issues/42/comments\t${commentsJson}\n`);
    const r = runTool(["--issue", "42", "--body", artifactBody("dv1:dup")]);
    expect(r.status).toBe(3);
    const out = JSON.parse(r.stdout) as { action: string; matches: number[] };
    expect(out.action).toBe("conflict");
    expect(out.matches).toEqual([1, 2]);
  });

  it("issue number resolves from the body header when --issue is absent", () => {
    writeFileSync(responses, "issues/56/comments\t[]\n");
    const r = runTool(["--body", artifactBody("dv1:x", { issue: 56 })]);
    expect(r.status).toBe(0);
    const out = JSON.parse(r.stdout) as Record<string, unknown>;
    expect(out["issue_number"]).toBe(56);
    expect(ghCalls().some((c) => c.includes("/issues/56/comments"))).toBe(true);
  });

  it("issue number infers from a doc_id issue-<N> segment", () => {
    writeFileSync(responses, "issues/91/comments\t[]\n");
    const r = runTool(["--body", artifactBody("dv1:org/repo:issue-91:plan:slug")]);
    expect(r.status).toBe(0);
    const out = JSON.parse(r.stdout) as Record<string, unknown>;
    expect(out["issue_number"]).toBe(91);
  });

  it("a --issue/header mismatch is refused (exit 2)", () => {
    const r = runTool(["--issue", "42", "--body", artifactBody("dv1:x", { issue: 56 })]);
    expect(r.status).toBe(2);
    expect(r.output).toContain("Issue number mismatch");
  });

  it("a --issue/doc_id mismatch is refused (exit 2)", () => {
    const r = runTool(["--issue", "42", "--body", artifactBody("dv1:org/repo:issue-91:plan:slug")]);
    expect(r.status).toBe(2);
    expect(r.output).toContain("does not match doc_id");
  });

  it("a body with no doc_id is refused (doc_id required in first 256 chars)", () => {
    const r = runTool(["--issue", "42", "--body", "just some text"]);
    expect(r.status).toBe(2);
    expect(r.output).toContain("Comment body must include 'doc_id: <value>'");
  });

  it("stamping rewrites updated_at_utc inside the header; --no-stamp skips it", () => {
    writeFileSync(responses, "issues/42/comments\t[]\n");
    runTool(["--issue", "42", "--body", artifactBody("dv1:s1", { stamp: true })]);
    // The posted body's newlines split the mutation log across lines —
    // assert over the whole log, not the -X POST line alone.
    const all1 = existsSync(mutations) ? readFileSync(mutations, "utf8") : "";
    expect(all1).not.toContain("2000-01-01T00:00:00Z");
    expect(all1).toContain("doc_id: dv1:s1");
    rmSync(mutations, { force: true });
    runTool(["--issue", "42", "--no-stamp", "--body", artifactBody("dv1:s2", { stamp: true })]);
    const all2 = existsSync(mutations) ? readFileSync(mutations, "utf8") : "";
    expect(all2).toContain("2000-01-01T00:00:00Z");
  });

  it("dry-run resolves the action without posting", () => {
    writeFileSync(responses, "issues/42/comments\t[]\n");
    const r = runTool(["--issue", "42", "--dry-run", "--body", artifactBody("dv1:dry")]);
    expect(r.status).toBe(0);
    const out = JSON.parse(r.stdout) as Record<string, unknown>;
    expect(out["action"]).toBe("created");
    expect(ghCalls().some((c) => c.includes("-X POST"))).toBe(false);
  });

  it("a body-file source reads the file (- is stdin)", () => {
    const dir = mkdtempSync(join(tmpdir(), "iau-file-"));
    const file = join(dir, "artifact.md");
    writeFileSync(file, artifactBody("dv1:from-file"));
    writeFileSync(responses, "issues/42/comments\t[]\n");
    const r = runTool(["--issue", "42", "--body-file", file]);
    expect(r.status).toBe(0);
    expect(r.output).toContain("created");
    rmSync(dir, { recursive: true, force: true });
  });

  it("empty piped stdin is refused (never an empty body)", () => {
    const r = runTool([], { stdin: "" });
    expect(r.status).toBe(2);
    expect(r.output).toContain("Refusing empty stdin body");
  });

  it("both --body and --body-file is a misuse failure", () => {
    expect(runTool(["--body", "x", "--body-file", "y"]).status).toBe(2);
  });

  it("an unknown flag exits 2", () => {
    expect(runTool(["--bogus"]).status).toBe(2);
  });
});
