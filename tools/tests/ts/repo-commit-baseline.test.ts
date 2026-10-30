// Characterization tests for repo-commit's current contract (the regression
// net for later extensions): the editor always opens on the normal lane and
// its save is the permission gate; the commit comes from the existing index
// only; empty index refuses; option arguments refuse; an aborted editor
// session leaves no commit and the index untouched. Driven through a copied
// tool fixture in a real temp git repo with a scripted GIT_EDITOR (a shell
// script that saves/empties/aborts on demand) — real git, no PATH stubbing.
// The copy exists so the --wip delegation test can provide a fake sibling
// git-wip stub instead of invoking the real one (which stages and pushes).
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_TOOLS = fileURLToPath(new URL(".", import.meta.url)).replace("tests/ts/", "");

let root: string;
let repo: string;
let tool: string;
let editorScript: string;
let binDir: string;
let cleanup: () => void;

function git(...args: string[]): string {
  const r = spawnSync("git", ["-C", repo, ...args], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
  return r.stdout;
}

function stageFile(name: string, content: string): void {
  writeFileSync(join(repo, name), content);
  git("add", "--", name);
}

function headSubject(): string {
  return git("log", "-1", "--format=%s").trim();
}

function headCount(): number {
  return Number.parseInt(git("rev-list", "--count", "HEAD").trim(), 10);
}

/** The scripted editor: repo-commit hands it the message file ($1); the mode
 * decides the session outcome — save verbatim, empty (the cancel path), or
 * exit non-zero (the abort path). */
function setEditorMode(mode: "save" | "empty" | "abort"): void {
  writeFileSync(editorScript, `#!/bin/sh\ncase "${mode}" in\n  save) exit 0 ;;\n  empty) : > "$1" ; exit 0 ;;\n  abort) exit 1 ;;\nesac\n`);
  chmodSync(editorScript, 0o755);
}

function runTool(
  args: string[],
  opts: { envEditor?: string; barePath?: boolean; env?: Record<string, string> } = {},
): { status: number; out: string } {
  const env: Record<string, string | undefined> = { ...process.env, GIT_EDITOR: editorScript };
  if (opts.envEditor !== undefined) env.GIT_EDITOR = opts.envEditor;
  if (opts.barePath) env.PATH = binDir;
  if (opts.env !== undefined) for (const [k, v] of Object.entries(opts.env)) env[k] = v;
  const r = spawnSync("node", [tool, ...args], { encoding: "utf8", cwd: repo, env });
  return { status: r.status ?? 1, out: (r.stdout ?? "") + (r.stderr ?? "") };
}

/** An initial commit made directly (bypassing the tool — it seeds state). */
function seedCommit(msg: string, file: string): void {
  writeFileSync(join(repo, file), `${msg}\n`);
  git("add", "--", file);
  git("commit", "-q", "--no-verify", "-m", msg);
}

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "repo-commit-baseline-"));

  // Tool fixture: a private copy of tools/ (ts/repo-commit.ts + lib/) with a
  // fake git-wip sibling stub so the delegation test never touches the real
  // staging/pushing git-wip.
  cpSync(join(REPO_TOOLS, "lib"), join(root, "tools", "lib"), { recursive: true });
  cpSync(join(REPO_TOOLS, "ts", "repo-commit.ts"), join(root, "tools", "ts", "repo-commit.ts"));
  tool = join(root, "tools", "ts", "repo-commit.ts");
  writeFileSync(join(root, "tools", "git-wip"), "#!/bin/sh\necho git-wip: fake delegate ran\nexit 42\n");
  chmodSync(join(root, "tools", "git-wip"), 0o755);

  // Bare-PATH bin for the refusal test: the editor chain's commandExists
  // probes must find nothing (no code, no nano) while node/git/sh still run.
  binDir = join(root, "bin");
  mkdirSync(binDir, { recursive: true });
  for (const c of ["node", "git", "sh"]) {
    const abs = spawnSync("sh", ["-c", `command -v ${c}`], { encoding: "utf8" }).stdout.trim();
    if (abs !== "") symlinkSync(abs, join(binDir, c));
  }

  repo = join(root, "repo");
  mkdirSync(repo, { recursive: true });
  spawnSync("git", ["-C", repo, "init", "-q", "-b", "master"], { encoding: "utf8" });
  git("config", "user.email", "t@example.com");
  git("config", "user.name", "T");
  seedCommit("initial: baseline", "seed.txt");
  editorScript = join(root, "editor.sh");
  setEditorMode("save");
  cleanup = () => rmSync(root, { recursive: true, force: true });
});

