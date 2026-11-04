// harness/repo-commit.ts — shared fixture harness for the repo-commit suites
// (extracted from the six suites' duplicated boilerplate: temp git repo
// factory, private tool copy with a fake git-wip sibling, scripted
// GIT_EDITOR, optional bare remote and stubbed-PATH binDir, and a runTool
// that spawns the copied tool). New repo-commit suites consume this instead
// of re-implementing it.

import { spawnSync } from "node:child_process";
import { chmodSync, cpSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const TOOLS_DIR = join(dirname(fileURLToPath(import.meta.url)), "../../..");

export interface Harness {
  /** Sandbox root (whole fixture tree; rmSync'd by dispose). */
  root: string;
  /** The real temp git repo the tests drive. */
  repo: string;
  /** Absolute path of the copied repo-commit.ts tool. */
  tool: string;
  /** The scripted GIT_EDITOR target (a shell script whose behavior `setEditorMode` controls). */
  editorScript: string;
  /** Bare-PATH bin (node/git/sh only) for command-absence tests; present when `barePathBin` was set. */
  binDir: string | null;
  /** Local bare remote, present when `bareRemote` was set. */
  remote: string | null;
  /** Fake commitlint bin, present when `commitlint` was set. */
  commitlintBin: string | null;
  /** Remove the whole fixture tree. Register in afterAll. */
  dispose: () => void;
}

export interface HarnessOptions {
  /** Create the bare-PATH binDir (command-absence tests). */
  barePathBin?: boolean;
  /** Create a local bare remote, wire it as `origin`, and clone the work repo from it. */
  bareRemote?: boolean;
  /** Wire a commitlint gate: commitlint.config.js in the repo + a scriptable node_modules/.bin/commitlint. */
  commitlint?: boolean;
  /** Seed commit subject + file (default: "initial: seed" / "seed.txt"). */
  seed?: { subject: string; file: string };
  /** Initial branch (default master). */
  branch?: string;
  /** Extra tools to copy next to repo-commit.ts (names relative to tools/, e.g. "git-unwip"). */
  extraToolStubs?: Array<{ name: string; body: string }>;
}

export function createRepoCommitHarness(options: HarnessOptions = {}): Harness {
  const root = mkdtempSync(join(tmpdir(), "repo-commit-harness-"));

  // Tool fixture: a private copy of tools/ (ts/repo-commit.ts + lib/) so the
  // delegation tests can provide fake sibling stubs instead of the real ones.
  cpSync(join(TOOLS_DIR, "lib"), join(root, "tools", "lib"), { recursive: true });
  cpSync(join(TOOLS_DIR, "ts", "repo-commit.ts"), join(root, "tools", "ts", "repo-commit.ts"));
  const tool = join(root, "tools", "ts", "repo-commit.ts");
  for (const stub of options.extraToolStubs ?? []) {
    const p = join(root, "tools", stub.name);
    writeFileSync(p, stub.body);
    chmodSync(p, 0o755);
  }
  if (!options.extraToolStubs?.some((s) => s.name === "git-wip")) {
    // Default fake git-wip sibling: delegation tests must never touch the
    // real staging/pushing git-wip.
    const p = join(root, "tools", "git-wip");
    writeFileSync(p, "#!/bin/sh\necho git-wip: fake delegate ran\nexit 42\n");
    chmodSync(p, 0o755);
  }

  let binDir: string | null = null;
  if (options.barePathBin) {
    binDir = join(root, "bin");
    mkdirSync(binDir, { recursive: true });
    for (const c of ["node", "git", "sh"]) {
      const abs = spawnSync("sh", ["-c", `command -v ${c}`], { encoding: "utf8" }).stdout.trim();
      if (abs !== "") symlinkSync(abs, join(binDir, c));
    }
  }

  let remote: string | null = null;
  if (options.bareRemote) {
    remote = join(root, "remote.git");
    spawnSync("git", ["init", "-q", "--bare", "-b", options.branch ?? "master", remote], { encoding: "utf8" });
  }

  let commitlintBin: string | null = null;

  const gitr = (target: string, args: string[]): string => {
    const r = spawnSync("git", ["-C", target, ...args], { encoding: "utf8" });
    if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
    return r.stdout;
  };

  let repo: string;
  if (options.bareRemote) {
    // Clone from the bare remote: origin is wired by clone itself and
    // pushed/unpushed HEAD are both constructible.
    repo = join(root, "work");
    spawnSync("git", ["clone", "-q", remote!, repo], { encoding: "utf8" });
    gitr(repo, ["config", "user.email", "t@example.com"]);
    gitr(repo, ["config", "user.name", "T"]);
  } else {
    repo = join(root, "repo");
    mkdirSync(repo, { recursive: true });
    spawnSync("git", ["-C", repo, "init", "-q", "-b", options.branch ?? "master"], { encoding: "utf8" });
    gitr(repo, ["config", "user.email", "t@example.com"]);
    gitr(repo, ["config", "user.name", "T"]);
  }

  if (options.commitlint) {
    // The commitlint setup lives in the repo being committed to (the gate
    // asks the repo's toplevel): commitlint.config.js + a scriptable fake
    // node_modules/.bin/commitlint whose mode each test sets.
    writeFileSync(join(repo, "commitlint.config.js"), "export default { rules: {} };\n");
    const bin = join(repo, "node_modules", ".bin");
    mkdirSync(bin, { recursive: true });
    commitlintBin = join(bin, "commitlint");
    writeFileSync(commitlintBin, "#!/bin/sh\nexit 0\n");
    chmodSync(commitlintBin, 0o755);
  }

  const seed = options.seed ?? { subject: "initial: seed", file: "seed.txt" };
  writeFileSync(join(repo, seed.file), `${seed.subject}\n`);
  gitr(repo, ["add", "--", seed.file]);
  gitr(repo, ["commit", "-q", "--no-verify", "-m", seed.subject]);

  const editorScript = join(root, "editor.sh");
  writeFileSync(editorScript, "#!/bin/sh\nexit 0\n");
  chmodSync(editorScript, 0o755);

  return {
    root,
    repo,
    tool,
    editorScript,
    binDir,
    remote,
    commitlintBin,
    dispose: () => rmSync(root, { recursive: true, force: true }),
  };
}

/** Git helper bound to the harness repo: throws on non-zero exit, returns stdout. */
export function harnessGit(h: Harness, ...args: string[]): string {
  const r = spawnSync("git", ["-C", h.repo, ...args], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
  return r.stdout;
}

export function harnessStageFile(h: Harness, name: string, content: string): void {
  writeFileSync(join(h.repo, name), content);
  harnessGit(h, "add", "--", name);
}

export function harnessHeadSubject(h: Harness): string {
  return harnessGit(h, "log", "-1", "--format=%s").trim();
}

export function harnessHeadCount(h: Harness): number {
  return Number.parseInt(harnessGit(h, "rev-list", "--count", "HEAD").trim(), 10);
}

export type EditorMode = "save" | "empty" | "abort";

/** Rewire the scripted editor's outcome: save verbatim, empty (cancel path), or exit non-zero (abort path). */
export function harnessSetEditorMode(h: Harness, mode: EditorMode): void {
  writeFileSync(
    h.editorScript,
    `#!/bin/sh\ncase "${mode}" in\n  save) exit 0 ;;\n  empty) : > "$1" ; exit 0 ;;\n  abort) exit 1 ;;\nesac\n`,
  );
  chmodSync(h.editorScript, 0o755);
}

export interface RunToolOptions {
  /** Override GIT_EDITOR (default: the scripted editor). `undefined` removes it. */
  envEditor?: string;
  /** Restrict PATH to the bare bin (command-absence tests). */
  barePath?: boolean;
  /** Extra env overrides. */
  env?: Record<string, string>;
  /** Stdin for the invocation (default empty; TTY is never attached under vitest). */
  input?: string;
  /** Run from a different cwd (default: the harness repo). */
  cwd?: string;
}

/** Spawn the copied repo-commit tool against the harness repo. */
export function harnessRunTool(
  h: Harness,
  args: string[],
  opts: RunToolOptions = {},
): { status: number; out: string } {
  const env: Record<string, string | undefined> = { ...process.env, GIT_EDITOR: h.editorScript };
  if (opts.envEditor !== undefined) env.GIT_EDITOR = opts.envEditor;
  if (opts.barePath && h.binDir !== null) env.PATH = h.binDir;
  if (opts.env !== undefined) for (const [k, v] of Object.entries(opts.env)) env[k] = v;
  const r = spawnSync("node", [h.tool, ...args], {
    encoding: "utf8",
    cwd: opts.cwd ?? h.repo,
    env,
    input: opts.input ?? "",
  });
  return { status: r.status ?? 1, out: (r.stdout ?? "") + (r.stderr ?? "") };
}

/** A commit made directly (bypassing the tool — it seeds state). Returns the new HEAD sha. */
export function harnessSeedCommit(h: Harness, msg: string, file: string): string {
  writeFileSync(join(h.repo, file), `${msg}\n`);
  harnessGit(h, "add", "--", file);
  harnessGit(h, "commit", "-q", "--no-verify", "-m", msg);
  return harnessGit(h, "rev-parse", "HEAD").trim();
}
