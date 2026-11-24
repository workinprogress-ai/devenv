// lint-skills behavioral tests: each defect
// class must FAIL the checker (negative controls); a golden tree must PASS.
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SCRIPT = join(__dirname, "../../ts/lint-skills.ts");

let workDir: string;
let tree: string;

const FEEDBACK_LINE = "> **Skill feedback:** x";
const HANDOFF_LINE =
  "> **Skill handoff:** conclusions, recommendations, and consent from a prior skill's frame are input, not authorization — this skill's own intake and gates run in full. See the [Skill Handoff Protocol](../common/references/skill-handoff-protocol.md).";

// Every fixture skill carries the canonical receiving-side line right after its
// Skill feedback blockquote, so tests that expect a clean tree stay clean; the
// SK012 negative controls opt out with raw=true.
function withHandoff(content: string): string {
  const end = content.indexOf("\n---\n", 4);
  if (!content.startsWith("---\n") || end === -1) return content;
  const at = end + "\n---\n".length;
  return `${content.slice(0, at)}${FEEDBACK_LINE}\n\n${HANDOFF_LINE}\n\n${content.slice(at)}`;
}

function runLint(env: Record<string, string> = {}): { status: number; out: string } {
  const r = spawnSync("node", [SCRIPT, workDir], {
    encoding: "utf8",
    timeout: 60_000,
    env: { ...process.env, ...env },
  });
  return { status: r.status ?? 1, out: (r.stdout ?? "") + (r.stderr ?? "") };
}

