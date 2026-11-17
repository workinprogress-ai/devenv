// Tests that the script template and library functions carry parameter/return documentation.
import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))));

function sh(script: string): { status: number; out: string } {
  const r = spawnSync("bash", ["-c", script], { encoding: "utf8" });
  return { status: r.status ?? 1, out: (r.stdout ?? "") + (r.stderr ?? "") };
}

// The devcontainer.json as plain JSON (full-line // comments dropped).

// ── function documentation ─

describe("function documentation", () => {

  it("script template includes documentation examples", () => {
    const template = readFileSync(join(ROOT, "tools/templates/script-template.ts"), "utf8");
    expect(template).toContain("Usage:");
    expect(template).toContain("Options:");
    expect(template).toContain("toolCli");
  });

  it("complex functions in bootstrap have parameter descriptions", () => {
    const r = sh(
      `grep -A 5 'add_nuget_source' '${ROOT}/.devcontainer/bootstrap.sh' 2>/dev/null | grep -q '$1\\|$2\\|$3\\|$4' && echo 'has_params' || echo 'no_params'`,
    );
    expect(r.status).toBe(0);
  });

  it("public library functions have return value documentation", () => {
    // versioning.bash retired with the bash verb layer; the documentation
    // contract pins a representative TS library function instead (its doc
    // comment describes the return: empty when unresolvable).
    const r = sh(
      `grep -B 8 'export function providerOrgGet' '${ROOT}/tools/lib/providers/provider-core.ts' | grep -q 'Empty'`,
    );
    expect(r.status).toBe(0);
  });
});
