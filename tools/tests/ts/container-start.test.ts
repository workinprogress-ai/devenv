// Tests for container-start.sh locking
// mechanism and bootstrap coordination, exercised against a mock toolbox.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { spawnSync } from "node:child_process";
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const ROOT = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))));
const CS = join(ROOT, ".devcontainer/container-start.sh");

let TMP = "";
let HOME = "";
let TOOLBOX = "";

function grepBash(args: string[]): number {
  return spawnSync("grep", args, { encoding: "utf8" }).status ?? 1;
}

function grepFile(pattern: string, file: string): number {
  return grepBash([pattern, file]);
}

// Behavior: run container-start.sh against the mock toolbox.
function runContainerStart(): { status: number; out: string } {
  cpSync(CS, join(TOOLBOX, ".devcontainer/container-start.sh"));
  mkdirSync(join(TOOLBOX, ".runtime"), { recursive: true });
  mkdirSync(join(TOOLBOX, "repos/x"), { recursive: true });
  const r = spawnSync("bash", [join(TOOLBOX, ".devcontainer/container-start.sh")], {
    env: { ...process.env, HOME, MOCK_TOOLBOX: TOOLBOX },
    encoding: "utf8",
  });
  return { status: r.status ?? 1, out: (r.stdout ?? "") + (r.stderr ?? "") };
}

// _bootstrap_driver BODY: driver.sh sources bootstrap.bash then runs BODY —
// paths resolve from the script that sources bootstrap.bash, HOME is scratch.
function bootstrapDriver(body: string): { status: number; out: string } {
  mkdirSync(join(TOOLBOX, ".devcontainer"), { recursive: true });
  mkdirSync(join(TOOLBOX, ".runtime"), { recursive: true });
  cpSync(join(ROOT, ".devcontainer/bootstrap.bash"), join(TOOLBOX, ".devcontainer/bootstrap.bash"));
  writeFileSync(
    join(TOOLBOX, ".devcontainer/driver.sh"),
    `#!/bin/bash\nsource "$(dirname "$0")/bootstrap.bash"\n${body}\n`,
  );
  chmodSync(join(TOOLBOX, ".devcontainer/driver.sh"), 0o755);
  const r = spawnSync("bash", [join(TOOLBOX, ".devcontainer/driver.sh")], {
    env: { ...process.env, HOME, MOCK_TOOLBOX: TOOLBOX },
    encoding: "utf8",
  });
  return { status: r.status ?? 1, out: (r.stdout ?? "") + (r.stderr ?? "") };
}

const BOOTSTRAP_OK = [
  "#!/bin/bash",
  'echo "Bootstrap running"',
  'sleep 1',
  'date +%s > "$HOME/.bootstrap_container_time"',
  'date +%s > "$(dirname "$0")/.bootstrap_run_time"',
  'echo "Bootstrap completed"',
  "",
].join("\n");

beforeEach(() => {
  TMP = mkdtempSync(join(tmpdir(), `cstart-${Date.now()}-${Math.random().toString(36).slice(2)}`));
  HOME = join(TMP, "home");
  TOOLBOX = join(TMP, "toolbox");
  mkdirSync(HOME, { recursive: true });
  mkdirSync(join(TOOLBOX, ".devcontainer"), { recursive: true });
  writeFileSync(join(TOOLBOX, ".devcontainer/bootstrap.sh"), BOOTSTRAP_OK);
  chmodSync(join(TOOLBOX, ".devcontainer/bootstrap.sh"), 0o755);
  writeFileSync(join(TOOLBOX, ".devcontainer/startup.sh"), '#!/bin/bash\necho "Startup running"\n');
  chmodSync(join(TOOLBOX, ".devcontainer/startup.sh"), 0o755);
});

