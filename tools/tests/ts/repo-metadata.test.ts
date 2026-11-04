// Port of test_repo_metadata.bats (35 tests): repo-level metadata tells the
// truth — every doc is indexed, the package scripts cover the linters, and
// the release config only references things that exist.
import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))));

function grepStatus(args: string[]): number {
  try {
    execFileSync("grep", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    return 0;
  } catch (e) {
    return (e as { status?: number }).status ?? 1;
  }
}

function grepOut(args: string[]): string {
  try {
    return execFileSync("grep", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  } catch {
    return "";
  }
}

function sh(script: string): { status: number; out: string } {
  try {
    return { status: 0, out: execFileSync("bash", ["-c", script], { encoding: "utf8" }) };
  } catch (e) {
    const err = e as { status?: number; stdout?: string };
    return { status: err.status ?? 1, out: err.stdout ?? "" };
  }
}

describe("repo metadata: docs index + configs", () => {
  it("docs/README.md links every other document in docs/", () => {
    const readme = readFileSync(join(ROOT, "docs/README.md"), "utf8");
    const missing = readdirSync(join(ROOT, "docs"))
      .filter((b) => b.endsWith(".md") && b !== "README.md")
      .filter((b) => !new RegExp(`]\\(\\./${b.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[)#]`).test(readme));
    expect(missing, `not indexed in docs/README.md: ${missing.join("")}`).toEqual([]);
  });

  it("package.json has a lint:skills script that runs lint-skills", () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as { scripts?: Record<string, string> };
    expect(pkg.scripts?.["lint:skills"]).toBe("lint-skills");
  });

  it("release.config.js references no repo script that does not exist", () => {
    // e.g. a publishCmd pointing at ./.azuredevops/... when no such directory exists
    const rc = readFileSync(join(ROOT, "release.config.js"), "utf8");
    const refs = [...rc.matchAll(/\.\/\.?[A-Za-z0-9_-]+\/[A-Za-z0-9_./-]+\.(sh|js|bash)/g)].map((m) => m[0]!);
    for (const r of refs) {
      expect(existsSync(join(ROOT, r)), `release.config.js references missing ${r}`).toBe(true);
    }
  });
});

describe("repo metadata: issue + research docs", () => {
  it("issue docs show research (not spike) artifact examples", () => {
    const docs = readdirSync(join(ROOT, "docs")).filter((f) => f.endsWith(".md")).map((f) => join(ROOT, "docs", f));
    expect(grepStatus(["-n", "-E", "spike-[0-9]+-|--artifact-type spike", ...docs])).not.toBe(0);
  });

  it("issue docs never force a workflow state with project-update-issue --status", () => {
    // Workflow states (TBD..Review) advance only by their own signals; only delivery
    // states (Merged, Staging, Production) may be written directly.
    const files = ["Issues-Quick-Reference.md", "Issues-Management.md", "Additional-Tooling.md"].map((f) => join(ROOT, "docs", f));
    const r = sh(`grep -nE 'project-update-issue .*--status "?(TBD|To-Groom|Ready|Implementing|Review)"?' '${files.join("' '")}' || true`);
    expect(r.out).toBe("");
  });

  it("issue docs do not claim that assigning an issue signals Implementing", () => {
    const files = [join(ROOT, "docs/Issues-Quick-Reference.md"), join(ROOT, "docs/Issues-Management.md")];
    expect(grepStatus(["-niE", "assign(ing|ment) (yourself )?signals Implementing", ...files])).not.toBe(0);
  });

  it("every code fence in the issue docs is closed", () => {
    for (const f of ["Issues-Quick-Reference", "Issues-Management"]) {
      const n = (grepOut(["-c", "^```", join(ROOT, `docs/${f}.md`)]) || "0").trim();
      expect(Number.parseInt(n, 10) % 2).toBe(0);
    }
  });

  it("Issues-Management: no stale note says issues close when moved to Production", () => {
    const doc = join(ROOT, "docs/Issues-Management.md");
    expect(grepStatus(["-n", "closed when moved to Production", doc])).not.toBe(0);
    expect(readFileSync(doc, "utf8")).toContain("reaching Production does not auto-close");
  });

  it("Additional-Tooling lists exactly the repo types repo-types.yaml defines for repo-create --type", () => {
    const yaml = readFileSync(join(ROOT, "tools/config/repo-types.yaml"), "utf8");
    let inTypes = false;
    const yamlTypes: string[] = [];
    for (const line of yaml.split("\n")) {
      if (/^types:/.test(line)) { inTypes = true; continue; }
      if (inTypes && /^  [a-z][a-z-]*:\s*$/.test(line)) yamlTypes.push(line.replace(/[:\s]/g, ""));
    }
    const doc = readFileSync(join(ROOT, "docs/Additional-Tooling.md"), "utf8");
    const docLine = doc.split("\n").find((l) => l.includes("- `--type <type>`: Required (")) ?? "";
    const docTypes = (docLine.match(/Required \(([^)]*)\)/)?.[1] ?? "").split("|").sort().join("|");
    expect(yamlTypes.length).toBeGreaterThan(0);
    expect(docTypes).toBe([...yamlTypes].sort().join("|"));
  });

  it("Function-Naming-Conventions: every example function exists, and every cited lib file exists", () => {
    const doc = readFileSync(join(ROOT, "docs/Function-Naming-Conventions.md"), "utf8");
    const fns = [...new Set([...doc.matchAll(/`([a-z_]+)\(\)`/g)].map((m) => m[1]!))].sort();
    for (const fn of fns) {
      const r = sh(`grep -rqE '^(function )?${fn}\\(\\)' '${ROOT}/tools' '${ROOT}/.devcontainer'`);
      expect(r.status, `example function not defined anywhere: ${fn}`).toBe(0);
    }
    // the doc cites paths as (lib/<name>.bash); each resolves under tools/
    const libs = [...new Set([...doc.matchAll(/\((lib\/[a-z-]+\.bash)\)/g)].map((m) => m[1]!))].sort();
    for (const lib of libs) {
      expect(existsSync(join(ROOT, "tools", lib)), `cited lib file missing: ${lib}`).toBe(true);
    }
  });

  it("Commit-Conventions documents the CI enforcement of commit messages and the trailer", () => {
    const doc = readFileSync(join(ROOT, "docs/Commit-Conventions.md"), "utf8");
    expect(doc).toContain("commit-action-check");
    expect(doc.toLowerCase()).toContain("commit-messages");
  });
});

