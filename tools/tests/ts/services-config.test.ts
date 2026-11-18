// get-services-config: syntax, --help contract (an existing config folder
// must be untouched), and the source-level shape locks of the tool.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync, existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { pathWithStubs, recordedGitCalls, runTool as runHarness, stubCli, stubRecordingGit } from "./harness/index.ts";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const ROOT = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))));
const SCRIPT = join(ROOT, "tools", "ts", "get-services-config.ts");
const TS_SOURCE = join(ROOT, "tools", "ts", "get-services-config.ts");

let TMP = "";

beforeEach(() => {
  TMP = mkdtempSync(join(tmpdir(), `svccfg-${Date.now()}-${Math.random().toString(36).slice(2)}`));
});

function runTool(args: string[], extraEnv: Record<string, string> = {}, cwd?: string): { status: number; out: string } {
  // The suite drove the depth-1 bash stub; the harness runs the .ts source
  // (same execution path) — the bash-syntax test below still pins the stub.
  const r = runHarness("get-services-config", args, { env: { ...extraEnv }, cwd });
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

  it("--help states every CONFIG_FOLDER rule", () => {
    const out = runTool(["--help"]).out.replace(/\s+/g, " ");
    for (const phrase of ["absolute path", "symbolic link", "DEVENV_ROOT", "current directory", "ancestor", "previously extracted", "unpushed", "stashes", "ignored or untracked"]) {
      expect(out).toContain(phrase);
    }
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

  function git(dir: string, ...a: string[]): string {
    const r = spawnSync("git", ["-C", dir, "-c", "user.name=t", "-c", "user.email=t@example.invalid", ...a], { encoding: "utf8" });
    expect(r.status).toBe(0);
    return r.stdout ?? "";
  }

  // A real, clean git working tree: initialised and everything committed.
  function commitAll(dir: string): void {
    git(dir, "init", "-q");
    git(dir, "add", "-A");
    git(dir, "commit", "-q", "-m", "init");
  }

  // Gives a committed repository a bare remote and pushes to it, so nothing
  // in it exists only locally.
  function pushToRemote(dir: string): string {
    const bare = `${dir}-origin.git`;
    git(TMP, "init", "-q", "--bare", bare);
    git(dir, "remote", "add", "origin", bare);
    git(dir, "push", "-q", "-u", "origin", "HEAD");
    return bare;
  }

  function existingConfig(): string {
    const cfg = join(TMP, "cfg");
    mkdirSync(cfg, { recursive: true });
    writeFileSync(join(cfg, "marker"), "keep\n");
    commitAll(cfg);
    pushToRemote(cfg);
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

    // A git that records every call and otherwise runs the real one, so the
    // tool sees genuine status/remote output and clone calls stay observable.
    function passthroughGit(): string {
      const bin = join(TMP, "pbin");
      mkdirSync(bin, { recursive: true });
      const real = spawnSync("sh", ["-c", "command -v git"], { encoding: "utf8" }).stdout.trim();
      stubCli(bin, "git", [
        "#!/usr/bin/env bash",
        `{ for a in "$@"; do printf '[%s]' "$a"; done; echo; } >> "${join(bin, "git-argv.log")}"`,
        `exec "${real}" "$@"`,
      ].join("\n"));
      return bin;
    }

    function runReal(folder: string, url: string, opts: { cwd?: string; env?: Record<string, string> } = {}): { status: number; out: string; calls: string[][] } {
      const bin = passthroughGit();
      const r = runTool([url], { CONFIG_FOLDER: folder, HOME: homeDir(), PATH: pathWithStubs(bin), ...opts.env }, opts.cwd);
      return { ...r, calls: recordedGitCalls(bin) };
    }

    // A committed working tree, fully pushed to its own bare remote.
    function workingTree(name: string, dirty: boolean): string {
      const dir = join(TMP, name);
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, "work.txt"), "committed\n");
      commitAll(dir);
      pushToRemote(dir);
      if (dirty) writeFileSync(join(dir, "work.txt"), "uncommitted\n");
      return dir;
    }

    const URL = "https://example.invalid/org/cfg.git";

    function expectRefused(r: { status: number; out: string; calls: string[][] }, dir: string, kind: string): void {
      expect(r.status).toBe(2);
      expect(r.out).toContain(dir);
      expect(r.out).toContain(kind);
      expect(r.calls.some((c) => c[0] === "clone")).toBe(false);
      expect(readdirSync(TMP).filter((n) => n.startsWith(`${basename(dir)}.`))).toEqual([]);
    }

    it("refuses a dirty git working tree with exit 2 and leaves it untouched", () => {
      const dir = workingTree("dirty", true);
      expectRefused(runReal(dir, URL), dir, "uncommitted, untracked or ignored files");
      expect(readFileSync(join(dir, "work.txt"), "utf8")).toBe("uncommitted\n");
    });

    it("refuses a dirty git working tree even when its origin is the configuration repository", () => {
      const remote = mkRemote();
      const dir = workingTree("tracking", true);
      git(dir, "remote", "set-url", "origin", remote);
      expectRefused(runReal(dir, remote), dir, "uncommitted, untracked or ignored files");
      expect(readFileSync(join(dir, "work.txt"), "utf8")).toBe("uncommitted\n");
    });

    it("refuses a tree whose only local content is a gitignored file", () => {
      const dir = join(TMP, "ignored");
      mkdirSync(dir);
      writeFileSync(join(dir, ".gitignore"), "secret.env\n");
      commitAll(dir);
      pushToRemote(dir);
      writeFileSync(join(dir, "secret.env"), "token\n");
      expectRefused(runReal(dir, URL), dir, "uncommitted, untracked or ignored files");
      expect(readFileSync(join(dir, "secret.env"), "utf8")).toBe("token\n");
    });

    it("refuses untracked files even when the user's git config hides them from status", () => {
      const dir = workingTree("hidden", false);
      writeFileSync(join(dir, "new.txt"), "untracked\n");
      git(dir, "config", "status.showUntrackedFiles", "no");
      expectRefused(runReal(dir, URL), dir, "uncommitted, untracked or ignored files");
      expect(existsSync(join(dir, "new.txt"))).toBe(true);
    });

    it("refuses a commit that exists only locally", () => {
      const dir = workingTree("unpushed", false);
      writeFileSync(join(dir, "work.txt"), "second\n");
      git(dir, "commit", "-q", "-am", "local only");
      expectRefused(runReal(dir, URL), dir, "commits that exist only locally");
      expect(readFileSync(join(dir, "work.txt"), "utf8")).toBe("second\n");
    });

    it("refuses a repository with no remote and one commit", () => {
      const dir = join(TMP, "noremote");
      mkdirSync(dir);
      writeFileSync(join(dir, "work.txt"), "committed\n");
      commitAll(dir);
      expectRefused(runReal(dir, URL), dir, "commits that exist only locally");
    });

    it("refuses stashed changes", () => {
      const dir = workingTree("stashed", true);
      git(dir, "stash", "push", "-q");
      expectRefused(runReal(dir, URL), dir, "stashed changes");
    });

    it("refuses a repository whose state git cannot report", () => {
      const dir = workingTree("corrupt", false);
      writeFileSync(join(dir, ".git", "HEAD"), "garbage\n");
      expectRefused(runReal(dir, URL), dir, "git could not report its state");
    });

    it("accepts an empty repository without commits", () => {
      const dir = join(TMP, "fresh");
      mkdirSync(dir);
      git(dir, "init", "-q");
      const r = runReal(dir, mkRemote());
      expect(r.status).toBe(0);
      expect(existsSync(join(dir, "app.json"))).toBe(true);
    });

    it("accepts a clean, fully pushed git working tree and replaces it", () => {
      const remote = mkRemote();
      const dir = workingTree("clean", false);
      const r = runReal(dir, remote);
      expect(r.status).toBe(0);
      expect(existsSync(join(dir, "work.txt"))).toBe(false);
      expect(existsSync(join(dir, "app.json"))).toBe(true);
    });

    it("treats a .git file (linked worktree) as a git working tree", () => {
      const main = workingTree("main", false);
      const wt = join(TMP, "linked");
      git(main, "worktree", "add", "-q", "-b", "side", wt);
      expect(statSync(join(wt, ".git")).isFile()).toBe(true);
      writeFileSync(join(wt, "side.txt"), "side\n");
      git(wt, "add", "side.txt");
      git(wt, "commit", "-q", "-m", "side work");
      // The commit exists only locally, so the worktree is refused.
      expectRefused(runReal(wt, URL), wt, "commits that exist only locally");
      git(main, "push", "-q", "origin", "side");
      const remote = mkRemote();
      const r = runReal(wt, remote);
      expect(r.status).toBe(0);
      expect(existsSync(join(wt, "app.json"))).toBe(true);
    });

    it("works on a first run with the default CONFIG_FOLDER and again as a refresh", () => {
      const root = join(TMP, "devroot-default");
      mkdirSync(root);
      const remote = mkRemote();
      const env = { DEVENV_ROOT: root, HOME: homeDir() };
      const first = runHarness("get-services-config", [remote], { env, cwd: TMP });
      expect(first.status).toBe(0);
      expect(existsSync(join(root, ".debug", "config", "app.json"))).toBe(true);
      const second = runHarness("get-services-config", [remote], { env, cwd: TMP });
      expect(second.status).toBe(0);
    });

    it("refuses DEVENV_ROOT even when it is a clean git working tree", () => {
      const dir = workingTree("devroot", false);
      const r = runReal(dir, URL, { env: { DEVENV_ROOT: dir } });
      expect(r.status).toBe(2);
      expect(r.out).toContain(dir);
      expect(r.out).toContain("devenv root");
      expect(r.calls).toEqual([]);
      expect(readFileSync(join(dir, "work.txt"), "utf8")).toBe("committed\n");
    });

    it("refuses an ancestor of DEVENV_ROOT", () => {
      const parent = join(TMP, "parent");
      const root = join(parent, "root");
      mkdirSync(root, { recursive: true });
      writeFileSync(join(parent, "keep.txt"), "keep\n");
      const r = runReal(parent, URL, { env: { DEVENV_ROOT: root } });
      expect(r.status).toBe(2);
      expect(r.out).toContain("devenv root");
      expect(r.calls).toEqual([]);
      expect(readFileSync(join(parent, "keep.txt"), "utf8")).toBe("keep\n");
    });

    it("refuses the current working directory", () => {
      const dir = workingTree("here", false);
      const r = runReal(dir, URL, { cwd: dir });
      expect(r.status).toBe(2);
      expect(r.out).toContain("current directory");
      expect(r.out).toContain("run the tool from another directory");
      expect(r.calls).toEqual([]);
      expect(readFileSync(join(dir, "work.txt"), "utf8")).toBe("committed\n");
    });

    it("refuses an ancestor of the current working directory", () => {
      const parent = join(TMP, "up");
      const child = join(parent, "child");
      mkdirSync(child, { recursive: true });
      const r = runReal(parent, URL, { cwd: child });
      expect(r.status).toBe(2);
      expect(r.out).toContain("current directory");
      expect(r.calls).toEqual([]);
    });

    it("refuses a symbolic link to a directory with an accurate message", () => {
      const real = join(TMP, "realdir");
      mkdirSync(real);
      writeFileSync(join(real, "keep.txt"), "keep\n");
      const link = join(TMP, "link");
      symlinkSync(real, link);
      const r = run(link, homeDir());
      expect(r.status).toBe(2);
      expect(r.out).toContain(link);
      expect(r.out).toContain("it is a symbolic link; point CONFIG_FOLDER at the real directory");
      expect(r.out).not.toContain("not a directory");
      expect(r.calls).toEqual([]);
      expect(readFileSync(join(real, "keep.txt"), "utf8")).toBe("keep\n");
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
