import { describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))));
const TOGGLE = join(ROOT, ".host", "cpuset-live-toggle.sh");
const DELEGATE = join(ROOT, ".host", "cpuset-delegate.sh");
const SETUP = join(ROOT, "setup");
const K3D_INSTALLER = join(ROOT, ".devcontainer", "install-extras", "k3d.sh");

/**
 * Behavior locks for the live-toggle's chain walk against a fake cgroup v2
 * tree (DEVENV_CGROUP_SYSFS_OVERRIDE seam; production reads /sys/fs/cgroup).
 * The walk order is the load-bearing behavior: cgroup v2 only exposes a
 * controller at a level after its parent's subtree_control enables it, so
 * the walk must go shallowest→deepest. A regression to bottom-up fails at
 * the deepest level first and never reaches the ancestors where the write
 * is necessary.
 */
describe("cpuset-live-toggle chain walk", () => {
  type Level = { path: string; controllers: string; writable?: boolean; refuseWrite?: boolean };

  const buildTree = (root: string, levels: Level[]): void => {
    // The cgroup root: every tree carries cgroup.controllers (the v2 check)
    // and a writable subtree_control (the walk's first write target).
    writeFileSync(join(root, "cgroup.controllers"), "cpuset cpu memory pids\n");
    writeFileSync(join(root, "cgroup.subtree_control"), "\n");
    for (const lvl of levels) {
      const dir = join(root, lvl.path.replace(/^\//, ""));
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, "cgroup.controllers"), `${lvl.controllers}\n`);
      const sc = join(dir, "cgroup.subtree_control");
      writeFileSync(sc, "\n");
      if (lvl.refuseWrite) {
        // A subtree_control that refuses writes: stub via chmod a-w is not
        // enough (root ignores it), so emulate with a directory instead —
        // echo > dir fails. Only used by the refusal case.
        rmSync(sc);
        mkdirSync(sc);
      }
    }
  };

  const runToggle = (root: string, chain: string) =>
    spawnSync("bash", [TOGGLE, "--chain", chain], {
      encoding: "utf8",
      env: {
        ...process.env,
        DEVENV_CGROUP_SYSFS_OVERRIDE: root,
        // Skip the sudo re-exec in the test environment (tests run as the
        // container user; the walk only needs the writable fake tree).
        DEVENV_TOGGLE_SKIP_ELEVATE: "1",
      },
    });

  it("walks shallowest→deepest: the root write happens before the deepest level's", () => {
    const fx = mkdtempSync(join(tmpdir(), "cpuset-walk-"));
    try {
      const chain = "/user.slice/user-1000.slice/user@1000.service/user.slice/libpod-abc.scope/container/init";
      buildTree(fx, [
        { path: "/user.slice", controllers: "cpu io memory pids" },
        { path: "/user.slice/user-1000.slice", controllers: "cpu io memory pids" },
        { path: "/user.slice/user-1000.slice/user@1000.service", controllers: "cpu io memory pids" },
        { path: "/user.slice/user-1000.slice/user@1000.service/user.slice", controllers: "cpu io memory pids" },
        { path: "/user.slice/user-1000.slice/user@1000.service/user.slice/libpod-abc.scope", controllers: "cpu io memory pids" },
        { path: "/user.slice/user-1000.slice/user@1000.service/user.slice/libpod-abc.scope/container", controllers: "cpu io memory pids" },
        { path: "/user.slice/user-1000.slice/user@1000.service/user.slice/libpod-abc.scope/container/init", controllers: "cpu io memory pids" },
      ]);
      const r = runToggle(fx, chain);
      expect(r.status).toBe(0);
      const out = (r.stdout ?? "") + (r.stderr ?? "");
      expect(out).toContain("Result: cpuset enabled down the chain");
      // The walk-order lock: the root's subtree_control line must be printed
      // before the deepest level's — i.e. the first "+cpuset ->" targets the
      // root, the last targets the deepest prefix.
      const writes = out
        .split("\n")
        .filter((l) => l.includes("+cpuset ->"))
        .map((l) => l.split("->")[1]?.trim() ?? "");
      expect(writes.length).toBe(8); // root + 7 prefixes
      expect(writes[0]).toBe(join(fx, "cgroup.subtree_control"));
      const deepest = `${fx}/${chain.slice(1)}/cgroup.subtree_control`;
      expect(writes[writes.length - 1]).toBe(deepest);
      // The writes actually landed.
      expect(readFileSync(join(fx, "cgroup.subtree_control"), "utf8")).toContain("+cpuset");
    } finally {
      rmSync(fx, { recursive: true, force: true });
    }
  });

  it("stops with the delegate pointer when a level lacks cpuset in its available set", () => {
    const fx = mkdtempSync(join(tmpdir(), "cpuset-walk-"));
    try {
      const chain = "/user.slice/libpod-abc.scope";
      // The scope's subtree_control is a directory: the echo write fails,
      // and its controllers file lacks cpuset — the exact kernel refusal
      // shape the stop-diagnosis branch handles.
      mkdirSync(join(fx, "user.slice", "libpod-abc.scope", "cgroup.subtree_control"), { recursive: true });
      writeFileSync(join(fx, "cgroup.controllers"), "cpuset cpu memory pids\n");
      writeFileSync(join(fx, "user.slice", "cgroup.controllers"), "cpu memory pids\n");
      writeFileSync(join(fx, "user.slice", "libpod-abc.scope", "cgroup.controllers"), "cpu memory pids\n");
      const r = runToggle(fx, chain);
      expect(r.status).toBe(1);
      const out = (r.stdout ?? "") + (r.stderr ?? "");
      expect(out).toContain("stop: cpuset not in available set");
      expect(out).toContain("cpuset-delegate.sh");
    } finally {
      rmSync(fx, { recursive: true, force: true });
    }
  });

  it("refuses on non-v2 hosts instead of fabricating a zero-write success", () => {
    const fx = mkdtempSync(join(tmpdir(), "cpuset-walk-"));
    try {
      // No cgroup.controllers anywhere — a v1/non-Linux shape.
      const r = runToggle(fx, "/user.slice");
      expect(r.status).toBe(1);
      const out = (r.stdout ?? "") + (r.stderr ?? "");
      expect(out).toContain("cgroup v2 required");
    } finally {
      rmSync(fx, { recursive: true, force: true });
    }
  });
});

