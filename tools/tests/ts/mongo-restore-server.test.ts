// Port of tools/tests/scripts/test_mongo_restore_server.bats (9 tests).
// mongo-restore-server consent gate and error path.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { toolScript } from "./harness/index.ts";
import { drivePty } from "./harness/pty.ts";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const ROOT = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))));
const TOOLS = join(ROOT, "tools");

let TMP = "";
let RESTORE_LOG = "";

beforeEach(() => {
  TMP = mkdtempSync(join(tmpdir(), `mongors-${Date.now()}-${Math.random().toString(36).slice(2)}`));
  RESTORE_LOG = join(TMP, "restore.log");
  writeFileSync(RESTORE_LOG, "");
  const bin = join(TMP, "stub-bin");
  mkdirSync(bin, { recursive: true });
  const mongoStub = (name: string, logVar: string, failVar: string): string => [
    "#!/usr/bin/env bash",
    `echo "${name} $*" >> "\${STUB_CALL_LOG:?}"`,
    logVar ? `[[ -n "\${${logVar}:-}" ]] && echo "${name} $*" >> "$${logVar}"` : "",
    // Record the config file's content too: that is where the URI now lives.
    logVar ? `for a in "$@"; do [[ "$a" == --config=* ]] && cat "\${a#--config=}" >> "$${logVar}"; done` : "",
    `if [[ "\${${failVar}:-0}" == "1" ]]; then`,
    `    echo "stub-${name}: simulated failure" >&2`,
    "    exit 1",
    "fi",
    name === "mongosh" ? 'if [[ "${STUB_MONGOSH_DATABASES:-}" ]]; then\n    printf \'%s\\n\' "${STUB_MONGOSH_DATABASES}"\nfi' : "",
    "exit 0",
    "",
  ].filter(Boolean).join("\n") + "\n";
  writeFileSync(join(bin, "mongorestore"), mongoStub("mongorestore", "STUB_MONGORESTORE_LOG", "STUB_MONGORESTORE_FAIL"));
  writeFileSync(join(bin, "mongosh"), mongoStub("mongosh", "", "STUB_MONGOSH_FAIL"));
  writeFileSync(join(bin, "mongodump"), mongoStub("mongodump", "STUB_MONGODUMP_LOG", "STUB_MONGODUMP_FAIL"));
  spawnSync("chmod", ["+x", join(bin, "mongorestore"), join(bin, "mongosh"), join(bin, "mongodump")]);
  writeFileSync(join(TMP, "stub-calls.log"), "");
  // The helper's sandboxed config.
  const root = join(TMP, "devenv-root");
  mkdirSync(root, { recursive: true });
  writeFileSync(
    join(root, "devenv.config"),
    "[provider]\nname=github\n\n[organization]\nname=Test Organization\norg=test-org\nemail_domain=test.example.com\n\n[workflows]\nstatus_workflow=TBD,To-Groom,Ready,Implementing,Review,Merged,Staging,Production\n",
  );
  // Backup tree: backup-20260901/db1, backup-20260910/db2 subdirs
  mkdirSync(join(TMP, "backups", "backup-20260901", "db1"), { recursive: true });
  mkdirSync(join(TMP, "backups", "backup-20260910", "db2"), { recursive: true });
});

const { DEVENV_REPO: _dr, ...procEnv } = process.env;

function runRestore(args: string[], extra: Record<string, string> = {}): { status: number; out: string } {
  const r = spawnSync("node", [toolScript("mongo-restore-server"), ...args], {
    input: "",
    encoding: "utf8",
    env: {
      ...procEnv,
      DEVENV_TOOLS: TOOLS,
      DEVENV_ROOT: join(TMP, "devenv-root"),
      DEVENV_ROOT_SET: "1",
      STUB_CALL_LOG: join(TMP, "stub-calls.log"),
      STUB_MONGORESTORE_LOG: RESTORE_LOG,
      PATH: `${join(TMP, "stub-bin")}:${procEnv.PATH ?? ""}`,
      ...extra,
    },
  });
  return { status: r.status ?? 1, out: (r.stdout ?? "") + (r.stderr ?? "") };
}

function ptyEnv(): Record<string, string> {
  return {
    DEVENV_TOOLS: TOOLS,
    DEVENV_ROOT: join(TMP, "devenv-root"),
    DEVENV_ROOT_SET: "1",
    STUB_CALL_LOG: join(TMP, "stub-calls.log"),
    STUB_MONGORESTORE_LOG: RESTORE_LOG,
    PATH: `${join(TMP, "stub-bin")}:${procEnv.PATH ?? ""}`,
  };
}

function logHas(pattern: string): boolean {
  return spawnSync("grep", ["-qF", "--", pattern, RESTORE_LOG]).status === 0;
}

function logEmpty(): boolean {
  return readFileSync(RESTORE_LOG, "utf8").trim() === "";
}

