// Tests for issue-search.ts — the substring/ranking search contract over a
// stubbed gh: any-term OR matching, case-insensitivity, literal
// metacharacters, ranking by hit count, limit, and formats.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const TOOL = join(fileURLToPath(new URL(".", import.meta.url)), "../../ts/issue-search.ts");

let stubDir = "";
let responses = "";
let repoRoot = "";

function installGhStub(): void {
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
  writeFileSync(
    join(stubDir, "gh"),
    [
      "#!/usr/bin/env bash",
      `if [ "$1" = "rev-parse" ]; then printf '%s\\n' "${repoRoot}"; exit 0; fi`,
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
    ].join("\n").replaceAll("__RESPONSES__", responses),
    { mode: 0o755 },
  );
}

function setIssues(issues: Array<{ number: number; title: string; body?: string; state?: string }>): void {
  writeFileSync(
    responses,
    `issue list\t${JSON.stringify(issues.map((i) => ({ ...i, state: i.state ?? "OPEN", url: `https://x/${i.number}` })))}\n`,
  );
}

function runTool(args: string[]): { status: number; stdout: string; stderr: string; output: string } {
  const r = spawnSync("node", [TOOL, ...args], {
    encoding: "utf8",
    input: "",
    cwd: repoRoot,
    env: { ...process.env, PATH: `${stubDir}:${process.env.PATH ?? ""}`, DEVENV_REPO: "org/repo" },
  });
  const stdout = r.stdout ?? "";
  const stderr = r.stderr ?? "";
  return { status: r.status ?? 1, stdout, stderr, output: stdout + stderr };
}

const FIXTURE = [
  { number: 1, title: "Token expiry handling", body: "refresh token flow breaks" },
  { number: 2, title: "Unrelated thing", body: "nothing here" },
  { number: 3, title: "token", body: "single mention" },
];

describe("issue-search", () => {
  beforeEach(() => {
    stubDir = mkdtempSync(join(tmpdir(), "is-stub-"));
    responses = join(stubDir, "responses.tsv");
    repoRoot = mkdtempSync(join(tmpdir(), "is-repo-"));
    setIssues(FIXTURE);
    installGhStub();
    process.env.PATH = `${stubDir}:${process.env.PATH ?? ""}`;
  });

  const savedPath = process.env.PATH;
  afterEach(() => {
    rmSync(stubDir, { recursive: true, force: true });
    rmSync(repoRoot, { recursive: true, force: true });
    process.env.PATH = savedPath;
  });

  it("any-term OR matching, ranked by distinct-term hit count", () => {
    const r = runTool(["token", "expiry", "--format", "json"]);
    expect(r.status).toBe(0);
    const out = JSON.parse(r.stdout) as Array<{ number: number; matchCount: number; matchedTerms: string[] }>;
    expect(out[0]?.number).toBe(1);
    expect(out[0]?.matchCount).toBe(2);
    expect(out.map((h) => h.number)).toEqual([1, 3]);
  });

  it("matching is case-insensitive", () => {
    const r = runTool(["TOKEN", "--format", "json"]);
    const out = JSON.parse(r.stdout) as Array<{ number: number }>;
    expect(out.length).toBe(2);
  });

  it("regex metacharacters in terms match literally", () => {
    setIssues([{ number: 9, title: "use Array[0] indexing", body: "" }]);
    const r = runTool(["Array[0]", "--format", "json"]);
    const out = JSON.parse(r.stdout) as Array<{ number: number }>;
    expect(out.length).toBe(1);
    expect(out[0]?.number).toBe(9);
  });

  it("--limit caps the results", () => {
    const r = runTool(["token", "--limit", "1", "--format", "json"]);
    const out = JSON.parse(r.stdout) as unknown[];
    expect(out.length).toBe(1);
  });

  it("table format renders the match summary", () => {
    const r = runTool(["token", "expiry"]);
    expect(r.stdout).toContain("2 matches");
    expect(r.stdout).toContain("token, expiry");
  });

  it("simple format renders the count bracket", () => {
    const r = runTool(["token", "--format", "simple"]);
    expect(r.stdout).toContain("[1 term]");
  });

  it("no terms is a misuse failure", () => {
    expect(runTool([]).status).toBe(2);
  });

  it("an unknown flag exits 2", () => {
    expect(runTool(["x", "--bogus"]).status).toBe(2);
  });
});
