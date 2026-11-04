// Port of test_rewrite_detect.bats (7 tests): tools/lib/rewrite-detect.bash —
// the shared rewrite classifier. All verdicts, the base-tip output, and the
// safety split (clean = HEAD is the past remote tip; diverged = HEAD has
// unique work).
import { beforeEach, describe, expect, it, vi } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const ROOT = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))));
const LIB = join(ROOT, "tools/lib/rewrite-detect.bash");

const IDENTITY = {
  GIT_AUTHOR_NAME: "t",
  GIT_AUTHOR_EMAIL: "t@example.test",
  GIT_COMMITTER_NAME: "t",
  GIT_COMMITTER_EMAIL: "t@example.test",
};
const env = { ...process.env, ...IDENTITY };

let TMP = "";
let ORIGIN = "";
let CLONE = "";

function git(args: string[], cwd: string, allowFail = false): string {
  const r = spawnSync("git", args, { cwd, encoding: "utf8", env });
  if (!allowFail && r.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${r.stderr ?? ""}`);
  return r.stdout ?? "";
}

// rewrite_origin: amend the tip on a second clone and force-push, so the
// first clone's origin/master is rewritten away from its HEAD. Sets OLD_TIP.
let OLD_TIP = "";
function rewriteOrigin(): void {
  const other = join(TMP, "rewriter");
  spawnSync("git", ["clone", "-q", ORIGIN, other], { encoding: "utf8", env });
  OLD_TIP = git(["rev-parse", "origin/master"], other).trim();
  git(["commit", "-q", "--allow-empty", "--amend", "-m", "rewritten base"], other);
  git(["push", "-q", "--force", "origin", "master"], other);
  git(["fetch", "-q", "origin"], CLONE);
}

function detectInClone(): string {
  const r = spawnSync("bash", ["-c", `source '${LIB}' && rewrite_detect_state master`], { cwd: CLONE, encoding: "utf8" });
  return (r.stdout ?? "").trim();
}

beforeEach(() => {
  TMP = mkdtempSync(join(tmpdir(), `rwrd-${Date.now()}-${Math.random().toString(36).slice(2)}`));
  ORIGIN = join(TMP, "origin.git");
  CLONE = join(TMP, "clone");
  spawnSync("git", ["init", "-q", "--bare", "-b", "master", ORIGIN]);
  spawnSync("git", ["clone", "-q", ORIGIN, CLONE], { encoding: "utf8", env });
  git(["commit", "-q", "--allow-empty", "-m", "base"], CLONE);
  git(["push", "-q", "origin", "master"], CLONE);
});

describe("rewrite-detect", () => {
  it("lib: not diverged (up to date) classifies none", () => {
    expect(detectInClone()).toBe("none");
  });

  it("lib: strictly behind classifies none (the caller's ordinary pull)", () => {
    const other = join(TMP, "ahead");
    spawnSync("git", ["clone", "-q", ORIGIN, other], { encoding: "utf8", env });
    git(["commit", "-q", "--allow-empty", "-m", "new upstream work"], other);
    git(["push", "-q", "origin", "master"], other);
    git(["fetch", "-q", "origin"], CLONE);
    expect(detectInClone()).toBe("none");
  });

  it("lib: strictly ahead classifies none (local-only work)", () => {
    git(["commit", "-q", "--allow-empty", "-m", "local only"], CLONE);
    expect(detectInClone()).toBe("none");
  });

  it("lib: rewritten remote + untouched clone classifies clean with the past tip", () => {
    rewriteOrigin();
    const out = detectInClone();
    const verdict = out.split(" ")[0] ?? "";
    const past = out.slice(out.indexOf(" ") + 1);
    expect(verdict).toBe("clean");
    expect(past).toBe(OLD_TIP);
  });

  it("lib: rewritten remote + unique local work classifies diverged with the base tip", () => {
    rewriteOrigin();
    git(["commit", "-q", "--allow-empty", "-m", "consumer note"], CLONE);
    const out = detectInClone();
    const verdict = out.split(" ")[0] ?? "";
    const past = out.slice(out.indexOf(" ") + 1);
    expect(verdict).toBe("diverged");
    expect(past).toBe(OLD_TIP);
  });

  it("lib: ordinary divergence (no rewrite on record) classifies none", () => {
    // Diverged without any rewrite: the remote moved forward past local work,
    // merged by a third party — a plain merge/rebase situation, not a reset.
    const third = join(TMP, "third");
    spawnSync("git", ["clone", "-q", ORIGIN, third], { encoding: "utf8", env });
    git(["commit", "-q", "--allow-empty", "-m", "local line"], CLONE);
    git(["commit", "-q", "--allow-empty", "-m", "remote line"], third);
    git(["push", "-q", "origin", "master"], third);
    git(["fetch", "-q", "origin"], CLONE);
    expect(detectInClone()).toBe("none");
  });

  it("lib: sourcing twice is a no-op (guard)", () => {
    const r = spawnSync("bash", ["-c", `source '${LIB}' && source '${LIB}' && rewrite_detect_state master`], { cwd: CLONE, encoding: "utf8" });
    expect((r.stdout ?? "").trim()).not.toBe("");
  });
});
