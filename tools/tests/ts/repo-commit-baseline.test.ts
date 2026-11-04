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
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  createRepoCommitHarness,
  harnessGit,
  harnessRunTool,
  harnessSeedCommit,
  harnessSetEditorMode,
  harnessStageFile,
  harnessHeadSubject,
  harnessHeadCount,
  type Harness,
} from "./harness/repo-commit.ts";


let h: Harness;


// Local aliases over the shared harness: the test bodies read against the
// historical helper names.
const git = (...args: string[]) => harnessGit(h, ...args);
const stageFile = (name: string, content: string) => harnessStageFile(h, name, content);
const headSubject = () => harnessHeadSubject(h);
const headCount = () => harnessHeadCount(h);
const setEditorMode = (m: "save" | "empty" | "abort") => harnessSetEditorMode(h, m);
const seedCommit = (msg: string, file: string) => harnessSeedCommit(h, msg, file);
const runTool = (
  args: string[],
  opts: { envEditor?: string; barePath?: boolean; env?: Record<string, string> } = {},
) => harnessRunTool(h, args, opts);
beforeAll(() => {
  h = createRepoCommitHarness({ barePathBin: true, seed: { subject: "initial: baseline", file: "seed.txt" } });
  harnessSetEditorMode(h, "save");
});

afterAll(() => h.dispose());

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
    const msgfile = join(h.root, "long-message.txt");
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
    git("config", "core.editor", h.editorScript);
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
