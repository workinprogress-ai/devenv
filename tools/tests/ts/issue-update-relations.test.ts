// Tests for 15.17 relation management: the blocked-by body-section
// convention (pure functions) and issue-update's --add-blocked-by /
// --remove-blocked-by flow over a stubbed provider.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { blockedByFrom, blockedByAdd, blockedByRemove } from "../../lib/domain/issues/relations.ts";

const TOOL = join(fileURLToPath(new URL(".", import.meta.url)), "../../ts/issue-update.ts");

// ---------------------------------------------------------------------------
// relations.ts (pure)
// ---------------------------------------------------------------------------

describe("blockedByFrom", () => {
  it("parses blocker numbers from the section", () => {
    const body = "Intro\n\n## Blocked by\nBlocked by #12\nBlocked by #7\n\n## Notes\nx";
    expect(blockedByFrom(body)).toEqual([12, 7]);
  });
  it("empty when no section", () => {
    expect(blockedByFrom("just text\n## Other\nBlocked by #12")).toEqual([]);
  });
  it("stops at the next heading (later mentions do not count)", () => {
    const body = "## Blocked by\nBlocked by #1\n## Notes\nBlocked by #2";
    expect(blockedByFrom(body)).toEqual([1]);
  });
});

describe("blockedByAdd", () => {
  it("creates the section when absent", () => {
    const out = blockedByAdd("Body text\n", [12]);
    expect(out).toContain("## Blocked by\nBlocked by #12");
    expect(blockedByFrom(out)).toEqual([12]);
  });
  it("appends to the existing section without duplicates", () => {
    const body = "## Blocked by\nBlocked by #12\n\n## Notes\nn";
    const out = blockedByAdd(body, [12, 7]);
    expect(blockedByFrom(out)).toEqual([12, 7]);
    expect(out.match(/Blocked by #12/g)?.length).toBe(1);
  });
  it("returns the body unchanged when everything is already listed", () => {
    const body = "## Blocked by\nBlocked by #12\n";
    expect(blockedByAdd(body, [12])).toBe(body);
  });
});

describe("blockedByRemove", () => {
  it("removes a listed blocker, keeps the rest", () => {
    const body = "## Blocked by\nBlocked by #12\nBlocked by #7\n";
    const out = blockedByRemove(body, [12]);
    expect(blockedByFrom(out)).toEqual([7]);
  });
  it("removes the whole section when the last blocker goes", () => {
    const body = "Intro\n\n## Blocked by\nBlocked by #12\n\nOutro";
    const out = blockedByRemove(body, [12]);
    expect(out).not.toContain("Blocked by");
    expect(out).not.toContain("## Blocked by");
    expect(out).toContain("Intro");
    expect(out).toContain("Outro");
  });
  it("absent blocker: body unchanged", () => {
    const body = "## Blocked by\nBlocked by #12\n";
    expect(blockedByRemove(body, [99])).toBe(body);
  });
});

// ---------------------------------------------------------------------------
// issue-update flow (stubbed gh)
// ---------------------------------------------------------------------------

let stubDir = "";
let repoRoot = "";

function installStubs(opts: { currentBody?: string } = {}): void {
  // The body answer must be a JSON string literal inside the stub — emit it
  // pre-serialized (bodies are single-line after newline escaping).
  const bodyAnswer = JSON.stringify(opts.currentBody ?? "Intro line\n");
  writeFileSync(
    join(stubDir, "gh"),
    [
      "#!/usr/bin/env bash",
      'printf \'%s\\n\' "gh $*" >> "__LOG__"',
      'if [ "$1 $2" = "auth status" ]; then exit 0; fi',
      'case "$*" in',
      '  *"repo view"*) echo \'{"name":"repo"}\';;',
      '  *"issue view"*"--json number"*) echo \'{"number":1}\';;',
      `  *"issue view"*body*) printf '{"body":%s}\\n' '${bodyAnswer}';;`,
      '  *"issue edit"*"--body-file"*)',
      '    # capture the stdin body for assertions',
      '    newbody=$(cat)',
      '    printf \'%s\\n\' "$newbody" >> "__BODY__"',
      '    ;;',
      "  *) ;;",
      "esac",
      "exit 0",
      "",
    ].join("\n").replaceAll("__LOG__", join(stubDir, "calls.log")).replaceAll("__BODY__", join(stubDir, "body.txt")),
    { mode: 0o755 },
  );
  writeFileSync(
    join(stubDir, "git"),
    [
      "#!/usr/bin/env bash",
      `if [ "$1" = "rev-parse" ]; then printf '%s\\n' "${repoRoot}"; exit 0; fi`,
      "exit 0",
      "",
    ].join("\n"),
    { mode: 0o755 },
  );
}

function runTool(args: string[]): { status: number; stdout: string; stderr: string; output: string } {
  const r = spawnSync("node", [TOOL, ...args], {
    encoding: "utf8",
    input: "",
    cwd: repoRoot,
    env: { ...process.env, PATH: `${stubDir}:${process.env.PATH ?? ""}`, DEVENV_REPO: "org/repo" },
  });
  return { status: r.status ?? 1, stdout: r.stdout ?? "", stderr: r.stderr ?? "", output: (r.stdout ?? "") + (r.stderr ?? "") };
}

function writtenBodies(): string[] {
  const p = join(stubDir, "body.txt");
  if (!existsSync(p)) return [];
  return readFileSync(p, "utf8").split("\n---\n").filter((x) => x !== "");
}

describe("issue-update blocked-by", () => {
  beforeEach(() => {
    stubDir = mkdtempSync(join(tmpdir(), "iub-stub-"));
    repoRoot = mkdtempSync(join(tmpdir(), "iub-repo-"));
    installStubs();
  });
  afterEach(() => {
    rmSync(stubDir, { recursive: true, force: true });
    rmSync(repoRoot, { recursive: true, force: true });
  });

  it("add-blocked-by writes the section into the body", () => {
    const r = runTool(["5", "--add-blocked-by", "12"]);
    expect(r.status).toBe(0);
    const bodies = writtenBodies();
    expect(bodies.length).toBe(1);
    expect(bodies[0]).toContain("## Blocked by");
    expect(blockedByFrom(bodies[0] ?? "")).toEqual([12]);
  });

  it("add is idempotent: an already-listed blocker issues no body write", () => {
    installStubs({ currentBody: "Intro\n\n## Blocked by\nBlocked by #12\n" });
    const r = runTool(["5", "--add-blocked-by", "12"]);
    expect(r.status).toBe(0);
    expect(writtenBodies().length).toBe(0);
  });

  it("remove of an absent blocker is a no-op success with no write", () => {
    const r = runTool(["5", "--remove-blocked-by", "99"]);
    expect(r.status).toBe(0);
    expect(writtenBodies().length).toBe(0);
  });

  it("remove of a listed blocker rewrites the body without it", () => {
    installStubs({ currentBody: "Intro\n\n## Blocked by\nBlocked by #12\nBlocked by #7\n" });
    const r = runTool(["5", "--remove-blocked-by", "12"]);
    expect(r.status).toBe(0);
    const bodies = writtenBodies();
    expect(bodies.length).toBe(1);
    expect(blockedByFrom(bodies[0] ?? "")).toEqual([7]);
  });

  it("a non-numeric blocker is a usage error before any call", () => {
    const r = runTool(["5", "--add-blocked-by", "abc"]);
    expect(r.status).toBe(2);
    expect(r.output).toContain("Invalid blocked-by reference: abc");
  });
});
