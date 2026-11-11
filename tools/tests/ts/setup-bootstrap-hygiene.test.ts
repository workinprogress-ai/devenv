// Bootstrap hygiene: failing setup steps surface their output, downloads are
// verified before use, and docker-restart stops only the daemon. Every run is
// confined to fixtures: fake HOME/toolbox, stubbed binaries first on PATH.
import { afterAll, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import {
  chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertKeyFingerprints, assertSha256, primaryFingerprints,
} from "../../ts/setup-steps/download-verify.ts";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const SETUP = join(REPO_ROOT, "tools", "ts", "setup.ts");

const tempRoots: string[] = [];
function tmp(prefix: string): string {
  const d = mkdtempSync(join(tmpdir(), prefix));
  tempRoots.push(d);
  return d;
}
afterAll(() => {
  for (const d of tempRoots) rmSync(d, { recursive: true, force: true });
});

function stubBin(dir: string, name: string, body: string): void {
  mkdirSync(dir, { recursive: true });
  const p = join(dir, name);
  writeFileSync(p, `#!/bin/bash\n${body}\n`);
  chmodSync(p, 0o755);
}

describe("setup --json surfaces the failing step's output", () => {
  it("a failed step reports its stderr in the log and in the JSON result", () => {
    const root = tmp("hyg-toolbox-");
    const home = tmp("hyg-home-");
    mkdirSync(join(root, ".setup"), { recursive: true }); // no seed files: credentials fails
    const r = spawnSync("node", [SETUP, "credentials", "--json"], {
      encoding: "utf8",
      input: "",
      env: { ...process.env, DEVENV_TOOLBOX_ROOT: root, HOME: home },
    });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("missing seed file");
    const parsed = JSON.parse(r.stdout) as { step: string; status: string; output?: string }[];
    expect(parsed[0]?.status).toBe("failed");
    expect(parsed[0]?.output).toContain("missing seed file");
  }, 60_000);
});

describe("download verification", () => {
  const colons = [
    "tru::1:1:1:0:3:1:5",
    "pub:-:4096:1:AAAA1111AAAA1111:1:::-:::scESC:::::::",
    "fpr:::::::::0123456789ABCDEF0123456789ABCDEF01234567:",
    "sub:-:4096:1:BBBB2222BBBB2222:1::::::e::::::",
    "fpr:::::::::FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF:",
  ].join("\n");

  it("primaryFingerprints takes the key fingerprints, not the subkeys", () => {
    expect(primaryFingerprints(colons)).toEqual(["0123456789ABCDEF0123456789ABCDEF01234567"]);
  });

  it("a key whose fingerprint is pinned verifies", () => {
    expect(assertKeyFingerprints("k", ["0123456789ABCDEF0123456789ABCDEF01234567"], ["0123456789abcdef0123456789abcdef01234567"])).toBe("verified");
  });

  it("a key with an unpinned fingerprint is refused", () => {
    expect(() => assertKeyFingerprints("k", ["0123456789ABCDEF0123456789ABCDEF01234567"], ["DEADBEEF"])).toThrow(/fingerprint/);
  });

  it("a download without a key is refused", () => {
    expect(() => assertKeyFingerprints("k", [], ["DEADBEEF"])).toThrow(/no key/);
  });

  it("with no pin configured the result is reported as unpinned, not verified", () => {
    expect(assertKeyFingerprints("k", ["AA"], [])).toBe("unpinned");
    expect(assertSha256("f", "data", "")).toBe("unpinned");
  });

  it("assertSha256 accepts the matching digest and refuses a different one", () => {
    const sum = createHash("sha256").update("data").digest("hex");
    expect(assertSha256("f", "data", sum.toUpperCase())).toBe("verified");
    expect(() => assertSha256("f", "tampered", sum)).toThrow(/sha256/);
  });
});

describe("download-csharp-debugger.sh", () => {
  const SCRIPT = join(REPO_ROOT, ".devcontainer", "download-csharp-debugger.sh");

  function fixture(wgetBody: string): { cwd: string; bin: string; env: NodeJS.ProcessEnv; script: string } {
    const cwd = tmp("hyg-dbg-");
    mkdirSync(join(cwd, ".devcontainer"), { recursive: true });
    const script = join(cwd, ".devcontainer", "download-csharp-debugger.sh");
    copyFileSync(SCRIPT, script);
    chmodSync(script, 0o755);
    const bin = join(cwd, "bin");
    stubBin(bin, "wget", wgetBody);
    return { cwd, bin, script, env: { PATH: `${bin}:/usr/bin:/bin`, HOME: cwd } };
  }

  it("a failed download stops the script before anything is run", () => {
    const f = fixture('exit 1');
    const r = spawnSync("bash", [f.script], { encoding: "utf8", env: f.env });
    expect(r.status).not.toBe(0);
    expect(existsSync(join(f.cwd, ".debug", "remote_debugger", "getvsdbg.sh"))).toBe(false);
  });

  it("a digest mismatch stops the script before the installer is run", () => {
    const f = fixture('while [ "$1" != "-O" ]; do shift; done; printf "echo RAN\\n" > "$2"');
    const r = spawnSync("bash", [f.script], {
      encoding: "utf8",
      env: { ...f.env, GETVSDBG_SHA256: "0".repeat(64) },
    });
    expect(r.status).not.toBe(0);
    expect(r.stdout).not.toContain("RAN");
  });

  it("a matching digest runs the installer", () => {
    const f = fixture('while [ "$1" != "-O" ]; do shift; done; printf "echo RAN\\n" > "$2"');
    const sum = createHash("sha256").update("echo RAN\n").digest("hex");
    const r = spawnSync("bash", [f.script], { encoding: "utf8", env: { ...f.env, GETVSDBG_SHA256: sum } });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("RAN");
  });
});

describe("docker-restart stops only the daemon", () => {
  it("kills dockerd by exact name and then reloads", () => {
    // A fixture checkout: the real tool copied beside a symlinked lib, a
    // recording sudo and a stub load-docker. Nothing real can be reached.
    const root = tmp("hyg-docker-");
    mkdirSync(join(root, "tools", "ts"), { recursive: true });
    mkdirSync(join(root, ".devcontainer"), { recursive: true });
    copyFileSync(join(REPO_ROOT, "tools", "ts", "docker-restart.ts"), join(root, "tools", "ts", "docker-restart.ts"));
    symlinkSync(join(REPO_ROOT, "tools", "lib"), join(root, "tools", "lib"));
    const log = join(root, "calls.log");
    stubBin(join(root, "bin"), "sudo", `echo "sudo $*" >> '${log}'`);
    stubBin(join(root, ".devcontainer"), "load-docker.sh", `echo "load-docker" >> '${log}'`);
    const r = spawnSync("node", [join(root, "tools", "ts", "docker-restart.ts")], {
      encoding: "utf8",
      env: { ...process.env, PATH: `${join(root, "bin")}:${process.env["PATH"]}` },
    });
    expect({ status: r.status, stderr: r.stderr }).toEqual({ status: 0, stderr: "" });
    const calls = readFileSync(log, "utf8").trim().split("\n");
    expect(calls).toEqual(["sudo pkill -x dockerd", "load-docker"]);
  }, 30_000);
});
