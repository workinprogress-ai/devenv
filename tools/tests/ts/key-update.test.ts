// key-update family behavioral tests (port of test_key_update.bats,
// scripts-family subset). Locks: non-interactive invocation without an
// argument refuses (non-zero, no hang on the read prompt); the DO script
// persists token files with 600 permissions and calls the updater with the
// value; --help/-h must never be consumed as a token/key. The provider
// (github) script's own tests live in the provider suite — its bash module
// is out of Phase 16's scope (providers' bootstrap-side bash stays).
//
// The tools invoke the env-var updater by exact tools-root path, so PATH
// stubbing cannot intercept it — tests point DEVENV_ROOT at a sandbox and
// stub `devenv-add-env-vars` acceptance indirectly via the updater stub on
// the tools depth-1 entry. tailscale needs PATH stubs for sudo and the
// tailscale CLI.
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync, chmodSync, readFileSync, symlinkSync, existsSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runTool as runHarness } from "./harness/index.ts";

const PROJECT_ROOT = join(__dirname, "../../..");
const DO_TOOL = join(PROJECT_ROOT, "tools/ts/_key-update-do.ts");
const TS_TOOL = join(PROJECT_ROOT, "tools/ts/_key-update-tailscale.ts");

let root: string;      // sandbox root
let binDir: string;    // PATH stubs
let callLog: string;
let devenvRoot: string;

function stub(name: string, body: string): void {
  const p = join(binDir, name);
  writeFileSync(p, `#!/usr/bin/env bash\n${body}\n`);
  chmodSync(p, 0o755);
}

function runTool(tool: string, args: string[], input: string | null, usePathStubs = true): { status: number; out: string } {
  // tool is a ts path; the harness takes the bare name.
  const name = tool.replace(/\.ts$/, "").split("/").pop() ?? tool;
  const r = runHarness(name, args, {
    stdin: input ?? "",
    env: {
      DEVENV_ROOT: devenvRoot,
      CALL_LOG: callLog,
      PATH: usePathStubs ? `${binDir}:${process.env["PATH"]}` : process.env["PATH"],
    },
  });
  return { status: r.status, out: r.output };
}

function readCalls(): string {
  return existsSync(callLog) ? readFileSync(callLog, "utf8") : "";
}

beforeEach(() => {
  root = join(tmpdir(), `keyupd-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  binDir = join(root, "bin");
  devenvRoot = join(root, "devroot");
  callLog = join(root, "calls.log");
  mkdirSync(binDir, { recursive: true });
  mkdirSync(join(devenvRoot, ".setup"), { recursive: true });
  mkdirSync(join(devenvRoot, ".runtime"), { recursive: true });
  // The updater requires the env-vars file to pre-exist (its own contract);
  // the bootstrap creates it before any key rotation can run.
  writeFileSync(join(devenvRoot, ".runtime", "env-vars.sh"), "#!/bin/bash\n# generated\n");
  writeFileSync(callLog, "");

  // PATH stubs for the tailscale path.
  stub("sudo", 'echo "sudo $*" >> "${CALL_LOG:?}"\nexec "$@"');
  stub(
    "tailscale",
    `echo "tailscale $*" >> "\${CALL_LOG:?}"
case "$1 $2" in
    "status --json") echo '{"HostName": "testhost"}' ;;
    up) exit 0 ;;
    status) echo "testhost   user@   -" ;;
    *) exit 0 ;;
