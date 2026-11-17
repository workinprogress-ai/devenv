// Tests that no bash local redeclares a devenv convenience export.
import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const ROOT = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url))))); // file → ts → tests → tools → devenv root

// ── env-collision ──────────────

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
          join(ROOT, ".devcontainer"),
          "--include=*.bash",
          "--include=*.sh",
        ],
        { encoding: "utf8" },
      );
      if (r.stdout) offenders += r.stdout;
    }
    // failure message names the hazard class
    expect(offenders).toBe("");
  });
});
