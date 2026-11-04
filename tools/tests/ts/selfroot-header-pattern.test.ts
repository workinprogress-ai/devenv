// Port of tools/tests/scripts/test_selfroot_header_pattern.bats (6 tests).
// Anti-drift guard for the self-root resolver headers. Canonical wrapper
// header (depth-2 files): source
// "$(cd "$(dirname "${BASH_SOURCE[0]}")/../lib" && pwd)/self-root.bash".
// The old depth-probing block must never reappear, and no depth-1-relative
// source line may return.
import { describe, expect, it, vi } from "vitest";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const ROOT = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))));
const SCRIPTS_DIR = join(ROOT, "tools", "tests", "scripts");
const TOOLS_DIR = join(ROOT, "tools");
const TESTS_DIR = join(ROOT, "tools", "tests");
const LIB_DIR = join(ROOT, "tools", "tests", "lib");

const CANONICAL_LINE = 'source "$(cd "$(dirname "${BASH_SOURCE[0]}")/../lib" && pwd)/self-root.bash"';
const PROBE_LINE = '[ -f "$_srl/../lib/self-root.bash" ] && _srl_lib="$_srl/../lib"';
const DEPTH1_LINE = 'source "$(cd "$(dirname "${BASH_SOURCE[0]}")/lib" && pwd)/self-root.bash"';

describe("scripts/selfroot-header-pattern", () => {
  it("pattern setup: canonical header matches a known converted file", () => {
    // Probe a file KNOWN to carry the header (not the first .sh
    // alphabetically: underscore-prefixed event handlers predate the
    // canonical header).
    let probe = join(SCRIPTS_DIR, "artifact-header.sh");
    if (spawnSync("test", ["-f", probe]).status !== 0) {
      const r = spawnSync("grep", ["-rl", "self-root.bash", SCRIPTS_DIR, "--include=*.sh"], { encoding: "utf8" });
      probe = ((r.stdout ?? "").split("\n").filter(Boolean)[0]) ?? "";
    }
    if (!probe) {
      // skip: no .sh wrappers remain in tools/scripts
      expect(true).toBe(true);
      return;
    }
    const line = (spawnSync("grep", ["-m1", "self-root.bash", probe], { encoding: "utf8" }).stdout ?? "").trim();
    expect(line).toBe(CANONICAL_LINE);
  });

  it("pattern: every tools/scripts file with self-root uses the canonical line", () => {
    const find = spawnSync(
      "bash",
      ["-c", `find '${SCRIPTS_DIR}' -maxdepth 1 -type f -exec grep -lZ "self-root.bash" {} + 2>/dev/null`],
      { encoding: "utf8" },
    );
    const files = (find.stdout ?? "").split("\0").filter(Boolean);
    let bad = 0;
    for (const f of files) {
      if (spawnSync("grep", ["-qF", CANONICAL_LINE, f]).status !== 0) {
        console.error(`NON-CANONICAL HEADER: ${f}`);
        bad += 1;
      }
    }
    expect(bad).toBe(0);
  });

  it("pattern: harness uses the canonical line", () => {
    expect(spawnSync("grep", ["-qF", CANONICAL_LINE, join(TESTS_DIR, "run-devenv-tests.sh")]).status).toBe(0);
  });

  it("pattern: the old _srl depth probe is gone from all of tools/", () => {
    const hits = spawnSync(
      "grep",
      ["-rlF", PROBE_LINE, TOOLS_DIR, "--exclude-dir=cache", "--exclude=test_selfroot_header_pattern.bats", "--exclude=selfroot-header-pattern.test.ts"],
      { encoding: "utf8" },
    );
    expect(((hits.stdout ?? "").split("\n").filter(Boolean)).length).toBe(0);
  });

  it("pattern: no depth-1-relative source line in scripts/ or tests/", () => {
    const hits = spawnSync(
      "grep",
      ["-rlF", DEPTH1_LINE, SCRIPTS_DIR, TESTS_DIR, "--exclude=test_selfroot_header_pattern.bats", "--exclude=selfroot-header-pattern.test.ts"],
      { encoding: "utf8" },
    );
    expect(((hits.stdout ?? "").split("\n").filter(Boolean)).length).toBe(0);
  });

  it("lib files use devenv_self_root (their own canonical form), not the wrapper line", () => {
    const find = spawnSync(
      "bash",
      ["-c", `find '${LIB_DIR}' -maxdepth 1 -name "*.bash" -not -name "self-root.bash" -print0 2>/dev/null`],
      { encoding: "utf8" },
    );
    const files = (find.stdout ?? "").split("\0").filter(Boolean);
    let bad = 0;
    for (const f of files) {
      if (spawnSync("grep", ["-qF", CANONICAL_LINE, f]).status === 0) {
        console.error(`WRAPPER HEADER IN LIB: ${f}`);
        bad += 1;
      }
    }
    expect(bad).toBe(0);
  });
});
