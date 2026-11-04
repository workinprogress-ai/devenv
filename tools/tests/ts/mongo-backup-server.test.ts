// Port of tools/tests/scripts/test_mongo_backup_server.bats (4 tests).
// mongo-backup-server's guarded database-listing path: a mongosh failure
// aborts before any dump; a malformed name in the listing aborts before any
// dump; a valid listing dumps each non-built-in database exactly once; a
// mongodump failure surfaces non-zero.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const ROOT = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))));
const TOOLS = join(ROOT, "tools");

let TMP = "";
let DUMP_LOG = "";

beforeEach(() => {
  TMP = mkdtempSync(join(tmpdir(), `mongobk-${Date.now()}-${Math.random().toString(36).slice(2)}`));
  DUMP_LOG = join(TMP, "dump.log");
  writeFileSync(DUMP_LOG, "");
  const bin = join(TMP, "stub-bin");
  mkdirSync(bin, { recursive: true });
  const mongoStub = (name: string, logVar: string, failVar: string): string[] => [
    "#!/usr/bin/env bash",
    `echo "${name} $*" >> "\${STUB_CALL_LOG:?}"`,
    `[[ -n "\${${logVar}:-}" ]] && echo "${name} $*" >> "$${logVar}"`,
    `if [[ "\${${failVar}:-0}" == "1" ]]; then`,
    `    echo "stub-${name}: simulated failure" >&2`,
    "    exit 1",
    "fi",
    name === "mongosh" ? 'if [[ "${STUB_MONGOSH_DATABASES:-}" ]]; then\n    printf \'%s\\n\' "${STUB_MONGOSH_DATABASES}"\nfi' : "",
    "exit 0",
    "",
  ];
  writeFileSync(join(bin, "mongorestore"), mongoStub("mongorestore", "STUB_MONGORESTORE_LOG", "STUB_MONGORESTORE_FAIL").filter(Boolean).join("\n") + "\n");
  writeFileSync(join(bin, "mongosh"), mongoStub("mongosh", "", "STUB_MONGOSH_FAIL").filter(Boolean).join("\n") + "\n");
  writeFileSync(join(bin, "mongodump"), mongoStub("mongodump", "STUB_MONGODUMP_LOG", "STUB_MONGODUMP_FAIL").filter(Boolean).join("\n") + "\n");
  spawnSync("chmod", ["+x", join(bin, "mongorestore"), join(bin, "mongosh"), join(bin, "mongodump")]);
  writeFileSync(join(TMP, "stub-calls.log"), "");
  // The helper's sandboxed config.
  const root = join(TMP, "devenv-root");
  mkdirSync(root, { recursive: true });
  writeFileSync(
    join(root, "devenv.config"),
    "[provider]\nname=github\n\n[organization]\nname=Test Organization\norg=test-org\nemail_domain=test.example.com\n\n[workflows]\nstatus_workflow=TBD,To-Groom,Ready,Implementing,Review,Merged,Staging,Production\n",
  );
  mkdirSync(join(TMP, "backups"), { recursive: true });
});

const { DEVENV_REPO: _dr, ...procEnv } = process.env;

function runBackup(uri: string, extra: Record<string, string> = {}): { status: number; out: string } {
  const r = spawnSync(join(TOOLS, "mongo-backup-server"), [uri, join(TMP, "backups")], {
    input: "",
    encoding: "utf8",
    env: {
      ...procEnv,
      DEVENV_TOOLS: TOOLS,
      DEVENV_ROOT: join(TMP, "devenv-root"),
      DEVENV_ROOT_SET: "1",
      STUB_CALL_LOG: join(TMP, "stub-calls.log"),
      STUB_MONGODUMP_LOG: DUMP_LOG,
      PATH: `${join(TMP, "stub-bin")}:${procEnv.PATH ?? ""}`,
      ...extra,
    },
  });
  return { status: r.status ?? 1, out: (r.stdout ?? "") + (r.stderr ?? "") };
}

function countInLog(pattern: string): number {
  const r = spawnSync("grep", ["-c", "--", pattern, DUMP_LOG], { encoding: "utf8" });
  return Number.parseInt((r.stdout ?? "0").trim(), 10) || 0;
}

function logEmpty(): boolean {
  return (readFileSync(DUMP_LOG, "utf8").trim() === "");
}

describe("scripts/mongo-backup-server", () => {
  it("backup: valid DB list dumps each non-built-in database once", () => {
    const r = runBackup("mongodb://user:pass@localhost:27017", { STUB_MONGOSH_DATABASES: "admin\nappdb\nauditdb\nconfig\nlocal" });
    expect(r.status).toBe(0);
    expect(countInLog("--db appdb")).toBe(1);
    expect(countInLog("--db auditdb")).toBe(1);
    // Built-ins were never dumped
    expect(countInLog("--db admin")).toBe(0);
    expect(countInLog("--db local")).toBe(0);
    expect(r.out).toContain("Backup completed");
  });

  it("backup: garbage database name aborts before any mongodump", () => {
    const r = runBackup("mongodb://localhost:27017", { STUB_MONGOSH_DATABASES: "gooddb\nWARNING: auth failed\ngooddb2" });
    expect(r.status).not.toBe(0);
    expect(r.out).toContain("invalid database name");
    expect(r.out).toContain("WARNING: auth failed");
    expect(logEmpty()).toBe(true);
  });

  it("backup: mongosh failure aborts with API-failure exit", () => {
    const r = runBackup("mongodb://localhost:27017", { STUB_MONGOSH_FAIL: "1" });
    expect(r.status).toBe(4);
    expect(logEmpty()).toBe(true);
  });

  it("backup: mongodump failure is reported non-zero", () => {
    const r = runBackup("mongodb://localhost:27017", { STUB_MONGOSH_DATABASES: "crashdb", STUB_MONGODUMP_FAIL: "1" });
    expect(r.status).not.toBe(0);
    expect(r.out).toContain("Backup failed for database: crashdb");
  });
});