describe("scripts/mongo-restore-server", () => {
  it("mongo-restore: refuses non-interactive run without --yes", () => {
    const r = runRestore(["mongodb://user:pass@localhost:27017", join(TMP, "backups")]);
    expect(r.status).toBe(2);
    expect(logEmpty()).toBe(true);
  });

  it("mongo-restore: --yes without a named target is refused", () => {
    const r = runRestore(["mongodb://user:pass@localhost:27017", join(TMP, "backups"), "--yes"]);
    expect(r.status).toBe(2);
    expect(r.out).toContain("--confirm-target");
    expect(logEmpty()).toBe(true);
  });

  it("mongo-restore: --yes with a mismatched target is refused", () => {
    const r = runRestore(["mongodb://user:pass@localhost:27017", join(TMP, "backups"), "--yes", "--confirm-target", "otherhost:27017"]);
    expect(r.status).toBe(2);
    expect(logEmpty()).toBe(true);
  });

  it("mongo-restore: --yes with the exact target performs the restore with --drop", () => {
    const r = runRestore(["mongodb://user:pass@localhost:27017/appdb?authSource=admin", join(TMP, "backups"), "--yes", "--confirm-target", "localhost:27017/appdb"]);
    expect(r.status).toBe(0);
    expect(logHas("--drop")).toBe(true);
    expect(logHas('uri: "mongodb://user:pass@localhost:27017/appdb?authSource=admin"')).toBe(true);
  });

  it("mongo-restore: YES=1 env var is not consent", () => {
    const r = runRestore(["mongodb://localhost:27017", join(TMP, "backups")], { YES: "1" });
    expect(r.status).toBe(2);
    expect(logEmpty()).toBe(true);
  });

  it("mongo-restore: picks the latest backup directory", () => {
    const r = runRestore(["mongodb://localhost:27017", join(TMP, "backups"), "--yes", "--confirm-target", "localhost:27017"]);
    expect(r.status).toBe(0);
    expect(readFileSync(RESTORE_LOG, "utf8")).toContain("backup-20260910");
  });

  it("mongo-restore: displays redacted credentials, restores with real ones", () => {
    const r = runRestore(["mongodb://user:secret@localhost:27017", join(TMP, "backups"), "--yes", "--confirm-target", "localhost:27017"]);
    expect(r.status).toBe(0);
    expect(r.out).toContain("***@localhost:27017");
    expect(r.out).not.toContain("secret");
    expect(logHas('uri: "mongodb://user:secret@localhost:27017"')).toBe(true);
    // The credentials never reach the command line.
    const argvLines = readFileSync(RESTORE_LOG, "utf8").split("\n").filter((l) => l.startsWith("mongorestore "));
    expect(argvLines.join("\n")).not.toContain("secret");
  });

  it("mongo-restore: retyping a wrong target at the terminal aborts without restoring", async () => {
    const r = await drivePty("node", [toolScript("mongo-restore-server"), "mongodb://user:pass@localhost:27017", join(TMP, "backups")], {
      keys: ["W", "wronghost:27017"],
      tailHoldMs: 1000,
      env: ptyEnv(),
    });
    expect(r.status).not.toBe(0);
    expect(r.out).toContain("Aborted");
    expect(logEmpty()).toBe(true);
  }, 120_000);

  it("mongo-restore: retyping the exact target at the terminal performs the restore", async () => {
    const r = await drivePty("node", [toolScript("mongo-restore-server"), "mongodb://user:pass@localhost:27017", join(TMP, "backups")], {
      keys: ["W", "localhost:27017"],
      tailHoldMs: 1000,
      env: ptyEnv(),
    });
    expect(r.status).toBe(0);
    expect(logHas("--drop")).toBe(true);
  }, 120_000);

  it("mongo-restore: failure path is reachable and reports non-zero", () => {
    const r = runRestore(["mongodb://localhost:27017", join(TMP, "backups"), "--yes", "--confirm-target", "localhost:27017"], { STUB_MONGORESTORE_FAIL: "1" });
    expect(r.status).not.toBe(0);
    expect(r.out).toContain("Restore failed");
  });

  it("mongo-restore: missing backup directory fails with 4", () => {
    const r = runRestore(["mongodb://localhost:27017", join(TMP, "nope"), "--yes", "--confirm-target", "localhost:27017"]);
    expect(r.status).toBe(4);
  });

  it("mongo-restore: unknown option exits 2", () => {
    const r = runRestore(["mongodb://localhost:27017", join(TMP, "backups"), "--frobnicate"]);
    expect(r.status).toBe(2);
  });

  it("mongo-restore: missing args show usage and exit 2", () => {
    const r = runRestore([]);
    expect(r.status).toBe(2);
    expect(r.out).toContain("Usage:");
  });
});
