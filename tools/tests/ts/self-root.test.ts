// Port of test_self_root.bats (11 tests): tools/lib/self-root.bash — the
// self-location resolver. Contract: self-location wins unless the exported
// DEVENV_TOOLS realpath-resolves to the same root.
import { afterEach, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))));
const LIB_PATH = join(ROOT, "tools/lib/self-root.bash");

const tempDirs: string[] = [];

function freshDir(): string {
  const d = mkdtempSync(join(tmpdir(), `selfroot-${Date.now()}-${Math.random().toString(36).slice(2)}`));
  tempDirs.push(d);
  return d;
}

// Build a fake devenv checkout (root/tools/lib sentinel) in a temp dir.
function makeFakeCheckout(root: string): void {
  mkdirSync(join(root, "tools/lib"), { recursive: true });
  mkdirSync(join(root, "tools/scripts"), { recursive: true });
  writeFileSync(join(root, "tools/scripts/sentinel.sh"), "#!/bin/bash\n");
}

// Source the lib with a script path pretending to live in a checkout; echo the
// resolved tools root. The script path is passed as argv, never interpolated.
function resolveFrom(scriptPath: string, env: Record<string, string> = {}): string {
  const r = spawnSync("bash", ["-c", `source '${LIB_PATH}'; devenv_resolve_tools_root "$1"`, "_", scriptPath], {
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
  return (r.stdout ?? "").trim();
}

afterEach(() => {
  for (const d of tempDirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe("self-root resolver", () => {
  it("unsets: no exported DEVENV_TOOLS -> self-derived tools root wins", () => {
    const root = freshDir();
    makeFakeCheckout(root);
    const result = resolveFrom(join(root, "tools/scripts/whatever.sh"), { DEVENV_TOOLS: "" });
    // run with the variable unset (empty env entry deletes it for bash)
    const r2 = spawnSync("bash", ["-c", `unset DEVENV_TOOLS; source '${LIB_PATH}'; devenv_resolve_tools_root "$1"`, "_", join(root, "tools/scripts/whatever.sh")], { encoding: "utf8" });
    expect(r2.stdout?.trim()).toBe(join(root, "tools"));
    void result;
  });

  it("matching env: exported DEVENV_TOOLS equal to self root -> honored", () => {
    const root = freshDir();
    makeFakeCheckout(root);
    const result = resolveFrom(join(root, "tools/scripts/whatever.sh"), { DEVENV_TOOLS: join(root, "tools") });
    expect(result).toBe(join(root, "tools"));
  });

  it("foreign env: exported DEVENV_TOOLS at another checkout -> overridden by self", () => {
    const foreignRoot = freshDir();
    const ownRoot = freshDir();
    makeFakeCheckout(foreignRoot);
    makeFakeCheckout(ownRoot);
    const result = resolveFrom(join(ownRoot, "tools/scripts/whatever.sh"), { DEVENV_TOOLS: join(foreignRoot, "tools") });
    expect(result).toBe(join(ownRoot, "tools"));
  });

  it("cache-mirror env: exported DEVENV_TOOLS inside a mirror tree -> overridden", () => {
    // Mirror = a fake checkout nested UNDER another fake checkout's cache dir,
    // modeling tools/cache/repo_cache/devenv/tools.
    const ownRoot = freshDir();
    makeFakeCheckout(ownRoot);
    const mirrorRoot = join(ownRoot, "tools/cache/repo_cache/devenv-mirror");
    makeFakeCheckout(mirrorRoot);
    const result = resolveFrom(join(ownRoot, "tools/scripts/whatever.sh"), { DEVENV_TOOLS: join(mirrorRoot, "tools") });
    expect(result).toBe(join(ownRoot, "tools"));
  });

  it("symlinked self-location: script invoked via symlink -> self root still derives", () => {
    const root = freshDir();
    makeFakeCheckout(root);
    const linkDir = freshDir();
    symlinkSync(join(root, "tools/scripts/whatever.sh"), join(linkDir, "aliased.sh"));
    const r2 = spawnSync("bash", ["-c", `unset DEVENV_TOOLS; source '${LIB_PATH}'; devenv_resolve_tools_root "$1"`, "_", join(linkDir, "aliased.sh")], { encoding: "utf8" });
    expect(r2.stdout?.trim()).toBe(join(root, "tools"));
  });

  it("foreign env via symlinked path -> overridden (realpath-normalized comparison)", () => {
    const foreignRoot = freshDir();
    const ownRoot = freshDir();
    makeFakeCheckout(foreignRoot);
    makeFakeCheckout(ownRoot);
    const linkDir = freshDir();
    symlinkSync(join(foreignRoot, "tools"), join(linkDir, "foreign-tools-link"));
    const result = resolveFrom(join(ownRoot, "tools/scripts/whatever.sh"), { DEVENV_TOOLS: join(linkDir, "foreign-tools-link") });
    expect(result).toBe(join(ownRoot, "tools"));
  });

  it("matching env via symlinked path -> honored (realpath-normalized comparison)", () => {
    const root = freshDir();
    makeFakeCheckout(root);
    const linkDir = freshDir();
    symlinkSync(join(root, "tools"), join(linkDir, "own-tools-link"));
    const result = resolveFrom(join(root, "tools/scripts/whatever.sh"), { DEVENV_TOOLS: join(linkDir, "own-tools-link") });
    expect(result).toBe(join(root, "tools"));
  });

  it("relative-path env resolving to the same root -> honored", () => {
    const root = freshDir();
    makeFakeCheckout(root);
    const result = resolveFrom(join(root, "tools/scripts/whatever.sh"), { DEVENV_TOOLS: `${join(root, "tools")}/../tools` });
    expect(result).toBe(join(root, "tools"));
  });

  it("nonexistent foreign env path -> overridden by self", () => {
    const root = freshDir();
    makeFakeCheckout(root);
    const result = resolveFrom(join(root, "tools/scripts/whatever.sh"), { DEVENV_TOOLS: "/nonexistent/path/tools" });
    expect(result).toBe(join(root, "tools"));
  });

  it("devcontainer layout: script in .devcontainer/install-extras derives repo root", () => {
    const root = freshDir();
    mkdirSync(join(root, ".devcontainer/install-extras"), { recursive: true });
    const r2 = spawnSync("bash", ["-c", `unset DEVENV_TOOLS; source '${LIB_PATH}'; devenv_self_root "$1"`, "_", join(root, ".devcontainer/install-extras/zsh.sh")], { encoding: "utf8" });
    expect(r2.stdout?.trim()).toBe(root);
  });

  it("lib from tests dir layout: script in tools/tests/lib derives repo root", () => {
    const root = freshDir();
    makeFakeCheckout(root);
    mkdirSync(join(root, "tools/tests/lib"), { recursive: true });
    const r2 = spawnSync("bash", ["-c", `unset DEVENV_TOOLS; source '${LIB_PATH}'; devenv_self_root "$1"`, "_", join(root, "tools/tests/lib/probe.bats")], { encoding: "utf8" });
    expect(r2.stdout?.trim()).toBe(root);
  });
});
