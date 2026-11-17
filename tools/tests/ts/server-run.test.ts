// server-run-sql / server-run-smb: containers are published on loopback only
// and the credentials come from the environment, never from the tool or argv.
// docker and sudo are stand-ins that record their arguments (and the password
// variable they were handed) and succeed.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { toolScript } from "./harness/index.ts";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

let TMP = "";
let DOCKER_LOG = "";

beforeEach(() => {
  TMP = mkdtempSync(join(tmpdir(), `serverrun-${Date.now()}-${Math.random().toString(36).slice(2)}`));
  DOCKER_LOG = join(TMP, "docker.log");
  writeFileSync(DOCKER_LOG, "");
  const bin = join(TMP, "bin");
  mkdirSync(bin, { recursive: true });
  // `docker ps` lists nothing (no existing container); every other call is
  // logged with the password variables it inherited.
  writeFileSync(
    join(bin, "docker"),
    [
      "#!/usr/bin/env bash",
      '[[ "$1" == "ps" && -n "${DOCKER_PS_FAIL:-}" ]] && exit 1',
      '[[ "$1" == "ps" ]] && { printf "%s" "${DOCKER_PS_OUT:-}"; exit 0; }',
      'echo "docker $* [PASS=${PASS:-} MSSQL_SA_PASSWORD=${MSSQL_SA_PASSWORD:-} SQLCMDPASSWORD=${SQLCMDPASSWORD:-}]" >> "$DOCKER_LOG"',
      '[[ -n "${DOCKER_FAIL_ON:-}" && "$*" == *"$DOCKER_FAIL_ON"* ]] && exit 1',
      "exit 0",
      "",
    ].join("\n"),
  );
  writeFileSync(join(bin, "sudo"), "#!/usr/bin/env bash\nexit 0\n");
  writeFileSync(join(bin, "sleep"), "#!/usr/bin/env bash\nexit 0\n");
  for (const n of ["docker", "sudo", "sleep"]) chmodSync(join(bin, n), 0o755);
  mkdirSync(join(TMP, "devenv-root"), { recursive: true });
});

const { DEVENV_REPO: _dr, SQL_SA_PASSWORD: _s, SMB_PASSWORD: _m, SMB_USER: _u, ...procEnv } = process.env;

function run(tool: string, extra: Record<string, string> = {}): { status: number; out: string } {
  const r = spawnSync("node", [toolScript(tool)], {
    input: "",
    encoding: "utf8",
    env: {
      ...procEnv,
      DEVENV_ROOT: join(TMP, "devenv-root"),
      DEVENV_ROOT_SET: "1",
      DOCKER_LOG,
      PATH: `${join(TMP, "bin")}:${procEnv.PATH ?? ""}`,
      ...extra,
    },
  });
  return { status: r.status ?? 1, out: (r.stdout ?? "") + (r.stderr ?? "") };
}

function dockerLog(): string {
  return readFileSync(DOCKER_LOG, "utf8");
}

