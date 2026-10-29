// Tests for issue-types.ts — the org issue-type listing contract over a
// stubbed gh (GraphQL response table): org resolution, formats, and the
// empty/invalid refusals.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const TOOL = join(fileURLToPath(new URL(".", import.meta.url)), "../../ts/issue-types.ts");

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
    "exit 1",
    "",
  ];
  writeFileSync(join(stubDir, "gh"), lines.join("\n").replaceAll("__RESPONSES__", responses), { mode: 0o755 });
}

const graphQlResponse = JSON.stringify({
  data: {
    organization: {
      issueTypes: {
        edges: [
          { node: { id: "IT_1", name: "Bug" } },
          { node: { id: "IT_2", name: "Feature" } },
        ],
        pageInfo: { hasNextPage: false },
      },
    },
  },
});

function runTool(args: string[], env: Record<string, string> = {}): { status: number; stdout: string; stderr: string; output: string } {
  const r = spawnSync("node", [TOOL, ...args], {
    encoding: "utf8",
    input: "",
    env: {
      ...process.env,
      PATH: `${stubDir}:${process.env.PATH ?? ""}`,
      DEVENV_ROOT: stubDir,
      DEVENV_REPO: "org/repo",
      ...env,
    },
  });
  const stdout = r.stdout ?? "";
  const stderr = r.stderr ?? "";
  return { status: r.status ?? 1, stdout, stderr, output: stdout + stderr };
}

describe("issue-types", () => {
  beforeEach(() => {
    stubDir = mkdtempSync(join(tmpdir(), "it-stub-"));
    responses = join(stubDir, "responses.tsv");
    // devenv.config at the DEVENV_ROOT the tool reads (org fixture).
    writeFileSync(join(stubDir, "devenv.config"), "[provider]\nname=github\n\n[organization]\norg=fixture-org\n");
    writeFileSync(responses, `issueTypes(first:100)\t${graphQlResponse}\n`);
    installGhStub();
    process.env.PATH = `${stubDir}:${process.env.PATH ?? ""}`;
  });

  afterEach(() => {
    rmSync(stubDir, { recursive: true, force: true });
  });

  it("table format lists name + id rows", () => {
    const r = runTool([]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("Bug");
    expect(r.stdout).toContain("IT_1");
    expect(r.stdout).toContain("Feature");
  });

  it("json format emits the {id,name} array", () => {
    const r = runTool(["--format", "json"]);
    expect(r.status).toBe(0);
    const out = JSON.parse(r.stdout) as Array<{ id: string; name: string }>;
    expect(out).toEqual([
      { id: "IT_1", name: "Bug" },
      { id: "IT_2", name: "Feature" },
    ]);
  });

  it("simple format emits names only", () => {
    const r = runTool(["--format", "simple"]);
    expect(r.status).toBe(0);
    expect(r.stdout.split("\n").filter((l) => l !== "")).toEqual(["Bug", "Feature"]);
  });

  it("org resolves from DEVENV_REPO's owner when config org is absent", () => {
    rmSync(join(stubDir, "devenv.config"));
    const r = runTool([], { DEVENV_REPO: "myorg/whatever" });
    expect(r.status).toBe(0);
  });

  it("an unresolvable org is a defined failure", () => {
    rmSync(join(stubDir, "devenv.config"));
    const r = runTool([], { DEVENV_REPO: "" });
    // 15.8: the requireRepoTarget guard fires before the org lookup; the
    // wrapper's own catch prints the named remediation error and exits 1.
    expect(r.status).toBe(1);
    expect(r.output).toContain("no repository target resolved");
  });

  it("an empty type list is a named failure (org without issue types)", () => {
    writeFileSync(responses, `issueTypes(first:100)\t${JSON.stringify({ data: { organization: { issueTypes: { edges: [], pageInfo: { hasNextPage: false } } } } })}\n`);
    const r = runTool([]);
    expect(r.status).toBe(1);
    expect(r.output).toContain("No issue types returned");
  });

  it("an invalid format is a defined failure", () => {
    const r = runTool(["--format", "bogus"]);
    expect(r.status).toBe(1);
    expect(r.output).toContain("Invalid format");
  });
});