describe("container-start structure", () => {
  it("container-start.sh has valid bash syntax", () => {
    expect(spawnSync("bash", ["-n", CS]).status).toBe(0);
  });

  it("container-start.sh defines get_run_time function", () => {
    expect(grepFile("^function get_run_time()", CS)).toBe(0);
  });

  it("container-start.sh defines run_bootstrap function with locking", () => {
    expect(grepFile("run_bootstrap()", CS)).toBe(0);
    expect(grepFile("flock", CS)).toBe(0);
  });

  it("container-start.sh uses bootstrap lock file", () => {
    expect(grepFile("bootstrap_lock_file=", CS)).toBe(0);
  });

  it("container-start.sh checks bootstrap run times", () => {
    expect(grepFile("container_bootstrap_run_file=", CS)).toBe(0);
    expect(grepFile("repo_bootstrap_run_file=", CS)).toBe(0);
  });

  it("container-start.sh has timeout for lock acquisition", () => {
    expect(grepFile("max_wait=", CS)).toBe(0);
  });

  it("container-start.sh runs startup.sh when bootstrap is current", () => {
    expect(grepFile("startup.sh", CS)).toBe(0);
  });

  it("container-start.sh runs custom-startup.sh if present", () => {
    expect(grepFile("custom-startup.sh", join(ROOT, ".devcontainer/startup.sh"))).toBe(0);
  });

  it("container-start.sh warns when no repos are cloned", () => {
    expect(grepFile("No repos have been cloned yet", CS)).toBe(0);
  });

  it("container-start.sh sweeps stale /dev mounts before bootstrap dispatch", () => {
    expect(grepFile("^function sweep_stale_dev_mounts()", CS)).toBe(0);
    // The sweep consults mountinfo's deleted-source marker and is idempotent,
    // non-fatal per entry, and runs unconditionally before the dispatch.
    expect(grepFile("//deleted", CS)).toBe(0);
    expect(grepFile("could not unmount stale /dev entry", CS)).toBe(0);
    // The call site precedes the bootstrap/startup dispatch.
    const src = spawnSync("cat", [CS], { encoding: "utf8" }).stdout ?? "";
    const callIdx = src.indexOf("sweep_stale_dev_mounts\n");
    const dispatchIdx = src.indexOf('if [ ! -f "$container_bootstrap_run_file" ]');
    expect(callIdx).toBeGreaterThan(-1);
    expect(dispatchIdx).toBeGreaterThan(callIdx);
  });

  it("sweep_stale_dev_mounts: unmounts and removes stale /dev entries, skips non-/dev and tolerates failures", () => {
    // Behavior lock against a fixture mountinfo (DEVENV_MOUNTINFO_OVERRIDE
    // seam; production reads /proc/self/mountinfo) and a stubbed umount:
    // /dev entries with //deleted sources are unmounted; entries elsewhere
    // are untouched; a failing umount logs and continues.
    const fx = mkdtempSync(join(tmpdir(), "sweep-fx-"));
    try {
      // Real mountinfo layout: 4=root, 5=mount point; one line carries an
      // optional master: field (shifts only post-point fields).
      const mountinfo = [
        "4046 4298 0:7 /hidraw7//deleted /dev/hidraw7 rw,nosuid - devtmpfs udev rw",
        "4047 4298 0:7 /sound//deleted /run/sound rw - devtmpfs udev rw",
        "4048 4298 0:7 /input/event27//deleted /dev/input/event27 rw,nosuid master:2 - devtmpfs udev rw",
        "4049 4298 0:7 /live /dev/live rw - devtmpfs udev rw",
      ].join("\n");
      writeFileSync(join(fx, "mountinfo"), `${mountinfo}\n`);
      const bin = join(fx, "bin");
      mkdirSync(bin);
      writeFileSync(
        join(bin, "umount"),
        [
          "#!/usr/bin/env bash",
          'echo "umount $*" >> "${SWEEP_LOG:?}"',
          // Fail one /dev target to exercise the non-fatal path.
          'if [[ "$1" == "/dev/input/event27" ]]; then exit 1; fi',
          "exit 0",
          "",
        ].join("\n"),
      );
      writeFileSync(join(bin, "awk"), ["#!/usr/bin/env bash", "exec /usr/bin/awk \"$@\"", ""].join("\n"));
      chmodSync(join(bin, "umount"), 0o755);
      chmodSync(join(bin, "awk"), 0o755);
      const sweepFn = spawnSync("sed", ["-n", "/^function sweep_stale_dev_mounts/,/^}/p", CS], { encoding: "utf8" });
      expect(sweepFn.stdout).toContain("sweep_stale_dev_mounts");
      const r = spawnSync("bash", ["-c", sweepFn.stdout + "\nsweep_stale_dev_mounts"], {
        encoding: "utf8",
        env: {
          ...process.env,
          SWEEP_LOG: join(fx, "umount.log"),
          DEVENV_MOUNTINFO_OVERRIDE: join(fx, "mountinfo"),
          PATH: `${bin}:${process.env.PATH ?? ""}`,
        },
      });
      expect(r.status).toBe(0);
      const out = (r.stdout ?? "") + (r.stderr ?? "");
      expect(out).toContain("Swept stale /dev mount: /dev/hidraw7");
      expect(out).toContain("WARNING: could not unmount stale /dev entry: /dev/input/event27");
      const called = readFileSync(join(fx, "umount.log"), "utf8").split("\n").filter(Boolean);
      expect(called).toContain("umount /dev/hidraw7");
      expect(called).toContain("umount /dev/input/event27");
      expect(called).not.toContain("umount /run/sound");
      expect(called).not.toContain("umount /dev/live");
    } finally {
      rmSync(fx, { recursive: true, force: true });
    }
  });

  it("container-start.sh warns about missing cpuset delegation before bootstrap dispatch", () => {
    expect(grepFile("^function warn_missing_cpuset()", CS)).toBe(0);
    expect(grepFile("cpuset cgroup controller is not delegated", CS)).toBe(0);
    expect(grepFile("cpuset-delegate\\.sh", CS)).toBe(0);
    expect(grepFile("cpuset-live-toggle\\.sh", CS)).toBe(0);
    expect(grepFile("Dev-container-environment\\.md", CS)).toBe(0);
    // The call site precedes the bootstrap/startup dispatch.
    const src = spawnSync("cat", [CS], { encoding: "utf8" }).stdout ?? "";
    const callIdx = src.indexOf("warn_missing_cpuset\n");
    const dispatchIdx = src.indexOf('if [ ! -f "$container_bootstrap_run_file" ]');
    expect(callIdx).toBeGreaterThan(-1);
    expect(dispatchIdx).toBeGreaterThan(callIdx);
  });

  it("warn_missing_cpuset: loud when cpuset is absent, silent when present, non-fatal when unreadable", () => {
    // Behavior lock against fixture controller files (DEVENV_CGROUP_CONTROLLERS_OVERRIDE
    // seam; production reads /sys/fs/cgroup/cgroup.controllers).
    const runFn = (fixture: string) => {
      const fn = spawnSync("sed", ["-n", "/^function warn_missing_cpuset/,/^}/p", CS], { encoding: "utf8" });
      expect(fn.stdout).toContain("warn_missing_cpuset");
      return spawnSync("bash", ["-c", fn.stdout + "\nwarn_missing_cpuset; echo rc=$?"], {
        encoding: "utf8",
        env: {
          ...process.env,
          DEVENV_CGROUP_CONTROLLERS_OVERRIDE: fixture,
        },
      });
    };
    // cpuset absent -> loud warning naming both fix scripts + docs, exit 0.
    const fx = mkdtempSync(join(tmpdir(), "cpuset-fx-"));
    try {
      writeFileSync(join(fx, "no-cpuset"), "cpuset cpu memory pids\n".replace("cpuset ", ""));
      writeFileSync(join(fx, "with-cpuset"), "cpuset cpu memory pids\n");
      writeFileSync(join(fx, "trailing"), "cpusetX cpu memory pids\n");

      const absent = runFn(join(fx, "no-cpuset"));
      expect(absent.status).toBe(0);
      const absentOut = (absent.stdout ?? "") + (absent.stderr ?? "");
      expect(absentOut).toContain("cpuset cgroup controller is not delegated");
      expect(absentOut).toContain(".host/cpuset-delegate.sh");
      expect(absentOut).toContain(".host/cpuset-live-toggle.sh");
      expect(absentOut).toContain("Dev-container-environment.md");
      expect(absentOut).toContain("rc=0");

      // cpuset present -> silent (word match, not substring: cpusetX must not match).
      const present = runFn(join(fx, "with-cpuset"));
      expect(present.status).toBe(0);
      expect(((present.stdout ?? "") + (present.stderr ?? ""))).not.toContain("not delegated");
      const trailing = runFn(join(fx, "trailing"));
      expect(trailing.status).toBe(0);
      expect(((trailing.stdout ?? "") + (trailing.stderr ?? ""))).toContain("not delegated");

      // unreadable/missing file -> silent and non-fatal (grep failure is fine).
      const missing = runFn(join(fx, "does-not-exist"));
      expect(missing.status).toBe(0);
      expect(((missing.stdout ?? "") + (missing.stderr ?? ""))).not.toContain("not delegated");
      expect((missing.stdout ?? "")).toContain("rc=0");

      // empty file (exists, zero bytes) -> grep matches nothing: warn, exit 0.
      writeFileSync(join(fx, "empty"), "");
      const empty = runFn(join(fx, "empty"));
      expect(empty.status).toBe(0);
      expect(((empty.stdout ?? "") + (empty.stderr ?? ""))).toContain("not delegated");
    } finally {
      rmSync(fx, { recursive: true, force: true });
    }
  });
});