describe("setup cpuset offer-hook (structure lock)", () => {
  const src = readFileSync(SETUP, "utf8");

  it("offers the delegate script once per machine behind a systemd check", () => {
    expect(src).toContain('[ -d /run/systemd/system ]');
    expect(src).toContain('$SETUP_DIR/cpuset_delegated');
    expect(src).toContain('"$toolbox_root/.host/cpuset-delegate.sh"');
    // The offer text names the failure mode (k3d hang) so the user can
    // connect the prompt to the documented warning.
    expect(src).toContain("k3d");
  });

  it("marks the offer as made on decline but NOT on install failure", () => {
    // The decline leg owns the unconditional touch; the failure leg must
    // leave the marker absent so the next setup run re-offers the retry.
    const decline = src.indexOf("Declining records the offer was made");
    const failure = src.indexOf("cpuset delegation install failed");
    const success = src.indexOf("cpuset delegation installed");
    expect(decline).toBeGreaterThan(-1);
    expect(failure).toBeGreaterThan(-1);
    expect(success).toBeGreaterThan(-1);
    // The unconditional marker touch sits between decline-comment and the
    // end of the hook; the failure branch (between success and decline
    // legs) must contain no marker write.
    const hookStart = src.indexOf("Enabling k3d cluster support");
    const hookEnd = src.indexOf("# Check write permission", hookStart);
    const hook = src.slice(hookStart, hookEnd);
    const touches = [...hook.matchAll(/touch "\$SETUP_DIR\/cpuset_delegated"/g)];
    expect(touches.length).toBe(2); // success leg + decline leg only
  });
});