function write(p: string, content: string, raw = false): void {
  const full = join(tree, p);
  mkdirSync(join(full, ".."), { recursive: true });
  writeFileSync(full, p.endsWith("/SKILL.md") && !raw ? withHandoff(content) : content);
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
  // the target of every skill's receiving-side handoff link
  write("common/references/skill-handoff-protocol.md", "# Skill Handoff Protocol\n");
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

  it("SK003: the Copilot limit is 1024 characters — 1024 passes, 1025 fails", () => {
    const skill = (len: number): string =>
      `---\nname: devenv-alpha\ndescription: ${"y".repeat(len)}\nuser-invocable: true\n---\n`;
    write("devenv-alpha/SKILL.md", skill(1024));
    expect(runLint().status).toBe(0);
    write("devenv-alpha/SKILL.md", skill(1025));
    const r = runLint();
    expect(r.status).toBe(1);
    expect(r.out).toContain("SK003");
  });

  it("SK003: length is measured on the parsed value, not the raw YAML line", () => {
    // 12 doubled apostrophes unescape to 12 characters: the raw line is over
    // 1024 characters, the parsed description is 1012.
    const value = `${"y".repeat(1000)}${"''".repeat(12)}`;
    write("devenv-alpha/SKILL.md", `---\nname: devenv-alpha\ndescription: '${value}'\nuser-invocable: true\n---\n`);
    expect(runLint().status).toBe(0);
  });

  it("SK011: an unquoted description containing ': ' fails as unparseable YAML", () => {
    write("devenv-alpha/SKILL.md", "---\nname: devenv-alpha\ndescription: route it: bug to hunt\nuser-invocable: true\n---\n");
    const r = runLint();
    expect(r.status).toBe(1);
    expect(r.out).toContain("SK011");
    expect(r.out).toContain("devenv-alpha");
  });

  it("SK011: the same description single-quoted parses and passes", () => {
    write("devenv-alpha/SKILL.md", "---\nname: devenv-alpha\ndescription: 'route it: bug to hunt'\nuser-invocable: true\n---\n");
    expect(runLint().status).toBe(0);
  });

  it("SK011: unparseable frontmatter is reported once — SK003 is skipped for that file", () => {
    write(
      "devenv-alpha/SKILL.md",
      `---\nname: devenv-alpha\ndescription: route it: ${"y".repeat(1100)}\nuser-invocable: true\n---\n`,
    );
    const r = runLint();
    expect(r.status).toBe(1);
    expect(r.out).toContain("SK011");
    expect(r.out).not.toContain("SK003");
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

  const ALPHA_FRONTMATTER = "---\nname: devenv-alpha\ndescription: x\nuser-invocable: true\n---\n";

  it("SK012: a SKILL.md without the receiving-side handoff line fails", () => {
    write("devenv-alpha/SKILL.md", `${ALPHA_FRONTMATTER}${FEEDBACK_LINE}\n\n# devenv-alpha\n`, true);
    const r = runLint();
    expect(r.status).toBe(1);
    expect(r.out).toContain("SK012");
    expect(r.out).toContain("devenv-alpha");
  });

  it("SK012: a handoff line with altered wording fails", () => {
    const altered = HANDOFF_LINE.replace("are input, not authorization", "are authorization");
    write("devenv-alpha/SKILL.md", `${ALPHA_FRONTMATTER}${FEEDBACK_LINE}\n\n${altered}\n\n# devenv-alpha\n`, true);
    const r = runLint();
    expect(r.status).toBe(1);
    expect(r.out).toContain("SK012");
    expect(r.out).toContain("canonical");
  });

  it("SK012: a handoff line that does not follow the Skill feedback blockquote fails", () => {
    write(
      "devenv-alpha/SKILL.md",
      `${ALPHA_FRONTMATTER}${HANDOFF_LINE}\n\n${FEEDBACK_LINE}\n\n# devenv-alpha\n`,
      true,
    );
    const r = runLint();
    expect(r.status).toBe(1);
    expect(r.out).toContain("SK012");
    expect(r.out).toContain("Skill feedback");
  });

  it("SK012: a handoff link to a missing protocol file fails through the link check", () => {
    rmSync(join(tree, "common/references/skill-handoff-protocol.md"));
    const r = runLint();
    expect(r.status).toBe(1);
    expect(r.out).toContain("SK005");
    expect(r.out).toContain("skill-handoff-protocol.md");
  });

  it("a handoff line that appears only inside a code fence does not count", () => {
    write(
      "devenv-alpha/SKILL.md",
      `${ALPHA_FRONTMATTER}${FEEDBACK_LINE}\n\n\`\`\`\n${HANDOFF_LINE}\n\`\`\`\n\n# devenv-alpha\n`,
      true,
    );
    const r = runLint();
    expect(r.status).toBe(1);
    expect(r.out).toContain("missing the receiving-side handoff line");
  });

  it("a duplicated handoff line fails", () => {
    write(
      "devenv-alpha/SKILL.md",
      `${ALPHA_FRONTMATTER}${FEEDBACK_LINE}\n\n${HANDOFF_LINE}\n\n${HANDOFF_LINE}\n\n# devenv-alpha\n`,
      true,
    );
    const r = runLint();
    expect(r.status).toBe(1);
    expect(r.out).toContain("more than one");
  });

  it("a multi-line Skill feedback blockquote still passes", () => {
    write(
      "devenv-alpha/SKILL.md",
      `${ALPHA_FRONTMATTER}${FEEDBACK_LINE}\n> and a continuation line of the same paragraph\n\n${HANDOFF_LINE}\n\n# devenv-alpha\n`,
      true,
    );
    expect(runLint().status).toBe(0);
  });

  it("the contiguous blockquote stack with bare > separators passes", () => {
    write(
      "devenv-alpha/SKILL.md",
      `${ALPHA_FRONTMATTER}> **Diagnostic mode:** x\n>\n${FEEDBACK_LINE}\n>\n${HANDOFF_LINE}\n>\n> Use the shared policy.\n\n# devenv-alpha\n`,
      true,
    );
    expect(runLint().status).toBe(0);
  });

  it("a handoff line separated from the Skill feedback blockquote by other content fails", () => {
    write(
      "devenv-alpha/SKILL.md",
      `${ALPHA_FRONTMATTER}${FEEDBACK_LINE}\n\n> **Other gate:** x\n\n${HANDOFF_LINE}\n\n# devenv-alpha\n`,
      true,
    );
    const r = runLint();
    expect(r.status).toBe(1);
    expect(r.out).toContain("immediately follow");
  });

  it("a handoff line that appears only inside a tilde fence does not count", () => {
    write(
      "devenv-alpha/SKILL.md",
      `${ALPHA_FRONTMATTER}${FEEDBACK_LINE}\n\n~~~\n${HANDOFF_LINE}\n~~~\n\n# devenv-alpha\n`,
      true,
    );
    const r = runLint();
    expect(r.status).toBe(1);
    expect(r.out).toContain("missing the receiving-side handoff line");
  });

  it("a four-backtick fence nesting a triple-backtick example stays one fence", () => {
    write(
      "devenv-alpha/SKILL.md",
      `${ALPHA_FRONTMATTER}\`\`\`\`md\n\`\`\`md\n${HANDOFF_LINE}\n\`\`\`\n\`\`\`\`\n\n${FEEDBACK_LINE}\n\n${HANDOFF_LINE}\n\n# devenv-alpha\n`,
      true,
    );
    expect(runLint().status).toBe(0);
  });

  it("an unclosed code fence is reported as unclosed, not as a missing line", () => {
    write(
      "devenv-alpha/SKILL.md",
      `${ALPHA_FRONTMATTER}\`\`\`\nexample\n\n${FEEDBACK_LINE}\n\n${HANDOFF_LINE}\n\n# devenv-alpha\n`,
      true,
    );
    const r = runLint();
    expect(r.status).toBe(1);
    expect(r.out).toContain("unclosed code fence");
    expect(r.out).not.toContain("missing the receiving-side handoff line");
  });

  it("a fence opened inside a blockquote hides its quoted handoff example", () => {
    write(
      "devenv-alpha/SKILL.md",
      `${ALPHA_FRONTMATTER}> \`\`\`\n> **Skill handoff:** an example, not the real line\n> \`\`\`\n\n${FEEDBACK_LINE}\n\n${HANDOFF_LINE}\n\n# devenv-alpha\n`,
      true,
    );
    expect(runLint().status).toBe(0);
  });

  it("a plain blockquote separated from the Skill feedback line by a bare > fails", () => {
    write(
      "devenv-alpha/SKILL.md",
      `${ALPHA_FRONTMATTER}${FEEDBACK_LINE}\n>\n> A plain note that is its own paragraph.\n>\n${HANDOFF_LINE}\n\n# devenv-alpha\n`,
      true,
    );
    const r = runLint();
    expect(r.status).toBe(1);
    expect(r.out).toContain("immediately follow");
  });

  it("a plain blockquote line directly under the feedback line is the same paragraph and passes", () => {
    write(
      "devenv-alpha/SKILL.md",
      `${ALPHA_FRONTMATTER}${FEEDBACK_LINE}\n> A plain continuation of the same paragraph.\n\n${HANDOFF_LINE}\n\n# devenv-alpha\n`,
      true,
    );
    expect(runLint().status).toBe(0);
  });

  it("a feedback continuation line that starts with bold text but is not a labeled gate passes", () => {
    write(
      "devenv-alpha/SKILL.md",
      `${ALPHA_FRONTMATTER}${FEEDBACK_LINE}\n> **Never** offered unprompted, same paragraph.\n\n${HANDOFF_LINE}\n\n# devenv-alpha\n`,
      true,
    );
    expect(runLint().status).toBe(0);
  });

  it("a SKILL.md without a Skill feedback blockquote fails", () => {
    write("devenv-alpha/SKILL.md", `${ALPHA_FRONTMATTER}${HANDOFF_LINE}\n\n# devenv-alpha\n`, true);
    const r = runLint();
    expect(r.status).toBe(1);
    expect(r.out).toContain("Skill feedback");
    expect(r.out).toContain("missing");
  });
});

void existsSync;
