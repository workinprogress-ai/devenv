// Port of tools/tests/scripts/test_fork_sync_links.bats (4 tests) — one
// vitest `it` per source `@test`: fork-sync --link / --propose-links
// adoption-map wiring.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { toolScript } from "./harness/index.ts";
import { createForkFixtureTrio, git, scenarioPreChangeIdBacklog, type ForkFixture } from "./harness/fork-fixture.ts";

vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });

const ROOT = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))));
const TOOLS = join(ROOT, "tools");
const SCRIPT = toolScript("fork-sync");

let TMP = "";
let FX: ForkFixture | undefined;
let DEVENV_ROOT = "";

function fx(): ForkFixture {
  if (!FX) throw new Error("fixture not set up");
  return FX;
}

function runScript(args: string[], env: Record<string, string> = {}): { status: number; out: string } {
  const r = spawnSync("node", [SCRIPT, ...args], {
    cwd: FX ? FX.workingClone : process.cwd(),
    encoding: "utf8",
    env: { ...process.env, DEVENV_ROOT, DEVENV_ROOT_SET: "1", DEVENV_TOOLS: TOOLS, ...env },
  });
  return { status: r.status ?? 1, out: (r.stdout ?? "") + (r.stderr ?? "") };
}

function setupLinksFixture(): void {
  FX = createForkFixtureTrio(join(TMP, "fork-fixture"));
  git(fx().workingClone, ["remote", "add", "upstream", fx().upstream]);
  git(fx().workingClone, ["fetch", "-q", "upstream"]);
  DEVENV_ROOT = join(TMP, "config-root");
  mkdirSync(DEVENV_ROOT, { recursive: true });
  writeFileSync(join(DEVENV_ROOT, "devenv.config"), `[fork]\nupstream_repo=${fx().upstream}\nupstream_branch=master\n`);
}

/** The links lane's env legs (the bats setup exported these): the twin
 * repos for propose-links scanning and the upstream clone pointer. */
function linksEnv(): Record<string, string> {
  return {
    FORK_TWIN_LOCAL_REPO: fx().workingClone,
    FORK_TWIN_UPSTREAM_REPO: fx().ghClone,
    FORK_UPSTREAM_CLONE: fx().ghClone,
  };
}

beforeEach(() => {
  TMP = mkdtempSync(join(tmpdir(), `fklnk-${Date.now()}-${Math.random().toString(36).slice(2)}`));
});

describe("fork-sync links", () => {
  it("--link records an adoption pair", () => {
    setupLinksFixture();
    scenarioPreChangeIdBacklog(fx(), 2);
    const localL = git(fx().workingClone, ["log", "--format=%H", "--grep=backlog: pre-change-id commit 1", "-1"]).out.trim();
    spawnSync("bash", ["-c", `git -C '${fx().workingClone}' format-patch -1 --stdout '${localL}' | git -C '${fx().ghClone}' am -q`], { encoding: "utf8" });
    const localU = git(fx().ghClone, ["log", "--format=%H", "--grep=backlog: pre-change-id commit 1", "-1"]).out.trim();
    const r = runScript(["--link", localL, localU], linksEnv());
    if (r.status !== 0) console.log("LINK-OUT:", r.out);
    expect(r.status).toBe(0);
    expect(r.out).toContain("recorded adoption pair");
    const map = join(git(fx().workingClone, ["rev-parse", "--path-format=absolute", "--git-common-dir"]).out.trim(), "fork-adoption-map");
    expect(readFileSync(map, "utf8")).toContain(`${localL} ${localU}`);
  });

  it("--link=<sha> and --unlink=<sha> accept the attached form", () => {
    setupLinksFixture();
    scenarioPreChangeIdBacklog(fx(), 2);
    const localL = git(fx().workingClone, ["log", "--format=%H", "--grep=backlog: pre-change-id commit 1", "-1"]).out.trim();
    spawnSync("bash", ["-c", `git -C '${fx().workingClone}' format-patch -1 --stdout '${localL}' | git -C '${fx().ghClone}' am -q`], { encoding: "utf8" });
    const localU = git(fx().ghClone, ["log", "--format=%H", "--grep=backlog: pre-change-id commit 1", "-1"]).out.trim();
    const map = join(git(fx().workingClone, ["rev-parse", "--path-format=absolute", "--git-common-dir"]).out.trim(), "fork-adoption-map");
    const linked = runScript([`--link=${localL}`, localU], linksEnv());
    expect(linked.status, linked.out).toBe(0);
    expect(readFileSync(map, "utf8")).toContain(`${localL} ${localU}`);
    const unlinked = runScript([`--unlink=${localL}`], linksEnv());
    expect(unlinked.status, unlinked.out).toBe(0);
    expect(unlinked.out).toContain("removed adoption pair");
    expect(readFileSync(map, "utf8")).not.toContain(localL);
  });

  it("--propose-links (non-TTY) prints exact --link commands", () => {
    setupLinksFixture();
    scenarioPreChangeIdBacklog(fx(), 2);
    for (const n of [1, 2]) {
      const c = git(fx().workingClone, ["log", "--format=%H", "--grep", `backlog: pre-change-id commit ${n}`, "-1"]).out.trim();
      spawnSync("bash", ["-c", `git -C '${fx().workingClone}' format-patch -1 --stdout '${c}' | git -C '${fx().ghClone}' am -q`], { encoding: "utf8" });
    }
    const r = runScript(["--propose-links"], linksEnv());
    expect(r.status).toBe(0);
    expect(r.out).toContain("fork-sync --link");
    const l2 = git(fx().workingClone, ["log", "--format=%H", "--grep=backlog: pre-change-id commit 2", "-1"]).out.trim();
    const u2 = git(fx().ghClone, ["log", "--format=%H", "--grep=backlog: pre-change-id commit 2", "-1"]).out.trim();
    expect(r.out).toContain(`--link ${l2} ${u2}`);
  });

  it("--link refuses to combine with --replay", () => {
    setupLinksFixture();
    const r = runScript(["--link", "a", "b", "--replay"]);
    expect(r.status).not.toBe(0);
    expect(r.out).toContain("--link runs alone");
  });

  it("a repeated --link is misuse (exit 2), not a silently coerced value", () => {
    setupLinksFixture();
    const r = runScript(["--link", "A", "--link", "C", "B"]);
    expect(r.status, r.out).toBe(2);
    expect(r.out).toContain("--link may be given only once");
  });

  it("--link with a missing second value, an empty value or a stray extra argument is misuse (exit 2)", () => {
    setupLinksFixture();
    const missing = runScript(["--link", "A"]);
    expect(missing.status, missing.out).toBe(2);
    expect(missing.out).toContain("Missing value for --link");
    const empty = runScript(["--link", "", "B"]);
    expect(empty.status, empty.out).toBe(2);
    expect(empty.out).toContain("non-empty");
    const extra = runScript(["--link=A", "B", "extra"]);
    expect(extra.status, extra.out).toBe(2);
    expect(extra.out).toContain("unexpected argument");
  });

  it("--link A B with an explicit empty first value still refuses to combine with --replay", () => {
    setupLinksFixture();
    const r = runScript(["--link", "", "B", "--replay"]);
    expect(r.status, r.out).toBe(2);
  });

  it("--propose-links reports no candidates when nothing matches", () => {
    setupLinksFixture();
    const r = runScript(["--propose-links"], linksEnv());
    expect(r.status).toBe(0);
    expect(r.out).toContain("no adoption candidates");
  });
});
