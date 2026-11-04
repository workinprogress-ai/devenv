// Port of tools/tests/devenv/test_provision_functions.bats (2 tests) — one vitest `it` per source `@test`.
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))));

// Port of tools/tests/devenv/test_provision_functions.bats — one vitest `it` per source `@test`.

// ── provision functions (port of test_provision_functions.bats, 2 tests) ─

describe("provision functions", () => {
  const provision = join(ROOT, "tools/lib/provision.bash");

  it("repo-get function targets the depth-1 stub (tools/repo-get), not a deleted .sh", () => {
    const content = readFileSync(provision, "utf8");
    expect(content).toContain('bash "$DEVENV_ROOT/tools/repo-get"');
    expect(content).not.toContain("tools/scripts/repo-get.sh");
  });

  it("every literal tools/ script path referenced in provision.bash resolves in the tree", () => {
    const content = readFileSync(provision, "utf8");
    // line-scoped like the source grep (bash grep never spans lines)
    const refs = [...new Set([...content.matchAll(/"([^"\n]*tools\/[^"\n]+)"/g)].map((m) => m[1]!))].sort();
    let bad = "";
    for (const ref of refs) {
      // strip the "$DEVENV_ROOT/ prefix form
      const path = ref.replace(/^\$DEVENV_ROOT\//, "").replace(/"$/, "");
      // Skip runtime-interpolated roots ($toolbox_root, $provider, editor
      // env fallbacks) — these resolve at runtime, not from the repo tree.
      if (path.includes("$")) continue;
      if (/tools\/lib\/providers\/.*key-update/.test(path)) continue;
      if (!existsSync(join(ROOT, path))) bad += ` ${path}`;
    }
    expect(bad, `dangling script refs:${bad}`).toBe("");
  });
});
