// Black-box tests for repo-stage against real temp git repos: every batch
// refusal row, path/unstage modes, dry-run no-mutation, deleted-file
// staging, rename-pair coverage, the staged-and-manifested allowance, and
// the happy group-staging path with stat echo. Real git, no PATH stubbing.
// Each test gets a FRESH repo (beforeEach) — the validators read the whole
// live tree, so state leaking between tests would be read as real findings.
// The manifest fixture lives OUTSIDE the worktree: an in-tree manifest is
// itself untracked and coverage (correctly) demands it be claimed.
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const TOOL = join(fileURLToPath(new URL(".", import.meta.url)), "../../ts/repo-stage.ts");

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

/** The manifest lives outside the worktree (root of the temp fixture). */
function manifest(name: string, body: string): string {
  const p = join(root, name);
  writeFileSync(p, body);
  return p;
}

function runTool(args: string[]): { status: number; out: string } {
  const r = spawnSync("node", [TOOL, ...args], { encoding: "utf8", cwd: repo, env: process.env });
  return { status: r.status ?? 1, out: (r.stdout ?? "") + (r.stderr ?? "") };
}

function status(): string {
  return git("status", "--porcelain");
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "repo-stage-test-"));
  repo = join(root, "repo");
  spawnSync("git", ["init", "-q", "-b", "master", repo], { encoding: "utf8" });
  git("config", "user.email", "t@example.com");
  git("config", "user.name", "T");
  write("seed.txt", "seed\n");
  git("add", "--", "seed.txt");
  git("commit", "-q", "--no-verify", "-m", "seed");
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

const GOOD = () => `# Commit batch: t

## group 1 — feat: first
- a.txt
- src/b.ts

## group 2 — fix: second
- c.md

## excluded
- skip.txt
`;

function goodTree(): void {
  mkdirSync(join(repo, "src"), { recursive: true });
  write("a.txt", "a\n");
  write("src/b.ts", "b\n");
  write("c.md", "c\n");
  write("skip.txt", "s\n");
}

describe("repo-stage path mode", () => {
  it("stages exactly the named literal paths", () => {
    write("p1.txt", "1\n");
    write("p2.txt", "2\n");
    const r = runTool(["p1.txt"]);
    expect(r.status).toBe(0);
    expect(status()).toContain("A  p1.txt");
    expect(status()).toContain("?? p2.txt");
  });

  it("unstages paths (--unstage round-trip)", () => {
    write("p1.txt", "1\n");
    git("add", "--", "p1.txt");
    const r = runTool(["--unstage", "p1.txt"]);
    expect(r.status).toBe(0);
    expect(status()).toContain("?? p1.txt");
  });

  it("refuses globs, traversal, absolute paths, and directories", () => {
    write("x.txt", "x\n");
    for (const bad of ["*.txt", "../evil.txt", "/etc/passwd"]) {
      const r = runTool([bad]);
      expect(r.status).not.toBe(0);
      expect(r.out).toContain("not a literal repo-root-relative file path");
    }
    mkdirSync(join(repo, "adir"), { recursive: true });
    const r = runTool(["adir"]);
    expect(r.status).not.toBe(0);
    expect(r.out).toContain("is a directory");
  });

  it("refuses a path that exists nowhere (typo catcher)", () => {
    const r = runTool(["nope-does-not-exist.txt"]);
    expect(r.status).not.toBe(0);
    expect(r.out).toContain("exists neither on disk nor as a changed/deleted file");
  });

  it("stages a deleted file (deletion-aware existence)", () => {
    write("doomed.txt", "d\n");
    git("add", "--", "doomed.txt");
    git("commit", "-q", "--no-verify", "-m", "doomed");
    rmSync(join(repo, "doomed.txt"));
    const r = runTool(["doomed.txt"]);
    expect(r.status).toBe(0);
    expect(status()).toContain("D  doomed.txt");
  });

  it("dry-run mutates nothing", () => {
    write("dry.txt", "d\n");
    const before = status();
    const r = runTool(["--dry-run", "dry.txt"]);
    expect(r.status).toBe(0);
    expect(r.out).toContain("would stage");
    expect(status()).toBe(before);
  });

  it("from a subdirectory, paths are repo-root-relative (stages the right file)", () => {
    mkdirSync(join(repo, "sub"), { recursive: true });
    mkdirSync(join(repo, "sub", "src"), { recursive: true });
    // both a root src/x.txt and a sub/src/x.txt exist — the named path
    // must resolve against the REPO ROOT, never the cwd
    mkdirSync(join(repo, "src"), { recursive: true });
    write("src/x.txt", "root\n");
    write("sub/src/x.txt", "wrong\n");
    const r = spawnSync("node", [TOOL, "src/x.txt"], { encoding: "utf8", cwd: join(repo, "sub"), env: process.env });
    expect(r.status).toBe(0);
    expect(status()).toContain("A  src/x.txt");
    expect(status()).not.toContain("sub/src/x.txt");
  });
});

