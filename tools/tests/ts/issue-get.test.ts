// Tests for issue-get.ts — the retrieval + field-extraction contract over a
// stubbed gh.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const TOOL = join(fileURLToPath(new URL(".", import.meta.url)), "../../ts/issue-get.ts");

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
      'printf \'gh %s\\n\' "$*" >> "__CALLS__";',
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
      'printf \'{\\"message\\":\\"Not Found\\"}\\n\'',
      "exit 1",
      "",
    ].join("\n").replaceAll("__RESPONSES__", responses).replaceAll("__CALLS__", join(stubDir, "calls.log")),
    { mode: 0o755 },
  );
}

const ISSUE = JSON.stringify({
  number: 42,
  title: "The title",
  body: "The body",
  state: "OPEN",
  labels: [{ name: "bug" }, { name: "infra" }],
  author: { login: "octocat" },
  url: "https://github.com/org/repo/issues/42",
});

function ghCalls(): string[] {
  const log = join(stubDir, "calls.log");
  if (!existsSync(log)) return [];
  return readFileSync(log, "utf8").split("\n").filter((l) => l.startsWith("gh "));
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

describe("issue-get", () => {
  beforeEach(() => {
    stubDir = mkdtempSync(join(tmpdir(), "ig-stub-"));
    responses = join(stubDir, "responses.tsv");
    repoRoot = mkdtempSync(join(tmpdir(), "ig-repo-"));
    writeFileSync(responses, `issue view 42\t${ISSUE}\n`);
    installGhStub();
    process.env.PATH = `${stubDir}:${process.env.PATH ?? ""}`;
  });

  afterEach(() => {
    rmSync(stubDir, { recursive: true, force: true });
    rmSync(repoRoot, { recursive: true, force: true });
  });

  it("emits the issue JSON with the default field list", () => {
    const r = runTool(["42"]);
    expect(r.status).toBe(0);
    const out = JSON.parse(r.stdout) as Record<string, unknown>;
    expect(out["number"]).toBe(42);
    expect(out["title"]).toBe("The title");
    expect(out["state"]).toBe("OPEN");
  });

  it("the default field list includes parent, surfaced as an object or null", () => {
    const r = runTool(["42"]);
    expect(r.status).toBe(0);
    // The stub returns the fixture verbatim; the assertion is that gh was
    // ASKED for the parent field.
    expect(ghCalls().join("\n")).toContain(
      "--json number,title,parent,body,state,labels,assignees,milestone,author,createdAt,updatedAt,closedAt,url,comments",
    );
  });

  it("--format parent prints the parent JSON object", () => {
    writeFileSync(responses, `issue view 42\t${JSON.stringify({ number: 42, parent: { number: 3, title: "Parent epic" } })}\n`);
    const r = runTool(["42", "--format", "parent"]);
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toBe(JSON.stringify({ number: 3, title: "Parent epic" }));
  });

  it("--pretty pretty-prints", () => {
    const r = runTool(["42", "--pretty"]);
    expect(r.stdout).toContain("\n  ");
  });

  it("--format title prints the raw field", () => {
    const r = runTool(["42", "--format", "title"]);
    expect(r.stdout.trim()).toBe("The title");
  });

  it("--format labels joins label names with commas", () => {
    const r = runTool(["42", "--format", "labels"]);
    expect(r.stdout.trim()).toBe("bug,infra");
  });

  it("--format on an absent field prints nothing (jq // empty parity)", () => {
    const r = runTool(["42", "--format", "milestone"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toBe("");
  });

  it("an unfetchable issue exits 4 with a named error", () => {
    const r = runTool(["999"]);
    expect(r.status).toBe(4);
    expect(r.output).toContain("Issue #999 not found");
  });

  it("a missing issue number exits 2", () => {
    expect(runTool([]).status).toBe(2);
  });

  it("an unknown flag exits 2", () => {
    expect(runTool(["42", "--bogus"]).status).toBe(2);
  });
});
