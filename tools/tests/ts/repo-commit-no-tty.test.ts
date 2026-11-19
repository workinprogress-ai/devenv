// Without a terminal, repo-commit accepts exactly one human gate: a VS Code
// tab opened by the user's own git-config editor (`core.editor = code --wait`)
// through the real remote-cli found by absolute path under ~/.vscode-server.
// Env-supplied editors, any other core.editor, a missing VS Code session, a
// missing remote-cli, and a `code` planted on PATH all keep today's refusal.
// Real git in throwaway fixture repos; the remote-cli is a stub under a fake
// HOME, so no real VS Code window is ever opened.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { chmodSync, existsSync, mkdirSync, readFileSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  createRepoCommitHarness,
  harnessGit,
  harnessHeadCount,
  harnessRunTool,
  harnessStageFile,
  type Harness,
} from "./harness/repo-commit.ts";

let h: Harness;
let home: string;

const HASH_A = "a".repeat(40);
const HASH_B = "b".repeat(40);

beforeEach(() => {
  h = createRepoCommitHarness({ seed: { subject: "chore: base", file: "base.txt" } });
  home = join(h.root, "home");
  harnessGit(h, "config", "core.editor", "code --wait");
  harnessStageFile(h, "a.txt", "a\n");
});

afterEach(() => h.dispose());

/** A stub remote-cli under the fake HOME: records its argv and the server
 * hash it belongs to, answers --version, and saves or empties the message. */
function stubRemoteCli(hash: string, log = join(h.root, "remote-cli.log")): string {
  const dir = join(home, ".vscode-server", "bin", hash, "bin", "remote-cli");
  mkdirSync(dir, { recursive: true });
  const bin = join(dir, "code");
  writeFileSync(
    bin,
    `#!/bin/sh
if [ "$1" = "--version" ]; then echo 1.0.0; exit 0; fi
echo "${hash} $*" >> '${log}'
for last; do :; done
if [ "$STUB_MODE" = "empty" ]; then : > "$last"; fi
exit 0
`,
  );
  chmodSync(bin, 0o755);
  return log;
}

function stubLog(log = join(h.root, "remote-cli.log")): string {
  return existsSync(log) ? readFileSync(log, "utf8") : "";
}

function run(env: Record<string, string> = {}, extra: Record<string, string> = {}): { status: number; out: string } {
  return harnessRunTool(h, ["feat: add a"], {
    noTty: true,
    envEditor: "",
    env: { HOME: home, VSCODE_IPC_HOOK_CLI: join(h.root, "vscode.sock"), ...env, ...extra },
  });
}

describe("no-TTY lane: accepted", () => {
  it("opens the VS Code remote-cli by absolute path and commits when the message is saved", () => {
    stubRemoteCli(HASH_A);
    const before = harnessHeadCount(h);

    const r = run();

    expect(r.status).toBe(0);
    expect(r.out).toContain("commit created");
    expect(harnessHeadCount(h)).toBe(before + 1);
    expect(stubLog()).toMatch(new RegExp(`^${HASH_A} --wait .+`));
  });

  it("an emptied message cancels the commit", () => {
    stubRemoteCli(HASH_A);
    const before = harnessHeadCount(h);

    const r = run({ STUB_MODE: "empty" });

    expect(r.status).not.toBe(0);
    expect(r.out).toContain("commit did not complete");
    expect(harnessHeadCount(h)).toBe(before);
  });

  it("uses the server hash VSCODE_CWD names when several servers exist", () => {
    const log = stubRemoteCli(HASH_A);
    stubRemoteCli(HASH_B, log);
    // make A the newer one, so a pick-newest rule would choose it
    const later = new Date(Date.now() + 60_000);
    utimesSync(join(home, ".vscode-server", "bin", HASH_A, "bin", "remote-cli", "code"), later, later);

    const r = run({ VSCODE_CWD: `/vscode/vscode-server/bin/linux-x64/${HASH_B}` });

    expect(r.status).toBe(0);
    expect(stubLog(log)).toMatch(new RegExp(`^${HASH_B} `));
  });

  it("falls back to the newest server that has a remote-cli when VSCODE_CWD names none", () => {
    const log = stubRemoteCli(HASH_A);
    stubRemoteCli(HASH_B, log);
    const later = new Date(Date.now() + 60_000);
    utimesSync(join(home, ".vscode-server", "bin", HASH_B, "bin", "remote-cli", "code"), later, later);

    const r = run({ VSCODE_CWD: "/somewhere/else" });

    expect(r.status).toBe(0);
    expect(stubLog(log)).toMatch(new RegExp(`^${HASH_B} `));
  });
});

describe("no-TTY lane: refused, nothing opened, nothing committed", () => {
  function expectRefused(r: { status: number; out: string }, before: number): void {
    expect(r.status).not.toBe(0);
    expect(r.out).toContain("without a terminal");
    expect(stubLog()).toBe("");
    expect(harnessHeadCount(h)).toBe(before);
  }

  it("ignores env-supplied editors: only git config counts", () => {
    harnessGit(h, "config", "--unset", "core.editor");
    stubRemoteCli(HASH_A);
    const before = harnessHeadCount(h);

    const r = harnessRunTool(h, ["feat: add a"], {
      noTty: true,
      envEditor: "code --wait",
      env: { HOME: home, VSCODE_IPC_HOOK_CLI: "/tmp/x.sock", VISUAL: "code --wait", EDITOR: "code --wait" },
    });

    expectRefused(r, before);
  });

  it.each(["true", "nano", "code", "code --wait --new-window", "code-insiders --wait", "env code --wait", "/usr/bin/code --wait"])(
    "refuses core.editor = %s",
    (value) => {
      harnessGit(h, "config", "core.editor", value);
      stubRemoteCli(HASH_A);
      const before = harnessHeadCount(h);

      expectRefused(run(), before);
    },
  );

  it("refuses when no VS Code session is attached (VSCODE_IPC_HOOK_CLI unset)", () => {
    stubRemoteCli(HASH_A);
    const before = harnessHeadCount(h);

    const r = harnessRunTool(h, ["feat: add a"], { noTty: true, envEditor: "", env: { HOME: home, VSCODE_IPC_HOOK_CLI: "" } });

    expectRefused(r, before);
  });

  it("refuses when no remote-cli exists under ~/.vscode-server", () => {
    mkdirSync(join(home, ".vscode-server", "bin", HASH_A), { recursive: true });
    const before = harnessHeadCount(h);

    expectRefused(run(), before);
  });

  it("never resolves code through PATH: a planted `code` is not run", () => {
    const planted = join(h.root, "planted");
    mkdirSync(planted, { recursive: true });
    const marker = join(h.root, "planted-ran");
    writeFileSync(join(planted, "code"), `#!/bin/sh\necho ran >> '${marker}'\nexit 0\n`);
    chmodSync(join(planted, "code"), 0o755);
    const before = harnessHeadCount(h);

    const r = run({ PATH: `${planted}:${process.env.PATH ?? ""}` });

    expectRefused(r, before);
    expect(existsSync(marker)).toBe(false);
  });
});
