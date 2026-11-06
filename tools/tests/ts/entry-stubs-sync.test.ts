// Port of tools/tests/scripts/test_entry_stubs_sync.bats (44 tests) — the
// idempotent owner of the tools/ depth-1 entry points. Mechanics are exercised
// against mock checkouts; one test guards the real tree. The bats assertions
// are the oracle. Fixture hygiene per tools/tests/README.md: mock checkouts
// live under tmpPath().
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync, chmodSync, readFileSync, existsSync, rmSync, symlinkSync, lstatSync, readdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))));
const SYNC_SOURCE = join(ROOT, ".devcontainer", "entry-stubs-sync.sh");

let TMP = "";

function ensureTmp(): void {
  if (!TMP) {
    TMP = mkdtempSync(join(tmpdir(), `estub-${Date.now()}-${Math.random().toString(36).slice(2)}`));
  }
}

function tmpPath(...parts: string[]): string {
  ensureTmp();
  const base = tmpdir();
  if (!isAbsolute(TMP) || !TMP.startsWith(base)) {
    throw new Error(`scratch-dir guard: TMP=${JSON.stringify(TMP)} is not under ${base}`);
  }
  return join(TMP, ...parts);
}

afterAll(() => {
  if (TMP && !process.env["KEEP_ESTUB_DEBUG"]) rmSync(TMP, { recursive: true, force: true });
});

// Mock checkout: .devcontainer/ (sync script) + tools/{scripts,ts,lib}. The
// fixture copies self-root + error-handling libs (the sync script's resolver
// deps). Returns the mock's sync-script path.
function makeMockCheckout(): { root: string; syncScript: string } {
  const root = tmpPath(`mock-${Math.random().toString(36).slice(2)}`);
  mkdirSync(join(root, ".devcontainer"), { recursive: true });
  mkdirSync(join(root, "tools", "scripts"), { recursive: true });
  mkdirSync(join(root, "tools", "ts"), { recursive: true });
  mkdirSync(join(root, "tools", "lib"), { recursive: true });
  spawnSync("cp", [SYNC_SOURCE, join(root, ".devcontainer")]);
  spawnSync("cp", [join(ROOT, "tools", "lib", "self-root.bash"), join(root, "tools", "lib")]);
  spawnSync("cp", [join(ROOT, "tools", "lib", "error-handling.bash"), join(root, "tools", "lib")]);
  return { root, syncScript: join(root, ".devcontainer", "entry-stubs-sync.sh") };
}

function makeTsScript(root: string, name: string): void {
  writeFileSync(join(root, "tools", "ts", `${name}.ts`), `console.log("ran-ts-${name}");\n`);
}

function makeScript(root: string, name: string): void {
  writeFileSync(
    join(root, "tools", "scripts", name),
    `#!/bin/bash\nsource "$(cd "$(dirname "\${BASH_SOURCE[0]}")/../lib" && pwd)/self-root.bash"\necho "ran-${name.replace(/\.sh$/, "")}"\n`,
  );
}

function makeStub(root: string, name: string, file: string): void {
  writeFileSync(join(root, "tools", name), `#!/bin/bash\nexec bash "$(dirname "$0")/scripts/${file}" "$@"\n`);
  chmodSync(join(root, "tools", name), 0o755);
}

function makeLayerScript(root: string, layer: string, name: string): void {
  mkdirSync(join(root, "tools", layer), { recursive: true });
  writeFileSync(join(root, "tools", layer, name), `#!/bin/bash\necho "ran-${layer}-${name}"\n`);
}

function sync(syncScript: string): { status: number; out: string } {
  const r = spawnSync("bash", [syncScript], { encoding: "utf8" });
  return { status: r.status ?? 1, out: (r.stdout ?? "") + (r.stderr ?? "") };
}

function runStub(root: string, name: string): { status: number; out: string } {
  const r = spawnSync("bash", [join(root, "tools", name)], { encoding: "utf8" });
  return { status: r.status ?? 1, out: (r.stdout ?? "").trim() };
}