esac`,
  );

  // Updater recording stub on the depth-1 entry the tools invoke by exact
  // path (tools root = the real project tools; the stub intercepts via PATH
  // is impossible for exact paths, so instead we assert on the real updater's
  // effect: the env-vars file in the sandbox DEVENV_ROOT gains the export).
  void symlinkSync;
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("key-update-do", () => {
  it("no argument with closed stdin refuses without hanging", () => {
    const r = runTool(DO_TOOL, [], "");
    expect(r.status).not.toBe(0);
    expect(r.out).toContain("No token provided");
    expect(readCalls()).not.toContain("sudo ");
    expect(existsSync(join(devenvRoot, ".setup", "do_token.txt"))).toBe(false);
  });

  it("argument path stores token with 600 and persists via the updater", () => {
    const r = runTool(DO_TOOL, ["d0token1234567890abcdef1234567890"], "");
    expect(r.status).toBe(0);
    expect(r.out).toContain("Success");
    const tokenFile = join(devenvRoot, ".setup", "do_token.txt");
    expect(statSync(tokenFile).mode & 0o777).toBe(0o600);
    expect(readFileSync(tokenFile, "utf8")).toContain("d0token1234567890abcdef1234567890");
    // The updater ran against the sandbox root and persisted the value.
    const envFile = join(devenvRoot, ".runtime", "env-vars.sh");
    if (existsSync(envFile)) {
      expect(readFileSync(envFile, "utf8")).toContain("export DO_TOKEN=d0token1234567890abcdef1234567890");
    }
  });

  it("--help exits 0 without prompting", () => {
    const r = runTool(DO_TOOL, ["--help"], "");
    expect(r.status).toBe(0);
    expect(r.out).toContain("Usage: key-update-do");
  });

  it("-h short flag also exits 0", () => {
    const r = runTool(DO_TOOL, ["-h"], "");
    expect(r.status).toBe(0);
    expect(r.out).toContain("Usage:");
  });
});

describe("key-update-tailscale", () => {
  it("closed stdin refuses without hanging", () => {
    const r = runTool(TS_TOOL, [], "");
    expect(r.status).not.toBe(0);
    expect(r.out).toContain("No key provided");
    expect(readCalls()).not.toContain("sudo tailscale up");
  });

  it("non-tskey input refuses before any daemon call", () => {
    const r = runTool(TS_TOOL, [], "not-a-tskey\n");
    expect(r.status).not.toBe(0);
    expect(r.out).toContain("Invalid key format");
    expect(readCalls()).not.toContain("sudo tailscale up");
  });

  it("valid key re-auths the daemon and persists the value", () => {
    const r = runTool(TS_TOOL, [], "tskey-abc123def456\n");
    expect(r.status).toBe(0);
    expect(r.out).toContain("Success");
    expect(readCalls()).toContain("sudo tailscale up --authkey=tskey-abc123def456");
    const envFile = join(devenvRoot, ".runtime", "env-vars.sh");
    if (existsSync(envFile)) {
      expect(readFileSync(envFile, "utf8")).toContain("export TS_AUTHKEY=tskey-abc123def456");
    }
  });

  it("a positional key is used without prompting, even if stdin never answers", () => {
    const r = runTool(TS_TOOL, ["tskey-posarg123"], null);
    expect(r.status).toBe(0);
    expect(r.out).toContain("Success");
    expect(readCalls()).toContain("sudo tailscale up --authkey=tskey-posarg123");
  });

  it("a positional key works with closed stdin", () => {
    const r = runTool(TS_TOOL, ["tskey-posarg123"], "");
    expect(r.status).toBe(0);
    expect(readCalls()).toContain("sudo tailscale up --authkey=tskey-posarg123");
  });

  it("a positional key wins over anything on stdin", () => {
    const r = runTool(TS_TOOL, ["tskey-fromarg"], "tskey-fromstdin\n");
    expect(r.status).toBe(0);
    expect(readCalls()).toContain("sudo tailscale up --authkey=tskey-fromarg");
    expect(readCalls()).not.toContain("tskey-fromstdin");
  });

  it("a positional key is validated like a prompted one", () => {
    const r = runTool(TS_TOOL, ["not-a-tskey"], "");
    expect(r.status).not.toBe(0);
    expect(r.out).toContain("Invalid key format");
    expect(readCalls()).not.toContain("sudo tailscale up");
  });

  it("--help exits 0 without prompting", () => {
    const r = runTool(TS_TOOL, ["--help"], "");
    expect(r.status).toBe(0);
    expect(r.out).toContain("Usage: key-update-tailscale");
  });

  it("-h short flag also exits 0", () => {
    const r = runTool(TS_TOOL, ["-h"], "");
    expect(r.status).toBe(0);
    expect(r.out).toContain("Usage:");
  });
});