describe("k3d installer cpuset pre-flight", () => {
  // The tool that actually depends on cpuset (k3d cluster creation — k3s
  // hard-requires the controller) checks the environment before claiming
  // success: a machine where clusters cannot start must say so at install
  // time, not leave the user to decode a kubelet hang. Behavior lock via
  // the same DEVENV_CGROUP_CONTROLLERS_OVERRIDE seam as warn_missing_cpuset.
  const runInstallerPreflight = (controllersFile: string) => {
    // Extract just the pre-flight block: everything before ARCH detection.
    const script = readFileSync(K3D_INSTALLER, "utf8");
    const cut = script.indexOf("ARCH=$(uname -m)");
    expect(cut).toBeGreaterThan(-1);
    const preflight = script.slice(0, cut);
    return spawnSync("bash", ["-c", preflight + 'echo "past-pre-flight rc=$?"'], {
      encoding: "utf8",
      env: { ...process.env, DEVENV_CGROUP_CONTROLLERS_OVERRIDE: controllersFile },
    });
  };

  it("warns (without failing) when cpuset is missing", () => {
    const fx = mkdtempSync(join(tmpdir(), "k3d-preflight-"));
    try {
      writeFileSync(join(fx, "no-cpuset"), "cpu memory pids\n");
      const r = runInstallerPreflight(join(fx, "no-cpuset"));
      const out = (r.stdout ?? "") + (r.stderr ?? "");
      expect(out).toContain("cpuset cgroup controller is missing");
      expect(out).toContain("CLUSTERS will hang");
      expect(out).toContain(".host/cpuset-delegate.sh");
      // Non-fatal: the binary also drives remote clusters — install proceeds.
      expect(out).toContain("past-pre-flight rc=0");
    } finally {
      rmSync(fx, { recursive: true, force: true });
    }
  });

  it("stays silent when cpuset is present", () => {
    const fx = mkdtempSync(join(tmpdir(), "k3d-preflight-"));
    try {
      writeFileSync(join(fx, "with-cpuset"), "cpuset cpu memory pids\n");
      const r = runInstallerPreflight(join(fx, "with-cpuset"));
      const out = (r.stdout ?? "") + (r.stderr ?? "");
      expect(out).not.toContain("cpuset cgroup controller is missing");
      expect(out).toContain("past-pre-flight rc=0");
    } finally {
      rmSync(fx, { recursive: true, force: true });
    }
  });
});

/**
 * Discovery & elevation ordering locks. Shipped bug: both scripts elevated
 * BEFORE container discovery, so discovery ran under root's podman — which
 * cannot see the invoking user's rootless containers (separate stores; on
 * some hosts root's podman is broken outright). Locks: discovery happens
 * with the invoking user's podman, podman failures surface as failures
 * (not masked as "no match"), and the elevated re-exec carries the resolved
 * --chain (toggle) / resolved mode flag (delegate) so root never needs podman.
 */
