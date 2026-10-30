// Black-box tests for repo-batch-draft against a real temp git repo with
// fixture plans: expansion, conflict detection, unassigned bucketing,
// readiness annotations, no-plan mode, and the round-trip guarantee (a
// resolved draft parses under repo-stage's own parser). Real git; the
// manifest draft lands in the fixture repo's .local-artifacts/.
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const TOOL = join(fileURLToPath(new URL(".", import.meta.url)), "../../ts/repo-batch-draft.ts");

let root: string;
let repo: string;

function git(...args: string[]): string {
  const r = spawnSync("git", ["-C", repo, ...args], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
  return r.stdout;
}

function write(path: string, content: string): void {
  writeFileSync(join(repo, path), content);
}

/** mkdir the parent directories a path needs, then write it. */
function writeFile(path: string, content: string): void {
  const parts = path.split("/");
  parts.pop();
  if (parts.length > 0) mkdirSync(join(repo, parts.join("/")), { recursive: true });
  write(path, content);
}

function runTool(args: string[]): { status: number; out: string } {
  const r = spawnSync("node", [TOOL, ...args], { encoding: "utf8", cwd: repo, env: process.env });
  return { status: r.status ?? 1, out: (r.stdout ?? "") + (r.stderr ?? "") };
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "batch-draft-test-"));
  repo = join(root, "repo");
  spawnSync("git", ["init", "-q", "-b", "master", repo], { encoding: "utf8" });
  git("config", "user.email", "t@example.com");
  git("config", "user.name", "T");
  write("seed.txt", "seed\n");
  git("add", "--", "seed.txt");
  git("commit", "-q", "--no-verify", "-m", "seed");
  mkdirSync(join(repo, ".local-artifacts"));
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

const PLAN = (opts: { oneDone?: boolean; twoDone?: boolean; commitBullet?: boolean } = {}) => `# Plan fixture

## Phases

### Phase 1 — P1

- [${opts.oneDone ? "x" : " "}] **1.1 [S] First task**
  - Files: \`src/a.ts\`, \`src/b.ts\`${opts.commitBullet ? "\n  - commit: feat: first unit" : ""}
- [${opts.twoDone ? "x" : " "}] **1.2 [S] Second task**
  - Files: \`docs/guide.md\`
`;

describe("repo-batch-draft", () => {
  it("expands plan claims into groups with correct subjects", () => {
    writeFile("src/a.ts", "a\n");
    writeFile("src/b.ts", "b\n");
    writeFile("docs/guide.md", "g\n");
    const plan = join(root, "plan.md");
    writeFileSync(plan, PLAN());
    const r = runTool(["--plan", plan]);
    expect(r.status).toBe(0);
    expect(r.out).toContain("groups 2 · assigned 3 · unassigned 0 · conflicts 0");
    const draft = readFileSync(join(repo, ".local-artifacts", "batch-draft-1.md"), "utf8");
    expect(draft).toContain("## group 1 — 1.1 — First task");
    expect(draft).toContain("- src/a.ts");
    expect(draft).toContain("## group 2 — 1.2 — Second task");
  });

  it("commit: bullet subjects prefill when present", () => {
    writeFile("src/a.ts", "a\n");
    writeFile("src/b.ts", "b\n");
    writeFile("docs/guide.md", "g\n");
    const plan = join(root, "plan.md");
    writeFileSync(plan, PLAN({ commitBullet: true }));
    runTool(["--plan", plan]);
    const draft = readFileSync(join(repo, ".local-artifacts", "batch-draft-1.md"), "utf8");
    expect(draft).toContain("## group 1 — 1.1 — feat: first unit");
  });

  it("unclaimed files park in unassigned and are listed on stdout", () => {
    writeFile("src/a.ts", "a\n");
    writeFile("src/b.ts", "b\n");
    writeFile("docs/guide.md", "g\n");
    writeFile("loose.txt", "l\n");
    const plan = join(root, "plan.md");
    writeFileSync(plan, PLAN());
    const r = runTool(["--plan", plan]);
    expect(r.status).toBe(0);
    expect(r.out).toContain("unassigned 1");
    expect(r.out).toContain("- loose.txt");
  });

  it("multi-claimed files park in conflicts with both claimants", () => {
    writeFile("src/a.ts", "a\n");
    writeFile("src/b.ts", "b\n");
    writeFile("docs/guide.md", "g\n");
    const plan = join(root, "plan.md");
    // a second plan whose task also claims src/a.ts
    writeFileSync(
      plan,
      `# Plan fixture

- [ ] **1.1 [S] First**
  - Files: \`src/a.ts\`
- [ ] **1.2 [S] Second**
  - Files: \`src/a.ts\`, \`docs/guide.md\`
`,
    );
    const r = runTool(["--plan", plan]);
    expect(r.status).toBe(0);
    expect(r.out).toContain("conflicts 1");
    expect(r.out).toContain("src/a.ts (1.1, 1.2)");
  });

  it("open tasks hold their own groups; done tasks' groups read ready", () => {
    writeFile("src/a.ts", "a\n");
    writeFile("src/b.ts", "b\n");
    writeFile("docs/guide.md", "g\n");
    const plan = join(root, "plan.md");
    writeFileSync(plan, PLAN({ oneDone: true }));
    const r = runTool(["--plan", plan]);
    expect(r.status).toBe(0);
    const draft = readFileSync(join(repo, ".local-artifacts", "batch-draft-1.md"), "utf8");
    expect(draft).toContain("<!-- readiness: ready -->"); // 1.1 done
    expect(draft.match(/readiness: hold/g)?.length).toBe(1); // 1.2 open (self-hold)
  });

  it("no-plan mode: everything unassigned with the summary line", () => {
    write("x.ts", "x\n");
    write("y.md", "y\n");
    const r = runTool([]);
    expect(r.status).toBe(0);
    expect(r.out).toContain("groups 0 · assigned 0 · unassigned 2 · conflicts 0");
    const draft = readFileSync(join(repo, ".local-artifacts", "batch-draft-1.md"), "utf8");
    expect(draft).toContain("<!-- unassigned: x.ts -->");
  });

  it("clean tree is a clean no-op", () => {
    const r = runTool([]);
    expect(r.status).toBe(0);
    expect(r.out).toContain("working tree is clean");
  });

  it("round-trip: a resolved draft parses under repo-stage's parser", async () => {
    writeFile("src/a.ts", "a\n");
    writeFile("loose.txt", "l\n");
    const plan = join(root, "plan.md");
    writeFileSync(plan, PLAN());
    runTool(["--plan", plan]);
    // resolve by hand: move loose.txt into group 1, drop parking comments
    const draftPath = join(repo, ".local-artifacts", "batch-draft-1.md");
    let text = readFileSync(draftPath, "utf8");
    text = text
      .replace("<!-- unassigned: loose.txt -->", "")
      .replace(/<!-- DRAFT ONLY[^\n]*-->\n?/g, "")
      .replace("- src/a.ts", "- src/a.ts\n- loose.txt")
      .replace(/\n{3,}/g, "\n\n");
    writeFileSync(draftPath, text);
    const { parseCommitBatch } = await import("../../lib/domain/commit-batch.ts");
    const parsed = parseCommitBatch(text);
    expect("errors" in parsed).toBe(false);
  });
});