afterAll(() => cleanup());

describe("repo-commit baseline (real git, scripted editor)", () => {
  it("a saved editor session commits the staged index with the suggested message", () => {
    stageFile("feature.txt", "one\n");
    setEditorMode("save");
    const r = runTool(["feat(test): baseline save path"]);
    expect(r.status).toBe(0);
    expect(r.out).toContain("commit created");
    expect(r.out).toContain("staged: 1 file, +1 −0"); // stat echo before the editor decision
    expect(headSubject()).toBe("feat(test): baseline save path");
    expect(git("status", "--porcelain")).toBe("");
  });

  it("an emptied message aborts: no commit, staged state untouched", () => {
    const before = headCount();
    stageFile("second.txt", "two\n");
    setEditorMode("empty");
    const r = runTool(["feat(test): should not land"]);
    expect(r.status).not.toBe(0);
    expect(r.out).toContain("commit did not complete");
    expect(headCount()).toBe(before);
    expect(git("status", "--porcelain")).toContain("A  second.txt");
  });

  it("an aborted editor session: no commit, staged state untouched", () => {
    seedCommit("seed: third anchor", "third-seed.txt");
    stageFile("third.txt", "three\n"); // staged AFTER seeding: seedCommit's add must not consume it
    const before = headCount();
    setEditorMode("abort");
    const r = runTool(["feat(test): should not land either"]);
    expect(r.status).not.toBe(0);
    expect(headCount()).toBe(before);
    expect(git("status", "--porcelain")).toContain("A  third.txt");
  });

  it("empty index refuses before any editor opens", () => {
    setEditorMode("save");
    runTool(["chore(test): drain index"]);
    const r = runTool(["feat(test): nothing staged"]);
    expect(r.status).not.toBe(0);
    expect(r.out).toContain("nothing is staged");
    expect(r.out).not.toContain("opening editor");
  });

  it("option arguments are refused: -m, --message, --yes", () => {
    stageFile("opt.txt", "x\n");
    for (const bad of ["-m", "--message=x", "--yes"]) {
      const r = runTool([bad, "msg"]);
      expect(r.status).not.toBe(0);
      expect(r.out).toContain("options are refused by design");
    }
  });

  it("--file carries a long message verbatim into the commit", () => {
    stageFile("longmsg.txt", "y\n");
    const msgfile = join(root, "long-message.txt");
    writeFileSync(msgfile, "feat(test): file-carried subject\n\n- body line one\n- body line two\n");
    setEditorMode("save");
    const r = runTool(["--file", msgfile]);
    expect(r.status).toBe(0);
    expect(r.out).toContain("commit created");
    const body = git("log", "-1", "--format=%B");
    expect(body).toContain("- body line one");
    expect(body).toContain("- body line two");
  });

  it("a non-interactive env editor is treated as unset; a usable config editor still works", () => {
    stageFile("cfg.txt", "z\n");
    git("config", "core.editor", editorScript);
    const r = runTool(["feat(test): config editor path"], { envEditor: ":" });
    git("config", "--unset", "core.editor");
    expect(r.status).toBe(0);
    expect(r.out).toContain("commit created");
  });

  it("every non-interactive source refuses: the editor save is the gate", () => {
    stageFile("nope.txt", "n\n");
    // Isolate the full editor-resolution environment: env GIT_EDITOR=":"
    // (non-interactive, treated as unset), global/system git config masked
    // (a devcontainer core.editor=code would otherwise leak in), and a
    // bare PATH carrying node/git/sh but not code/nano — the chain's
    // fallback probes then honestly find nothing usable and the tool
    // must refuse rather than open any editor.
    const r = runTool(["feat(test): refused"], {
      envEditor: ":",
      barePath: true,
      env: {
        GIT_CONFIG_GLOBAL: "/dev/null",
        GIT_CONFIG_SYSTEM: "/dev/null",
        VISUAL: "",
        EDITOR: "",
      },
    });
    expect(r.status).not.toBe(0);
    expect(r.out).toContain("refusing non-interactive editor");
    expect(r.out).not.toContain("opening editor");
  });

  it("--wip delegates to the sibling git-wip stub with exit-code passthrough", () => {
    stageFile("wipfile.txt", "w\n");
    const r = runTool(["--wip"]);
    expect(r.status).toBe(42);
    expect(r.out).toContain("git-wip: fake delegate ran");
    // delegation must not have opened an editor or committed on this lane
    expect(r.out).not.toContain("opening editor");
  });
});
