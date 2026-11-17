// lint-skills behavioral tests (port of test_lint_skills.bats): each defect
// class must FAIL the checker (negative controls); a golden tree must PASS.
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SCRIPT = join(__dirname, "../../ts/lint-skills.ts");

let workDir: string;
let tree: string;

function runLint(env: Record<string, string> = {}): { status: number; out: string } {
  const r = spawnSync("node", [SCRIPT, workDir], {
    encoding: "utf8",
    timeout: 60_000,
    env: { ...process.env, ...env },
  });
  return { status: r.status ?? 1, out: (r.stdout ?? "") + (r.stderr ?? "") };
}

function write(p: string, content: string): void {
  const full = join(tree, p);
  mkdirSync(join(full, ".."), { recursive: true });
  writeFileSync(full, content);
}

function writeSkill(name: string): void {
  write(
    `${name}/SKILL.md`,
    `---\nname: ${name}\ndescription: x\nuser-invocable: true\n---\n# ${name}\n`,
  );
}

// Makes TREE a git repo (SK007 is gated on $repo_root/.git) whose history
// contains a committed TREE/docs/GitHub-Issues-Management.md that is then
// renamed (committed) to docs/Issues-History.md.
function setupGitWithRenamedDoc(): void {
  const git = (...args: string[]): void => {
    const r = spawnSync("git", ["-C", workDir, ...args], { encoding: "utf8" });
    if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
  };
  git("init", "-q", ".");
  git("config", "user.email", "t@t");
  git("config", "user.name", "t");
  mkdirSync(join(workDir, "docs"), { recursive: true });
  writeFileSync(join(workDir, "docs", "GitHub-Issues-Management.md"), "old doc\n");
  git("add", "-A");
  git("commit", "-qm", "init");
  git("mv", "docs/GitHub-Issues-Management.md", "docs/Issues-History.md");
  git("add", "-A");
  git("commit", "-qm", "rename");
}

