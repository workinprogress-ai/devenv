// Port of tools/tests/devenv/test_env_collision.bats (1 test) — one vitest `it` per source `@test`.
import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const ROOT = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url))))); // file → ts → tests → tools → devenv root

// Port of tools/tests/devenv/test_env_collision.bats — one vitest `it` per source `@test`.

// ── env-collision (port of test_env_collision.bats, 1 test) ──────────────

describe("env-collision", () => {
  it("no bash local redeclares a devenv convenience export", () => {
    // Bash locals inherit the export attribute of a same-named exported
    // global; past MAX_ARG_STRLEN every child process fails with E2BIG.
    // The convention: same-named locals are banned (repos_list, not repos).
    const convenienceExports = ["repos", "playground", "debug"];
    let offenders = "";
    for (const name of convenienceExports) {
      const r = spawnSync(
        "grep",
        [
          "-rEn",
          `local[[:space:]]+"?${name}"?([[:space:]=]|$)`,
          join(ROOT, "tools/lib"),
          join(ROOT, "tools/scripts"),
          join(ROOT, ".devcontainer"),
          "--include=*.bash",
          "--include=*.sh",
        ],
        { encoding: "utf8" },
      );
      if (r.stdout) offenders += r.stdout;
    }
    // failure message names the hazard class (same as the bats `fail`)
    expect(offenders).toBe("");
  });
});
