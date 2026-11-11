// Port of tools/tests/scripts/test_mongo_restore_server.bats (9 tests).
// mongo-restore-server consent gate and error path.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { toolScript } from "./harness/index.ts";

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

  it("mongo-restore: --yes performs the restore with --drop", () => {
    const r = runRestore(["mongodb://user:pass@localhost:27017", join(TMP, "backups"), "--yes"]);
    expect(r.status).toBe(0);
    expect(logHas("--drop")).toBe(true);
    expect(logHas("--uri=mongodb://user:pass@localhost:27017")).toBe(true);
  });

  it("mongo-restore: YES=1 env var is accepted as consent", () => {
    const r = runRestore(["mongodb://localhost:27017", join(TMP, "backups")], { YES: "1" });
    expect(r.status).toBe(0);
    expect(logHas("--drop")).toBe(true);
  });

  it("mongo-restore: picks the latest backup directory", () => {
    const r = runRestore(["mongodb://localhost:27017", join(TMP, "backups"), "--yes"], { YES: "1" });
    expect(r.status).toBe(0);
    expect(readFileSync(RESTORE_LOG, "utf8")).toContain("backup-20260910");
  });

  it("mongo-restore: displays redacted credentials, restores with real ones", () => {
    const r = runRestore(["mongodb://user:secret@localhost:27017", join(TMP, "backups"), "--yes"], { YES: "1" });
    expect(r.status).toBe(0);
    expect(r.out).toContain("***@localhost:27017");
    expect(r.out).not.toContain("secret");
    expect(logHas("--uri=mongodb://user:secret@localhost:27017")).toBe(true);
  });

  it("mongo-restore: failure path is reachable and reports non-zero", () => {
    const r = runRestore(["mongodb://localhost:27017", join(TMP, "backups"), "--yes"], { STUB_MONGORESTORE_FAIL: "1" });
    expect(r.status).not.toBe(0);
    expect(r.out).toContain("Restore failed");
  });

  it("mongo-restore: missing backup directory fails with 4", () => {
    const r = runRestore(["mongodb://localhost:27017", join(TMP, "nope"), "--yes"]);
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
