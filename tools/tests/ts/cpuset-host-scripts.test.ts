import { describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))));
const TOGGLE = join(ROOT, ".host", "cpuset-live-toggle.sh");
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
