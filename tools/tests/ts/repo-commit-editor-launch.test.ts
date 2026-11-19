// An editor candidate that is on PATH but cannot launch (the devcontainer `code`
// shim exits 127 when no VS Code remote-cli follows it on PATH) must not end the
// commit: the next candidate is tried, and a launch failure is reported as an
// editor failure, never as a pre-commit hook rejection. Real git in throwaway
// fixture repos; the pty comes from util-linux `script` via the shared harness.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  createRepoCommitHarness,
  harnessGit,
  harnessHeadCount,
  harnessHeadSubject,
  harnessRunTool,
  harnessSetEditorMode,
  harnessStageFile,
  type Harness,
} from "./harness/repo-commit.ts";

let h: Harness;

beforeEach(() => {
  h = createRepoCommitHarness({ seed: { subject: "chore: base", file: "base.txt" } });
});
afterEach(() => h.dispose());

function stubBin(name: string, body: string): string {
  const dir = join(h.root, "stubs");
  mkdirSync(dir, { recursive: true });
  const p = join(dir, name);
  writeFileSync(p, body);
  chmodSync(p, 0o755);
  return dir;
}

describe("editor candidate that exists but cannot launch", () => {
  it("falls through to the next candidate instead of failing the commit", () => {
    // `code` on PATH behaves like the devcontainer shim without a remote-cli
    stubBin("code", "#!/bin/sh\necho 'code or code-insiders is not installed' >&2\nexit 127\n");
    // nano stands in for a working terminal editor: leaves the preloaded message as saved
    const dir = stubBin("nano", "#!/bin/sh\nexit 0\n");
    harnessGit(h, "config", "core.editor", "code --wait");
    harnessStageFile(h, "a.txt", "a\n");
    const before = harnessHeadCount(h);

    const r = harnessRunTool(h, ["feat: add a"], {
      envEditor: "",
      env: { PATH: `${dir}:${process.env.PATH ?? ""}` },
    });

    expect(r.out).toContain("opening editor: nano");
    expect(r.status).toBe(0);
    expect(harnessHeadCount(h)).toBe(before + 1);
    expect(harnessHeadSubject(h)).toBe("feat: add a");
  });
});

describe("VS Code launcher recognised by command basename", () => {
  const BROKEN = "#!/bin/sh\necho 'code or code-insiders is not installed' >&2\nexit 127\n";

  it.each([
    ["a full path", (dir: string) => `${dir}/code --wait`],
    ["an env prefix", () => "env code --wait"],
    ["env with an assignment", () => "env FOO=1 code --wait"],
    ["a leading assignment and full path", (dir: string) => `FOO=1 ${dir}/code --wait`],
  ])("probes %s and falls through when it cannot launch", (_label, make) => {
    const dir = stubBin("code", BROKEN);
    stubBin("nano", "#!/bin/sh\nexit 0\n");
    harnessGit(h, "config", "core.editor", make(dir));
    harnessStageFile(h, "a.txt", "a\n");
    const before = harnessHeadCount(h);

    const r = harnessRunTool(h, ["feat: add a"], {
      envEditor: "",
      env: { PATH: `${dir}:${process.env.PATH ?? ""}` },
    });

    expect(r.out).toContain("opening editor: nano");
    expect(r.status).toBe(0);
    expect(harnessHeadCount(h)).toBe(before + 1);
  });

  it.each([
    ["bare", () => "code --wait"],
    ["a full path", (dir: string) => `${dir}/code --wait`],
    ["env-prefixed", () => "env code --wait"],
  ])("still chooses a %s candidate whose --version succeeds", (_label, make) => {
    // the stub answers --version and, as the editor, leaves the message as saved
    const dir = stubBin("code", "#!/bin/sh\nexit 0\n");
    harnessGit(h, "config", "core.editor", make(dir));
    harnessStageFile(h, "a.txt", "a\n");
    const before = harnessHeadCount(h);

    const r = harnessRunTool(h, ["feat: add a"], {
      envEditor: "",
      env: { PATH: `${dir}:${process.env.PATH ?? ""}` },
    });

    expect(r.out).toContain("opening editor: ");
    expect(r.out).toContain("code --wait");
    expect(r.status).toBe(0);
    expect(harnessHeadCount(h)).toBe(before + 1);
  });

  it("refuses with the precise message and creates no commit when every candidate is unusable", () => {
    const h2 = createRepoCommitHarness({ barePathBin: true, seed: { subject: "chore: base", file: "base.txt" } });
    try {
      const dir = join(h2.root, "stubs");
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, "code"), BROKEN);
      chmodSync(join(dir, "code"), 0o755);
      harnessGit(h2, "config", "core.editor", `${dir}/code --wait`);
      harnessStageFile(h2, "a.txt", "a\n");
      const before = harnessHeadCount(h2);

      const r = harnessRunTool(h2, ["feat: add a"], {
        envEditor: "code --wait",
        env: { PATH: `${dir}:${h2.binDir}`, VISUAL: "", EDITOR: "" },
      });

      expect(r.status).toBe(1);
      expect(r.out).toContain("refusing non-interactive editor — the editor save is the permission gate");
      expect(harnessHeadCount(h2)).toBe(before);
    } finally {
      h2.dispose();
    }
  });
});

