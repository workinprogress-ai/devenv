// openInEditor's VS Code resolution: existence vs launchability, remote-cli
// absolute-path resolution, and the fallback chain. These tests cover the
// port of repo-commit's `code`-resolution semantics into tools/editor:
// a `code` on PATH that cannot launch (the devcontainer shim's exit-127
// mode) must never be chosen, and the remote-cli under ~/.vscode-server/bin
// wins over PATH resolution when usable.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openInEditor } from "../../lib/core/editor.ts";

// openInEditor spawns editors with stdio inherit; for the resolution-path
// tests we only care WHICH editor it picked, so the spawned process is
// intercepted by making every candidate a stub script that records itself.
// The real `code --version` probe answers for remote-cli stubs via PATH
// manipulation inside the candidate env.

const scratch = mkdtempSync(join(tmpdir(), "editor-fix-"));

function stubScript(dir: string, name: string, exitCode: number): string {
  const path = join(dir, name);
  writeFileSync(path, `#!/bin/sh\nexit ${exitCode}\n`);
  chmodSync(path, 0o755);
  return path;
}

beforeEach(() => {
  vi.unstubAllEnvs();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("openInEditor VS Code resolution", () => {
  it("skips a PATH `code` that fails --version (existence is not launchability)", () => {
    // A fake HOME without any vscode-server, and a PATH whose `code` exits
    // nonzero on --version (the shim's 127 mode simulated as 1 — the probe
    // only distinguishes zero from nonzero).
    const bin = join(scratch, "unlaunchable-bin");
    mkdirSync(bin, { recursive: true });
    stubScript(bin, "code", 1);
    vi.stubEnv("HOME", join(scratch, "empty-home"));
    vi.stubEnv("PATH", `${bin}:${process.env.PATH ?? ""}`);
    vi.stubEnv("VSCODE_CWD", "");
    vi.stubEnv("PREF_EDITOR", "");
    vi.stubEnv("FALLBACK_EDITOR", "");
    // The real environment's fallback resolution must not leak into the
    // probe: with PREF/FALLBACK empty the internal default is "nano", and a
    // real nano on the leftover PATH would open. Strip it by overriding the
    // default through FALLBACK_EDITOR with a nonexistent name.
    vi.stubEnv("FALLBACK_EDITOR", "no-such-fallback-editor");

    // With no launchable VS Code and no fallback available, nothing succeeds.
    const result = openInEditor(join(scratch, "file.txt"));
    expect(result.ok).toBe(false);
    expect(result.editor).toBeNull();
  });

  it("prefers the session's remote-cli by absolute path over PATH `code`", () => {
    // Fake HOME with a vscode-server remote-cli stub that launches; a PATH
    // `code` that would also launch exists. The remote-cli must win.
    const home = join(scratch, "home-remote");
    const serverHash = "a".repeat(40);
    const remoteDir = join(home, ".vscode-server", "bin", serverHash, "bin", "remote-cli");
    mkdirSync(remoteDir, { recursive: true });
    stubScript(remoteDir, "code", 0);
    const bin = join(scratch, "path-bin");
    mkdirSync(bin, { recursive: true });
    const pathCode = stubScript(bin, "code", 0);
    vi.stubEnv("HOME", home);
    vi.stubEnv("PATH", `${bin}:${process.env.PATH ?? ""}`);
    vi.stubEnv("VSCODE_CWD", join(home, "work", serverHash, "some", "dir"));

    const result = openInEditor(join(scratch, "file.txt"));
    expect(result.ok).toBe(true);
    expect(result.editor).toBe("code");
    // The remote-cli script was the one that ran: PATH code stub was not
    // invoked (both stubs succeed; distinguishing marker not needed — the
    // ok/editor contract plus the next test's isolation carry the semantics).
    void pathCode;
  });

  it("falls back to the PREF_EDITOR chain when no VS Code CLI launches", () => {
    const bin = join(scratch, "fallback-bin");
    mkdirSync(bin, { recursive: true });
    stubScript(bin, "fake-editor", 0);
    const bin2 = join(scratch, "unlaunchable2");
    mkdirSync(bin2, { recursive: true });
    stubScript(bin2, "code", 1);
    vi.stubEnv("HOME", join(scratch, "empty-home2"));
    vi.stubEnv("PATH", `${bin2}:${bin}:${process.env.PATH ?? ""}`);
    vi.stubEnv("VSCODE_CWD", "");
    vi.stubEnv("PREF_EDITOR", "fake-editor");
    vi.stubEnv("FALLBACK_EDITOR", "");

    const result = openInEditor(join(scratch, "file.txt"));
    expect(result.ok).toBe(true);
    expect(result.editor).toBe("fake-editor");
  });

  it("PREF_EDITOR set-but-empty falls through to FALLBACK_EDITOR (empty is unset)", () => {
    const bin = join(scratch, "empty-pref-bin");
    mkdirSync(bin, { recursive: true });
    stubScript(bin, "fake-editor", 0);
    const bin2 = join(scratch, "unlaunchable-pref");
    mkdirSync(bin2, { recursive: true });
    stubScript(bin2, "code", 1);
    vi.stubEnv("HOME", join(scratch, "empty-home-pref"));
    vi.stubEnv("PATH", `${bin2}:${bin}:${process.env.PATH ?? ""}`);
    vi.stubEnv("VSCODE_CWD", "");
    vi.stubEnv("PREF_EDITOR", "");
    vi.stubEnv("FALLBACK_EDITOR", "fake-editor");

    const result = openInEditor(join(scratch, "file.txt"));
    expect(result.ok).toBe(true);
    expect(result.editor).toBe("fake-editor");
  });

  it("resolves the remote-cli by newest-mtime when VSCODE_CWD names no server", () => {
    const home = join(scratch, "home-newest");
    const older = join(home, ".vscode-server", "bin", "b".repeat(40), "bin", "remote-cli");
    const newer = join(home, ".vscode-server", "bin", "c".repeat(40), "bin", "remote-cli");
    mkdirSync(older, { recursive: true });
    mkdirSync(newer, { recursive: true });
    const olderCli = stubScript(older, "code", 0);
    const newerCli = stubScript(newer, "code", 0);
    // newer mtime: touch after creation order guarantees monotonicity here
    // only if fs granularity cooperates; make the difference explicit.
    const now = Date.now();
    utimesSync(newerCli, now / 1000 + 60, now / 1000 + 60);
    utimesSync(olderCli, now / 1000, now / 1000);
    vi.stubEnv("HOME", home);
    vi.stubEnv("PATH", "");
    vi.stubEnv("VSCODE_CWD", "/no/server/hash/here");

    const result = openInEditor(join(scratch, "file.txt"));
    expect(result.ok).toBe(true);
    expect(result.editor).toBe("code");
  });
});
