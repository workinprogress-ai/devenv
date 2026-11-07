// Port of tools/tests/scripts/test_services_config.bats (14 tests).
// get-services-config: syntax, --help contract (an existing config folder
// must be untouched), and the source-level shape locks of the TS port.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runTool as runHarness } from "./harness/index.ts";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const ROOT = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))));
const SCRIPT = join(ROOT, "tools", "get-services-config");
const TS_SOURCE = join(ROOT, "tools", "ts", "get-services-config.ts");

let TMP = "";

beforeEach(() => {
  TMP = mkdtempSync(join(tmpdir(), `svccfg-${Date.now()}-${Math.random().toString(36).slice(2)}`));
});

function runTool(args: string[], extraEnv: Record<string, string> = {}): { status: number; out: string } {
  // The suite drove the depth-1 bash stub; the harness runs the .ts source
  // (same execution path) — the bash-syntax test below still pins the stub.
  const r = runHarness("get-services-config", args, { env: { ...extraEnv } });
  return { status: r.status, out: r.output };
}

function sourceHas(args: string[]): boolean {
  return spawnSync("grep", args, { encoding: "utf8" }).status === 0;
}

describe("scripts/services-config", () => {
  it("get-services-config.sh has valid bash syntax", () => {
    expect(spawnSync("bash", ["-n", SCRIPT]).status).toBe(0);
  });

  it("get-services-config.sh has --help flag", () => {
    const r = runTool(["--help"]);
    expect(r.status).toBe(0);
    expect(r.out).toContain("Usage:");
  });

  it("get-services-config.sh --help leaves an existing config folder untouched", () => {
    // Without --help handling the flag was taken as a repo URL and the
    // existing target folder was deleted before the clone failed.
    const cfg = join(TMP, "cfg");
    mkdirSync(cfg, { recursive: true });
    writeFileSync(join(cfg, "marker"), "keep\n");
    const r = runTool(["--help"], { CONFIG_FOLDER: cfg });
    expect(r.status).toBe(0);
    expect(existsSync(join(cfg, "marker"))).toBe(true);
  });

  it("get-services-config.sh -h is the same as --help", () => {
    const r = runTool(["-h"]);
    expect(r.status).toBe(0);
    expect(r.out).toContain("Usage:");
  });

  it("get-services-config.sh uses error handling library", () => {
    expect(sourceHas(["lib/core/logging", TS_SOURCE])).toBe(true);
  });

  it("get-services-config.sh uses DEVENV_ROOT variable", () => {
    expect(sourceHas(["-E", "\\$DEVENV_ROOT/", TS_SOURCE])).toBe(true);
  });

  it("get-services-config.sh validates service argument", () => {
    expect(sourceHas(["-E", "repo_url|SERVICES_CONFIG_REPO", TS_SOURCE])).toBe(true);
  });

  it("get-services-config.sh has cleanup function", () => {
    expect(sourceHas(["-q", "rmSync(targetFolder", TS_SOURCE])).toBe(true);
  });

  it("get-services-config.sh clones git repository", () => {
    expect(sourceHas(["git clone", TS_SOURCE])).toBe(true);
  });

  it("get-services-config.sh supports branch checkout", () => {
    expect(sourceHas(["git checkout", TS_SOURCE])).toBe(true);
  });

  it("get-services-config.sh removes git artifacts", () => {
    expect(sourceHas(['"\\.git"', TS_SOURCE])).toBe(true);
  });

  it("get-services-config.sh creates info.txt metadata", () => {
    expect(sourceHas(["info.txt", TS_SOURCE])).toBe(true);
  });

  it("get-services-config.sh creates default.env template", () => {
    expect(sourceHas(["default.env", TS_SOURCE])).toBe(true);
  });

  it("get-services-config.sh handles missing repo URL", () => {
    expect(sourceHas(["-A2", 'repoUrl === ""', TS_SOURCE])).toBe(true);
    const r = spawnSync("grep", ["-A2", 'repoUrl === ""', TS_SOURCE], { encoding: "utf8" });
    expect((r.stdout ?? "") + (r.stderr ?? "")).toContain("logError");
  });
});