describe("failure classification after a passing hook", () => {
  it("reports a failed editor as an editor failure, not a hook rejection", () => {
    // a passing hook that talks on stderr, as real hook suites do
    const hook = join(h.repo, ".git", "hooks", "pre-commit");
    writeFileSync(hook, "#!/bin/sh\necho 'pre-commit hook: all checks passed' >&2\nexit 0\n");
    chmodSync(hook, 0o755);
    harnessSetEditorMode(h, "abort"); // exits 1: git reports a problem with the editor
    harnessStageFile(h, "a.txt", "a\n");
    const before = harnessHeadCount(h);

    const r = harnessRunTool(h, ["feat: add a"]);

    expect(r.status).not.toBe(0);
    expect(r.out).not.toContain("rejected by a pre-commit hook");
    expect(r.out).toContain("editor");
    expect(harnessHeadCount(h)).toBe(before);
  });

  it("reports a commit-msg hook rejection after a saved message as a post-editor failure, not a pre-commit rejection", () => {
    const hook = join(h.repo, ".git", "hooks", "commit-msg");
    writeFileSync(hook, "#!/bin/sh\necho 'commit-msg: subject rejected' >&2\nexit 1\n");
    chmodSync(hook, 0o755);
    harnessSetEditorMode(h, "save");
    harnessStageFile(h, "a.txt", "a\n");
    const before = harnessHeadCount(h);

    const r = harnessRunTool(h, ["feat: add a"]);

    expect(r.status).not.toBe(0);
    expect(r.out).toContain("commit-msg: subject rejected"); // the hook's own output reached the terminal
    expect(r.out).toContain("failed after the editor closed");
    expect(r.out).not.toContain("rejected by a pre-commit hook");
    expect(harnessHeadCount(h)).toBe(before);
  });

  it("does not depend on git's message language: a translated editor failure is still an editor failure", () => {
    // stub git: runs the real commit machinery up to the editor, then fails
    // with a non-English message that also contains the word "hook"
    const real = spawnSync("sh", ["-c", "command -v git"], { encoding: "utf8" }).stdout.trim();
    const dir = stubBin(
      "git",
      `#!/bin/sh
case "$*" in
  *" commit "*)
    for last; do :; done
    sh -c "$GIT_EDITOR \\"\\$@\\"" editor "$last"
    echo "hook pre-commit : tout est passe" >&2
    echo "erreur : un probleme est survenu avec l'editeur" >&2
    exit 1 ;;
esac
exec ${real} "$@"
`,
    );
    harnessSetEditorMode(h, "abort");
    harnessStageFile(h, "a.txt", "a\n");
    const before = harnessHeadCount(h);

    const r = harnessRunTool(h, ["feat: add a"], {
      env: { PATH: `${dir}:${process.env.PATH ?? ""}`, LC_ALL: "fr_FR.UTF-8", LANG: "fr_FR.UTF-8" },
    });

    expect(r.status).not.toBe(0);
    expect(r.out).toContain("the editor failed to launch or exited non-zero");
    expect(r.out).not.toContain("rejected by a pre-commit hook");
    expect(harnessHeadCount(h)).toBe(before);
  });
});
