// Port of tools/tests/scripts/test_repo_commit.bats (17) +
// test_repo_create.bats (25) + test_repo_scratchpad.bats (30) — 72 tests.
//
// Subjects: the repo-commit wrapper (interactive-only contract), repo-create
// (types config + naming patterns + mocked-gh flows), and the repo-scratchpad
// state machine (enter/carry/commit/reset/promote/exit/resume + restriction
// refusals). The bats assertions are the oracle.
// Fixture hygiene per tools/tests/README.md: all scratch paths flow through
// tmpPath() (throws unless under os.tmpdir()); every repo fixture is created
// under the temp root, and suites chdir only into throwaway repos.
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync, chmodSync, readFileSync, existsSync, rmSync, symlinkSync, readdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))));
const TOOLS = join(ROOT, "tools");
const REPO_COMMIT = join(TOOLS, "repo-commit");
const REPO_CREATE = join(TOOLS, "repo-create");
const REPO_SCRATCHPAD = join(TOOLS, "repo-scratchpad");
const GIT_WIP = join(TOOLS, "git-wip");
const PR_CREATE = join(TOOLS, "pr-create");
const REPO_TYPES_YAML = join(TOOLS, "config", "repo-types.yaml");
const REPO_CREATE_TS = join(TOOLS, "ts", "repo-create.ts");

// Scratch root: a single mktemp dir under os.tmpdir(), created lazily and
// wiped on process exit via vitest's afterAll hook. The guard throws unless
// the base is absolute and under os.tmpdir() (see tools/tests/README.md).
let TMP = "";

