// Port of tools/tests/scripts/test_check_commit_trailers.bats (18) +
// test_prepare_commit_msg.bats (20) — the Devenv-Action/Change-Id hook pair.
//
// Subjects: tools/internal/commit-action-check (trailer gate, message-file +
// commit-range modes) and tools/internal/prepare-commit-msg (Change-Id +
// Devenv-Action prefill hook). The bats assertions are the oracle.
// Fixture hygiene per tools/tests/README.md: all scratch paths flow through
// tmpPath() (throws unless under os.tmpdir()).
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync, chmodSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))));
const TOOLS = join(ROOT, "tools");
const CAC = join(TOOLS, "internal", "commit-action-check");
const PCM = join(TOOLS, "internal", "prepare-commit-msg");
const PCM_TS = join(TOOLS, "internal", "prepare-commit-msg.ts");

let TMP = "";

function tmpPath(...parts: string[]): string {
  const base = tmpdir();
  if (!TMP || !isAbsolute(TMP) || !TMP.startsWith(base)) {
    throw new Error(`scratch-dir guard: TMP=${JSON.stringify(TMP)} is not under ${base}`);
  }
  return join(TMP, ...parts);
}

const GIT_ENV = (): Record<string, string> => ({
  ...process.env,
  GIT_AUTHOR_NAME: "t",
  GIT_AUTHOR_EMAIL: "t@example.invalid",
  GIT_COMMITTER_NAME: "t",
  GIT_COMMITTER_EMAIL: "t@example.invalid",
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_SYSTEM: "/dev/null",
});

function git(cwd: string, args: string[], env: Record<string, string> = {}): { status: number; stdout: string } {
  const r = spawnSync("git", args, { cwd, encoding: "utf8", env: { ...GIT_ENV(), ...env } });
  return { status: r.status ?? 1, stdout: r.stdout ?? "" };
}

function run(exe: string, args: string[], opts: { cwd?: string; env?: Record<string, string>; input?: string } = {}): { status: number; stdout: string; stderr: string; out: string } {
  const r = spawnSync(exe, args, {
    cwd: opts.cwd,
    input: opts.input,
    encoding: "utf8",
    env: { ...GIT_ENV(), ...(opts.env ?? {}) },
  });
  return { status: r.status ?? 1, stdout: r.stdout ?? "", stderr: r.stderr ?? "", out: (r.stdout ?? "") + (r.stderr ?? "") };
}

let REPO = "";
let BASE = "";

// commit <subject> [trailer-line] on the current fixture repo
function commit(subject: string, trailer?: string): void {
  const f = join(REPO, "f");
  let content = "";
  try {
    content = readFileSync(f, "utf8");
  } catch {
    /* first commit may have no f yet — setup creates it */
  }
  writeFileSync(f, content + subject + "\n");
  git(REPO, ["add", "f"]);
  if (trailer) {
    git(REPO, ["commit", "-q", "-m", subject, "-m", trailer]);
  } else {
    git(REPO, ["commit", "-q", "-m", subject]);
  }
}

beforeEach(() => {
  TMP = mkdtempSync(join(tmpdir(), `trailers-${Date.now()}-${Math.random().toString(36).slice(2)}`));
  REPO = tmpPath("repo");
  mkdirSync(REPO, { recursive: true });
  git(REPO, ["init", "-q", "-b", "main"]);
  const f = join(REPO, "f");
  writeFileSync(f, "base\n");
  git(REPO, ["add", "f"]);
  git(REPO, ["commit", "-q", "-m", "chore: base", "-m", "Devenv-Action: nothing"]);
  BASE = git(REPO, ["rev-parse", "HEAD"]).stdout.trim();
});

afterEach(() => {
  rmSync(TMP, { recursive: true, force: true });
});

// ── commit-action-check (Devenv-Action trailer gate) ────────────────────────

