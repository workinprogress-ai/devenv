// Self-locating harness tests (port of test_self_locating_harness.bats):
// regression for the wrong-suite hazard — an exported DEVENV_TOOLS pointing
// at a foreign tree must not redirect devenv's own tools. Asserts resolution
// identity, never test counts.
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdirSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const PROJECT_ROOT = join(__dirname, "../../..");
const RUN_TESTS = join(PROJECT_ROOT, "tools/tests/run-devenv-tests.sh");
const LINT_SCRIPTS = join(PROJECT_ROOT, "tools/ts/lint-scripts.ts");
const LINT_DOCS = join(PROJECT_ROOT, "tools/ts/lint-documentation.ts");
const RESOLVER = join(PROJECT_ROOT, "tools/lib/core/self-root.ts");

let tmp: string;

beforeEach(() => {
  tmp = join(tmpdir(), `selfloc-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(tmp, { recursive: true });
});

afterEach(() => rmSync(tmp, { recursive: true, force: true }));

describe("self-locating harness", () => {
  it("setup: harness and resolver exist", () => {
    expect(existsSync(RUN_TESTS)).toBe(true);
    expect(existsSync(RESOLVER)).toBe(true);
  });

  it("tool resolution identity: resolver keyed on a tool path yields own checkout despite foreign DEVENV_TOOLS", () => {
    // The tools resolve via selfRoot/resolveToolsRoot keyed on their own path;
    // probing the resolver with a tool's path asserts the identity.
    const r = spawnSync(
      "node",
      [
        "--input-type=module",
        "-e",
        `import { dirname } from "node:path";
import { resolveToolsRoot } from ${JSON.stringify(join(PROJECT_ROOT, "tools/lib/core/self-root.ts"))};
const tools = resolveToolsRoot(${JSON.stringify(LINT_SCRIPTS)});
process.stdout.write(dirname(tools));`,
      ],
      { encoding: "utf8", env: { ...process.env, DEVENV_TOOLS: "/nonexistent/foreign/tools" } },
    );
    expect(r.status).toBe(0);
    expect(r.stdout).toBe(PROJECT_ROOT);
  });

  it("lint-scripts survives foreign DEVENV_TOOLS/DEVENV_ROOT", () => {
    const r = spawnSync("node", [LINT_SCRIPTS, "--help"], {
      encoding: "utf8",
      env: { ...process.env, DEVENV_TOOLS: "/nonexistent/foreign/tools", DEVENV_ROOT: "/nonexistent/foreign" },
    });
    expect(r.status).toBe(0);
  });

  it("lint-documentation self-derives DEVENV_ROOT despite foreign env", () => {
    const r = spawnSync("bash", ["-c", `printf '' | node '${LINT_DOCS}' /dev/null 2>&1`], {
      encoding: "utf8",
      env: { ...process.env, DEVENV_ROOT: "/nonexistent/foreign", DEVENV_TOOLS: "/nonexistent/foreign/tools" },
    });
    const out = r.stdout ?? "";
    // Must not die with the old 'DEVENV_ROOT is not set' or foreign-path
    // errors; /dev/null as file arg exits cleanly (nothing to lint).
    expect(out).not.toContain("DEVENV_ROOT is not set");
    expect(out).not.toContain("/nonexistent/foreign");
  });
});

// The harness-copied-to-bare-checkout sentinel proof stays in the bats suite:
// it executes the whole bats runner, which is the bats harness's own concern
// (hook/signal machinery stays bats per Tooling-Standards). The two suites
// complement: this file covers the tool-side identity, the bats suite covers
// the runner-side identity.