describe("repo metadata: skills tree", () => {
  it("research SKILL: the findings file is the one upserted, never a tmpN.md copy", () => {
    const path = join(ROOT, "copilot/skills/devenv-research/SKILL.md");
    expect(grepStatus(["-n", "Write the findings doc to `.local-artifacts/tmpN.md`", path])).not.toBe(0);
    expect(readFileSync(path, "utf8")).toContain("issue-artifact-upsert --issue <N> --body-file <path to research-NNN-<topic>.md>");
  });

  it("research SKILL: numbering takes the number only and composes the filename explicitly", () => {
    const path = join(ROOT, "copilot/skills/devenv-research/SKILL.md");
    expect(grepStatus(["-n", "--", "--dir <artifacts-folder> --filename", path])).not.toBe(0);
    // next-id replaces only {N}; a trailing * would be printed literally
    // (the * is bracketed so grep does not parse {N} as a bad interval + quantifier)
    expect(grepStatus(["-n", "research-{N}-[*]' --width 3 --dir <artifacts-folder>", path])).toBe(0);
  });

  it("research SKILL: the prototype path uses the playground/devenv-research-<topic>-<date>/ form", () => {
    expect(grepStatus(["-n", "playground/research-", join(ROOT, "copilot/skills/devenv-research/SKILL.md")])).not.toBe(0);
  });


  it("delegate and pair per-task gates stop at owner: User and Research: tasks", () => {
    for (const skill of ["devenv-delegate", "devenv-pair"]) {
      // the stop-and-hand-back rule sits beside the decision: gate, mentioning both triggers
      expect(grepStatus(["-nE", "owner: User.*Research:|Research:.*owner: User", join(ROOT, `copilot/skills/${skill}/SKILL.md`)]), `${skill}: no owner/research gate`).toBe(0);
    }
  });

  it("link-prefix rule: a workspace-level .local-artifacts link to a repo file takes one ../", () => {
    const path = join(ROOT, "copilot/skills/_conventions.md");
    expect(grepStatus(["-n", "(\\.\\./\\.\\/repos/", path])).not.toBe(0);
    expect(readFileSync(path, "utf8")).toContain("(../repos/<your-service>/src/Foo.cs#L42)");
  });

  it("board roadmap recipe passes --issue (select requires an issue number)", () => {
    const path = join(ROOT, "copilot/skills/devenv-board/SKILL.md");
    expect(grepStatus(["-n", "issue-artifact-select --artifact-type roadmap", path])).not.toBe(0);
    expect(readFileSync(path, "utf8")).toContain("issue-artifact-select --issue <epic> --artifact-type roadmap");
  });

  it("registry: audit triggers use assessment language, hunt-language stays with hunt", () => {
    const reg = join(ROOT, "copilot/skills/devenv-help/references/skills-registry.md");
    const audit = grepOut(["^| `/devenv-audit`", reg]);
    const hunt = grepOut(["^| `/devenv-hunt`", reg]);
    const triggers = audit.split("|")[3] ?? "";
    expect(triggers).not.toContain("hunt");
    expect(triggers).toContain("correctness-risk audit");
    expect(hunt).toContain("go hunting");
    expect(hunt).toContain("bug hunt");
  });

  it("pair SKILL: step headings are unique and no reference dangles past the last step", () => {
    const path = join(ROOT, "copilot/skills/devenv-pair/SKILL.md");
    const content = readFileSync(path, "utf8");
    const headings = [...content.matchAll(/^### [0-9]+[a-z]?\./gm)].map((m) => m[0]!);
    const dup = headings.filter((h, i) => headings.indexOf(h) !== i);
    expect(dup, `duplicate step headings: ${dup.join("")}`).toEqual([]);
    // the session procedure tops out at step 6; "step 8" belongs to the separate
    // Session Wrap-Up list, so only the old dangling "step 7" is checked for
    expect(grepStatus(["-niE", "\\bstep 7\\b", path])).not.toBe(0);
  });

  it("FIXME:DEVENV markers use the single-colon form everywhere in the skill tree", () => {
    expect(grepStatus(["-rn", "--include=*.md", "DEVENV\\[[^]]*\\]::", join(ROOT, "copilot"), join(ROOT, "docs")])).not.toBe(0);
  });

  it("update-roadmap SKILL: issue-get is not claimed to return linked PRs, and PRs are found by their bodies", () => {
    const path = join(ROOT, "copilot/skills/devenv-update-roadmap/SKILL.md");
    expect(grepStatus(["-n", "fetch issue state, labels, linked PRs", path])).not.toBe(0);
    expect(grepStatus(["-n", "scan issue comments for `Closes", path])).not.toBe(0);
    expect(readFileSync(path, "utf8")).toContain("scan PR bodies for `Closes #N`");
  });

  it("update-roadmap SKILL: states that roadmap-parse passes status through and the skill computes it", () => {
    expect(readFileSync(join(ROOT, "copilot/skills/devenv-update-roadmap/SKILL.md"), "utf8"))
      .toMatch(/passes each step.s existing \*\*Status\*\* line through/);
  });

  it("no doc or skill names the nonexistent create-for-merge PR tool", () => {
    expect(grepStatus(["-rn", "--include=*.md", "create-for-merge", join(ROOT, "docs"), join(ROOT, "copilot")])).not.toBe(0);
  });

  it("devenv-commit SKILL describes repo-commit's real editor-resolution chain, in order", () => {
    const path = join(ROOT, "copilot/skills/devenv-commit/SKILL.md");
    // the order in repo-commit.sh: GIT_EDITOR, core.editor, code --wait, nano, VISUAL, EDITOR
    expect(readFileSync(path, "utf8")).toMatch(/GIT_EDITOR.*core\.editor.*code --wait.*nano.*VISUAL.*EDITOR/s);
    expect(readFileSync(path, "utf8").toLowerCase()).toContain("treated as unset");
    expect(grepStatus(["-n", "prefers VS Code (`code --wait`) with nano as fallback", path])).not.toBe(0);
  });

  it("copilot-instructions does not claim pr-create pushes the branch in general", () => {
    const path = join(ROOT, "copilot/copilot-instructions.md");
    expect(grepStatus(["-n", "pr-create` pushes the branch", path])).not.toBe(0);
    expect(readFileSync(path, "utf8")).toContain("pr-create --at` pushes the merge branch");
  });
});

describe("repo metadata: shared references", () => {
  const PC = join(ROOT, "copilot/skills/_shared/references/protocol-common.md");

  it("protocol-common: no reference to a nonexistent issue-edit wrapper", () => {
    expect(grepStatus(["-n", "issue-edit", PC])).not.toBe(0);
  });

  it("protocol-common: body-input contract names the picker only where it exists", () => {
    const content = readFileSync(PC, "utf8");
    const block = content.slice(content.indexOf("### Markdown body input (shared contract)"), content.indexOf("## Issue tools"));
    expect(block).toContain("issue-artifact-upsert");
    expect(block).toContain("error");
  });

  it("protocol-common: the --marker recipe uses single backslashes (a real regex escape)", () => {
    // bats argv carries 5 backslashes (BRE: two literal backslashes + literal [) —
    // the DOUBLED-backslash recipe form; TS needs 10 source backslashes for that
    expect(grepStatus(["-n", "--", "--marker 'DEVENV\\\\\\\\\\[", PC])).not.toBe(0);
    // the recipe line uses a single backslash before [ and ] (a real regex escape)
    expect(readFileSync(PC, "utf8")).toContain(String.raw`--marker 'DEVENV\[bug-hunt\]'`);
  });

  it("protocol-common: issue-create blocks only without --no-interactive (no-template is a no-op)", () => {
    expect(grepStatus(["-n", "Without `--no-template`/`--no-interactive`", PC])).not.toBe(0);
    expect(readFileSync(PC, "utf8")).toContain("Without `--no-interactive`");
  });
});

describe("repo metadata: edit protocol + commit chain", () => {
  it("edit protocol: plans and roadmaps are exempt from per-edit revision history", () => {
    const f = join(ROOT, "copilot/skills/common/references/issue-backed-artifact-edit-protocol.md");
    const content = readFileSync(f, "utf8");
    const block = content.slice(content.indexOf("## Revision history"), content.indexOf("## Decision-package parity"));
    expect(block).toContain("current-state");
    expect(block).toContain("plans");
    expect(block).toContain("roadmaps");
  });

  it("edit protocol: states the file-canonical vs issue-canonical rule with type lists", () => {
    const f = join(ROOT, "copilot/skills/common/references/issue-backed-artifact-edit-protocol.md");
    const content = readFileSync(f, "utf8");
    const block = content.slice(content.indexOf("## Source-of-truth rule"), content.indexOf("## Typical applications"));
    expect(block).toContain("File-canonical");
    expect(block).toContain("Issue-canonical");
    expect(block).toContain("research");
    expect(block).toContain("design");
    expect(block).toContain("plans");
    expect(block).toContain("roadmaps");
  });

  it("research SKILL cites the edit protocol, which actually holds the file-canonical rule", () => {
    expect(readFileSync(join(ROOT, "copilot/skills/devenv-research/SKILL.md"), "utf8"))
      .toContain("issue-backed-artifact-edit-protocol.md#source-of-truth-rule");
  });

  it("ruleset commit-message pattern allows exactly the commitlint type enum", () => {
    const enumTypes = (sh(`node --input-type=module -e "const c=(await import('file://${ROOT}/commitlint.config.js')).default; console.log(c.rules['type-enum'][2].slice().sort().join('|'))"`).out).trim();
    const rulesetJson = JSON.parse(readFileSync(join(ROOT, "tools/config/ruleset-default.json"), "utf8")) as unknown;
    // find the commit_message_pattern parameter anywhere in the JSON tree
    let pattern = "";
    const walk = (node: unknown): void => {
      if (Array.isArray(node)) { node.forEach(walk); return; }
      if (node && typeof node === "object") {
        const obj = node as Record<string, unknown>;
        if (obj.type === "commit_message_pattern" && obj.parameters && typeof obj.parameters === "object") {
          pattern = ((obj.parameters as Record<string, unknown>).pattern as string) ?? "";
        }
        Object.values(obj).forEach(walk);
      }
    };
    walk(rulesetJson);
    const ruleset = pattern.replace(/^\^\(([^)]*)\).*/, "$1").split("|").sort().join("|");
    expect(enumTypes).not.toBe("");
    expect(ruleset).toBe(enumTypes);
  });

  it("the wrapper's DEVENV_COMMIT_TYPES equals the commitlint type enum", () => {
    const enumTypes = (sh(`node --input-type=module -e "const c=(await import('file://${ROOT}/commitlint.config.js')).default; console.log(c.rules['type-enum'][2].slice().sort().join(' '))"`).out).trim();
    const wrapper = (sh(`source '${ROOT}/tools/lib/git-operations.bash' >/dev/null 2>&1; echo "\$DEVENV_COMMIT_TYPES"`).out).trim().split(/\s+/).sort().join(" ");
    expect(enumTypes).not.toBe("");
    expect(wrapper).toBe(enumTypes);
  });

  it("the lint-skills docs name every rule the script implements", () => {
    const doc = join(ROOT, "copilot/skills/_tools-reference.md");
    // the implementation now lives at tools/ts/lint-skills.ts (the .sh moved there)
    const script = readFileSync(join(ROOT, "tools/ts/lint-skills.ts"), "utf8");
    const ids = [...new Set(script.match(/SK0[0-9]+/g) ?? [])].sort();
    const last = ids.at(-1) ?? "";
    const docContent = readFileSync(doc, "utf8");
    const start = docContent.indexOf("### lint-skills");
    const section = docContent.slice(start, docContent.indexOf("```", start));
    expect(section).toContain(last);
    expect(section).toContain("anchor");
    expect(section).toContain("orphan");
    expect(section).toContain("references");
  });
});