beforeEach(() => {
  workDir = join(tmpdir(), `lintskills-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  tree = join(workDir, "copilot", "skills");
  // Golden minimal tree: two skills, registry, catalog.
  writeSkill("devenv-alpha");
  writeSkill("devenv-beta");
  writeSkill("devenv-help");
  // the registry and catalog are referenced from the help skill (SK009
  // requires every reference file be linked)
  write(
    "devenv-help/SKILL.md",
    "---\nname: devenv-help\ndescription: x\nuser-invocable: true\n---\n# devenv-help\nSee references/skills-registry.md and ../common/references/skills-catalog.md\n",
  );
  write(
    "devenv-help/references/skills-registry.md",
    "| `/devenv-alpha` | x | x | x |\n| `/devenv-beta` | x | x | x |\n| `/devenv-help` | x | x | x |\n",
  );
  // The catalog is a pointer (no skill names); docs/Skills.md (reached through
  // the shared symlink) is the canonical full listing the lint checks.
  write("common/references/skills-catalog.md", "See ../../_shared/docs/Skills.md\n");
  write("_shared/docs/Skills.md", "devenv-alpha devenv-beta devenv-help\n");
});

afterEach(() => rmSync(workDir, { recursive: true, force: true }));

describe("lint-skills", () => {
  it("golden tree passes", () => {
    expect(runLint().status).toBe(0);
  });

  it("SK004: a skill missing from docs/Skills.md fails", () => {
    write("_shared/docs/Skills.md", "devenv-alpha devenv-help\n");
    const r = runLint();
    expect(r.status).toBe(1);
    expect(r.out).toContain("SK004");
    expect(r.out).toContain("devenv-beta");
    expect(r.out).toContain("Skills.md");
  });

  it("SK004: a pointer-only catalog is fine when Skills.md lists every skill", () => {
    expect(runLint().status).toBe(0);
  });

  it("SK008: a cross-file link to a missing heading anchor fails", () => {
    write("common/references/target.md", "# Target\n\n## Real Heading\n");
    write(
      "devenv-alpha/SKILL.md",
      '---\nname: devenv-alpha\ndescription: x\nuser-invocable: true\n---\nSee [x](../common/references/target.md#no-such-heading).\n',
    );
    const r = runLint();
    expect(r.status).toBe(1);
    expect(r.out).toContain("SK008");
    expect(r.out).toContain("no-such-heading");
  });

  it("SK008: a cross-file anchor matching a heading slug passes (punctuation, repeats)", () => {
    write("common/references/target.md", "# T\n\n## Skill `_on_<event>` (signals)\n\n## Same\n\n## Same\n");
    write(
      "devenv-alpha/SKILL.md",
      '---\nname: devenv-alpha\ndescription: x\nuser-invocable: true\n---\n[a](../common/references/target.md#skill-_on_event-signals) [b](../common/references/target.md#same-1)\n',
    );
    expect(runLint().status).toBe(0);
  });

  it("SK008: same-file example anchors and fenced examples are not checked", () => {
    write(
      "devenv-alpha/SKILL.md",
      '---\nname: devenv-alpha\ndescription: x\nuser-invocable: true\n---\nExample [AC-N](#ac-N).\n\n```\n[x](../common/references/target.md#nope)\n```\n',
    );
    write("common/references/target.md", "# Target\n");
    expect(runLint().status).toBe(0);
  });

  it("SK010: a frontmatter trigger phrase missing from the registry row fails", () => {
    write(
      "devenv-alpha/SKILL.md",
      '---\nname: devenv-alpha\ndescription: Does things. USE WHEN the user says "alpha trigger one" or "alpha trigger two". DO NOT USE FOR beta work (use `/devenv-beta`).\nuser-invocable: true\n---\n# devenv-alpha\n',
    );
    write(
      "devenv-help/references/skills-registry.md",
      "| `/devenv-alpha` | x | \"alpha trigger one\" | y |\n| `/devenv-beta` | x | x | x |\n| `/devenv-help` | x | x | x |\n",
    );
    write("_shared/docs/Skills.md", "| `/devenv-alpha` | x. Triggers: \"alpha trigger one\", \"alpha trigger two\" | a |\n| `/devenv-beta` | x | x |\n| `/devenv-help` | x | x |\n");
    const r = runLint();
    expect(r.status).toBe(1);
    expect(r.out).toContain("SK010");
    expect(r.out).toContain("alpha trigger two");
    expect(r.out).toContain("registry row");
  });

  it("SK010: a NOT-FOR sibling missing from docs/Skills.md fails", () => {
    write(
      "devenv-alpha/SKILL.md",
      '---\nname: devenv-alpha\ndescription: Does things. USE WHEN the user says "alpha trigger one". DO NOT USE FOR beta work (use `/devenv-beta`).\nuser-invocable: true\n---\n# devenv-alpha\n',
    );
    write(
      "devenv-help/references/skills-registry.md",
      "| `/devenv-alpha` | x | \"alpha trigger one\" | beta work → `/devenv-beta` |\n| `/devenv-beta` | x | x | x |\n| `/devenv-help` | x | x | x |\n",
    );
    write("_shared/docs/Skills.md", "| `/devenv-alpha` | x. Triggers: \"alpha trigger one\" | a |\n| `/devenv-beta` | x | x |\n| `/devenv-help` | x | x |\n");
    const r = runLint();
    expect(r.status).toBe(1);
    expect(r.out).toContain("SK010");
    expect(r.out).toContain("NOT-FOR sibling");
    expect(r.out).toContain("Skills.md");
  });

  it("SK010: single-quoted YAML apostrophes unescape before matching", () => {
    write(
      "devenv-alpha/SKILL.md",
      "---\nname: devenv-alpha\ndescription: 'Does things. USE WHEN the user says \"let''s alpha\".'\nuser-invocable: true\n---\n# devenv-alpha\n",
    );
    write(
      "devenv-help/references/skills-registry.md",
      '| `/devenv-alpha` | x | "let\'s alpha" | y |\n| `/devenv-beta` | x | x | x |\n| `/devenv-help` | x | x | x |\n',
    );
    write(
      "_shared/docs/Skills.md",
      '| `/devenv-alpha` | x. Triggers: "let\'s alpha" | a |\n| `/devenv-beta` | x | x |\n| `/devenv-help` | x | x |\n',
    );
    expect(runLint().status).toBe(0);
  });

  it("SK009: a references/ file that nothing links to fails", () => {
    write("devenv-alpha/references/lonely.md", "# Lonely\n");
    const r = runLint();
    expect(r.status).toBe(1);
    expect(r.out).toContain("SK009");
    expect(r.out).toContain("lonely.md");
  });

  it("SK009: a references/ file linked from its skill passes", () => {
    write("devenv-alpha/references/used.md", "# Used\n");
    write(
      "devenv-alpha/SKILL.md",
      '---\nname: devenv-alpha\ndescription: x\nuser-invocable: true\n---\nSee [used](./references/used.md).\n',
    );
    expect(runLint().status).toBe(0);
  });

  it("SK001: missing description fails", () => {
    write("devenv-alpha/SKILL.md", "---\nname: devenv-alpha\nuser-invocable: true\n---\n");
    const r = runLint();
    expect(r.status).toBe(1);
    expect(r.out).toContain("SK001");
  });

  it("SK002: name mismatch fails", () => {
    write("devenv-alpha/SKILL.md", "---\nname: devenv-something-else\ndescription: x\nuser-invocable: true\n---\n");
    const r = runLint();
    expect(r.status).toBe(1);
    expect(r.out).toContain("SK002");
  });

  it("SK003: over-length description fails", () => {
    const long = "y".repeat(2100);
    write("devenv-alpha/SKILL.md", `---\nname: devenv-alpha\ndescription: ${long}\nuser-invocable: true\n---\n`);
    const r = runLint();
    expect(r.status).toBe(1);
    expect(r.out).toContain("SK003");
  });

  it("SK004: registry ghost (reference with no directory) fails", () => {
    write(
      "devenv-help/references/skills-registry.md",
      "| `/devenv-alpha` | x | x | x |\n| `/devenv-beta` | x | x | x |\n| `/devenv-help` | x | x | x |\n| `/devenv-ghost` | x | x | x |\n",
    );
    const r = runLint();
    expect(r.status).toBe(1);
    expect(r.out).toContain("SK004");
    expect(r.out).toContain("ghost");
  });

  it("SK004: orphan skill directory (not in registry) fails", () => {
    writeSkill("devenv-orphan");
    const r = runLint();
    expect(r.status).toBe(1);
    expect(r.out).toContain("SK004");
    expect(r.out).toContain("orphan");
  });

  it("SK005: broken relative link fails", () => {
    write(
      "devenv-alpha/SKILL.md",
      '---\nname: devenv-alpha\ndescription: x\nuser-invocable: true\n---\n# A\n[bad](../devenv-nonexistent/SKILL.md)\n',
    );
    const r = runLint();
    expect(r.status).toBe(1);
    expect(r.out).toContain("SK005");
  });

  // --- SK007: stale backticked path references ----------------------------------

  it("SK007: stale path (in git history, missing from tree) fails", () => {
    write("devenv-alpha/SKILL.md", '---\nname: devenv-alpha\ndescription: x\nuser-invocable: true\n---\nsee `docs/GitHub-Issues-Management.md`\n');
    setupGitWithRenamedDoc();
    const r = runLint();
    expect(r.status).toBe(1);
    expect(r.out).toContain("SK007");
    expect(r.out).toContain("docs/GitHub-Issues-Management.md");
  });

  it("SK007: globs, bare dirs, placeholders, and never-existed paths pass", () => {
    write(
      "devenv-alpha/SKILL.md",
      '---\nname: devenv-alpha\ndescription: x\nuser-invocable: true\n---\nrefs `docs/Decisions/` `tools/lib/providers/*` `docs/SomeFile.md` `docs/Usage_guide.md`\n',
    );
    setupGitWithRenamedDoc();
    const r = runLint();
    expect(r.status).toBe(0);
    expect(r.out).not.toContain("SK007");
  });

  it("SK007: current path referenced alongside renamed sibling stays clean", () => {
    write("devenv-alpha/SKILL.md", '---\nname: devenv-alpha\ndescription: x\nuser-invocable: true\n---\nnow `docs/Issues-History.md`\n');
    setupGitWithRenamedDoc();
    const r = runLint();
    expect(r.status).toBe(0);
    expect(r.out).not.toContain("SK007");
  });

  it("SK007: no .git dir — check skipped silently", () => {
    write("devenv-alpha/SKILL.md", '---\nname: devenv-alpha\ndescription: x\nuser-invocable: true\n---\nsee `docs/anything-old.md`\n');
    const r = runLint();
    expect(r.status).toBe(0);
    expect(r.out).not.toContain("SK007");
  });

  it("SK003: a folded (description: >) description is measured by its full text", () => {
    const line = "z".repeat(90);
    const body = Array.from({ length: 25 }, () => `  ${line}`).join("\n");
    write("devenv-alpha/SKILL.md", `---\nname: devenv-alpha\ndescription: >\n${body}\nuser-invocable: true\n---\n`);
    const r = runLint();
    expect(r.status).toBe(1);
    expect(r.out).toContain("SK003");
  });

  it("SK003: a short folded description passes", () => {
    write("devenv-alpha/SKILL.md", "---\nname: devenv-alpha\ndescription: >\n  short text\n  more\nuser-invocable: true\n---\n");
    const r = runLint();
    expect(r.status).toBe(0);
    expect(r.out).not.toContain("SK003");
  });

  it("strict mode: a warning alone fails; default mode tolerates it", () => {
    write("devenv-alpha/SKILL.md", "---\nname: devenv-alpha\ndescription: x\n---\n# A\n");
    expect(runLint().status).toBe(0);
    const strict = runLint({ SK_LINT_STRICT: "1" });
    expect(strict.status).toBe(1);
    expect(strict.out).toContain("SK-WARN");
  });

  it("SK006: a git failure in a tree with .git is an error, not 'not found'", () => {
    mkdirSync(join(workDir, ".git"));
    const r = runLint();
    expect(r.status).toBe(1);
    expect(r.out).toContain("SK006");
  });
});

void existsSync;