// The extensionless-script execution path sources self-root via the stub's
// own dir; running the stub as `bash <path>` matches the bats `run bash`.
function md5(path: string): string {
  return spawnSync("md5sum", [path], { encoding: "utf8" }).stdout.split(" ")[0] ?? "";
}

describe("entry-stubs-sync (bats port)", () => {
  beforeEach(() => {
    // Each test builds its own mock checkout (the bats suites did the same
    // inside every @test).
  });

  it("setup: sync script exists in .devcontainer/", () => {
    expect(existsSync(SYNC_SOURCE)).toBe(true);
  });

  it("creates a stub for every tools/scripts/ script", () => {
    const { root, syncScript } = makeMockCheckout();
    makeScript(root, "alpha.sh");
    makeScript(root, "beta.sh");
    expect(sync(syncScript).status).toBe(0);
    expect(existsSync(join(root, "tools", "alpha"))).toBe(true);
    expect(existsSync(join(root, "tools", "beta"))).toBe(true);
    expect(readFileSync(join(root, "tools", "alpha"), "utf8")).toContain("scripts/alpha.sh");
    expect(readFileSync(join(root, "tools", "beta"), "utf8")).toContain("scripts/beta.sh");
  });

  it("converts a stale symlink into a stub", () => {
    const { root, syncScript } = makeMockCheckout();
    makeScript(root, "alpha.sh");
    symlinkSync(join(root, "tools", "scripts", "alpha.sh"), join(root, "tools", "alpha"));
    expect(sync(syncScript).status).toBe(0);
    expect(lstatSync(join(root, "tools", "alpha")).isSymbolicLink()).toBe(false);
    expect(readFileSync(join(root, "tools", "alpha"), "utf8")).toContain("scripts/alpha.sh");
  });

  it("converts a drifted real-file copy into a stub (scripts/ is canonical)", () => {
    const { root, syncScript } = makeMockCheckout();
    makeScript(root, "alpha.sh");
    writeFileSync(join(root, "tools", "alpha"), "#!/bin/bash\n# drifted stale content\n");
    expect(sync(syncScript).status).toBe(0);
    expect(readFileSync(join(root, "tools", "alpha"), "utf8")).toContain("scripts/alpha.sh");
    expect(readFileSync(join(root, "tools", "alpha"), "utf8")).not.toContain("drifted stale content");
  });

  it("idempotent: second run changes nothing", () => {
    const { root, syncScript } = makeMockCheckout();
    makeScript(root, "alpha.sh");
    expect(sync(syncScript).status).toBe(0);
    const first = md5(join(root, "tools", "alpha"));
    const r2 = sync(syncScript);
    expect(r2.status).toBe(0);
    expect(r2.out).toContain("already-ok=1");
    expect(md5(join(root, "tools", "alpha"))).toBe(first);
  });

  it("stubs execute the real scripts/ file (BASH_SOURCE is the scripts path)", () => {
    const { root, syncScript } = makeMockCheckout();
    makeScript(root, "alpha.sh");
    expect(sync(syncScript).status).toBe(0);
    const r = spawnSync("bash", [join(root, "tools", "alpha")], { encoding: "utf8" });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("ran-alpha");
  });

  it("foreign depth-1 files are left untouched", () => {
    const { root, syncScript } = makeMockCheckout();
    makeScript(root, "alpha.sh");
    writeFileSync(join(root, "tools", "unrelated"), "not-ours\n");
    expect(sync(syncScript).status).toBe(0);
    expect(readFileSync(join(root, "tools", "unrelated"), "utf8")).toBe("not-ours\n");
  });

  it("handles git-* scripts (no .sh suffix) by full name", () => {
    const { root, syncScript } = makeMockCheckout();
    writeFileSync(join(root, "tools", "scripts", "git-wip"), "#!/bin/bash\necho git-tool-ran\n");
    expect(sync(syncScript).status).toBe(0);
    expect(existsSync(join(root, "tools", "git-wip"))).toBe(true);
    expect(readFileSync(join(root, "tools", "git-wip"), "utf8")).toContain("scripts/git-wip");
  });

  it("underscore-prefixed scripts get no depth-1 entry (internal by contract)", () => {
    const { root, syncScript } = makeMockCheckout();
    makeScript(root, "alpha.sh");
    mkdirSync(join(root, "tools", "internal"), { recursive: true });
    writeFileSync(join(root, "tools", "internal", "_on_merge.sh"), '#!/bin/bash\nexec bash "$(dirname "$0")/internal/_on_event_dispatch.sh" "_on_merge" "$@"\n');
    chmodSync(join(root, "tools", "internal", "_on_merge.sh"), 0o755);
    expect(sync(syncScript).status).toBe(0);
    expect(existsSync(join(root, "tools", "alpha"))).toBe(true);
    expect(existsSync(join(root, "tools", "_on_merge"))).toBe(false);
  });

  it("stubs whose script was renamed away are purged (dead exec target)", () => {
    const { root, syncScript } = makeMockCheckout();
    makeScript(root, "alpha.sh");
    makeStub(root, "old-name", "old-name.sh");
    expect(sync(syncScript).status).toBe(0);
    expect(existsSync(join(root, "tools", "old-name"))).toBe(false);
    expect(existsSync(join(root, "tools", "alpha"))).toBe(true);
  });

  it("stale node stubs (deleted .ts source) are purged too", () => {
    const { root, syncScript } = makeMockCheckout();
    writeFileSync(join(root, "tools", "scripts", "alpha.sh"), "#!/bin/bash\necho ran-sh\n");
    writeFileSync(join(root, "tools", "gone"), '#!/bin/bash\nexec node "$(dirname "$0")/scripts/gone.ts" "$@"\n');
    chmodSync(join(root, "tools", "gone"), 0o755);
    expect(sync(syncScript).status).toBe(0);
    expect(existsSync(join(root, "tools", "gone"))).toBe(false);
    expect(existsSync(join(root, "tools", "alpha"))).toBe(true);
  });

  it("stale underscore stubs from the old contract are purged", () => {
    const { root, syncScript } = makeMockCheckout();
    makeScript(root, "alpha.sh");
    makeStub(root, "_on_merge", "_on_merge.sh");
    expect(sync(syncScript).status).toBe(0);
    expect(existsSync(join(root, "tools", "_on_merge"))).toBe(false);
    expect(existsSync(join(root, "tools", "alpha"))).toBe(true);
  });

  it("foreign underscore files at depth-1 are left untouched", () => {
    const { root, syncScript } = makeMockCheckout();
    makeScript(root, "alpha.sh");
    writeFileSync(join(root, "tools", "_my_private_tool"), "custom internal tool\n");
    expect(sync(syncScript).status).toBe(0);
    expect(readFileSync(join(root, "tools", "_my_private_tool"), "utf8")).toBe("custom internal tool\n");
  });

  it("test runner gets a depth-1 entry (tools/run-devenv-tests)", () => {
    const { root, syncScript } = makeMockCheckout();
    mkdirSync(join(root, "tools", "tests"), { recursive: true });
    writeFileSync(join(root, "tools", "tests", "run-devenv-tests.sh"), "#!/bin/bash\necho tests-ran\n");
    chmodSync(join(root, "tools", "tests", "run-devenv-tests.sh"), 0o755);
    expect(sync(syncScript).status).toBe(0);
    expect(existsSync(join(root, "tools", "run-devenv-tests"))).toBe(true);
    expect(readFileSync(join(root, "tools", "run-devenv-tests"), "utf8")).toContain("tests/run-devenv-tests.sh");
  });

  it("hidden files in tools/ are never touched", () => {
    const { root, syncScript } = makeMockCheckout();
    makeScript(root, "alpha.sh");
    writeFileSync(join(root, "tools", ".continueignore"), "config\n");
    expect(sync(syncScript).status).toBe(0);
    expect(readFileSync(join(root, "tools", ".continueignore"), "utf8")).toBe("config\n");
  });

  it("real checkout: every depth-1 stub's exec target exists", () => {
    // Guards the real tree: a stub whose target is missing breaks the
    // command for every developer (this exact gap shipped once).
    const broken: string[] = [];
    for (const f of readdirSync(join(ROOT, "tools")).sort()) {
      if (!/^[a-z]/.test(f)) continue;
      const full = join(ROOT, "tools", f);
      if (!existsSync(full) || !statSync(full).isFile()) continue;
      const target = (readFileSync(full, "utf8").match(/scripts\/[a-zA-Z0-9._-]*\.sh/) ?? [])[0];
      if (!target) continue;
      if (!existsSync(join(ROOT, "tools", target))) {
        broken.push(`${f} -> ${target}`);
      }
    }
    expect(broken, `stale depth-1 stubs (exec target missing):\n${broken.join("\n")}`).toEqual([]);
  });

  it("a stub for an extensionless script whose target is gone is purged", () => {
    const { root, syncScript } = makeMockCheckout();
    makeScript(root, "alpha.sh");
    makeStub(root, "git-old-tool", "git-old-tool");
    expect(sync(syncScript).status).toBe(0);
    expect(existsSync(join(root, "tools", "git-old-tool"))).toBe(false);
    expect(existsSync(join(root, "tools", "alpha"))).toBe(true);
  });

  it("a stub for an extensionless script that still exists is kept", () => {
    const { root, syncScript } = makeMockCheckout();
    writeFileSync(join(root, "tools", "scripts", "git-live"), "#!/bin/bash\necho git-live\n");
    chmodSync(join(root, "tools", "scripts", "git-live"), 0o755);
    makeStub(root, "git-live", "git-live");
    expect(sync(syncScript).status).toBe(0);
    expect(existsSync(join(root, "tools", "git-live"))).toBe(true);
  });

  // ── override layers: custom > fork > scripts (ts between fork and scripts) ─

  it("a tools/fork/ script gets a depth-1 stub that runs it", () => {
    const { root, syncScript } = makeMockCheckout();
    makeLayerScript(root, "fork", "own-tool.sh");
    expect(sync(syncScript).status).toBe(0);
    expect(readFileSync(join(root, "tools", "own-tool"), "utf8")).toContain("fork/own-tool.sh");
    expect(runStub(root, "own-tool").out).toBe("ran-fork-own-tool.sh");
  });

  it("a tools/custom/ script gets a depth-1 stub that runs it", () => {
    const { root, syncScript } = makeMockCheckout();
    makeLayerScript(root, "custom", "mine.sh");
    sync(syncScript);
    expect(readFileSync(join(root, "tools", "mine"), "utf8")).toContain("custom/mine.sh");
  });

  it("a tools/ts/ source gets a node stub that runs it", () => {
    const { root, syncScript } = makeMockCheckout();
    makeTsScript(root, "ts-tool");
    expect(sync(syncScript).status).toBe(0);
    expect(readFileSync(join(root, "tools", "ts-tool"), "utf8")).toMatch(/exec node .*ts\/ts-tool\.ts/);
    expect(runStub(root, "ts-tool").out).toBe("ran-ts-ts-tool");
  });

  it("precedence: ts beats scripts for the same name (extensioned source wins the stub)", () => {
    const { root, syncScript } = makeMockCheckout();
    makeScript(root, "shared.sh");
    makeTsScript(root, "shared");
    sync(syncScript);
    expect(readFileSync(join(root, "tools", "shared"), "utf8")).toMatch(/exec node .*ts\/shared\.ts/);
  });

  it("precedence: fork beats ts for the same name", () => {
    const { root, syncScript } = makeMockCheckout();
    makeTsScript(root, "shared");
    makeLayerScript(root, "fork", "shared.ts");
    sync(syncScript);
    expect(readFileSync(join(root, "tools", "shared"), "utf8")).toMatch(/exec node .*fork\/shared\.ts/);
  });

  it("precedence: custom beats fork beats provided for the same name", () => {
    const { root, syncScript } = makeMockCheckout();
    makeScript(root, "shared.sh");
    makeLayerScript(root, "fork", "shared.sh");
    sync(syncScript);
    expect(readFileSync(join(root, "tools", "shared"), "utf8")).toContain("fork/shared.sh");
    makeLayerScript(root, "custom", "shared.sh");
    sync(syncScript);
    expect(readFileSync(join(root, "tools", "shared"), "utf8")).toContain("custom/shared.sh");
    expect(runStub(root, "shared").out).toBe("ran-custom-shared.sh");
  });

  it("removing an override and re-syncing points the stub back at the next layer", () => {
    const { root, syncScript } = makeMockCheckout();
    makeScript(root, "shared.sh");
    makeLayerScript(root, "custom", "shared.sh");
    sync(syncScript);
    expect(readFileSync(join(root, "tools", "shared"), "utf8")).toContain("custom/shared.sh");
    rmSync(join(root, "tools", "custom", "shared.sh"));
    expect(sync(syncScript).status).toBe(0);
    expect(readFileSync(join(root, "tools", "shared"), "utf8")).toContain("scripts/shared.sh");
  });

  it("removing a pure custom tool purges its stub", () => {
    const { root, syncScript } = makeMockCheckout();
    makeLayerScript(root, "custom", "temp.sh");
    sync(syncScript);
    expect(existsSync(join(root, "tools", "temp"))).toBe(true);
    rmSync(join(root, "tools", "custom", "temp.sh"));
    const r = sync(syncScript);
    expect(r.out).toContain("removed=1");
    expect(existsSync(join(root, "tools", "temp"))).toBe(false);
  });

  it("underscore-prefixed scripts in fork/ and custom/ get no depth-1 entry", () => {
    const { root, syncScript } = makeMockCheckout();
    makeLayerScript(root, "fork", "_internal.sh");
    makeLayerScript(root, "custom", "_hidden.sh");
    sync(syncScript);
    expect(existsSync(join(root, "tools", "_internal"))).toBe(false);
    expect(existsSync(join(root, "tools", "_hidden"))).toBe(false);
    expect(existsSync(join(root, "tools", "_internal.sh"))).toBe(false);
  });

  it("a stale extensionless git-* stub is purged along with the .sh ones", () => {
    const { root, syncScript } = makeMockCheckout();
    makeStub(root, "git-gone", "git-gone");
    sync(syncScript);
    expect(existsSync(join(root, "tools", "git-gone"))).toBe(false);
  });

  it("a fork-layer git-* tool overrides the provided one", () => {
    const { root, syncScript } = makeMockCheckout();
    writeFileSync(join(root, "tools", "scripts", "git-thing"), "#!/bin/bash\necho provided\n");
    mkdirSync(join(root, "tools", "fork"), { recursive: true });
    writeFileSync(join(root, "tools", "fork", "git-thing"), "#!/bin/bash\necho forked\n");
    sync(syncScript);
    expect(runStub(root, "git-thing").out).toBe("forked");
  });

  it("a re-run with no changes in any layer is a no-op", () => {
    const { root, syncScript } = makeMockCheckout();
    makeScript(root, "a.sh");
    makeLayerScript(root, "fork", "b.sh");
    makeLayerScript(root, "custom", "a.sh");
    sync(syncScript);
    const r = sync(syncScript);
    expect(r.out).toContain("created=0 converted=0");
    expect(r.out).toContain("removed=0");
  });


  // ── safety/edge cases (the bats file's harder half) ──────────────────────

  it("a custom tool named like a tools/ directory is skipped with a warning and the rest still sync", () => {
    const { root, syncScript } = makeMockCheckout();
    mkdirSync(join(root, "tools", "config"), { recursive: true });
    makeLayerScript(root, "custom", "lib.sh");
    makeLayerScript(root, "custom", "config.sh");
    makeLayerScript(root, "custom", "fine.sh");
    const r = sync(syncScript);
    expect(r.status).toBe(0);
    expect(r.out).toContain("tools/lib is a directory");
    expect(r.out).toContain("tools/config is a directory");
    expect(existsSync(join(root, "tools", "lib")) && statSync(join(root, "tools", "lib")).isDirectory()).toBe(true);
    expect(existsSync(join(root, "tools", "config")) && statSync(join(root, "tools", "config")).isDirectory()).toBe(true);
    expect(existsSync(join(root, "tools", "fine"))).toBe(true);
  });

  it("a filename the stub could interpret is skipped, never written into a stub", () => {
    const { root, syncScript } = makeMockCheckout();
    mkdirSync(join(root, "tools", "custom"), { recursive: true });
    writeFileSync(join(root, "tools", "custom", "$(touch PWNED).sh"), "#!/bin/bash\necho x\n");
    writeFileSync(join(root, "tools", "custom", "back`tick.sh"), "#!/bin/bash\necho x\n");
    writeFileSync(join(root, "tools", "custom", "my tool.sh"), "#!/bin/bash\necho x\n");
    writeFileSync(join(root, "tools", "custom", "ok-name.sh"), "#!/bin/bash\necho x\n");
    const r = sync(syncScript);
    expect(r.status).toBe(0);
    expect(r.out).toContain("not a plain tool name");
    expect(existsSync(join(root, "tools", "ok-name"))).toBe(true);
    expect(runStub(root, "ok-name").status).toBe(0);
    expect(existsSync(join(root, "PWNED"))).toBe(false);
    expect(existsSync(join(root, "tools", "PWNED"))).toBe(false);
    // nothing but the one plain name was created
    const depth1Files = readdirSync(join(root, "tools")).filter((n) => statSync(join(root, "tools", n)).isFile());
    expect(depth1Files).toHaveLength(1);
  });

  it("a dangling symlink and a directory named like a script are ignored", () => {
    const { root, syncScript } = makeMockCheckout();
    mkdirSync(join(root, "tools", "custom", "dir.sh"), { recursive: true });
    symlinkSync("/nonexistent/target", join(root, "tools", "custom", "dangling.sh"));
    makeLayerScript(root, "custom", "real.sh");
    expect(sync(syncScript).status).toBe(0);
    expect(existsSync(join(root, "tools", "real"))).toBe(true);
    expect(existsSync(join(root, "tools", "dir"))).toBe(false);
    expect(existsSync(join(root, "tools", "dangling"))).toBe(false);
  });

  it("a document or data file that shares a tool's name is left alone with a warning", () => {
    const { root, syncScript } = makeMockCheckout();
    makeScript(root, "README.sh");
    writeFileSync(join(root, "tools", "README"), "my notes\n");
    const r = sync(syncScript);
    expect(r.status).toBe(0);
    expect(readFileSync(join(root, "tools", "README"), "utf8")).toBe("my notes\n");
    expect(r.out).toContain("leaving tools/README alone");
  });

  it("a drifted script copy or a stub for an old source is still converted to the winning stub", () => {
    const { root, syncScript } = makeMockCheckout();
    makeScript(root, "tool.sh");
    writeFileSync(join(root, "tools", "tool"), "#!/bin/bash\necho an old copy\n");
    chmodSync(join(root, "tools", "tool"), 0o755);
    sync(syncScript);
    expect(readFileSync(join(root, "tools", "tool"), "utf8")).toContain("scripts/tool.sh");
  });

  it("a hardlinked entry is replaced, and the source script it shares an inode with is untouched", () => {
    const { root, syncScript } = makeMockCheckout();
    makeScript(root, "alpha.sh");
    const before = readFileSync(join(root, "tools", "scripts", "alpha.sh"), "utf8");
    spawnSync("ln", [join(root, "tools", "scripts", "alpha.sh"), join(root, "tools", "alpha")]);
    expect(sync(syncScript).status).toBe(0);
    expect(readFileSync(join(root, "tools", "scripts", "alpha.sh"), "utf8")).toBe(before);
    expect(readFileSync(join(root, "tools", "alpha"), "utf8")).toContain("scripts/alpha.sh");
    expect(spawnSync("stat", ["-c", "%i", join(root, "tools", "alpha")], { encoding: "utf8" }).stdout.trim())
      .not.toBe(spawnSync("stat", ["-c", "%i", join(root, "tools", "scripts", "alpha.sh")], { encoding: "utf8" }).stdout.trim());
  });

  it("a hardlinked runner entry leaves the runner script untouched", () => {
    const { root, syncScript } = makeMockCheckout();
    mkdirSync(join(root, "tools", "tests"), { recursive: true });
    writeFileSync(join(root, "tools", "tests", "run-devenv-tests.sh"), "#!/bin/bash\necho runner");
    spawnSync("ln", [join(root, "tools", "tests", "run-devenv-tests.sh"), join(root, "tools", "run-devenv-tests")]);
    expect(sync(syncScript).status).toBe(0);
    expect(readFileSync(join(root, "tools", "tests", "run-devenv-tests.sh"), "utf8")).toBe("#!/bin/bash\necho runner");
  });

  it("a stub is written with mode 755 whatever the umask, and no temporary file is left behind", () => {
    const { root, syncScript } = makeMockCheckout();
    makeScript(root, "alpha.sh");
    const e: Record<string, string> = {};
    for (const [k, v] of Object.entries(process.env)) if (v !== undefined) e[k] = v;
    const r = spawnSync("bash", ["-c", `umask 077; bash '${syncScript}'`], { encoding: "utf8", env: e });
    expect(r.status).toBe(0);
    expect(spawnSync("stat", ["-c", "%a", join(root, "tools", "alpha")], { encoding: "utf8" }).stdout.trim()).toBe("755");
    expect(readdirSync(join(root, "tools")).filter((n) => n.includes(".tmp.")).length).toBe(0);
  });

  it("a stub that cannot be written leaves the old entry in place and says so (skips as root)", () => {
    if (typeof process.getuid === "function" && process.getuid() === 0) return; // bats skipped as root too
    const { root, syncScript } = makeMockCheckout();
    makeScript(root, "alpha.sh");
    writeFileSync(join(root, "tools", "alpha"), "#!/bin/bash\necho old entry");
    chmodSync(join(root, "tools", "alpha"), 0o755);
    spawnSync("chmod", ["a-w", join(root, "tools")]);
    const r = sync(syncScript);
    spawnSync("chmod", ["u+w", join(root, "tools")]);
    expect(r.status).not.toBe(0);
    expect(r.out).toContain("could not write");
    expect(readFileSync(join(root, "tools", "alpha"), "utf8")).toBe("#!/bin/bash\necho old entry");
  });

  it("the entry never goes missing while the sync replaces it", () => {
    const { root, syncScript } = makeMockCheckout();
    makeScript(root, "alpha.sh");
    writeFileSync(join(root, "tools", "alpha"), "#!/bin/bash\necho old\n");
    chmodSync(join(root, "tools", "alpha"), 0o755);
    // a watcher checks for the entry in a tight loop while the sync runs
    const stop = join(root, ".stop");
    const missing = join(root, ".missing");
    const watcher = spawn("bash", ["-c", `while [ ! -e '${stop}' ]; do [ -e '${join(root, "tools", "alpha")}' ] || { touch '${missing}'; break; }; done`], { stdio: "ignore" });
    try {
      for (let i = 1; i <= 8; i++) {
        writeFileSync(join(root, "tools", "alpha.stale"), `#!/bin/bash\necho old ${i}\n`);
        spawnSync("mv", ["-f", join(root, "tools", "alpha.stale"), join(root, "tools", "alpha")]);
        sync(syncScript);
      }
    } finally {
      writeFileSync(stop, "");
      void watcher;
    }
    expect(existsSync(missing)).toBe(false);
  });

  it("a .ts source gets a node stub that executes it (shebang-carrying source)", () => {
    const { root, syncScript } = makeMockCheckout();
    writeFileSync(join(root, "tools", "ts", "ts-tool.ts"), '#!/usr/bin/env node\nconsole.log("ran-ts");\n');
    expect(sync(syncScript).status).toBe(0);
    expect(existsSync(join(root, "tools", "ts-tool"))).toBe(true);
    expect(readFileSync(join(root, "tools", "ts-tool"), "utf8")).toContain('exec node "$(dirname "$0")/ts/ts-tool.ts"');
    const r = spawnSync(join(root, "tools", "ts-tool"), { encoding: "utf8" });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("ran-ts");
  });

  it("a custom .ts overrides a provided .sh (mixed-extension chain: node wins)", () => {
    const { root, syncScript } = makeMockCheckout();
    writeFileSync(join(root, "tools", "scripts", "duo.sh"), "#!/bin/bash\necho ran-sh\n");
    mkdirSync(join(root, "tools", "custom"), { recursive: true });
    writeFileSync(join(root, "tools", "custom", "duo.ts"), '#!/usr/bin/env node\nconsole.log("ran-custom-ts");\n');
    expect(sync(syncScript).status).toBe(0);
    expect(readFileSync(join(root, "tools", "duo"), "utf8")).toContain('exec node "$(dirname "$0")/custom/duo.ts"');
    const r = spawnSync(join(root, "tools", "duo"), { encoding: "utf8" });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("ran-custom-ts");
  });

  it("a fork .sh overrides a provided .ts (mixed-extension chain: bash wins)", () => {
    const { root, syncScript } = makeMockCheckout();
    writeFileSync(join(root, "tools", "ts", "duo.ts"), '#!/usr/bin/env node\nconsole.log("ran-ts");\n');
    mkdirSync(join(root, "tools", "fork"), { recursive: true });
    writeFileSync(join(root, "tools", "fork", "duo.sh"), "#!/bin/bash\necho ran-fork-sh\n");
    expect(sync(syncScript).status).toBe(0);
    expect(readFileSync(join(root, "tools", "duo"), "utf8")).toContain('exec bash "$(dirname "$0")/fork/duo.sh"');
    const r = spawnSync(join(root, "tools", "duo"), { encoding: "utf8" });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("ran-fork-sh");
  });

  it("a runner-language change converts the existing stub in place", () => {
    const { root, syncScript } = makeMockCheckout();
    writeFileSync(join(root, "tools", "scripts", "conv.sh"), "#!/bin/bash\necho old-sh\n");
    sync(syncScript);
    expect(readFileSync(join(root, "tools", "conv"), "utf8")).toContain("exec bash");
    // the tool migrates to TS: .sh source removed, .ts source arrives
    rmSync(join(root, "tools", "scripts", "conv.sh"));
    writeFileSync(join(root, "tools", "ts", "conv.ts"), '#!/usr/bin/env node\nconsole.log("new-ts");\n');
    expect(sync(syncScript).status).toBe(0);
    expect(readFileSync(join(root, "tools", "conv"), "utf8")).toContain('exec node "$(dirname "$0")/ts/conv.ts"');
    const r = spawnSync(join(root, "tools", "conv"), { encoding: "utf8" });
    expect(r.stdout).toContain("new-ts");
  });
});