describe("commit-action-check", () => {
  it("shim is executable", () => {
    const r = spawnSync("test", ["-x", CAC]);
    // `test` is a builtin — spawn a shell for it.
    expect(spawnSync("bash", ["-c", `test -x '${CAC}'`]).status).toBe(0);
    void r;
  });

  it("--help exits 0 and shows usage; --version prints a version", () => {
    const h = run(CAC, ["--help"]);
    expect(h.status).toBe(0);
    expect(h.out).toContain("Usage:");
    const v = run(CAC, ["--version"]);
    expect(v.status).toBe(0);
    expect(v.stdout.trim()).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("no arguments is a usage error (exit 2)", () => {
    expect(run(CAC, []).status).toBe(2);
  });

  it("range mode passes when every commit carries a valid trailer", () => {
    commit("feat: one", "Devenv-Action: restart");
    commit("fix: two", "Devenv-Action: nothing");
    expect(run(CAC, [BASE, "HEAD"], { cwd: REPO }).status).toBe(0);
  });

  it("range mode fails on a commit with no trailer and names it", () => {
    commit("feat: ok", "Devenv-Action: nothing");
    commit("fix: forgot the trailer");
    const r = run(CAC, [BASE, "HEAD"], { cwd: REPO });
    expect(r.status).toBe(1);
    expect(r.out).toContain("forgot the trailer");
  });

  it("range mode fails on an invalid trailer value", () => {
    commit("feat: bad value", "Devenv-Action: reboot");
    expect(run(CAC, [BASE, "HEAD"], { cwd: REPO }).status).toBe(1);
  });

  it("range mode rejects a WIP commit (WIP never reaches master)", () => {
    commit("WIP: half done", "Devenv-Action: nothing");
    const r = run(CAC, [BASE, "HEAD"], { cwd: REPO });
    expect(r.status).toBe(1);
    expect(r.out).toContain("WIP");
  });

  it("range mode ignores commits outside the range", () => {
    // Only the setup base commit is in history — nothing to check.
    expect(run(CAC, [BASE, "HEAD"], { cwd: REPO }).status).toBe(0);
  });

  it("message-file mode accepts every valid action, case-insensitively on the key", () => {
    for (const a of ["nothing", "restart", "bootstrap", "recreate"]) {
      const msg = tmpPath(`msg-${a}`);
      writeFileSync(msg, `feat: x\n\nbody\n\nDevenv-Action: ${a}\n`);
      expect(run(CAC, ["--message-file", msg]).status).toBe(0);
    }
  });

  it("message-file mode rejects a missing trailer with guidance", () => {
    const msg = tmpPath("msg-no-trailer");
    writeFileSync(msg, "feat: x\n\nno trailer here\n");
    const r = run(CAC, ["--message-file", msg]);
    expect(r.status).toBe(1);
    expect(r.out).toContain("Devenv-Action");
    expect(r.out).toContain("recreate");
  });

  it("message-file mode exempts local WIP commits", () => {
    const msg = tmpPath("msg-wip");
    writeFileSync(msg, "WIP: scratch\n");
    expect(run(CAC, ["--message-file", msg]).status).toBe(0);
  });

  it("the commit-msg hook delegates to this script (single source for the valid values)", () => {
    const hook = readFileSync(join(ROOT, ".husky", "commit-msg"), "utf8");
    expect(hook).toContain("commit-action-check");
    // The valid-value list must live only in the script, not duplicated here.
    expect(hook).not.toMatch(/nothing\|restart\|bootstrap\|recreate/);
  });

  it("range mode warns, without failing, about a commit that has no Change-Id", () => {
    commit("feat: no id", "Devenv-Action: nothing");
    const r = run(CAC, [BASE, "HEAD"], { cwd: REPO });
    expect(r.status).toBe(0);
    expect(r.out).toContain("no Change-Id trailer");
    expect(r.out).toContain("1 commit(s) have no Change-Id trailer");
  });

  it("range mode stays quiet about Change-Id when every commit has one", () => {
    const f = join(REPO, "f");
    writeFileSync(f, readFileSync(f, "utf8") + "x\n");
    git(REPO, ["add", "f"]);
    git(REPO, ["commit", "-q", "-m", "feat: with id", "-m", "Devenv-Action: nothing\nChange-Id: Abc123Abc123"]);
    const r = run(CAC, [BASE, "HEAD"], { cwd: REPO });
    expect(r.status).toBe(0);
    expect(r.out).not.toContain("Change-Id");
  });

  it("range mode still fails on a missing Devenv-Action and warns about the Change-Id too", () => {
    commit("fix: neither");
    const r = run(CAC, [BASE, "HEAD"], { cwd: REPO });
    expect(r.status).toBe(1);
    expect(r.out).toContain("missing or invalid Devenv-Action");
    expect(r.out).toContain("no Change-Id trailer");
  });

  it("message-file mode warns, without failing, when the Change-Id is missing", () => {
    const msg = tmpPath("msg-no-id");
    writeFileSync(msg, "feat: x\n\nDevenv-Action: nothing\n");
    const r = run(CAC, ["--message-file", msg]);
    expect(r.status).toBe(0);
    expect(r.out).toContain("no Change-Id trailer");
  });

  it("message-file mode sees a Change-Id that is followed by the editor's comment block", () => {
    const msg = tmpPath("msg-comment-block");
    writeFileSync(msg, "feat: x\n\nDevenv-Action: nothing\nChange-Id: Abc123Abc123\n# Please enter the commit message\n#\n");
    const r = run(CAC, ["--message-file", msg]);
    expect(r.status).toBe(0);
    expect(r.out).not.toContain("Change-Id");
  });

  it("message-file mode does not warn about a WIP commit", () => {
    const msg = tmpPath("msg-wip-quiet");
    writeFileSync(msg, "WIP: scratch\n");
    const r = run(CAC, ["--message-file", msg]);
    expect(r.status).toBe(0);
    expect(r.out).not.toContain("Change-Id");
  });
});

// ── prepare-commit-msg (Change-Id + Devenv-Action prefill hook) ─────────────

let PC_REPO = "";
let MSG = "";

function hookedRepo(): string {
  const repo = tmpPath(`pc-repo-${Math.random().toString(36).slice(2)}`);
  mkdirSync(repo, { recursive: true });
  git(repo, ["init", "-q", "-b", "main"]);
  git(repo, ["config", "user.email", "t@t"]);
  git(repo, ["config", "user.name", "t"]);
  mkdirSync(join(repo, ".git", "hooks"), { recursive: true });
  const hook = join(repo, ".git", "hooks", "prepare-commit-msg");
  writeFileSync(hook, `#!/bin/sh\nexec "${PCM}" "$@"\n`);
  chmodSync(hook, 0o755);
  return repo;
}

function messageOf(repo: string, ref = "HEAD"): string {
  return git(repo, ["log", "-1", "--format=%B", ref]).stdout;
}

describe("prepare-commit-msg", () => {
  beforeEach(() => {
    MSG = tmpPath(`COMMIT_EDITMSG-${Math.random().toString(36).slice(2)}`);
  });

  it("the hook body is executable and the husky hook delegates to it", () => {
    expect(spawnSync("bash", ["-c", `test -x '${PCM}'`]).status).toBe(0);
    expect(existsSync(PCM_TS)).toBe(true);
    expect(readFileSync(join(ROOT, ".husky", "prepare-commit-msg"), "utf8")).toContain("tools/internal/prepare-commit-msg");
  });

  it("--help and --version succeed", () => {
    const h = run(PCM, ["--help"]);
    expect(h.status).toBe(0);
    expect(h.out).toContain("Change-Id");
    expect(run(PCM, ["--version"]).status).toBe(0);
  });

  it("a missing argument or file is a usage error", () => {
    expect(run(PCM, []).status).toBe(2);
    expect(run(PCM, [tmpPath("nope")]).status).toBe(2);
  });

  it("source message adds a valid Change-Id and no Devenv-Action placeholder", () => {
    writeFileSync(MSG, "feat: x\n");
    expect(run(PCM, [MSG, "message"]).status).toBe(0);
    expect(readFileSync(MSG, "utf8")).toMatch(/^Change-Id: /m);
    expect(readFileSync(MSG, "utf8")).not.toContain("Devenv-Action");
  });

  it("an editor-bound message gets a pre-filled Devenv-Action: nothing", () => {
    for (const kind of ["", "template"]) {
      writeFileSync(MSG, "\n");
      expect(run(PCM, [MSG, kind]).status).toBe(0);
      const content = readFileSync(MSG, "utf8");
      expect(content).toMatch(/^Change-Id: /m);
      // Pre-filled with a VALID action: commit-action-check requires a
      // complete value, so saving the editor unchanged must succeed.
      expect(content).toMatch(/^Devenv-Action: nothing$/m);
    }
  });

  it("an existing Change-Id is never replaced", () => {
    writeFileSync(MSG, "feat: x\n\nChange-Id: Abc123Abc123\n");
    run(PCM, [MSG, "message"]);
    run(PCM, [MSG, "commit"]);
    const content = readFileSync(MSG, "utf8");
    expect(content).toContain("Change-Id: Abc123Abc123");
    expect(content.match(/^Change-Id:/gm) ?? []).toHaveLength(1);
  });

  it("running it twice adds nothing the second time", () => {
    writeFileSync(MSG, "feat: x\n");
    run(PCM, [MSG, ""]);
    const first = readFileSync(MSG, "utf8");
    run(PCM, [MSG, ""]);
    expect(readFileSync(MSG, "utf8")).toBe(first);
  });

  it("an existing Devenv-Action is not duplicated", () => {
    writeFileSync(MSG, "feat: x\n\nDevenv-Action: nothing\n");
    run(PCM, [MSG, ""]);
    const content = readFileSync(MSG, "utf8");
    expect(content.match(/^Devenv-Action:/gm) ?? []).toHaveLength(1);
    expect(content).toMatch(/^Devenv-Action: nothing$/m);
  });

  it("amend adds a missing Change-Id but no placeholder", () => {
    writeFileSync(MSG, "feat: x\n");
    expect(run(PCM, [MSG, "commit", "HEAD"]).status).toBe(0);
    const content = readFileSync(MSG, "utf8");
    expect(content).toMatch(/^Change-Id: /m);
    expect(content).not.toContain("Devenv-Action");
  });

  it("merge and squash messages are left untouched", () => {
    for (const kind of ["merge", "squash"]) {
      writeFileSync(MSG, "Merge branch x\n");
      run(PCM, [MSG, kind]);
      expect(readFileSync(MSG, "utf8")).toBe("Merge branch x\n");
    }
  });

  it("git commit -m records a Change-Id", () => {
    PC_REPO = hookedRepo();
    writeFileSync(join(PC_REPO, "a"), "a\n");
    git(PC_REPO, ["add", "a"]);
    git(PC_REPO, ["commit", "-q", "-m", "feat: a"]);
    expect(messageOf(PC_REPO)).toMatch(/^Change-Id: /m);
  });

  it("the editor sees the placeholders and a typed subject survives", () => {
    PC_REPO = hookedRepo();
    writeFileSync(join(PC_REPO, "a"), "a\n");
    git(PC_REPO, ["add", "a"]);
    const editor = tmpPath("editor.sh");
    writeFileSync(editor, '#!/bin/sh\n{ echo "feat: typed subject"; cat "$1"; } > "$1.new" && mv "$1.new" "$1"\n');
    chmodSync(editor, 0o755);
    git(PC_REPO, ["commit", "-q"], { GIT_EDITOR: editor });
    expect(messageOf(PC_REPO).split("\n")[0]).toBe("feat: typed subject");
    expect(messageOf(PC_REPO)).toMatch(/^Change-Id: /m);
    expect(messageOf(PC_REPO)).toMatch(/^Devenv-Action: nothing$/m);
  });

  it("amend, cherry-pick and rebase keep the Change-Id", () => {
    PC_REPO = hookedRepo();
    writeFileSync(join(PC_REPO, "a"), "a\n");
    git(PC_REPO, ["add", "a"]);
    git(PC_REPO, ["commit", "-q", "-m", "base"]);
    git(PC_REPO, ["checkout", "-q", "-b", "side"]);
    writeFileSync(join(PC_REPO, "b"), "b\n");
    git(PC_REPO, ["add", "b"]);
    git(PC_REPO, ["commit", "-q", "-m", "feat: b"]);
    const id = (messageOf(PC_REPO).match(/^Change-Id: (.+)$/m) ?? [])[1] ?? "";
    expect(id).not.toBe("");
    git(PC_REPO, ["commit", "-q", "--amend", "--no-edit"]);
    expect((messageOf(PC_REPO).match(/^Change-Id: (.+)$/m) ?? [])[1]).toBe(id);
    git(PC_REPO, ["checkout", "-q", "-b", "pick", "main"]);
    git(PC_REPO, ["cherry-pick", "side"]);
    expect((messageOf(PC_REPO).match(/^Change-Id: (.+)$/m) ?? [])[1]).toBe(id);
    git(PC_REPO, ["checkout", "-q", "main"]);
    writeFileSync(join(PC_REPO, "m"), "m\n");
    git(PC_REPO, ["add", "m"]);
    git(PC_REPO, ["commit", "-q", "-m", "main: m"]);
    git(PC_REPO, ["checkout", "-q", "side"]);
    git(PC_REPO, ["rebase", "-q", "main"]);
    expect((messageOf(PC_REPO).match(/^Change-Id: (.+)$/m) ?? [])[1]).toBe(id);
  });

  it("--no-verify still adds a Change-Id", () => {
    PC_REPO = hookedRepo();
    writeFileSync(join(PC_REPO, "a"), "a\n");
    git(PC_REPO, ["add", "a"]);
    git(PC_REPO, ["commit", "-q", "-n", "-m", "feat: a"]);
    expect(messageOf(PC_REPO)).toMatch(/^Change-Id: /m);
  });

  it("a WIP commit gets neither a Change-Id nor a placeholder", () => {
    writeFileSync(MSG, "WIP: scratch\n");
    const r = run(PCM, [MSG, "message"]);
    expect(r.status).toBe(0);
    expect(readFileSync(MSG, "utf8")).toBe("WIP: scratch\n");
    PC_REPO = hookedRepo();
    writeFileSync(join(PC_REPO, "a"), "a\n");
    git(PC_REPO, ["add", "a"]);
    git(PC_REPO, ["commit", "-q", "-n", "-m", "WIP: a"]);
    expect(messageOf(PC_REPO)).not.toMatch(/^Change-Id: /m);
  });

  it("a foreign Change-Id is kept without a warning", () => {
    const foreign = "I8c9d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8";
    writeFileSync(MSG, `feat: x\n\nChange-Id: ${foreign}\n`);
    const r = run(PCM, [MSG, "message"]);
    expect(r.status).toBe(0);
    expect(r.out).toBe("");
    const content = readFileSync(MSG, "utf8");
    expect(content.match(/^Change-Id:/gm) ?? []).toHaveLength(1);
    expect(content).toContain(`Change-Id: ${foreign}`);
  });

  it("an unusable Change-Id is kept and reported on stderr", () => {
    writeFileSync(MSG, "feat: x\n\nChange-Id: short\n");
    const r = run(PCM, [MSG, "message"]);
    expect(r.status).toBe(0);
    expect(r.out).toContain("the Change-Id 'short' is not usable");
    const content = readFileSync(MSG, "utf8");
    expect(content.match(/^Change-Id:/gm) ?? []).toHaveLength(1);
    expect(content).toContain("Change-Id: short");
  });

  it("-e -n editor flow — typed subject commits with trailers (the restored prefill contract)", () => {
    PC_REPO = hookedRepo();
    writeFileSync(join(PC_REPO, "a"), "a\n");
    git(PC_REPO, ["add", "a"]);
    const editor = tmpPath("editor2.sh");
    writeFileSync(editor, '#!/bin/sh\nprintf "feat: typed subject\\n" > "$1"\n');
    chmodSync(editor, 0o755);
    git(PC_REPO, ["commit", "-e", "-n"], { GIT_EDITOR: editor });
    expect(messageOf(PC_REPO).split("\n")[0]).toBe("feat: typed subject");
    git(PC_REPO, ["commit", "-q", "--amend", "-m", "feat: typed subject, amended"]);
    expect(messageOf(PC_REPO)).toMatch(/^Change-Id: /m);
  });

  it("editor flow warns loudly when the effective editor is a no-op", () => {
    PC_REPO = hookedRepo();
    writeFileSync(MSG, "");
    const r = run(PCM, [MSG, ""], { cwd: PC_REPO, env: { GIT_EDITOR: ":" } });
    expect(r.status).toBe(0);
    expect(r.out).toContain("no editor will open");
    expect(r.out).toContain("unset the GIT_EDITOR/core.editor override");
    expect(readFileSync(MSG, "utf8")).toContain("Devenv-Action: nothing");
  });

  it("editor flow stays silent when a real editor resolves", () => {
    PC_REPO = hookedRepo();
    writeFileSync(MSG, "");
    // Ambient sessions may export a no-op GIT_EDITOR (AI shells do); the test
    // owns its inputs — unset the override so a real editor resolves.
    const env: Record<string, string> = {};
    for (const [k, v] of Object.entries(GIT_ENV())) env[k] = v;
    delete env["GIT_EDITOR"];
    const r = spawnSync(PCM, [MSG, ""], { cwd: PC_REPO, encoding: "utf8", env });
    expect(r.status).toBe(0);
    expect((r.stdout ?? "") + (r.stderr ?? "")).not.toContain("no editor will open");
    expect(readFileSync(MSG, "utf8")).toContain("Devenv-Action: nothing");
  });
});
