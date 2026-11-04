// container-enable-dotnet-debugger behavioral tests (port of
// test_container_enable_dotnet_debugger.bats): the argument guard, and that
// a given container name reaches docker. docker is a recording stand-in on
// PATH.
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync, chmodSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const TOOL = join(__dirname, "../../ts/container-enable-dotnet-debugger.ts");

let binDir: string;
let dockerLog: string;
let root: string;

function runTool(...args: string[]): { status: number; out: string } {
  const r = spawnSync("node", [TOOL, ...args], {
    encoding: "utf8",
    cwd: root,
    env: { ...process.env, PATH: `${binDir}:${process.env["PATH"]}` },
  });
  return { status: r.status ?? 1, out: (r.stdout ?? "") + (r.stderr ?? "") };
}

beforeEach(() => {
  root = join(tmpdir(), `dbg-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  binDir = join(root, "bin");
  mkdirSync(binDir, { recursive: true });
  dockerLog = join(root, "docker.log");
  writeFileSync(dockerLog, "");
  const stub = join(binDir, "docker");
  writeFileSync(stub, `#!/usr/bin/env bash\necho "docker $*" >> "${dockerLog}"\n`);
  chmodSync(stub, 0o755);
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("container-enable-dotnet-debugger", () => {
  it("a bare invocation prints the message and exits 1 instead of crashing", () => {
    const r = runTool();
    expect(r.status).toBe(1);
    expect(r.out).toContain("Provide the container name");
    expect(readFileSync(dockerLog, "utf8")).toBe("");
  });

  it("an empty container name is refused the same way", () => {
    const r = runTool("");
    expect(r.status).toBe(1);
    expect(r.out).toContain("Provide the container name");
    expect(readFileSync(dockerLog, "utf8")).toBe("");
  });

  it("a container name is passed through to every docker exec", () => {
    const r = runTool("mycontainer");
    expect(r.status).toBe(0);
    const log = readFileSync(dockerLog, "utf8");
    expect(log.match(/^docker exec mycontainer /gm)?.length).toBe(4);
    expect(log).toContain("docker exec mycontainer mkdir -p /remote_debugger");
    expect(log).toContain(
      "docker exec mycontainer /bin/bash /remote_debugger/getvsdbg.sh -v latest -l /remote_debugger",
    );
  });
});
