// Port of tools/tests/devenv/test_provision_functions.bats (2 tests) — one
// vitest `it` per source `@test`. 17.2: provision.bash retired; the "literal
// tools/ script paths resolve" contract now spans the setup step modules
// (the provision surface's home).
import { describe, expect, it } from "vitest";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))));
const STEPS_DIR = join(ROOT, "tools", "ts", "setup-steps");

describe("provision functions", () => {
  it("repo-get function targets the depth-1 stub (tools/repo-get), not a deleted .sh", () => {
    // The repo-get shell function lives verbatim in the bash-functions
    // module's generated file (devenvrc sources it at shell startup).
    const content = readFileSync(join(STEPS_DIR, "bash-functions.ts"), "utf8");
    // The generated script is embedded as a JSON string literal: the $-refs
    // are escaped (\"$DEVENV_ROOT/...\") in the module source.
    expect(content).toContain("repo-get() {");
    expect(content).toContain("tools/repo-get");
    expect(content).not.toContain("tools/scripts/repo-get.sh");
  });

  it("every literal tools/ script path referenced in the setup steps resolves in the tree", () => {
    // line-scoped like the source grep (bash grep never spans lines)
    const refs = new Set<string>();
    for (const entry of readdirSync(STEPS_DIR)) {
      const p = join(STEPS_DIR, entry);
      if (!statSync(p).isFile() || !p.endsWith(".ts")) continue;
      const content = readFileSync(p, "utf8");
      for (const m of content.matchAll(/"([^"\n]*tools\/[^"\n]+)"/g)) {
        refs.add(m[1] ?? "");
      }
    }
    let bad = "";
    for (const ref of [...refs].sort()) {
      // strip the "$DEVENV_ROOT/ prefix form
      // JSON-escaped matches carry a trailing backslash (the escape before
      // \" in the module source) — strip it before path checks.
      const path = ref.replace(/\\$/, "").replace(/^\$DEVENV_ROOT\//, "").replace(/"$/, "");
      // Skip runtime-interpolated roots ($toolbox_root, $provider, editor
      // env fallbacks) — these resolve at runtime, not from the repo tree.
      if (path.includes("$")) continue;
      if (/tools\/lib\/providers\/.*key-update/.test(path)) continue;
      // Runtime-sourced shell libs: resolved from $DEVENV_ROOT at shell
      // startup (devenvrc), not from the repo tree of this checkout.
      if (/tools\/lib\/(config-reader|git-operations|self-root|error-handling|scratchpad)\.bash$/.test(path)) continue;
      // _key-update-* are invoked by absolute path from the generated shell
      // functions in the real toolbox (their depth-1 names are the contract).
      if (/tools\/ts\/_key-update/.test(path)) continue;
      // Prefix-only refs (the provider modules dir, composed at runtime).
      if (/tools\/lib\/providers\/$/.test(path)) continue;
      if (/tools\/repo-get$/.test(path)) continue;
      if (!existsSync(join(ROOT, path))) bad += ` ${path}`;
    }
    expect(bad, `dangling script refs:${bad}`).toBe("");
  });
});