describe("container-start behavior", () => {
  it("get_run_time returns 0 for missing file", () => {
    const script = join(TMP, "test_get_run_time.sh");
    writeFileSync(
      script,
      [
        "#!/bin/bash",
        "function get_run_time() {",
        "  if [ ! -f $1 ]; then",
        '    echo "0"',
        "  else",
        "    cat $1",
        "  fi",
        "}",
        'result=$(get_run_time "/nonexistent/file")',
        'echo "$result"',
        "",
      ].join("\n"),
    );
    chmodSync(script, 0o755);
    const r = spawnSync(script, { encoding: "utf8" });
    expect(r.status).toBe(0);
    expect((r.stdout ?? "").trim()).toBe("0");
  });

  it("bootstrap lock prevents concurrent runs", () => {
    const script = join(TMP, "test_lock.sh");
    writeFileSync(
      script,
      [
        "#!/bin/bash",
        'lock_file="$1"',
        'exec 200>"$lock_file"',
        "",
        "if flock -n 200; then",
        '  echo "lock_acquired"',
        "  sleep 2",
        "else",
        '  echo "lock_blocked"',
        "fi",
        "",
      ].join("\n"),
    );
    chmodSync(script, 0o755);
    const lock = join(TMP, "test.lock");
    // Start first process in background (tracked by the OS, reaped below).
    const first = spawnSync("bash", ["-c", `"${script}" "${lock}" & p=$!; sleep 0.5; "${script}" "${lock}"; wait $p 2>/dev/null`], {
      encoding: "utf8",
    });
    expect(((first.stdout ?? "") + (first.stderr ?? "")).trim()).toContain("lock_blocked");
  });

  it("container-start.sh fails and says so when bootstrap fails", () => {
    writeFileSync(join(TOOLBOX, ".devcontainer/bootstrap.sh"), '#!/bin/bash\necho "Bootstrap running"\nexit 7\n');
    const r = runContainerStart();
    expect(r.status).toBe(7);
    expect(r.out).toContain("Bootstrap failed (exit 7)");
    expect(r.out).not.toContain("Bootstrap script executed");
  });

  it("a failed bootstrap leaves the next start to run bootstrap again", () => {
    // First start: bootstrap dies before writing the markers.
    writeFileSync(join(TOOLBOX, ".devcontainer/bootstrap.sh"), "#!/bin/bash\nexit 1\n");
    expect(runContainerStart().status).not.toBe(0);
    // Second start with a working bootstrap must run it, not the startup path.
    writeFileSync(
      join(TOOLBOX, ".devcontainer/bootstrap.sh"),
      [
        "#!/bin/bash",
        'echo "Bootstrap running"',
        'date +%s > "$HOME/.bootstrap_container_time"',
        'cp "$HOME/.bootstrap_container_time" "$(dirname "$0")/../.runtime/.bootstrap_run_time"',
        "",
      ].join("\n"),
    );
    const r = runContainerStart();
    expect(r.status).toBe(0);
    expect(r.out).toContain("Bootstrap running");
    expect(r.out).not.toContain("Startup running");
  });

  it("a completed bootstrap goes to startup.sh and the lock file is kept", () => {
    writeFileSync(join(HOME, ".bootstrap_container_time"), `${Math.floor(Date.now() / 1000)}\n`);
    mkdirSync(join(TOOLBOX, ".runtime"), { recursive: true });
    writeFileSync(join(TOOLBOX, ".runtime/.bootstrap_run_time"), `${Math.floor(Date.now() / 1000)}\n`);
    writeFileSync(join(HOME, ".bootstrap.lock"), "");
    const r = runContainerStart();
    expect(r.status).toBe(0);
    expect(r.out).toContain("Startup running");
    expect(existsSync(join(HOME, ".bootstrap.lock"))).toBe(true);
  });

  it("the lock file survives a successful bootstrap run", () => {
    writeFileSync(
      join(TOOLBOX, ".devcontainer/bootstrap.sh"),
      [
        "#!/bin/bash",
        'date +%s > "$HOME/.bootstrap_container_time"',
        'cp "$HOME/.bootstrap_container_time" "$(dirname "$0")/../.runtime/.bootstrap_run_time"',
        "",
      ].join("\n"),
    );
    const r = runContainerStart();
    expect(r.status).toBe(0);
    expect(existsSync(join(HOME, ".bootstrap.lock"))).toBe(true);
  });

  it("bootstrap and startup children do not inherit the lock descriptors", () => {
    writeFileSync(
      join(TOOLBOX, ".devcontainer/bootstrap.sh"),
      [
        "#!/bin/bash",
        'for fd in 200 201; do [ -e "/proc/self/fd/$fd" ] && echo "bootstrap-fd$fd-open"; done',
        'echo "bootstrap-fds-checked"',
        'date +%s > "$HOME/.bootstrap_container_time"',
        'cp "$HOME/.bootstrap_container_time" "$(dirname "$0")/../.runtime/.bootstrap_run_time"',
        "",
      ].join("\n"),
    );
    const r = runContainerStart();
    expect(r.out).toContain("bootstrap-fds-checked");
    expect(r.out).not.toContain("-open");
  });

  it("one marker present and one missing counts as not completed: bootstrap runs again", () => {
    writeFileSync(join(HOME, ".bootstrap_container_time"), `${Math.floor(Date.now() / 1000)}\n`); // no repo marker
    writeFileSync(
      join(TOOLBOX, ".devcontainer/bootstrap.sh"),
      [
        "#!/bin/bash",
        'echo "Bootstrap running"',
        'date +%s > "$HOME/.bootstrap_container_time"',
        'cp "$HOME/.bootstrap_container_time" "$(dirname "$0")/../.runtime/.bootstrap_run_time"',
        "",
      ].join("\n"),
    );
    chmodSync(join(TOOLBOX, ".devcontainer/bootstrap.sh"), 0o755);
    const r = runContainerStart();
    expect(r.status).toBe(0);
    expect(r.out).toContain("Bootstrap running");
    expect(r.out).not.toContain("Startup running");
  });

  it("markers that disagree count as not completed: bootstrap runs again", () => {
    mkdirSync(join(TOOLBOX, ".runtime"), { recursive: true });
    writeFileSync(join(HOME, ".bootstrap_container_time"), "111\n");
    writeFileSync(join(TOOLBOX, ".runtime/.bootstrap_run_time"), "222\n");
    writeFileSync(
      join(TOOLBOX, ".devcontainer/bootstrap.sh"),
      [
        "#!/bin/bash",
        'echo "Bootstrap running"',
        'date +%s > "$HOME/.bootstrap_container_time"',
        'cp "$HOME/.bootstrap_container_time" "$(dirname "$0")/../.runtime/.bootstrap_run_time"',
        "",
      ].join("\n"),
    );
    chmodSync(join(TOOLBOX, ".devcontainer/bootstrap.sh"), 0o755);
    const r = runContainerStart();
    expect(r.status).toBe(0);
    expect(r.out).toContain("Bootstrap running");
  });

  it("startup.sh, like bootstrap, is started without the lock descriptors", () => {
    mkdirSync(join(TOOLBOX, ".runtime"), { recursive: true });
    writeFileSync(join(HOME, ".bootstrap_container_time"), `${Math.floor(Date.now() / 1000)}\n`);
    writeFileSync(join(TOOLBOX, ".runtime/.bootstrap_run_time"), `${Math.floor(Date.now() / 1000)}\n`);
    writeFileSync(
      join(TOOLBOX, ".devcontainer/startup.sh"),
      [
        "#!/bin/bash",
        'for fd in 200 201; do [ -e "/proc/self/fd/$fd" ] && echo "startup-fd$fd-open"; done',
        'echo "startup-fds-checked"',
        "",
      ].join("\n"),
    );
    chmodSync(join(TOOLBOX, ".devcontainer/startup.sh"), 0o755);
    const r = runContainerStart();
    expect(r.out).toContain("startup-fds-checked");
    expect(r.out).not.toContain("-open");
  });

  it("init_bootstrap_run_time clears the real markers it resolves itself", () => {
    const r = bootstrapDriver("init_bootstrap_run_time");
    writeFileSync(join(HOME, ".bootstrap_container_time"), "1\n");
    writeFileSync(join(TOOLBOX, ".runtime/.bootstrap_run_time"), "1\n");
    const run = bootstrapDriver("init_bootstrap_run_time");
    void r;
    expect(run.status).toBe(0);
    expect(existsSync(join(HOME, ".bootstrap_container_time"))).toBe(false);
    expect(existsSync(join(TOOLBOX, ".runtime/.bootstrap_run_time"))).toBe(false);
  });

  it("the markers stay absent when a task after init_bootstrap_run_time fails", () => {
    bootstrapDriver("init_bootstrap_run_time");
    writeFileSync(join(HOME, ".bootstrap_container_time"), "1\n");
    writeFileSync(join(TOOLBOX, ".runtime/.bootstrap_run_time"), "1\n");
    const run = bootstrapDriver("failing_task() { return 1; }\nrun_bootstrap_tasks init_bootstrap_run_time failing_task");
    expect(run.status).not.toBe(0);
    expect(run.out).toContain("Task failed: failing_task");
    expect(existsSync(join(HOME, ".bootstrap_container_time"))).toBe(false);
    expect(existsSync(join(TOOLBOX, ".runtime/.bootstrap_run_time"))).toBe(false);
  });

  it("init_bootstrap_run_time comes before initialize_paths in the default task list", () => {
    const content = (spawnSync("sed", ["-n", "/local default_tasks=(/,/^    )/p", join(ROOT, ".devcontainer/bootstrap.bash")], { encoding: "utf8" }).stdout ?? "");
    const lines = content.split("\n");
    const initLine = lines.findIndex((l) => /^ *init_bootstrap_run_time$/.test(l));
    const pathsLine = lines.findIndex((l) => /^ *initialize_paths$/.test(l));
    expect(initLine).toBeGreaterThanOrEqual(0);
    expect(pathsLine).toBeGreaterThanOrEqual(0);
    expect(initLine).toBeLessThan(pathsLine);
  });
});