describe("repo-stage batch mode", () => {
  it("summary mode validates and lists groups without staging", () => {
    goodTree();
    const m = manifest("good.md", GOOD());
    const r = runTool(["--batch", m]);
    expect(r.status).toBe(0);
    expect(r.out).toContain("batch ok: 2 group(s)");
    expect(r.out).toContain("group 1/2");
    expect(status()).not.toContain("A ");
  });

  it("stages group N with stat echo and remaining count", () => {
    goodTree();
    const m = manifest("good2.md", GOOD());
    const r = runTool(["--batch", m, "--group", "1"]);
    expect(r.status).toBe(0);
    expect(r.out).toContain("staged group 1/2 · 2 file(s)");
    expect(r.out).toContain("suggested: feat: first");
    expect(r.out).toContain("1 group(s) remain");
    expect(status()).toContain("A  a.txt");
    expect(status()).toContain("A  src/b.ts");
  });

  it("refuses an unclaimed changed file (coverage)", () => {
    goodTree();
    write("orphan.txt", "o\n");
    const m = manifest("cov.md", GOOD());
    const r = runTool(["--batch", m]);
    expect(r.status).not.toBe(0);
    expect(r.out).toContain("coverage: 'orphan.txt' is changed but claimed by no group");
  });

  it("coverage self-heals once a file is committed (groups may be empty)", () => {
    write("g1a.txt", "x\n");
    write("g2a.txt", "y\n");
    git("add", "--", "g1a.txt");
    git("commit", "-q", "--no-verify", "-m", "g1");
    const m = manifest(
      "heal.md",
      `# Commit batch: t

## group 1 — feat: done

## group 2 — feat: more
- g2a.txt
`,
    );
    const r = runTool(["--batch", m, "--group", "2"]);
    expect(r.status).toBe(0);
    expect(status()).toContain("A  g2a.txt");
  });

  it("refuses duplicate membership, naming both sections", () => {
    write("dup.txt", "d\n");
    write("skip.txt", "s\n");
    const m = manifest(
      "dup.md",
      `# Commit batch: t

## group 1 — a
- dup.txt

## group 2 — b
- dup.txt

## excluded
- skip.txt
`,
    );
    const r = runTool(["--batch", m]);
    expect(r.status).not.toBe(0);
    expect(r.out).toContain("'dup.txt' appears in both group 1 and group 2");
  });

  it("refuses a path claimed but nonexistent (typo in manifest)", () => {
    write("real.txt", "r\n");
    write("skip.txt", "s\n");
    const m = manifest(
      "typo.md",
      `# Commit batch: t

## group 1 — a
- real.txt
- rael.txt

## excluded
- skip.txt
`,
    );
    const r = runTool(["--batch", m]);
    expect(r.status).not.toBe(0);
    expect(r.out).toContain("'rael.txt' exists neither on disk nor as a changed/deleted file");
  });

  it("refuses staged content outside the manifest (index purity)", () => {
    goodTree();
    write("stray.txt", "s\n");
    git("add", "--", "stray.txt");
    const m = manifest("pure.md", GOOD());
    const r = runTool(["--batch", m]);
    expect(r.status).not.toBe(0);
    // a staged unmanifested file trips BOTH coverage (it is changed) and
    // index purity (it is staged) — either message proves the refusal
    expect(
      r.out.includes("index: 'stray.txt' is staged but not in the batch") ||
        r.out.includes("coverage: 'stray.txt' is changed but claimed by no group"),
    ).toBe(true);
  });

  it("allows staged content that IS in the manifest (stage-several orderings)", () => {
    write("a2.txt", "a\n");
    write("skip.txt", "s\n");
    const m = manifest(
      "allow.md",
      `# Commit batch: t

## group 1 — a
- a2.txt

## excluded
- skip.txt
`,
    );
    git("add", "--", "a2.txt"); // pre-staged but manifested: allowed
    const r = runTool(["--batch", m, "--group", "1"]);
    expect(r.status).toBe(0);
    expect(status()).toContain("A  a2.txt");
  });

  it("covers rename pairs: both old and new paths must be claimed", () => {
    write("oldname.txt", "o\n");
    write("skip.txt", "s\n");
    git("add", "--", "oldname.txt");
    git("commit", "-q", "--no-verify", "-m", "oldname");
    git("mv", "oldname.txt", "newname.txt");
    const m = manifest(
      "ren1.md",
      `# Commit batch: t

## group 1 — r
- newname.txt

## excluded
- skip.txt
`,
    );
    const bad = runTool(["--batch", m]);
    expect(bad.status).not.toBe(0);
    expect(bad.out).toContain("'oldname.txt' is changed but claimed by no group");
    const m2 = manifest(
      "ren2.md",
      `# Commit batch: t

## group 1 — r
- newname.txt
- oldname.txt

## excluded
- skip.txt
`,
    );
    const good = runTool(["--batch", m2, "--group", "1"]);
    expect(good.status).toBe(0);
  });

  it("dry-run validates fully but stages nothing", () => {
    goodTree();
    const m = manifest("good3.md", GOOD());
    const before = status();
    const r = runTool(["--batch", m, "--group", "1", "--dry-run"]);
    expect(r.status).toBe(0);
    expect(r.out).toContain("dry-run: would stage");
    expect(status()).toBe(before);
  });

  it("refuses a malformed manifest (unknown construct) with the line named", () => {
    goodTree();
    const m = manifest(
      "bad.md",
      `# Commit batch: t

## group 1 — a
- a.txt
some random prose line

## excluded
- skip.txt
`,
    );
    const r = runTool(["--batch", m]);
    expect(r.status).not.toBe(0);
    expect(r.out).toContain("unrecognized line");
    expect(r.out).toContain("line 5");
  });

  it("refuses a directory entry in the manifest (embedded-repo gitlink guard)", () => {
    goodTree();
    mkdirSync(join(repo, "dummy"), { recursive: true });
    const m = manifest(
      "dir.md",
      `# Commit batch: t

## group 1 — a
- a.txt
- dummy/

## excluded
- skip.txt
`,
    );
    const r = runTool(["--batch", m]);
    expect(r.status).not.toBe(0);
    expect(r.out).toContain("dummy/");
    expect(r.out).toContain("batch entries are files only");
  });

  it("refuses --group beyond the batch", () => {
    goodTree();
    const m = manifest("good4.md", GOOD());
    const r = runTool(["--batch", m, "--group", "9"]);
    expect(r.status).not.toBe(0);
    expect(r.out).toContain("group 9 not in batch");
  });
});