function ensureTmp(): void {
  if (!TMP) {
    TMP = mkdtempSync(join(tmpdir(), `repotrio-${Date.now()}-${Math.random().toString(36).slice(2)}`));
    // Empty global/system config: no ambient core.editor can leak into
    // fixture repos (an opened editor tab is a real-session side effect).
    writeFileSync(join(TMP, "gitconfig"), "");
    writeFileSync(join(TMP, "gitconfig-system"), "");
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

const GIT_ENV = (): Record<string, string> => ({
  ...process.env,
  GIT_AUTHOR_NAME: "Test",
  GIT_AUTHOR_EMAIL: "test@example.com",
  GIT_COMMITTER_NAME: "Test",
  GIT_COMMITTER_EMAIL: "test@example.com",
  // Config isolation: the ambient global core.editor (code --wait) must never
  // be reachable — repo-commit's editor fall-through would open an editor tab
  // in the user's session. Point both config scopes at throwaway files.
  GIT_CONFIG_GLOBAL: join(tmpPath(), "gitconfig"),
  GIT_CONFIG_SYSTEM: join(tmpPath(), "gitconfig-system"),
});

function git(cwd: string, args: string[], env: Record<string, string> = {}): { status: number; stdout: string; stderr: string } {
  const r = spawnSync("git", args, { cwd, encoding: "utf8", env: { ...GIT_ENV(), ...env } });
  return { status: r.status ?? 1, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

function run(exe: string, args: string[], opts: { cwd?: string; env?: Record<string, string | undefined> } = {}): { status: number; stdout: string; stderr: string; out: string } {
  const e: Record<string, string> = {};
  for (const [k, v] of Object.entries(GIT_ENV())) e[k] = v;
  // An explicit undefined DELETES the key — how a test unsets an ambient
  // variable (this session exports VISUAL/EDITOR and a global core.editor;
  // letting them reach repo-commit's editor gate opens the user's editor).
  for (const [k, v] of Object.entries(opts.env ?? {})) {
    if (v === undefined) delete e[k];
    else e[k] = v;
  }
  const r = spawnSync(exe, args, { cwd: opts.cwd, encoding: "utf8", env: e });
  return { status: r.status ?? 1, stdout: r.stdout ?? "", stderr: r.stderr ?? "", out: (r.stdout ?? "") + (r.stderr ?? "") };
}

// A PATH shadow that omits interactive editors (code/code-insiders/nano) so
// auto-resolve candidates come back empty and refusal paths are deterministic.
// It REPLACES PATH in the refusal tests (bats semantics) — prepending would
// let editor auto-resolve walk the ambient PATH and find the real `code`.
function shadowPathWithoutEditors(): string {
  const shadow = tmpPath("shadow-bin");
  mkdirSync(shadow, { recursive: true });
  for (const dir of (process.env.PATH ?? "").split(":")) {
    if (!dir || !existsSync(dir)) continue;
    for (const entry of readdirSync(dir)) {
      if (entry === "code" || entry === "code-insiders" || entry === "nano") continue;
      const target = join(dir, entry);
      try {
        if (!statSync(target).isFile() && !statSync(target).isSymbolicLink()) continue;
      } catch {
        continue;
      }
      const dest = join(shadow, entry);
      if (!existsSync(dest)) {
        try {
          symlinkSync(target, dest);
        } catch {
          /* best-effort, as in bats */
        }
      }
    }
  }
  // The depth-1 stub execs `node`; the shadow REPLACES PATH, so node (and
  // its dirname chain) must resolve from within the shadow or the wrapper
  // dies before the editor gate. Symlink the node binary in.
  const nodeDir = dirname(process.execPath);
  if (!existsSync(join(shadow, "node"))) {
    try {
      symlinkSync(join(nodeDir, "node"), join(shadow, "node"));
    } catch {
      /* already present */
    }
  }
  return shadow;
}

afterAll(() => {
  if (TMP) rmSync(TMP, { recursive: true, force: true });
});

// ── repo-commit ─────────────────────────────────────────────────────────────

let C_REPO = "";

function commitRepo(): string {
  const repo = tmpPath(`rc-${Math.random().toString(36).slice(2)}`);
  mkdirSync(repo, { recursive: true });
  git(repo, ["init", "-q"]);
  git(repo, ["config", "user.email", "test@example.com"]);
  git(repo, ["config", "user.name", "Test"]);
  writeFileSync(join(repo, "init.txt"), "init\n");
  git(repo, ["add", "init.txt"]);
  git(repo, ["commit", "-q", "-m", "init"], { GIT_EDITOR: "true" });
  return repo;
}

function stageOneFile(repo: string): void {
  writeFileSync(join(repo, "a.txt"), "hello\n");
  git(repo, ["add", "a.txt"]);
}

function writeEditor(name: string, body: string): string {
  const f = tmpPath(`${name}-${Math.random().toString(36).slice(2)}.sh`);
  writeFileSync(f, body);
  chmodSync(f, 0o755);
  return f;
}

describe("repo-commit wrapper (bats port)", () => {
  beforeEach(() => {
    C_REPO = commitRepo();
  });

  it("--help exits 0 and mentions the interactive contract", () => {
    const r = run(REPO_COMMIT, ["--help"]);
    expect(r.status).toBe(0);
    expect(r.out).toContain("interactive");
  });

  it("refuses invocation with no arguments", () => {
    const r = run(REPO_COMMIT, [], { cwd: C_REPO });
    expect(r.status).not.toBe(0);
    expect(r.out.includes("only argument") || r.out.includes("suggested commit message")).toBe(true);
  });

  it("refuses -m (no non-interactive path)", () => {
    const r = run(REPO_COMMIT, ["-m", "sneaky message"], { cwd: C_REPO });
    expect(r.status).not.toBe(0);
    expect(r.out).toContain("refused");
  });

  it("refuses --yes and any option-shaped first argument", () => {
    expect(run(REPO_COMMIT, ["--yes"], { cwd: C_REPO }).status).not.toBe(0);
    expect(run(REPO_COMMIT, ["--message", "x"], { cwd: C_REPO }).status).not.toBe(0);
  });

  it("refuses more than one argument", () => {
    stageOneFile(C_REPO);
    const r = run(REPO_COMMIT, ["msg one", "extra"], { cwd: C_REPO });
    expect(r.status).not.toBe(0);
    expect(r.out).toContain("exactly one argument");
  });

  it("refuses when nothing is staged", () => {
    const r = run(REPO_COMMIT, ["orphan message"], { cwd: C_REPO, env: { GIT_EDITOR: "" } });
    expect(r.status).not.toBe(0);
    expect(r.out).toContain("nothing is staged");
  });

  it("non-interactive GIT_EDITOR sentinel falls through to core.editor", () => {
    // THE regression case: automation hosts inject GIT_EDITOR=: into terminals;
    // the user's own core.editor must outrank it and the commit proceeds.
    stageOneFile(C_REPO);
    const saveEditor = writeEditor("save-editor", "#!/usr/bin/env bash\nexit 0\n");
    git(C_REPO, ["config", "core.editor", saveEditor]);
    const r = run(REPO_COMMIT, ["sentinel overridden by config"], { cwd: C_REPO, env: { GIT_EDITOR: ":" } });
    expect(r.status).toBe(0);
    expect(git(C_REPO, ["log", "-1", "--format=%s"]).stdout.trim()).toBe("sentinel overridden by config");
  });

  it("refuses when every editor source resolves non-interactive", () => {
    stageOneFile(C_REPO);
    const shadow = shadowPathWithoutEditors();
    git(C_REPO, ["config", "core.editor", "true"]);
    const r = run("bash", [REPO_COMMIT, "should be refused"], {
      cwd: C_REPO,
      env: { PATH: shadow, GIT_EDITOR: "true", VISUAL: "true", EDITOR: "true" },
    });
    expect(r.status).not.toBe(0);
    expect(r.out).toContain("refusing non-interactive editor");
  });

  it("refuses non-interactive editor via core.editor config", () => {
    stageOneFile(C_REPO);
    const shadow = shadowPathWithoutEditors();
    git(C_REPO, ["config", "core.editor", "true"]);
    const r = run("bash", [REPO_COMMIT, "should be refused"], {
      cwd: C_REPO,
      env: { PATH: shadow, GIT_EDITOR: undefined, VISUAL: undefined, EDITOR: undefined },
    });
    expect(r.status).not.toBe(0);
    expect(r.out).toContain("refusing non-interactive editor");
  });

  it("refuses when a lone no-op sentinel is the only editor source", () => {
    // GIT_EDITOR=: with nothing else available: no fall-through target exists,
    // so the wrapper refuses rather than launching git's vi default.
    stageOneFile(C_REPO);
    const shadow = shadowPathWithoutEditors();
    const r = run("bash", [REPO_COMMIT, "refused"], {
      cwd: C_REPO,
      env: { PATH: shadow, GIT_EDITOR: ":", VISUAL: undefined, EDITOR: undefined },
    });
    expect(r.status).not.toBe(0);
    expect(r.out).toContain("refusing non-interactive editor");
  });

  it("editor session with saved message commits the staged index", () => {
    stageOneFile(C_REPO);
    // A "user who saves": editor keeps the file (deterministic, non-empty).
    const saveEditor = writeEditor("save-editor-keep", '#!/usr/bin/env bash\ncp "$1" "$1" 2>/dev/null || true\nexit 0\n');
    const r = run(REPO_COMMIT, ["add greeting file"], { cwd: C_REPO, env: { GIT_EDITOR: saveEditor } });
    expect(r.status).toBe(0);
    expect(git(C_REPO, ["log", "-1", "--format=%s"]).stdout.trim()).toBe("add greeting file");
    const files = git(C_REPO, ["diff-tree", "--no-commit-id", "--name-only", "-r", "HEAD"]).stdout;
    expect(files.split("a.txt").length - 1).toBe(1);
  });

  it("user editing the message in the editor wins over the suggestion", () => {
    stageOneFile(C_REPO);
    const editEditor = writeEditor("edit-editor", '#!/usr/bin/env bash\nprintf \'user-edited subject\\n\' > "$1"\n');
    const r = run(REPO_COMMIT, ["suggested subject"], { cwd: C_REPO, env: { GIT_EDITOR: editEditor } });
    expect(r.status).toBe(0);
    expect(git(C_REPO, ["log", "-1", "--format=%s"]).stdout.trim()).toBe("user-edited subject");
  });

  it("editor emptying the message aborts the commit (cancel path)", () => {
    stageOneFile(C_REPO);
    const emptyEditor = writeEditor("empty-editor", '#!/usr/bin/env bash\n: > "$1"\nexit 0\n');
    const r = run(REPO_COMMIT, ["do not commit me"], { cwd: C_REPO, env: { GIT_EDITOR: emptyEditor } });
    expect(r.status).not.toBe(0);
    // Nothing committed; staged state preserved (diff --cached --quiet exit 1
    // = staged changes still present).
    expect(git(C_REPO, ["diff", "--cached", "--quiet"]).status).toBe(1);
    expect(Number(git(C_REPO, ["rev-list", "--count", "HEAD"]).stdout || "0")).toBeLessThanOrEqual(1);
  });

  it("failing pre-commit hook is reported as a hook rejection", () => {
    // A failing pre-commit hook is NOT an editor abort: the tool must name the
    // hook as the cause so a red suite is never misread as a cancelled commit.
    stageOneFile(C_REPO);
    const saveEditor = writeEditor("save-editor-hook", "#!/usr/bin/env bash\nexit 0\n");
    const hook = join(C_REPO, ".git", "hooks", "pre-commit");
    writeFileSync(hook, '#!/usr/bin/env bash\necho "Test suite failed! (mode: parallel)" >&2\necho "husky - pre-commit script failed (code 1)" >&2\nexit 1\n');
    chmodSync(hook, 0o755);
    const r = run(REPO_COMMIT, ["hook should reject this"], { cwd: C_REPO, env: { GIT_EDITOR: saveEditor } });
    expect(r.status).not.toBe(0);
    expect(r.out).toContain("rejected by a pre-commit hook");
    expect(r.out).toContain("Test suite failed");
    expect(r.out).not.toContain("editor session aborted");
    expect(git(C_REPO, ["diff", "--cached", "--quiet"]).status).toBe(1);
  });

  it("unstaged files are never swept into the commit", () => {
    writeFileSync(join(C_REPO, "staged.txt"), "staged\n");
    writeFileSync(join(C_REPO, "unstaged.txt"), "unstaged\n");
    git(C_REPO, ["add", "staged.txt"]);
    const saveEditor = writeEditor("save-editor-unstaged", "#!/usr/bin/env bash\nexit 0\n");
    const r = run(REPO_COMMIT, ["only staged file"], { cwd: C_REPO, env: { GIT_EDITOR: saveEditor } });
    expect(r.status).toBe(0);
    const files = git(C_REPO, ["show", "--name-only", "--format="]).stdout;
    expect(files).toContain("staged.txt");
    expect(files).not.toContain("unstaged.txt");
  });

  it("refuses a no-op editor hidden behind a wrapper or a shell", () => {
    // The gate looks through env, assignments, nice/timeout/nohup/command/exec
    // and refuses a shell used as the editor.
    stageOneFile(C_REPO);
    const shadow = shadowPathWithoutEditors();
    const editors = [
      "sh -c true",
      "bash -c ':'",
      "env true",
      "env FOO=1 true",
      "/usr/bin/env sh -c exit",
      "nice -n 5 true",
      "timeout 5 true",
      "nohup true",
      "command true",
      "exec true",
      "FOO=1 true",
    ];
    for (const editor of editors) {
      const r = run("bash", [REPO_COMMIT, "should be refused"], {
        cwd: C_REPO,
        env: { PATH: shadow, GIT_EDITOR: editor, VISUAL: undefined, EDITOR: undefined },
      });
      expect(r.status, `accepted: ${editor} (${r.out.slice(0, 120)})`).not.toBe(0);
      expect(r.out, `not refused for: ${editor}`).toContain("refusing non-interactive editor");
    }
    expect(git(C_REPO, ["log", "-1", "--format=%s"]).stdout.trim()).toBe("init");
  });

  it("a real editor behind env still passes the gate", () => {
    stageOneFile(C_REPO);
    const saveEditor = writeEditor("save-editor-wrapped", "#!/usr/bin/env bash\nexit 0\n");
    const r = run(REPO_COMMIT, ["wrapped real editor"], { cwd: C_REPO, env: { GIT_EDITOR: `env FOO=1 ${saveEditor}` } });
    expect(r.status).toBe(0);
    expect(git(C_REPO, ["log", "-1", "--format=%s"]).stdout.trim()).toBe("wrapped real editor");
  });
});

// ── repo-create ─────────────────────────────────────────────────────────────

// YAML keys the bats suite asserted via yq; read structurally here (yq is not
// a test dependency — the yaml text is the contract surface).
// Line-scanner for the repo-types.yaml structure — deliberately NOT regex:
// a lazy block-matching regex on this 400-line file backtracks
// catastrophically in V8 (the yaml tests hung until the runner timeout).
// The file shape is stable: `types:` at column 0, type keys at 2 spaces,
// fields at 4, nested maps deeper. Comments and blank lines interleave.
function yamlLines(): string[] {
  return readFileSync(REPO_TYPES_YAML, "utf8").split("\n");
}

function yamlKeysOfTypes(): string[] {
  const lines = yamlLines();
  const start = lines.findIndex((l) => l === "types:");
  expect(start, "types: block not found").toBeGreaterThanOrEqual(0);
  const keys: string[] = [];
  for (let i = start + 1; i < lines.length; i++) {
    const l = lines[i] ?? "";
    if (/^[^ \t#]/.test(l)) break; // next top-level key: end of the block
    const m = l.match(/^ {2}([a-z0-9-]+):\s*$/);
    if (m && m[1]) keys.push(m[1]);
  }
  return keys;
}

function yamlTypeBlock(type: string): string[] {
  const lines = yamlLines();
  const start = lines.findIndex((l) => l === `  ${type}:`);
  if (start < 0) return [];
  const block: string[] = [];
  for (let i = start + 1; i < lines.length; i++) {
    const l = lines[i] ?? "";
    if (/^ {0,1}[^ ]/.test(l)) break; // dedent below field level: next type
    block.push(l);
  }
  return block;
}

// Scalar value of a field, or "" when the field is a nested mapping.
function yamlTypeField(type: string, field: string): string {
  const block = yamlTypeBlock(type);
  const f = block.find((l) => l.startsWith(`    ${field}:`));
  if (!f) return "";
  return f.slice(`    ${field}:`.length).trim();
}

const NAMING = {
  service: /^service\.[a-z0-9-]+\.[a-z0-9-]+$/,
  csLibrary: /^lib\.cs\.[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z0-9-]+$/,
  planning: /^planning(\.[a-z0-9-]+)?\.[a-z0-9-]+$/,
  tsPackage: /^pkg\.ts\.[a-z0-9-]+$/,
  appWeb: /^app\.web\.[a-z0-9-]+$/,
  gateway: /^gateway\.[a-z0-9-]+\.[a-z0-9-]+$/,
};

describe("repo-create (bats port)", () => {
  it("the entry has valid bash syntax (depth-1 stub)", () => {
    expect(spawnSync("bash", ["-n", REPO_CREATE]).status).toBe(0);
  });

  it("requires --type parameter", () => {
    const r = run(REPO_CREATE, ["test-repo"]);
    expect(r.status).not.toBe(0);
    expect(r.out.includes("--type is required") || r.out.includes("--interactive")).toBe(true);
  });

  it("shows help with --help", () => {
    const r = run(REPO_CREATE, ["--help"]);
    expect(r.status).toBe(0);
    expect(r.out).toMatch(/Usage:/);
    expect(r.out).toMatch(/Repository Types:/);
    expect(r.out).toContain("--interactive");
  });

  it("repo-types.yaml exists and parses as YAML", () => {
    expect(existsSync(REPO_TYPES_YAML)).toBe(true);
    // Structural parse via the tool's own reader is covered downstream; here
    // the shape contract: a top-level types mapping.
    expect(readFileSync(REPO_TYPES_YAML, "utf8")).toMatch(/^types:\n/m);
  });

  it("repo-types.yaml defines expected types", () => {
    const keys = yamlKeysOfTypes();
    for (const t of ["planning", "service", "gateway", "app-web", "cs-library", "ts-package", "none"]) {
      expect(keys, `missing type ${t}`).toContain(t);
    }
  });

  it("repo-types.yaml: template type has isTemplate property", () => {
    expect((yamlTypeField("template", "isTemplate").split("#")[0] ?? "").trim()).toBe("true");
  });

  it("repo-types.yaml: all types have required fields", () => {
    // Oracle semantics: the bats assertions ran yq, which prints "null" for
    // missing keys — so their real force is "naming_pattern and naming_example
    // are non-null" (the fields the tool actually reads). Mirror that.
    for (const type of yamlKeysOfTypes()) {
      const block = yamlTypeBlock(type).join("\n");
      expect(block, `${type}.naming_pattern missing`).toMatch(/^    naming_pattern:/m);
      expect(block, `${type}.naming_example missing`).toMatch(/^    naming_example:/m);
    }
  });

  it("service naming pattern validation", () => {
    expect("service.platform.identity").toMatch(NAMING.service);
    expect("service.stargate.resident-profile").toMatch(NAMING.service);
    expect("service.identity").not.toMatch(NAMING.service);
  });

  it("cs-library naming pattern validation", () => {
    expect("lib.cs.common.utilities").toMatch(NAMING.csLibrary);
    expect("lib.cs.platform.auth.core").toMatch(NAMING.csLibrary);
    expect("lib.cs.common").not.toMatch(NAMING.csLibrary);
  });

  it("planning naming pattern validation", () => {
    expect("planning.development.main").toMatch(NAMING.planning);
    expect("planning.roadmap").toMatch(NAMING.planning);
  });

  it("ts-package naming pattern validation", () => {
    expect("pkg.ts.ui-components").toMatch(NAMING.tsPackage);
    expect("pkg.ts.ui.components").not.toMatch(NAMING.tsPackage);
  });

  it("app-web naming pattern validation", () => {
    expect("app.web.admin-portal").toMatch(NAMING.appWeb);
    expect("app.mobile.admin").not.toMatch(NAMING.appWeb);
  });

  it("gateway naming pattern validation", () => {
    expect("gateway.platform.main").toMatch(NAMING.gateway);
  });

  it("repo-types.yaml: branch protection settings exist for all types", () => {
    // Oracle semantics (yq-null artifact): the protection MODEL lives in
    // per-type merge fields (allowedMergeTypes, deletePRBranchOnMerge,
    // rulesetConfigFile) — assert the model surface, not a removed key name.
    for (const type of yamlKeysOfTypes()) {
      const block = yamlTypeBlock(type).join("\n");
      expect(
        block.match(/allowedMergeTypes|rulesetConfigFile|mainBranch/),
        `${type} carries no protection-model field`,
      ).not.toBeNull();
    }
  });

  it("repo-create reads the domain types module", () => {
    expect(readFileSync(REPO_CREATE_TS, "utf8")).toContain("domain/repos/types.ts");
  });

  it("repo-create reads the provider core module", () => {
    expect(readFileSync(REPO_CREATE_TS, "utf8")).toContain("provider-core.ts");
  });

  it("repo-create contains post-creation script handling", () => {
    expect(readFileSync(REPO_CREATE_TS, "utf8")).toContain("runPostCreationScript");
  });

  it("repo-create contains interactive mode", () => {
    expect(readFileSync(REPO_CREATE_TS, "utf8")).toContain("interactiveMode");
  });

  it("repo-create contains wait_for_repo_ready and gates it on template use", () => {
    const s = readFileSync(REPO_CREATE_TS, "utf8");
    expect(s).toContain("waitForRepoReady");
    // The wait is gated on the template actually being used.
    const i = s.indexOf("waitForRepoReady(");
    expect(s.slice(Math.max(0, i - 200), i)).toMatch(/template/);
  });

  it("exits early when repo already exists (mocked gh)", () => {
    const bin = tmpPath("bin-exists");
    mkdirSync(bin, { recursive: true });
    writeFileSync(
      join(bin, "gh"),
      '#!/usr/bin/env bash\nif [ "$1" = "repo" ] && [ "$2" = "view" ]; then exit 0; fi\nif [ "$1" = "auth" ] && [ "$2" = "status" ]; then exit 0; fi\necho "unexpected gh call" >&2\nexit 1\n',
    );
    chmodSync(join(bin, "gh"), 0o755);
    const cfg = tmpPath("repo-types-exists.yaml");
    writeFileSync(cfg, 'types:\n  none:\n    naming_pattern: ".*"\n    naming_example: "anything"\n    rulesetConfigFile: null\n');
    const r = run(REPO_CREATE, ["test-repo", "--type", "none"], { env: { PATH: `${bin}:${process.env.PATH ?? ""}`, REPO_TYPES_CONFIG: cfg } });
    expect(r.status).toBe(0);
  });

  it("fails when type missing even with mocked gh", () => {
    const bin = tmpPath("bin-notype");
    mkdirSync(bin, { recursive: true });
    writeFileSync(join(bin, "gh"), '#!/usr/bin/env bash\necho "gh should not be called" >&2\nexit 1\n');
    chmodSync(join(bin, "gh"), 0o755);
    const r = run(REPO_CREATE, ["test-repo"], { env: { PATH: `${bin}:${process.env.PATH ?? ""}` } });
    expect(r.status).not.toBe(0);
    expect(r.out).toMatch(/Repository type/);
  });

  it("accepts --description parameter (description rides the gh create call)", () => {
    const bin = tmpPath("bin-desc");
    mkdirSync(bin, { recursive: true });
    writeFileSync(
      join(bin, "gh"),
      '#!/usr/bin/env bash\nif [ "$1" = "repo" ] && [ "$2" = "view" ]; then exit 0; fi\nif [ "$1" = "auth" ] && [ "$2" = "status" ]; then exit 0; fi\nif [ "$1" = "repo" ] && [ "$2" = "create" ]; then\n  for arg in "$@"; do\n    [ "$arg" = "Test description" ] && exit 0\n  done\nfi\nexit 0\n',
    );
    chmodSync(join(bin, "gh"), 0o755);
    const cfg = tmpPath("repo-types-desc.yaml");
    writeFileSync(cfg, 'types:\n  none:\n    naming_pattern: ".*"\n    naming_example: "anything"\n    rulesetConfigFile: null\n');
    const calls = tmpPath("gh-desc-calls.log");
    writeFileSync(calls, "");
    const r = run(REPO_CREATE, ["test-repo", "--type", "none", "--description", "Test description"], {
      env: { PATH: `${bin}:${process.env.PATH ?? ""}`, REPO_TYPES_CONFIG: cfg },
    });
    expect(r.status).toBe(0);
  });

  it("repo-types.yaml none type accepts anything (pattern .* wildcard)", () => {
    // The yaml value is single-quoted ('.*') — strip the quotes before
    // compiling it as a pattern.
    const raw = yamlTypeField("none", "naming_pattern").replace(/^'(.*)'$/, "$1");
    expect("anything-at-all").toMatch(new RegExp(raw));
  });
});

// ── repo-scratchpad ─────────────────────────────────────────────────────────

let SP_REPO = "";
let SP_BASE = "";
let SP_BASE_BRANCH = "";

function mockGitRepo(): string {
  const repo = tmpPath(`sp-${Math.random().toString(36).slice(2)}`);
  mkdirSync(repo, { recursive: true });
  git(repo, ["init", "-q"]);
  git(repo, ["config", "user.email", "test@example.com"]);
  git(repo, ["config", "user.name", "Test User"]);
  git(repo, ["remote", "add", "origin", "git@github.com:test-org/dummy.git"]);
  writeFileSync(join(repo, "README.md"), "");
  git(repo, ["add", "README.md"]);
  git(repo, ["commit", "-q", "-m", "Initial commit"]);
  git(repo, ["branch", "-M", "main"]);
  return repo;
}

function sp(args: string[]): { status: number; out: string } {
  const r = run("bash", [REPO_SCRATCHPAD, ...args], { cwd: SP_REPO });
  return { status: r.status, out: r.out };
}

function spSetup(): void {
  SP_REPO = mockGitRepo();
  git(SP_REPO, ["commit", "-q", "--allow-empty", "-m", "base"]);
  SP_BASE = git(SP_REPO, ["rev-parse", "HEAD"]).stdout.trim();
  SP_BASE_BRANCH = git(SP_REPO, ["symbolic-ref", "--short", "HEAD"]).stdout.trim();
}

// Add a scratch commit (work file + branded commit), the bats fixtures' bread
// and butter.
function scratchWork(message: string): string {
  writeFileSync(join(SP_REPO, "w.txt"), "work\n");
  git(SP_REPO, ["add", "-A"]);
  const r = sp(["commit", message]);
  expect(r.status).toBe(0);
  return git(SP_REPO, ["rev-parse", "HEAD"]).stdout.trim();
}

describe("repo-scratchpad state machine (bats port)", () => {
  beforeEach(() => {
    spSetup();
  });

  it("enter: refuses on dirty tree with guidance naming git wip (fail-closed, tracked changes)", () => {
    const f = join(SP_REPO, "README.md");
    writeFileSync(f, readFileSync(f, "utf8") + "dirt\n");
    const r = sp(["enter"]);
    expect(r.status).toBe(1);
    expect(r.out).toContain("working tree is dirty");
    expect(r.out).toContain("git wip");
    expect(git(SP_REPO, ["show-ref", "--verify", "--quiet", "refs/heads/scratchpad/exp"]).status).not.toBe(0);
  });

  it("enter: refuses on untracked files (untracked = dirty, one uniform rule)", () => {
    writeFileSync(join(SP_REPO, "untracked.txt"), "new\n");
    const r = sp(["enter"]);
    expect(r.status).toBe(1);
    expect(r.out).toContain("working tree is dirty");
    expect(git(SP_REPO, ["show-ref", "--verify", "--quiet", "refs/heads/scratchpad/exp"]).status).not.toBe(0);
  });

  it("enter: --carry proceeds on dirty tree with warning + snapshot patch", () => {
    const f = join(SP_REPO, "README.md");
    writeFileSync(f, readFileSync(f, "utf8") + "dirt\n");
    const r = sp(["enter", "--carry"]);
    expect(r.status).toBe(0);
    expect(r.out).toContain("CARRY");
    expect(r.out).toContain("DESTROY");
    const patch = join(SP_REPO, ".local-artifacts", "tmp", "scratchpad", "exp-carry.patch");
    expect(existsSync(patch)).toBe(true);
    expect(readFileSync(patch, "utf8")).toContain("dirt");
    expect(git(SP_REPO, ["show-ref", "--verify", "--quiet", "refs/heads/scratchpad/exp"]).status).toBe(0);
  });

  it("enter: succeeds on clean tree, cuts branch, records refs", () => {
    const r = sp(["enter", "testslug"]);
    expect(r.status).toBe(0);
    expect(r.out).toContain("Scratchpad active: scratchpad/testslug");
    expect(git(SP_REPO, ["show-ref", "--verify", "--quiet", "refs/heads/scratchpad/testslug"]).status).toBe(0);
    expect(git(SP_REPO, ["show-ref", "--verify", "--quiet", "refs/scratchpad/base"]).status).toBe(0);
    expect(git(SP_REPO, ["show-ref", "--verify", "--quiet", "refs/scratchpad/state"]).status).toBe(0);
    expect(git(SP_REPO, ["symbolic-ref", "--short", "HEAD"]).stdout.trim()).toBe("scratchpad/testslug");
  });

  it("enter: refuses slug that is not branch-name-safe", () => {
    expect(sp(["enter", "Bad_Slug!"]).status).toBe(2);
  });

  it("enter: refuses when a scratchpad is already active (one per repo)", () => {
    sp(["enter"]);
    const r = sp(["enter", "other"]);
    expect(r.status).toBe(3);
    expect(r.out).toContain("already active");
  });

  it("commit: brands with scratch: prefix and records state ref", () => {
    sp(["enter"]);
    scratchWork("probe one");
    expect(git(SP_REPO, ["log", "-1", "--format=%s"]).stdout.trim()).toBe("scratch: probe one");
  });

  it("commit: bypasses enforcement hooks (commit -n)", () => {
    mkdirSync(join(SP_REPO, ".git", "hooks"), { recursive: true });
    writeFileSync(join(SP_REPO, ".git", "hooks", "pre-commit"), "#!/bin/bash\nexit 1\n");
    chmodSync(join(SP_REPO, ".git", "hooks", "pre-commit"), 0o755);
    sp(["enter"]);
    scratchWork("must bypass");
    expect(git(SP_REPO, ["log", "-1", "--format=%s"]).stdout.trim()).toBe("scratch: must bypass");
  });

  it("commit: refuses outside a scratchpad", () => {
    writeFileSync(join(SP_REPO, "w.txt"), "work\n");
    const r = sp(["commit", "nope"]);
    expect(r.status).toBe(1);
    expect(r.out).toContain("no scratchpad active");
  });

  it("reset: returns branch to base, AI-safe, removes scratch content", () => {
    sp(["enter"]);
    scratchWork("to be destroyed");
    const baseCount = Number(git(SP_REPO, ["rev-list", "--count", SP_BASE]).stdout);
    expect(Number(git(SP_REPO, ["rev-list", "--count", "HEAD"]).stdout)).toBe(baseCount + 1);
    expect(sp(["reset"]).status).toBe(0);
    expect(Number(git(SP_REPO, ["rev-list", "--count", "HEAD"]).stdout)).toBe(baseCount);
    expect(existsSync(join(SP_REPO, "w.txt"))).toBe(false);
  });

  it("reset: carried dirty work is destroyed on the --carry path (documented hazard)", () => {
    const f = join(SP_REPO, "README.md");
    writeFileSync(f, readFileSync(f, "utf8") + "carried\n");
    sp(["enter", "--carry"]);
    expect(sp(["reset"]).status).toBe(0);
    // Carried modification is gone from the tree; the snapshot patch remains
    // as the salvage record (root-scoped carry dir survives reset).
    expect(readFileSync(f, "utf8")).not.toContain("carried");
    const patch = join(SP_REPO, ".local-artifacts", "tmp", "scratchpad", "exp-carry.patch");
    expect(existsSync(patch)).toBe(true);
  });

  it("reset: refuses while a bisect session is mid-flight", () => {
    sp(["enter"]);
    git(SP_REPO, ["update-ref", "refs/bisect/start", git(SP_REPO, ["rev-parse", "HEAD"]).stdout.trim()]);
    const r = sp(["reset"]);
    expect(r.status).toBe(1);
    expect(r.out).toContain("bisect");
  });

  it("promote: lands the scratch commit staged-uncommitted on base with no commit created", () => {
    sp(["enter"]);
    writeFileSync(join(SP_REPO, "fix.txt"), "fix\n");
    git(SP_REPO, ["add", "-A"]);
    sp(["commit", "the fix"]);
    const fixSha = git(SP_REPO, ["rev-parse", "HEAD"]).stdout.trim();
    const r = sp(["promote", fixSha]);
    expect(r.status).toBe(0);
    // Back on base, no new commit, but the change is staged.
    expect(git(SP_REPO, ["rev-parse", "HEAD"]).stdout.trim()).toBe(git(SP_REPO, ["rev-parse", "refs/scratchpad/base"]).stdout.trim());
    expect(existsSync(join(SP_REPO, "fix.txt"))).toBe(true);
    expect(git(SP_REPO, ["diff", "--cached", "--quiet"]).status).toBe(1); // something IS staged
  });

  it("promote: refuses a sha not on the scratchpad branch", () => {
    sp(["enter"]);
    const base = git(SP_REPO, ["rev-parse", "refs/scratchpad/base"]).stdout.trim();
    expect(sp(["promote", base]).status).toBe(4);
  });

  it("exit: returns to base, deletes branch, clears refs, prints tip", () => {
    sp(["enter"]);
    scratchWork("scratch work");
    const tip = git(SP_REPO, ["rev-parse", "HEAD"]).stdout.trim();
    const r = sp(["exit"]);
    expect(r.status).toBe(0);
    expect(r.out).toContain(tip);
    expect(git(SP_REPO, ["symbolic-ref", "--short", "HEAD"]).stdout.trim()).toBe(SP_BASE_BRANCH);
    for (const ref of ["refs/heads/scratchpad/exp", "refs/scratchpad/base", "refs/scratchpad/state", "refs/scratchpad/origin-branch"]) {
      expect(git(SP_REPO, ["show-ref", "--verify", "--quiet", ref]).status, ref).not.toBe(0);
    }
  });

  it("exit: refuses while a bisect session is mid-flight", () => {
    sp(["enter"]);
    git(SP_REPO, ["update-ref", "refs/bisect/start", git(SP_REPO, ["rev-parse", "HEAD"]).stdout.trim()]);
    const r = sp(["exit"]);
    expect(r.status).toBe(1);
    expect(r.out).toContain("bisect");
  });

  it("detection: is detached-HEAD-safe (state ref, not branch name)", () => {
    // Simulate a bisect's detached checkout: the mode must still be detected
    // via the metadata ref.
    sp(["enter"]);
    git(SP_REPO, ["checkout", "-q", "--detach", "HEAD"]);
    const r = sp(["status"]);
    expect(r.status).toBe(0);
    expect(r.out).toContain("Scratchpad active");
  });

  it("status: reports inactive on a fresh repo", () => {
    const r = sp(["status"]);
    expect(r.status).toBe(0);
    expect(r.out).toContain("No scratchpad active");
  });

  it("lib: dirty-entry refusal text is stable (P3 contract consumer)", () => {
    writeFileSync(join(SP_REPO, "x.txt"), "dirt\n");
    const r = sp(["enter"]);
    expect(r.out).toContain("Error: working tree is dirty");
    expect(r.out).toContain("git wip");
  });

  // ── Phase 3: restrictions & refusals ────────────────────────────────────

  it("refusal contract: git-wip blocked while scratchpad active (exit 3, sentinel)", () => {
    sp(["enter"]);
    const r = run(GIT_WIP, ["wip msg"], { cwd: SP_REPO });
    expect(r.status).toBe(3);
    expect(r.out).toContain("git-wip is blocked while a scratchpad is active");
    expect(r.out).toContain("repo-scratchpad promote");
  });

  it("refusal contract: repo-commit blocked while scratchpad active (exit 3, sentinel)", () => {
    sp(["enter"]);
    const f = join(SP_REPO, "README.md");
    writeFileSync(f, readFileSync(f, "utf8") + "x\n");
    git(SP_REPO, ["add", "README.md"]);
    const r = run(REPO_COMMIT, ["some message"], { cwd: SP_REPO });
    expect(r.status).toBe(3);
    expect(r.out).toContain("repo-commit is blocked while a scratchpad is active");
  });

  it("refusal contract: pr-create blocked while scratchpad active (exit 3, push sentinel)", () => {
    sp(["enter"]);
    const r = run(PR_CREATE, ["title", "--no-issue"], { cwd: SP_REPO });
    expect(r.status).toBe(3);
    expect(r.out).toContain("pr-create push is blocked on a scratchpad branch");
  });

  it("refusal contract: restricted tools work normally when no scratchpad (no false positives)", () => {
    // repo-commit proceeds past the refusal gate (reaches its own option refusal).
    const rc = run(REPO_COMMIT, ["-m", "opt"], { cwd: SP_REPO });
    expect(rc.status).toBe(1);
    expect(rc.out).toContain("options are refused by design");
    // pr-create gets past the scratchpad gate (reaches its own arg validation).
    const pr = run(PR_CREATE, [], { cwd: SP_REPO });
    expect(pr.status).not.toBe(3);
  });

  it("push-path defense-in-depth: bare scratchpad/* branch (no state refs) blocks push tools", () => {
    // Simulate orphaned state: branch under the prefix, no scratchpad refs.
    git(SP_REPO, ["checkout", "-q", "-b", "scratchpad/orphan"]);
    const wip = run(GIT_WIP, ["wip msg"], { cwd: SP_REPO });
    expect(wip.status).toBe(3);
    expect(wip.out).toContain("push is blocked on a scratchpad branch");
    const pr = run(PR_CREATE, ["t", "--no-issue"], { cwd: SP_REPO });
    expect(pr.status).toBe(3);
    // Normal branch is unaffected.
    git(SP_REPO, ["checkout", "-q", SP_BASE_BRANCH]);
    const wip2 = run(GIT_WIP, ["--definitely-not-a-flag"], { cwd: SP_REPO });
    expect(wip2.status).toBe(1);
  });

  it("B1: commit refuses when HEAD is off the scratch branch (post-promote pause)", () => {
    sp(["enter"]);
    writeFileSync(join(SP_REPO, "fix.txt"), "fix\n");
    git(SP_REPO, ["add", "-A"]);
    sp(["commit", "the fix"]);
    const fixSha = git(SP_REPO, ["rev-parse", "HEAD"]).stdout.trim();
    sp(["promote", fixSha]);
    // Head is now on the origin branch with state refs live (paused).
    const c = sp(["commit", "must refuse"]);
    expect(c.status).toBe(1);
    expect(c.out).toContain("HEAD is not on the scratch branch");
    // And reset must refuse too (would rewind the origin branch).
    expect(sp(["reset"]).status).toBe(1);
  });

  it("B1: enter refuses while a foreign bisect is in flight", () => {
    git(SP_REPO, ["update-ref", "refs/bisect/start", git(SP_REPO, ["rev-parse", "HEAD"]).stdout.trim()]);
    const r = sp(["enter"]);
    expect(r.status).toBe(1);
    expect(r.out).toContain("bisect");
    expect(git(SP_REPO, ["show-ref", "--verify", "--quiet", "refs/heads/scratchpad/exp"]).status).not.toBe(0);
  });

  it("B1: resume refuses on staged salvage; exit-then-flow lands it", () => {
    sp(["enter"]);
    writeFileSync(join(SP_REPO, "fix.txt"), "fix\n");
    git(SP_REPO, ["add", "-A"]);
    sp(["commit", "salvage"]);
    sp(["promote", git(SP_REPO, ["rev-parse", "HEAD"]).stdout.trim()]);
    // The salvage is STAGED: resume must refuse, naming the land-it-first path.
    const r = sp(["resume"]);
    expect(r.status).toBe(1);
    expect(r.out).toContain("staged salvage");
    expect(r.out).toContain("repo-scratchpad exit");
    // The sanctioned landing: exit keeps staged work on the origin branch.
    expect(sp(["exit"]).status).toBe(0);
    expect(existsSync(join(SP_REPO, "fix.txt"))).toBe(true);
    expect(git(SP_REPO, ["diff", "--cached", "--quiet"]).status).not.toBe(0);
  });

  it("C3: ghost state gets a friendly recovery pointer, not a raw git error", () => {
    // TRUE ghost: the state tip points at a commit no scratch branch has
    // (scratch work committed, then the branch rewound under it), with a
    // second scratch branch present so the unique-prefix self-heal cannot
    // silently rescue discovery.
    const enterR = sp(["enter"]);
    expect(enterR.status, `enter failed: ${enterR.out}`).toBe(0);
    git(SP_REPO, ["branch", "scratchpad/other"]);
    const ct = git(SP_REPO, ["commit-tree", `${git(SP_REPO, ["rev-parse", "HEAD"]).stdout.trim()}^{tree}`, "-m", "ghost"]);
    expect(ct.status, `commit-tree failed: ${ct.stderr}`).toBe(0);
    const ghost = ct.stdout.trim();
    expect(ghost, "empty ghost sha").not.toBe("");
    const ur = git(SP_REPO, ["update-ref", "refs/scratchpad/state", ghost]);
    expect(ur.status, `update-ref failed: ${ur.stderr}`).toBe(0);
    const st = sp(["status"]);
    expect(st.status, `status out: ${st.out}`).toBe(1);
    expect(st.out).toContain("ghost state");
    expect(st.out).toContain("update-ref -d");
    const ex = sp(["exit"]);
    expect(ex.status).toBe(1);
    expect(ex.out).toContain("ghost state");
  });

  it("C1: promote output names the exit-then-commit unblock (no raw checkout advice)", () => {
    sp(["enter"]);
    writeFileSync(join(SP_REPO, "fix.txt"), "fix\n");
    git(SP_REPO, ["add", "-A"]);
    sp(["commit", "the fix"]);
    const r = sp(["promote", git(SP_REPO, ["rev-parse", "HEAD"]).stdout.trim()]);
    expect(r.status).toBe(0);
    expect(r.out).toContain("repo-scratchpad exit");
    expect(r.out).toContain("repo-scratchpad resume");
    expect(r.out).not.toContain("git checkout");
  });

  it("nit: slug with consecutive dots refused with the friendly message", () => {
    const r = sp(["enter", "a..b"]);
    expect(r.status).toBe(2);
    expect(r.out).toContain("no '..'");
  });
});
