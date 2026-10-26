// Tests for issue-create.ts — body-source resolution, reference lines, ref
// parsing, and the create flow through a stubbed gh with a call log.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const TOOL = join(fileURLToPath(new URL(".", import.meta.url)), "../../ts/issue-create.ts");

let stubDir = "";
let repoRoot = "";
let workDir = "";

function installGhStub(opts: { createOut?: string; repoViewFails?: boolean } = {}): void {
  const createOut = opts.createOut ?? "https://github.com/org/repo/issues/777";
  const lines = [
    "#!/usr/bin/env bash",
    'printf \'%s\\n\' "gh $*" >> "__LOG__"',
    `if [ "$1 $2" = "auth status" ]; then exit 0; fi`,
    `if [ "${opts.repoViewFails ? "1" : "0"}" = "1" ] && [ "$1 $2" = "repo view" ]; then exit 1; fi`,
    `case "$*" in`,
    `  *"repo view"*)`,
    `    if [[ "$*" == *"owner"* ]]; then echo '{"owner":{"login":"org"}}'; else echo '{"name":"repo"}'; fi`,
    `    ;;`,
    `  *"issue create"*)`,
    `    echo "${createOut}"`,
    `    ;;`,
    `  *"graphql"*)`,
    `    echo '{"data":{"repository":{"issue":{"id":"I_stub"}}}}'`,
    `    ;;`,
    `  *) ;;`,
    `esac`,
    "exit 0",
    "",
  ];
  writeFileSync(join(stubDir, "gh"), lines.join("\n").replaceAll("__LOG__", join(stubDir, "calls.log")), { mode: 0o755 });
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

function ghCalls(): string[] {
  const log = join(stubDir, "calls.log");
  if (!existsSync(log)) return [];
  return readFileSync(log, "utf8").split("\n").filter((l) => l.startsWith("gh "));
}

interface RunOpts {
  args: string[];
  input?: string;
  createOut?: string;
  repoViewFails?: boolean;
  issuesConfig?: string;
}

function runTool(opts: RunOpts): { status: number; stdout: string; stderr: string; output: string } {
  const r = spawnSync("node", [TOOL, ...opts.args], {
    encoding: "utf8",
    input: opts.input ?? "",
    cwd: repoRoot,
    env: {
      ...process.env,
      PATH: `${stubDir}:${process.env.PATH ?? ""}`,
      DEVENV_REPO: "org/repo",
      WORKFLOW_CORE_TOOLS: "/nonexistent-workflow-tools",
      ...(opts.issuesConfig !== undefined ? { ISSUES_CONFIG: opts.issuesConfig } : {}),
    },
  });
  const stdout = r.stdout ?? "";
  const stderr = r.stderr ?? "";
  return { status: r.status ?? 1, stdout, stderr, output: stdout + stderr };
}

function writeTypesConfig(): string {
  const p = join(workDir, "issues-config.yml");
  writeFileSync(p, "types:\n  - name: Bug\n    id: IT_b\n  - name: Task\n    id: IT_t\n");
  return p;
}

describe("issue-create", () => {
  beforeEach(() => {
    stubDir = mkdtempSync(join(tmpdir(), "icx-stub-"));
    repoRoot = mkdtempSync(join(tmpdir(), "icx-repo-"));
    workDir = mkdtempSync(join(tmpdir(), "icx-work-"));
    installGhStub();
  });

  afterEach(() => {
    rmSync(stubDir, { recursive: true, force: true });
    rmSync(repoRoot, { recursive: true, force: true });
    rmSync(workDir, { recursive: true, force: true });
  });

  it("--dry-run prints the final body without any mutating call", () => {
    const cfg = writeTypesConfig();
    const r = runTool({ args: ["--title", "T", "--type", "Task", "--no-interactive", "--dry-run", "--body", "C:\\new\\table"], issuesConfig: cfg });
    expect(r.status).toBe(0);
    // Backslash sequences stay exactly as typed (never control characters).
    expect(r.output).toContain("C:\\new\\table");
    expect(ghCalls().some((c) => c.includes("issue create"))).toBe(false);
  });

  it("--body-file keeps backslash sequences exactly as written", () => {
    const cfg = writeTypesConfig();
    const bodyFile = join(workDir, "body.md");
    writeFileSync(bodyFile, "C:\\new\\table and \\\\server\\share");
    const r = runTool({ args: ["--title", "T", "--type", "Task", "--no-interactive", "--dry-run", "--body-file", bodyFile], issuesConfig: cfg });
    expect(r.status).toBe(0);
    expect(r.output).toContain("C:\\new\\table and \\\\server\\share");
  });

  it("parent and blocked-by references become real body lines", () => {
    const cfg = writeTypesConfig();
    const r = runTool({
      args: ["--title", "T", "--type", "Task", "--no-interactive", "--dry-run", "--parent", "12", "--blocked-by", "7", "--blocked-by", "9", "--body", "CONTENT"],
      issuesConfig: cfg,
    });
    expect(r.status).toBe(0);
    expect(r.output).toContain("Part of #12\n\nBlocked by #7\nBlocked by #9\n\nCONTENT");
  });

  it("giving both --body and --body-file is a usage error", () => {
    const cfg = writeTypesConfig();
    const bodyFile = join(workDir, "body.md");
    writeFileSync(bodyFile, "x\n");
    const r = runTool({ args: ["--title", "T", "--type", "Task", "--no-interactive", "--body", "text", "--body-file", bodyFile], issuesConfig: cfg });
    expect(r.status).toBe(2);
    expect(r.output).toContain("Only one");
  });

  it("a missing --body-file is a usage error naming the file", () => {
    const cfg = writeTypesConfig();
    const r = runTool({ args: ["--title", "T", "--type", "Task", "--no-interactive", "--body-file", join(workDir, "does-not-exist.md")], issuesConfig: cfg });
    expect(r.status).toBe(2);
    expect(r.output).toContain("does-not-exist.md");
  });

  it("creates the issue, sets the native type, and prints the URL", () => {
    const cfg = writeTypesConfig();
    const r = runTool({ args: ["--title", "T", "--type", "Task", "--no-interactive", "--body", "b"], issuesConfig: cfg });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("https://github.com/org/repo/issues/777");
    const calls = ghCalls().join("\n");
    expect(calls).toContain("issue create -R org/repo --title T");
    expect(calls).toContain("issue edit 777 --type Task");
  });

  it("a bare id from the provider also yields the issue number", () => {
    const cfg = writeTypesConfig();
    installGhStub({ createOut: "42" });
    const r = runTool({ args: ["--title", "T", "--type", "Bug", "--no-interactive", "--body", "b"], issuesConfig: cfg });
    expect(r.status).toBe(0);
    expect(ghCalls().join("\n")).toContain("issue edit 42 --type Bug");
  });

  it("a label containing spaces is passed as one label", () => {
    const cfg = writeTypesConfig();
    const r = runTool({ args: ["--title", "T", "--type", "Task", "--no-interactive", "--body", "b", "--label", "good first issue", "--label", "bug"], issuesConfig: cfg });
    expect(r.status).toBe(0);
    const calls = ghCalls().join("\n");
    expect(calls).toContain("--label good first issue");
    expect(calls).toContain("--label bug");
    // A split would appear as "--label good " followed by a non-"first" token
    // in the argv stream; the full phrase appearing exactly once proves it did
    // not split.
    expect(calls.split("--label good first issue").length - 1).toBe(1);
  });

  it("an unknown type names the error and lists the valid set", () => {
    const cfg = writeTypesConfig();
    const r = runTool({ args: ["--title", "T", "--type", "Story", "--no-interactive", "--body", "b"], issuesConfig: cfg });
    expect(r.status).toBe(1);
    expect(r.output).toContain("Invalid issue type: Story");
    expect(r.output).toContain("Bug Task");
    expect(ghCalls().some((c) => c.includes("issue create"))).toBe(false);
  });

  it("an unreachable target repo stops before creation", () => {
    const cfg = writeTypesConfig();
    installGhStub({ repoViewFails: true });
    const r = runTool({ args: ["--title", "T", "--type", "Task", "--no-interactive", "--body", "b"], issuesConfig: cfg });
    expect(r.status).toBe(1);
    expect(r.output).toContain("Target repository not found or inaccessible: org/repo");
    expect(ghCalls().some((c) => c.includes("issue create"))).toBe(false);
  });

  it("--no-interactive without --title is a usage error", () => {
    const cfg = writeTypesConfig();
    const r = runTool({ args: ["--type", "Task", "--no-interactive"], issuesConfig: cfg });
    expect(r.status).toBe(2);
    expect(r.output).toContain("Issue title is required when using --no-interactive");
  });

  it("piped stdin becomes the body when no flag or template produced one", () => {
    const cfg = writeTypesConfig();
    const r = runTool({ args: ["--title", "T", "--type", "Task", "--no-interactive"], input: "piped body text\n", issuesConfig: cfg });
    expect(r.status).toBe(0);
    expect(ghCalls().join("\n")).toContain("--body piped body text");
  });

  it("an empty piped stdin body is refused", () => {
    const cfg = writeTypesConfig();
    const r = runTool({ args: ["--title", "T", "--type", "Task", "--no-interactive"], input: "   \n", issuesConfig: cfg });
    expect(r.status).toBe(2);
    expect(r.output).toContain("Refusing empty piped stdin body");
  });
});
