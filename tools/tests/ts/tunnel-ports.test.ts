// Port of tools/tests/scripts/test_tunnel_ports.bats (6 tests).
// tunnel-ports smoke tests. ssh is a stand-in that records its arguments,
// notes its PID and sleeps, so tunnels can be "opened" and closed for real.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

vi.setConfig({ testTimeout: 120_000, hookTimeout: 60_000 });

const ROOT = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))));
const SCRIPT = join(ROOT, "tools", "tunnel-ports");

let TMP = "";
let SSH_LOG = "";
let SSH_PID_LOG = "";

beforeEach(() => {
  TMP = mkdtempSync(join(tmpdir(), `tunnel-${Date.now()}-${Math.random().toString(36).slice(2)}`));
  SSH_LOG = join(TMP, "ssh-args.log");
  SSH_PID_LOG = join(TMP, "ssh-pids.log");
  writeFileSync(SSH_LOG, "");
  writeFileSync(SSH_PID_LOG, "");
  const bin = join(TMP, "bin");
  mkdirSync(bin, { recursive: true });
  writeFileSync(
    join(bin, "ssh"),
    [
      "#!/usr/bin/env bash",
      '{ printf \'ARG:%s\\n\' "$@"; echo "END-OF-CALL"; } >> "$SSH_LOG"',
      'echo "$$" >> "$SSH_PID_LOG"',
      "exec sleep 30",
      "",
    ].join("\n"),
  );
  spawnSync("chmod", ["+x", join(bin, "ssh")]);
  // The helper's sandboxed config.
  const root = join(TMP, "devenv-root");
  mkdirSync(root, { recursive: true });
  writeFileSync(
    join(root, "devenv.config"),
    "[provider]\nname=github\n\n[organization]\nname=Test Organization\norg=test-org\nemail_domain=test.example.com\n\n[workflows]\nstatus_workflow=TBD,To-Groom,Ready,Implementing,Review,Merged,Staging,Production\n",
  );
});

const { DEVENV_REPO: _dr, ...procEnv } = process.env;

function env(): Record<string, string> {
  return {
    ...procEnv,
    SSH_LOG,
    SSH_PID_LOG,
    PATH: `${join(TMP, "bin")}:${procEnv.PATH ?? ""}`,
  };
}

// Run the script, answering its "press any key" prompt only once the expected
// number of ssh stand-ins has started and logged (otherwise the script closes
// the tunnels before they have recorded anything).
function runTunnels(args: string[], expectCalls = 1): { status: number; out: string } {
  const waitLoop =
    `for i in $(seq 1 100); do` +
    ` [ "$(wc -l < '${SSH_PID_LOG}')" -ge ${expectCalls} ] && break;` +
    ` sleep 0.1; done; printf 'x'`;
  const r = spawnSync("bash", ["-c", `{ ${waitLoop}; } | '${SCRIPT}' ${args.map((a) => `'${a}'`).join(" ")}`], {
    encoding: "utf8",
    env: env(),
  });
  return { status: r.status ?? 1, out: (r.stdout ?? "") + (r.stderr ?? "") };
}

function sshLogHas(line: string): boolean {
  return spawnSync("grep", ["-qx", line, SSH_LOG]).status === 0;
}

describe("scripts/tunnel-ports", () => {
  it("no arguments prints the usage line instead of an unbound-variable error", () => {
    const r = spawnSync(SCRIPT, [], { encoding: "utf8", env: env() });
    expect(r.status).toBe(1);
    const out = (r.stdout ?? "") + (r.stderr ?? "");
    expect(out).toContain("Usage:");
    expect(out).not.toContain("unbound variable");
  });

  it("a tunnel without -i opens and closes cleanly", () => {
    // SSH_CERT used to be read while unset, aborting the run at the first
    // tunnel: invocations without -i never worked.
    const r = runTunnels(["user@host", "8080:db.internal"]);
    expect(r.status).toBe(0);
    expect(r.out).toContain("Opening tunnel: Local port 8080 to db.internal through user@host");
    expect(r.out).toContain("Tunnels closed.");
    expect(sshLogHas("ARG:-L")).toBe(true);
    expect(sshLogHas("ARG:8080:db.internal:8080")).toBe(true);
    expect(sshLogHas("ARG:22")).toBe(true);
    expect(sshLogHas("ARG:user@host")).toBe(true);
    expect(sshLogHas("ARG:-i")).toBe(false);
  });

  it("-p sets the ssh port", () => {
    const r = runTunnels(["-p", "2222", "user@host", "8080:db.internal"]);
    expect(r.status).toBe(0);
    expect(sshLogHas("ARG:2222")).toBe(true);
  });

  it("-i passes a key path containing spaces as one argument", () => {
    const r = runTunnels(["-i", "/tmp/my key/id_rsa", "user@host", "8080:db.internal"]);
    expect(r.status).toBe(0);
    expect(sshLogHas("ARG:-i")).toBe(true);
    expect(sshLogHas("ARG:/tmp/my key/id_rsa")).toBe(true);
  });

  it("every opened tunnel is closed when the run ends", () => {
    const r = runTunnels(["user@host", "8080:db.one", "9090:db.two"], 2);
    expect(r.status).toBe(0);
    const ends = spawnSync("grep", ["-c", "END-OF-CALL", SSH_LOG], { encoding: "utf8" });
    expect(Number.parseInt((ends.stdout ?? "0").trim(), 10)).toBe(2);
    const pids = (spawnSync("cat", [SSH_PID_LOG], { encoding: "utf8" }).stdout ?? "").split("\n").filter(Boolean);
    for (const pid of pids) {
      // kill -0 fails (non-zero) when the process no longer exists
      expect(spawnSync("kill", ["-0", pid]).status).not.toBe(0);
    }
  });

  it("options without a target print usage instead of an unbound-variable error", () => {
    const r = spawnSync(SCRIPT, ["-p", "2222"], { encoding: "utf8", env: env() });
    expect(r.status).toBe(1);
    const out = (r.stdout ?? "") + (r.stderr ?? "");
    expect(out).toContain("Usage:");
    expect(out).not.toContain("unbound variable");
  });
});
