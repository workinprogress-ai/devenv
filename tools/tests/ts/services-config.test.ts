// get-services-config: syntax, --help contract (an existing config folder
// must be untouched), and the source-level shape locks of the tool.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync, existsSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { pathWithStubs, recordedGitCalls, runTool as runHarness, stubRecordingGit } from "./harness/index.ts";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const ROOT = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))));
const SCRIPT = join(ROOT, "tools", "ts", "get-services-config.ts");
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
    expect(spawnSync("node", ["--check", SCRIPT]).status).toBe(0);
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
    expect(sourceHas(["-q", "rmSync(staging", TS_SOURCE])).toBe(true);
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

  function mkRemote(): string {
    const remote = join(TMP, "remote");
    mkdirSync(remote, { recursive: true });
    const g = (...a: string[]) => spawnSync("git", ["-C", remote, ...a], { encoding: "utf8" });
    g("init", "-q");
    writeFileSync(join(remote, "app.json"), "{}\n");
    g("add", "-A");
    g("commit", "-q", "-m", "init");
    return remote;
  }

  function existingConfig(): string {
    const cfg = join(TMP, "cfg");
    mkdirSync(cfg, { recursive: true });
    mkdirSync(join(cfg, ".git"));
    writeFileSync(join(cfg, "marker"), "keep\n");
    return cfg;
  }

  it("keeps the existing config when the clone fails", () => {
    const cfg = existingConfig();
    const r = runTool([join(TMP, "no-such-repo")], { CONFIG_FOLDER: cfg });
    expect(r.status).not.toBe(0);
    expect(readFileSync(join(cfg, "marker"), "utf8")).toBe("keep\n");
    expect(readdirSync(TMP).filter((n) => n.startsWith("cfg."))).toEqual([]);
  });

  it("keeps the existing config when the branch does not exist", () => {
    const cfg = existingConfig();
    const r = runTool([mkRemote(), "no-such-branch"], { CONFIG_FOLDER: cfg });
    expect(r.status).not.toBe(0);
    expect(readFileSync(join(cfg, "marker"), "utf8")).toBe("keep\n");
    expect(readdirSync(TMP).filter((n) => n.startsWith("cfg."))).toEqual([]);
  });

  it("replaces the existing config with the cloned one on success", () => {
    const cfg = existingConfig();
    const r = runTool([mkRemote()], { CONFIG_FOLDER: cfg });
    expect(r.status).toBe(0);
    expect(existsSync(join(cfg, "marker"))).toBe(false);
    expect(existsSync(join(cfg, "app.json"))).toBe(true);
    expect(existsSync(join(cfg, ".git"))).toBe(false);
    expect(readdirSync(TMP).filter((n) => n.startsWith("cfg."))).toEqual([]);
  });

  it("get-services-config.sh handles missing repo URL", () => {
    expect(sourceHas(["-A2", 'repoUrl === ""', TS_SOURCE])).toBe(true);
    const r = spawnSync("grep", ["-A2", 'repoUrl === ""', TS_SOURCE], { encoding: "utf8" });
    expect((r.stdout ?? "") + (r.stderr ?? "")).toContain("logError");
  });

  describe("clone argument separation", () => {
    function cloneCall(args: string[], env: Record<string, string> = {}): string[] {
      const bin = join(TMP, "bin");
      mkdirSync(bin, { recursive: true });
      stubRecordingGit(bin);
      runTool(args, { CONFIG_FOLDER: join(TMP, "cfg"), PATH: pathWithStubs(bin), ...env });
      const call = recordedGitCalls(bin).find((c) => c[0] === "clone");
      expect(call).toBeDefined();
      return call!;
    }

    it("passes an option-looking SERVICES_CONFIG_REPO after --", () => {
      const call = cloneCall([], { SERVICES_CONFIG_REPO: "--upload-pack=evil" });
      expect(call.indexOf("--upload-pack=evil")).toBeGreaterThan(call.indexOf("--"));
      expect(call[call.indexOf("--upload-pack=evil") - 1]).toBe("--");
    });

    it("passes a positional that begins with - after --", () => {
      const call = cloneCall(["--", "-oops"]);
      expect(call[call.indexOf("-oops") - 1]).toBe("--");
    });
  });

  describe("CONFIG_FOLDER validation", () => {
    function run(folder: string, home: string): { status: number; out: string; calls: string[][] } {
      const bin = join(TMP, "bin");
      mkdirSync(bin, { recursive: true });
      stubRecordingGit(bin, { cloneCreates: true });
      const r = runTool(["https://example.invalid/cfg.git"], { CONFIG_FOLDER: folder, HOME: home, PATH: pathWithStubs(bin) });
      return { ...r, calls: recordedGitCalls(bin) };
    }

    function listing(dir: string): string[] {
      return readdirSync(dir, { recursive: true }).map(String).sort();
    }

    function homeDir(): string {
      const home = join(TMP, "outer", "home");
      mkdirSync(home, { recursive: true });
      return home;
    }

    it.each([
      ["a relative path", () => "relative/cfg", "not an absolute path"],
      ["the filesystem root", () => "/", "home directory or one of its ancestors"],
      ["the home directory", () => join(TMP, "outer", "home"), "home directory or one of its ancestors"],
      ["an ancestor of the home directory", () => join(TMP, "outer"), "home directory or one of its ancestors"],
    ])("refuses %s with exit 2 before any clone", (_name, folder, reason) => {
      const home = homeDir();
      writeFileSync(join(TMP, "outer", "keep.txt"), "keep\n");
      const f = folder();
      const before = listing(join(TMP, "outer"));
      const r = run(f, home);
      expect(r.status).toBe(2);
      expect(r.out).toContain(f);
      expect(r.out).toContain(reason);
      expect(r.calls).toEqual([]);
      expect(listing(join(TMP, "outer"))).toEqual(before);
    });

    it("refuses a non-empty directory that is not a git working tree", () => {
      const cfg = join(TMP, "plain");
      mkdirSync(cfg);
      writeFileSync(join(cfg, "precious.txt"), "keep\n");
      const before = listing(cfg);
      const r = run(cfg, homeDir());
      expect(r.status).toBe(2);
      expect(r.out).toContain(cfg);
      expect(r.out).toContain("neither a git working tree");
      expect(r.calls).toEqual([]);
      expect(listing(cfg)).toEqual(before);
      expect(readFileSync(join(cfg, "precious.txt"), "utf8")).toBe("keep\n");
    });

    it("refuses a path that is a file", () => {
      const file = join(TMP, "afile");
      writeFileSync(file, "x\n");
      const r = run(file, homeDir());
      expect(r.status).toBe(2);
      expect(r.out).toContain("not a directory");
      expect(readFileSync(file, "utf8")).toBe("x\n");
    });

    it("accepts an empty directory", () => {
      const cfg = join(TMP, "empty");
      mkdirSync(cfg);
      const r = run(cfg, homeDir());
      expect(r.status).toBe(0);
      expect(existsSync(join(cfg, "app.json"))).toBe(true);
    });

    it("accepts an existing git working tree and replaces it", () => {
      const cfg = join(TMP, "tree");
      mkdirSync(join(cfg, ".git"), { recursive: true });
      writeFileSync(join(cfg, "old.txt"), "old\n");
      const r = run(cfg, homeDir());
      expect(r.status).toBe(0);
      expect(existsSync(join(cfg, "old.txt"))).toBe(false);
      expect(existsSync(join(cfg, "app.json"))).toBe(true);
    });

    it("accepts a non-existent folder under a missing parent", () => {
      const cfg = join(TMP, "new", "deeper", "cfg");
      const r = run(cfg, homeDir());
      expect(r.status).toBe(0);
      expect(existsSync(join(cfg, "app.json"))).toBe(true);
    });

    it("accepts the output of an earlier run, so a refresh works", () => {
      const cfg = join(TMP, "again");
      expect(run(cfg, homeDir()).status).toBe(0);
      expect(existsSync(join(cfg, ".git"))).toBe(false);
      const second = run(cfg, homeDir());
      expect(second.status).toBe(0);
      expect(existsSync(join(cfg, "app.json"))).toBe(true);
    });
  });
});