describe("server-run-sql", () => {
  it("refuses a password that breaks the complexity rules before touching docker", () => {
    for (const weak of ["short1!", "alllowercase", "lower12345"]) {
      const r = run("server-run-sql", { SQL_SA_PASSWORD: weak });
      expect(r.status).toBe(2);
      expect(r.out).toContain("complexity");
      expect(dockerLog()).toBe("");
    }
  });

  it("removes the container it created when the server never becomes ready", () => {
    const r = run("server-run-sql", { SQL_SA_PASSWORD: "Str0ng!Pass-xyz", DOCKER_FAIL_ON: "SELECT 1" });
    expect(r.status).not.toBe(0);
    expect(r.out).toContain("did not become ready");
    expect(dockerLog()).toContain("docker rm -f sqlserver");
    expect(dockerLog()).not.toContain("CREATE DATABASE");
  });

  it("removes the container it created when database creation fails", () => {
    const r = run("server-run-sql", { SQL_SA_PASSWORD: "Str0ng!Pass-xyz", DOCKER_FAIL_ON: "CREATE DATABASE" });
    expect(r.status).not.toBe(0);
    expect(dockerLog()).toContain("docker rm -f sqlserver");
  });

  it("on an existing container waits for readiness and creates the database", () => {
    const r = run("server-run-sql", { SQL_SA_PASSWORD: "Str0ng!Pass-xyz", DOCKER_PS_OUT: "sqlserver\n" });
    expect(r.status).toBe(0);
    const log = dockerLog();
    expect(log).toContain("docker start sqlserver");
    expect(log).not.toContain("docker run");
    expect(log).toContain("SELECT 1");
    expect(log).toContain("IF DB_ID('test') IS NULL CREATE DATABASE test;");
  });

  it("does not remove a pre-existing container when readiness fails", () => {
    const r = run("server-run-sql", { SQL_SA_PASSWORD: "Str0ng!Pass-xyz", DOCKER_PS_OUT: "sqlserver\n", DOCKER_FAIL_ON: "SELECT 1" });
    expect(r.status).not.toBe(0);
    expect(dockerLog()).not.toContain("docker rm");
  });

  it("a failed docker ps followed by a failed run never removes a container", () => {
    const r = run("server-run-sql", { SQL_SA_PASSWORD: "Str0ng!Pass-xyz", DOCKER_PS_FAIL: "1", DOCKER_FAIL_ON: "run" });
    expect(r.status).not.toBe(0);
    expect(r.out).toContain("docker ps failed");
    expect(dockerLog()).not.toContain("docker rm");
    expect(dockerLog()).not.toContain("docker run");
  });

  it("does not remove a container when docker run fails", () => {
    const r = run("server-run-sql", { SQL_SA_PASSWORD: "Str0ng!Pass-xyz", DOCKER_FAIL_ON: "--user root" });
    expect(r.status).not.toBe(0);
    expect(dockerLog()).not.toContain("docker rm");
  });

  it("the readiness timeout names an SA password that differs from the stored one, on create and exists paths", () => {
    for (const ps of ["", "sqlserver\n"]) {
      const r = run("server-run-sql", { SQL_SA_PASSWORD: "Str0ng!Pass-xyz", DOCKER_PS_OUT: ps, DOCKER_FAIL_ON: "SELECT 1" });
      expect(r.out).toContain("differs from the one stored in the existing data");
      expect(r.out).toContain("sqlserver");
    }
  });

  it("refuses to start a container without a password and without a terminal", () => {
    const r = run("server-run-sql");
    expect(r.status).toBe(2);
    expect(r.out).toContain("SQL_SA_PASSWORD");
    expect(dockerLog()).toBe("");
  });

  it("publishes on loopback and passes the password by environment only", () => {
    const r = run("server-run-sql", { SQL_SA_PASSWORD: "Str0ng!Pass-xyz" });
    expect(r.status).toBe(0);
    const log = dockerLog();
    expect(log).toContain("-p 127.0.0.1:1433:1433");
    expect(log).toContain("[PASS= MSSQL_SA_PASSWORD=Str0ng!Pass-xyz");
    // The password is in the environment bracket only, never on argv.
    for (const line of log.split("\n").filter(Boolean)) expect(line.split(" [")[0]).not.toContain("Str0ng");
    expect(log).toContain("CREATE DATABASE test;");
    expect(r.out).not.toContain("Str0ng");
    expect(r.out).not.toContain("1Passw0rd");
  });
});

describe("server-run-smb", () => {
  it("refuses to start a container without a password and without a terminal", () => {
    const r = run("server-run-smb");
    expect(r.status).toBe(2);
    expect(r.out).toContain("SMB_PASSWORD");
    expect(dockerLog()).toBe("");
  });

  it("publishes on loopback and passes the password by environment only", () => {
    const r = run("server-run-smb", { SMB_PASSWORD: "smb-secret-xyz", SMB_USER: "alice" });
    expect(r.status).toBe(0);
    const log = dockerLog();
    expect(log).toContain("-p 127.0.0.1:445:445");
    expect(log).toContain("-e USER=alice");
    expect(log).toContain("[PASS=smb-secret-xyz");
    for (const line of log.split("\n").filter(Boolean)) expect(line.split(" [")[0]).not.toContain("smb-secret");
    expect(r.out).not.toContain("smb-secret");
    expect(r.out).not.toContain("devenv123");
  });
});
