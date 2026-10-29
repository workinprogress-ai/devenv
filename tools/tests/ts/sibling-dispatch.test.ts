// Sibling-dispatch contract: every cross-tool invocation from a TS tool
// resolves an exact path inside the tools root — either the depth-1 stub
// (join(toolsDir, "<tool>")) or, for the repo-get dispatcher family, the
// same-layer source (join(toolsDir, "ts", "<tool>.ts")) — never a stale
// source path and never a bare PATH lookup. Regression for the migration
// breakage where join(toolsDir, "scripts", "repo-get.ts") silently skipped
// repo-create's clone step.
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const toolsDir = join(repoRoot, "tools");

// External CLIs legitimately invoked via PATH (installed binaries, not
// devenv tools). Everything else that looks like a devenv tool name must
// be dispatched by exact path.
const externalCliAllowlist = new Set([
  "git", "node", "bash", "sh", "docker", "kubectl", "gh", "test", "ls",
  "cat", "rm", "cp", "mv", "mkdir", "echo", "sed", "grep", "find", "tar",
  "curl", "uname", "realpath", "basename", "dirname", "tee", "sort",
  "head", "tail", "wc", "xargs", "env", "which", "unzip", "mongodump",
  "mongorestore", "ssh", "sleep", "dotnet", "ps", "sudo", "od",
  "terraform", "telepresence", "yq",
]);

function toolsTsFiles(): string[] {
  return readdirSync(join(toolsDir, "ts"))
    .filter((f) => f.endsWith(".ts"))
    .map((f) => join(toolsDir, "ts", f));
}

// Matches spawnSync/spawn/execSync/execFileSync("name" ...) or run(["name" ...
// with a string-literal first argument.
const spawnCall =
  /(?:spawnSync|spawn|execSync|execFileSync|execFile)\(\s*(?:"([^"]+)"|'([^']+)')/g;
const runArrayFirst =
  /run\(\s*\[\s*(?:"([^"]+)"|'([^']+)')/g;

function isDevenvToolName(name: string): boolean {
  if (externalCliAllowlist.has(name)) return false;
  // devenv tool naming: dashed lowercase, matches a depth-1 stub or ts source
  if (!/^[a-z][a-z0-9-]*$/.test(name)) return false;
  return existsSync(join(toolsDir, name)) || existsSync(join(toolsDir, "ts", `${name}.ts`));
}

describe("sibling dispatch contract", () => {
  it("every devenv-tool spawn names an existing exact path, never a stale source path", () => {
    const violations: string[] = [];
    for (const file of toolsTsFiles()) {
      const src = readFileSync(file, "utf8");
      for (const m of src.matchAll(spawnCall)) {
        const name = m[1] ?? m[2] ?? "";
        if (name.includes("/") || name === "" || name.includes("$")) continue;
        if (isDevenvToolName(name)) {
          violations.push(`${file}: PATH-spawn of devenv tool "${name}"`);
        }
      }
      for (const m of src.matchAll(runArrayFirst)) {
        const name = m[1] ?? m[2] ?? "";
        if (name.includes("/") || name === "" || name.includes("$")) continue;
        if (isDevenvToolName(name)) {
          violations.push(`${file}: PATH-run of devenv tool "${name}"`);
        }
      }
      // Stale source paths: join(..., "scripts", "<x>.ts") — the TS bodies
      // moved to ts/; any remaining construction is dead.
      if (/join\([^)]*"scripts",\s*"[a-z0-9-]+\.ts"/.test(src)) {
        violations.push(`${file}: constructs a stale scripts/<x>.ts source path`);
      }
    }
    expect(violations, violations.join("\n")).toEqual([]);
  });

  it("every depth-1 stub referenced as a sibling resolves to a real file", () => {
    const violations: string[] = [];
    for (const file of toolsTsFiles()) {
      const src = readFileSync(file, "utf8");
      // join(toolsDir, "<tool>") where toolsDir is the module's tools root
      for (const m of src.matchAll(/join\(\s*(?:toolsDir|TOOLS_DIR)\s*,\s*"([a-z0-9-]+)"\s*\)/g)) {
        const name = m[1] ?? "";
        const p = join(toolsDir, name);
        if (!existsSync(p) || statSync(p).isDirectory()) {
          violations.push(`${file}: stub path "${name}" does not resolve (looking for ${p})`);
        }
      }
      // Same-layer family: join(toolsDir, "ts", "<x>.ts") must exist
      for (const m of src.matchAll(/join\(\s*(?:toolsDir|TOOLS_DIR)\s*,\s*"ts",\s*"([a-z0-9.-]+\.ts)"\s*\)/g)) {
        const p = join(toolsDir, "ts", m[1] ?? "");
        if (!existsSync(p)) {
          violations.push(`${file}: same-layer source "${m[1]}" does not exist`);
        }
      }
    }
    expect(violations, violations.join("\n")).toEqual([]);
  });
});
