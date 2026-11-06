// Port of test_test_helper.bats (3 tests): the bash test helper's isolation
// contract — provider detection isolated from real config, inherited provider
// selection cannot leak in, and the teardown config-mutation guard never
// invokes git.
import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))));
const HELPER = join(ROOT, "tools/tests/test_helper.bash");

function sh(script: string, env: Record<string, string> = {}): { status: number; out: string } {
  const r = spawnSync("bash", ["-c", script], { encoding: "utf8", env: { ...process.env, ...env } });
  return { status: r.status ?? 1, out: (r.stdout ?? "") + (r.stderr ?? "") };
}

describe("test helper isolation", () => {
  it("default provider detection is isolated from the real repo config", () => {
    // Drive the helper the way a bats test does: test_helper_setup creates a
    // scratch TEST_TEMP_DIR with its own devenv.config and points DEVENV_ROOT
    // at it; provider_detect must then answer github from the FIXTURE config,
    // never from the real tree. The child env drops an inherited DEVENV_ROOT
    // (the runtime workspace exports one; the helper must not depend on it —
    // that is exactly the leak this test pins).
    const r = spawnSync(
      "bash",
      [
        "-c",
        `source "$1"\ntest_helper_setup\ntrap test_helper_teardown EXIT\n` +
        `unset _PROVIDER_CORE_LOADED PROVIDER_NAME\n` +
        `source "$PROJECT_ROOT/tools/lib/providers/provider-core.bash"\nprovider_detect\n` +
        `echo "root=\$DEVENV_ROOT"\necho "provider=\$PROVIDER_NAME"`,
        "bash",
        HELPER,
      ],
      {
        encoding: "utf8",
        env: (() => {
          const e: Record<string, string> = {};
          for (const [k, v] of Object.entries(process.env)) {
            if (v !== undefined && k !== "DEVENV_ROOT" && k !== "DEVENV_TOOLS" && k !== "DEVENV_ROOT_SET") e[k] = v;
          }
          e["BATS_TEST_DIRNAME"] = join(ROOT, "tools/tests/lib");
          return e;
        })(),
      },
    );
    const out = (r.stdout ?? "") + (r.stderr ?? "");
    expect(out).toContain("provider=github");
    // DEVENV_ROOT (the scratch fixture) must differ from PROJECT_ROOT (real tree)
    expect(out).toMatch(/root=/);
    expect(out).not.toContain(`root=${ROOT}`);
    // The detection ran against the fixture config: DEVENV_ROOT lives under
    // the helper's per-run TEST_TEMP_DIR (/tmp/…/devenv-root), never the
    // checkout — regardless of what the calling shell exported.
    expect(out).toMatch(/root=.*\/devenv-root/);
  });

  it("inherited Azure selection cannot override GitHub fixture URL matching", () => {
    const r = spawnSync(
      "bash",
      [
        "-c",
        `source "$1"\ntest_helper_setup\ntrap test_helper_teardown EXIT\n` +
        `source "$PROJECT_ROOT/tools/lib/provider-loader.bash"\n` +
        `printf "provider=%s\\n" "$PROVIDER_NAME"\n` +
        `printf "%s\\n" "https://github.com/test-org/test-repo/pull/1" | provider_extract_url`,
        "bash",
        HELPER,
      ],
      {
        encoding: "utf8",
        env: { ...process.env, PROVIDER_NAME: "azure", BATS_TEST_DIRNAME: join(ROOT, "tools/tests/lib") },
      },
    );
    expect(r.status ?? 1).toBe(0);
    expect(r.stdout ?? "").toContain("provider=github");
    expect(r.stdout ?? "").toContain("https://github.com/test-org/test-repo/pull/1");
  });

  it("test helper teardown fails on config mutation without invoking git", () => {
    const fakeRoot = mkdtempSync(join(tmpdir(), `thguard-${Date.now()}-${Math.random().toString(36).slice(2)}`));
    const gitLog = join(fakeRoot, "git.log");
    try {
      mkdirSync(join(fakeRoot, "bin"), { recursive: true });
      writeFileSync(join(fakeRoot, "devenv.config"), "before\n");
      writeFileSync(join(fakeRoot, "bin/git"), '#!/usr/bin/env bash\nprintf \'%s\\n\' "$*" >> "$GIT_CALL_LOG"\n');
      chmodSync(join(fakeRoot, "bin/git"), 0o755);
      const hash = sh(`md5sum '${join(fakeRoot, "devenv.config")}' | cut -d' ' -f1`).out.trim();
      const r = sh(
        `source '${HELPER}'\n` +
        `export PROJECT_ROOT='${fakeRoot}'\n` +
        `_REAL_CONFIG_HASH='${hash}'\nexport _REAL_CONFIG_HASH\n` +
        `export GIT_CALL_LOG='${gitLog}' PATH='${join(fakeRoot, "bin")}:$PATH'\n` +
        `printf 'after\\n' > '${join(fakeRoot, "devenv.config")}'\n` +
        `test_helper_teardown`,
        { BATS_TEST_DIRNAME: join(ROOT, "tools/tests/lib") },
      );
      expect(r.status).not.toBe(0);
      expect(r.out).toContain("TEST-ISOLATION VIOLATION");
      expect(spawnSync("bash", ["-c", `[ -e '${gitLog}' ]`]).status ?? 1).not.toBe(0); // git never invoked
      expect(sh(`cat '${join(fakeRoot, "devenv.config")}'`).out).toBe("after\n"); // content untouched by teardown
    } finally {
      rmSync(fakeRoot, { recursive: true, force: true });
    }
  });
});
