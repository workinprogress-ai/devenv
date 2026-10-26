// Tests for issue-comment-list.ts — enumeration + formatting contract over
// a stubbed gh: per-line JSON (default), pretty array, preview/full body,
// and the devenv gate.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const TOOL = join(fileURLToPath(new URL(".", import.meta.url)), "../../ts/issue-comment-list.ts");

let stubDir = "";
let responses = "";
let repoRoot = "";

function installGhStub(): void {
  const ghLines = [
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
  writeFileSync(join(stubDir, "gh"), ghLines.join("\n").replaceAll("__RESPONSES__", responses), { mode: 0o755 });
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

function setComments(comments: string): void {
  writeFileSync(responses, `issues/42/comments\t${comments}\n`);
}

function runTool(args: string[], opts: { clearRepo?: boolean } = {}): { status: number; stdout: string; stderr: string; output: string } {
  const env: Record<string, string | undefined> = {
    ...process.env,
    PATH: `${stubDir}:${process.env.PATH ?? ""}`,
    DEVENV_REPO: "org/repo",
  };
  if (opts.clearRepo) delete env["DEVENV_REPO"];
  const r = spawnSync("node", [TOOL, ...args], {
    encoding: "utf8",
    input: "",
    cwd: repoRoot,
    env: env as NodeJS.ProcessEnv,
  });
  const stdout = r.stdout ?? "";
  const stderr = r.stderr ?? "";
  return { status: r.status ?? 1, stdout, stderr, output: stdout + stderr };
}

describe("issue-comment-list", () => {
  beforeEach(() => {
    stubDir = mkdtempSync(join(tmpdir(), "icl-stub-"));
    responses = join(stubDir, "responses.tsv");
    repoRoot = mkdtempSync(join(tmpdir(), "icl-repo-"));
    writeFileSync(responses, "");
    installGhStub();
    process.env.PATH = `${stubDir}:${process.env.PATH ?? ""}`;
  });

  afterEach(() => {
    rmSync(stubDir, { recursive: true, force: true });
    rmSync(repoRoot, { recursive: true, force: true });
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
    const r = runTool(["42"]);
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
    const out = JSON.parse(runTool(["42"]).stdout.trim()) as Record<string, unknown>;
    const preview = out["bodyPreview"] as string;
    expect(preview.length).toBe(257);
    expect(preview.endsWith("…")).toBe(true);
  });

  it("--full swaps bodyPreview for the complete body", () => {
    const c = JSON.stringify({ id: 1, body: "x".repeat(300), user: { login: "a" }, created_at: "c", updated_at: "u", url: "u" });
    setComments(`[${c}]`);
    const lines = runTool(["42", "--full"]).stdout.trim().split("\n").map((l) => JSON.parse(l) as Record<string, unknown>);
    expect((lines[0]?.["body"] as string).length).toBe(300);
    expect("bodyPreview" in (lines[0] as object)).toBe(false);
  });

  it("--pretty emits a JSON array", () => {
    setComments(`[${JSON.stringify({ id: 1, body: "b", user: { login: "a" }, created_at: "c", updated_at: "u", url: "u" })}]`);
    const out = JSON.parse(runTool(["42", "--pretty"]).stdout) as unknown[];
    expect(Array.isArray(out)).toBe(true);
    expect(out.length).toBe(1);
  });

  it("an empty comment list prints nothing (default mode)", () => {
    const r = runTool(["42"]);
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toBe("");
  });

  it("a missing issue number exits 1 with the usage hint (bash parity)", () => {
    const r = runTool([], { clearRepo: true });
    expect(r.status).toBe(1);
    expect(r.output).toContain("Issue number is required");
  });

  it("an unknown flag exits 1 (bash parity for this tool)", () => {
    expect(runTool(["42", "--bogus"]).status).toBe(1);
  });
});