describe("cpuset-live-toggle discovery & elevation ordering", () => {
  const mkbin = (): { bin: string; log: string } => {
    const bin = mkdtempSync(join(tmpdir(), "cpuset-bin-"));
    return { bin, log: join(bin, "calls.log") };
  };
  const writeHelper = (path: string, body: string): void => {
    writeFileSync(path, body, { mode: 0o755 });
  };
  const runToggleEnv = (bin: string, cgroupRoot: string, args: string[]) =>
    spawnSync("bash", [TOGGLE, ...args], {
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${bin}:${process.env.PATH}`,
        DEVENV_CGROUP_SYSFS_OVERRIDE: cgroupRoot,
      },
    });

  it("discovers with the invoking user's podman, then elevates with the resolved --chain", () => {
    const fx = mkdtempSync(join(tmpdir(), "cpuset-order-"));
    const { bin, log } = mkbin();
    const sleeper = spawn("sleep", ["60"]);
    try {
      const pid = sleeper.pid!;
      writeHelper(join(bin, "podman"), [
        "#!/usr/bin/env bash",
        `echo "podman uid=$(id -u) args: $*" >> ${log}`,
        'if [ "$1" = "ps" ]; then echo fakecid; exit 0; fi',
        `if [ "$1" = "inspect" ]; then echo ${pid}; exit 0; fi`,
        "exit 1",
      ].join("\n"));
      writeHelper(join(bin, "sudo"), [
        "#!/usr/bin/env bash",
        `echo "sudo args: $*" >> ${log}`,
        'DEVENV_TOGGLE_SKIP_ELEVATE=1 exec "$@"',
      ].join("\n"));
      // Fake cgroup v2 tree shaped for the sleeper's real chain (0::<path>).
      writeFileSync(join(fx, "cgroup.controllers"), "cpuset cpu memory pids\n");
      writeFileSync(join(fx, "cgroup.subtree_control"), "\n");
      const chain = readFileSync(`/proc/${pid}/cgroup`, "utf8")
        .split("\n").find((l) => l.startsWith("0::"))!.slice(3);
      const lvl = join(fx, chain.replace(/^\//, ""));
      mkdirSync(lvl, { recursive: true });
      writeFileSync(join(lvl, "cgroup.controllers"), "cpu io memory pids\n");
      writeFileSync(join(lvl, "cgroup.subtree_control"), "\n");

      const r = runToggleEnv(bin, fx, ["--container-name", "test-ctr"]);
      expect(r.status).toBe(0);
      expect((r.stdout ?? "") + (r.stderr ?? "")).toContain("Result: cpuset enabled down the chain");
      const calls = readFileSync(log, "utf8").split("\n").filter(Boolean);
      const podmanIdx = calls.findIndex((c) => c.startsWith("podman"));
      const sudoIdx = calls.findIndex((c) => c.startsWith("sudo"));
      expect(podmanIdx).toBeGreaterThanOrEqual(0);
      expect(sudoIdx).toBeGreaterThan(podmanIdx); // discovery BEFORE elevation
      expect(calls[sudoIdx]).toContain("--chain"); // sudo gets the resolved chain
    } finally {
      sleeper.kill();
      rmSync(fx, { recursive: true, force: true });
      rmSync(bin, { recursive: true, force: true });
    }
  });

  it("surfaces a podman failure instead of masking it as a name mismatch", () => {
    const fx = mkdtempSync(join(tmpdir(), "cpuset-mask-"));
    const { bin } = mkbin();
    try {
      writeHelper(join(bin, "podman"), [
        "#!/usr/bin/env bash",
        'echo "Error: failed to open 2048 locks in /libpod_lock: permission denied" >&2',
        "exit 1",
      ].join("\n"));
      writeHelper(join(bin, "sudo"), [
        "#!/usr/bin/env bash",
        'DEVENV_TOGGLE_SKIP_ELEVATE=1 exec "$@"',
      ].join("\n"));
      const r = runToggleEnv(bin, fx, ["--container-name", "anything"]);
      expect(r.status).toBe(1);
      const out = (r.stdout ?? "") + (r.stderr ?? "");
      expect(out).toContain("podman ps failed");
      expect(out).toContain("libpod_lock");
      expect(out).not.toContain("no podman container matches");
    } finally {
      rmSync(fx, { recursive: true, force: true });
      rmSync(bin, { recursive: true, force: true });
    }
  });
});

describe("cpuset-delegate detection & elevation ordering", () => {
  it("detects via the invoking user's podman before elevating; sudo receives the resolved mode", () => {
    const bin = mkdtempSync(join(tmpdir(), "cpuset-bin-"));
    const log = join(bin, "calls.log");
    const sleeper = spawn("sleep", ["60"]);
    try {
      const pid = sleeper.pid!;
      writeFileSync(join(bin, "podman"), [
        "#!/usr/bin/env bash",
        `echo "podman args: $*" >> ${log}`,
        'if [ "$1" = "ps" ]; then echo fakecid; exit 0; fi',
        `if [ "$1" = "inspect" ]; then echo ${pid}; exit 0; fi`,
        "exit 1",
      ].join("\n"), { mode: 0o755 });
      // Record-only sudo: the ordering + argv are the lock; the continued
      // run (systemd checks, drop-in install) is out of scope hermetically.
      writeFileSync(join(bin, "sudo"), [
        "#!/usr/bin/env bash",
        `echo "sudo args: $*" >> ${log}`,
        "exit 0",
      ].join("\n"), { mode: 0o755 });

      const r = spawnSync("bash", [DELEGATE, "--container-name", "test-ctr"], {
        encoding: "utf8",
        env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
      });
      expect(r.status).toBe(0);
      const calls = readFileSync(log, "utf8").split("\n").filter(Boolean);
      const podmanIdx = calls.findIndex((c) => c.startsWith("podman"));
      const sudoIdx = calls.findIndex((c) => c.startsWith("sudo"));
      expect(podmanIdx).toBeGreaterThanOrEqual(0);
      expect(sudoIdx).toBeGreaterThan(podmanIdx);
      // The mode flag derives from the discovered chain's shape.
      const chain = readFileSync(`/proc/${pid}/cgroup`, "utf8");
      const expected = /user@\d+\.service/.test(chain) ? "--force-user" : "--force-docker";
      expect(calls[sudoIdx]).toContain(expected);
    } finally {
      sleeper.kill();
      rmSync(bin, { recursive: true, force: true });
    }
  });
});
