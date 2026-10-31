// Tests for issue-artifact-list.ts — artifact enumeration over a stubbed gh
// (PATH stub + response table; the tool runs as a child process).
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const TOOL = join(fileURLToPath(new URL(".", import.meta.url)), "../../ts/issue-artifact-list.ts");

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
  sourceFile?: string;
  title?: string;
  updatedAt?: string;
}): string {
  const header = [
    "<!-- DEVENV_ARTIFACT_V1",
    `doc_id: ${opts.docId}`,
    `artifact_type: ${opts.artifactType ?? "plan"}`,
    ...(opts.sourceFile !== undefined ? [`source_file: ${opts.sourceFile}`] : []),
    `issue_number: 42`,
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

describe("issue-artifact-list", () => {
  beforeEach(() => {
    stubDir = mkdtempSync(join(tmpdir(), "ial-stub-"));
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

  it("lists only artifact comments with the bash field set, newest first", () => {
    writeFileSync(
      responses,
      `issues/42/comments\t[${artifactComment({ id: 1, docId: "dv1:old", updatedAt: "2026-01-02T00:00:00Z" })},${artifactComment({ id: 2, docId: "dv1:new", updatedAt: "2026-01-03T00:00:00Z", title: "Newest Plan" })},{"id":3,"body":"not an artifact","user":{"login":"x"},"created_at":"c","updated_at":"u","url":"u3","issue_url":"https://github.com/org/repo/issues/42"}]\n`,
    );
    const r = runTool(["--issue", "42"]);
    expect(r.status).toBe(0);
    const out = JSON.parse(r.stdout) as Array<Record<string, unknown>>;
    expect(out.length).toBe(2);
    expect(out[0]?.["doc_id"]).toBe("dv1:new");
    expect(out[0]?.["title"]).toBe("Newest Plan");
    expect(out[1]?.["doc_id"]).toBe("dv1:old");
    expect(out[0]?.["comment_id"]).toBe(2);
    expect(out[0]?.["issue_number"]).toBe(42);
    expect("body" in (out[0] as object)).toBe(false);
    expect(typeof (out[0] as Record<string, unknown>)["bodyPreview"]).toBe("string");
  });

  it("--artifact-type filters on the header's artifact_type", () => {
    writeFileSync(
      responses,
      `issues/42/comments\t[${artifactComment({ id: 1, docId: "dv1:a", artifactType: "plan" })},${artifactComment({ id: 2, docId: "dv1:b", artifactType: "research" })}]\n`,
    );
    const r = runTool(["--issue", "42", "--artifact-type", "research"]);
    const out = JSON.parse(r.stdout) as Array<Record<string, unknown>>;
    expect(out.length).toBe(1);
    expect(out[0]?.["doc_id"]).toBe("dv1:b");
  });

  it("--full swaps bodyPreview for body on every entry", () => {
    writeFileSync(responses, `issues/42/comments\t[${artifactComment({ id: 1, docId: "dv1:a" })}]\n`);
    const r = runTool(["--issue", "42", "--full"]);
    const out = JSON.parse(r.stdout) as Array<Record<string, unknown>>;
    expect("body" in (out[0] as object)).toBe(true);
    expect("bodyPreview" in (out[0] as object)).toBe(false);
  });

  it("source_file is null when the header omits it", () => {
    writeFileSync(responses, `issues/42/comments\t[${artifactComment({ id: 1, docId: "dv1:a" })}]\n`);
    const out = JSON.parse(runTool(["--issue", "42"]).stdout) as Array<Record<string, unknown>>;
    expect(out[0]?.["source_file"]).toBeNull();
  });

  it("an empty comment list yields [] with exit 0", () => {
    const r = runTool(["--issue", "42"]);
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toBe("[]");
  });

  it("a missing issue is a misuse failure; non-numeric too", () => {
    expect(runTool([]).status).toBe(2);
    expect(runTool(["--issue", "4x"]).status).toBe(2);
  });

  it("an unknown flag exits 2", () => {
    expect(runTool(["--bogus"]).status).toBe(2);
  });
});
