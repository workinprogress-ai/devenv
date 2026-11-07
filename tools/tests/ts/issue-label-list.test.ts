// Tests for issue-label-list.ts — enumeration + search + formats over a
// stubbed gh.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { runTool as runHarness, pathWithStubs } from "./harness/index.ts";

const TOOL = "issue-label-list";

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

const LABELS = JSON.stringify([
  { name: "bug", description: "Something is broken", color: "d73a4a" },
  { name: "Priority: High", description: "", color: "ff0000" },
]);

function runTool(args: string[]): { status: number; stdout: string; stderr: string; output: string } {
  // Thin wrapper over the shared harness: the suite keeps its name and
  // env shape; the spawn boilerplate lives in one place.
  return runHarness(TOOL, args, { env: { PATH: pathWithStubs(stubDir), DEVENV_REPO: "org/repo" }, cwd: repoRoot });
}

describe("issue-label-list", () => {
  const savedPath_issue_label_list = process.env.PATH;
  beforeEach(() => {
    stubDir = mkdtempSync(join(tmpdir(), "ill-stub-"));
    responses = join(stubDir, "responses.tsv");
    repoRoot = mkdtempSync(join(tmpdir(), "ill-repo-"));
    writeFileSync(responses, `label list\t${LABELS}\n`);
    installGhStub();
    process.env.PATH = `${stubDir}:${process.env.PATH ?? ""}`;
  });

  afterEach(() => {
    rmSync(stubDir, { recursive: true, force: true });
    rmSync(repoRoot, { recursive: true, force: true });
    process.env.PATH = savedPath_issue_label_list;
  });

  it("table format lists name/color/description", () => {
    const r = runTool([]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("bug");
    expect(r.stdout).toContain("d73a4a");
    expect(r.stdout).toContain("Something is broken");
  });

  it("--search filters case-insensitively", () => {
    const out = JSON.parse(runTool(["--search", "PRIORITY", "--format", "json"]).stdout) as Array<{ name: string }>;
    expect(out.length).toBe(1);
    expect(out[0]?.name).toBe("Priority: High");
  });

  it("simple format prints names only", () => {
    const r = runTool(["--format", "simple"]);
    expect(r.stdout.split("\n").filter((l) => l !== "")).toEqual(["bug", "Priority: High"]);
  });

  it("json format emits the label array", () => {
    const out = JSON.parse(runTool(["--format", "json"]).stdout) as Array<{ name: string }>;
    expect(out.length).toBe(2);
  });

  it("an invalid format exits 2", () => {
    expect(runTool(["--format", "bogus"]).status).toBe(2);
  });

  it("an unknown flag exits 2", () => {
    expect(runTool(["--bogus"]).status).toBe(2);
  });
});
