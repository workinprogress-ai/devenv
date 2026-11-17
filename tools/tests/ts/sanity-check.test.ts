// Port of tools/tests/devenv/test_sanity_check.bats (5 tests) — one vitest `it` per source `@test`.
import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync, chmodSync, copyFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { canaryEnv } from "./harness/canary.ts";

const ROOT = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))));

// Port of tools/tests/devenv/test_sanity_check.bats — one vitest `it` per source `@test`.

// ── sanity-check (port of test_sanity_check.bats, 5 tests) ───────────────
// sanity-check.sh is sourced by the generated shell rc at every shell start;
// its bootstrap run-time warning must appear only when the container's and
// the repo's run times really differ.

describe("sanity-check", () => {
  let root: string;
  let homeDir: string;

  function setup(): void {
    root = mkdtempSync(join(tmpdir(), "sanity-"));
    homeDir = join(root, "home");
    mkdirSync(join(root, ".devcontainer"), { recursive: true });
    mkdirSync(join(root, ".runtime"), { recursive: true });
    mkdirSync(join(root, "tools"), { recursive: true });
    mkdirSync(homeDir, { recursive: true });
    copyFileSync(join(ROOT, ".devcontainer/sanity-check.sh"), join(root, ".devcontainer", "sanity-check.sh"));
    // The update check is not under test here.
    writeFileSync(join(root, ".devcontainer", "check-update-devenv-repo.sh"), "#!/bin/bash\nexit 0\n");
    // The wrapper smoke check wants a working next-id; give it one.
    writeFileSync(join(root, "tools", "next-id"), "#!/bin/bash\nexit 0\n");
    chmodSync(join(root, ".devcontainer", "check-update-devenv-repo.sh"), 0o755);
    chmodSync(join(root, "tools", "next-id"), 0o755);
  }

  // Source the script the way the rc does, in a clean environment.
  function sourceSanity(): { status: number; out: string } {
    const r = spawnSync(
      "bash",
      ["-c", `source '${root}/.devcontainer/sanity-check.sh'; echo "rc=$?"`],
      { encoding: "utf8", env: { ...canaryEnv("/usr/bin:/bin"), HOME: homeDir, DEVENV_ROOT: root } },
    );
    return { status: r.status ?? 1, out: (r.stdout ?? "") + (r.stderr ?? "") };
  }

  it("matching bootstrap run times: no warning", () => {
    setup();
    writeFileSync(join(homeDir, ".bootstrap_container_time"), "1700000000\n");
    writeFileSync(join(root, ".runtime", ".bootstrap_run_time"), "1700000000\n");
    const r = sourceSanity();
    expect(r.out).not.toContain("WARNING");
    expect(r.out).toContain("rc=0");
  });

  it("neither run-time file present (fresh container): no warning", () => {
    setup();
    const r = sourceSanity();
    expect(r.out).not.toContain("WARNING");
  });

  it("differing bootstrap run times: warns to rebuild", () => {
    setup();
    writeFileSync(join(homeDir, ".bootstrap_container_time"), "1700000000\n");
    writeFileSync(join(root, ".runtime", ".bootstrap_run_time"), "1700009999\n");
    const r = sourceSanity();
    expect(r.out).toContain("bootstrap run time does not match");
    expect(r.out).toContain("rebuild");
  });

  it("sourcing it leaves no helper function or variable behind in the shell", () => {
    setup();
    // env -i like the bats original: the leak check runs in a clean shell, so
    // the vitest process's own environment cannot contribute names. The inner
    // script goes through a temp file — no nested-quoting hazards.
    const inner = join(root, "leak-check.sh");
    writeFileSync(inner, [
      "before=$(compgen -A function; compgen -v)",
      `source '${root}/.devcontainer/sanity-check.sh' >/dev/null 2>&1`,
      "after=$(compgen -A function; compgen -v)",
      'diff <(echo "$before" | sort) <(echo "$after" | sort) \\',
      "  | grep '^>' | grep -v -E 'BASH_|_=|before|after|OLDPWD|PIPESTATUS|DEVENV_SANITY_CHECKED' || true",
    ].join("\n"));
    const r = spawnSync("bash", ["-c", `env -i HOME='${homeDir}' PATH=/usr/bin:/bin DEVENV_ROOT='${root}' bash '${inner}'`], {
      encoding: "utf8",
    });
    expect(r.stdout ?? "").toBe("");
  });

  it("a nested shell does not repeat the checks the parent already ran", () => {
    setup();
    writeFileSync(join(homeDir, ".bootstrap_container_time"), "1700000000\n");
    writeFileSync(join(root, ".runtime", ".bootstrap_run_time"), "1700009999\n");
    const r = spawnSync(
      "bash",
      ["-c", `source '${root}/.devcontainer/sanity-check.sh'; bash -c "source '${root}/.devcontainer/sanity-check.sh'"`],
      { encoding: "utf8", env: { ...canaryEnv("/usr/bin:/bin"), HOME: homeDir, DEVENV_ROOT: root } },
    );
    const out = (r.stdout ?? "") + (r.stderr ?? "");
    expect(out.match(/bootstrap run time does not match/g)).toHaveLength(1);
  });

  it("the script has no backslash-escaped dollars (the eval-expansion pretense)", () => {
    // Plain source treats \$ as a literal dollar sign, which is what made the
    // run-time comparison compare two different literal strings.
    const r = spawnSync("grep", ["-nF", "\\$", join(ROOT, ".devcontainer/sanity-check.sh")], { encoding: "utf8" });
    expect(r.status).toBe(1);
  });
});
