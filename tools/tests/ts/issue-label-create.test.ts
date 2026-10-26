// Tests for issue-label-create.ts — idempotent create / --update / --seed
// over a stubbed gh with a mutation log.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const TOOL = join(fileURLToPath(new URL(".", import.meta.url)), "../../ts/issue-label-create.ts");

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
      "exit 0",
      "",
    ].join("\n").replaceAll("__RESPONSES__", responses),
    { mode: 0o755 },
  );
  writeFileSync(join(stubDir, "yq"), "#!/usr/bin/env bash\necho \"yq $*\" >> \"" + stubDir + "/yq.log\"\nexit 0\n", { mode: 0o755 });
}

function setExisting(names: string[]): void {
  writeFileSync(responses, `label list\t${JSON.stringify(names.map((n) => ({ name: n })))}\n`);
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

describe("issue-label-create", () => {
  beforeEach(() => {
    stubDir = mkdtempSync(join(tmpdir(), "ilc-stub-"));
    responses = join(stubDir, "responses.tsv");
    repoRoot = mkdtempSync(join(tmpdir(), "ilc-repo-"));
    writeFileSync(responses, "");
    installGhStub();
    process.env.PATH = `${stubDir}:${process.env.PATH ?? ""}`;
  });

  afterEach(() => {
    rmSync(stubDir, { recursive: true, force: true });
    rmSync(repoRoot, { recursive: true, force: true });
  });

  it("a new label is created with color and description", () => {
    setExisting([]);
    const r = runTool(["area/auth", "--color", "1d76db", "--description", "Auth area"]);
    expect(r.status).toBe(0);
    expect(r.output).toContain("Created label: area/auth");
  });

  it("an existing label is skipped with exit 0 (idempotent)", () => {
    setExisting(["needs-triage"]);
    const r = runTool(["needs-triage", "--color", "ededed"]);
    expect(r.status).toBe(0);
    expect(r.output).toContain("Label already exists (skipped)");
  });

  it("--update on an existing label updates instead of skipping", () => {
    setExisting(["needs-triage"]);
    const r = runTool(["needs-triage", "--color", "0e8a16", "--update"]);
    expect(r.status).toBe(0);
    expect(r.output).toContain("Updated label: needs-triage");
  });

  it("dry-run previews the create without writing", () => {
    setExisting([]);
    const r = runTool(["preview-me", "--dry-run"]);
    expect(r.status).toBe(0);
    expect(r.output).toContain("[DRY RUN] Would create label: preview-me");
  });

  it("dry-run previews the update for an existing label with --update", () => {
    setExisting(["exists"]);
    const r = runTool(["exists", "--color", "abc123", "--update", "--dry-run"]);
    expect(r.status).toBe(0);
    expect(r.output).toContain("[DRY RUN] Would update label: exists");
  });

  it("a malformed color is refused (6-digit hex, no #)", () => {
    expect(runTool(["x", "--color", "#ff0000"]).status).toBe(2);
    expect(runTool(["x", "--color", "zzz111"]).status).toBe(2);
  });

  it("no NAME and no --seed is a misuse failure", () => {
    expect(runTool([]).status).toBe(2);
  });

  it("an unknown flag exits 2", () => {
    expect(runTool(["x", "--bogus"]).status).toBe(2);
  });
});
