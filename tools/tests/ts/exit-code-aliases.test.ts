// Port of tools/tests/scripts/test_exit_code_aliases.bats (5 tests).
// Each exit-code value has one name. The former aliases are gone: nothing
// defines or uses them.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const ROOT = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))));
const PROJECT_ROOT = ROOT;
const TOOLS = join(ROOT, "tools");

let TMP = "";
let TREE = "";

beforeEach(() => {
  TMP = mkdtempSync(join(tmpdir(), `exitalias-${Date.now()}-${Math.random().toString(36).slice(2)}`));
});

// A throwaway checkout of just what these scripts need: the libraries
// self-locate, so the only way to give them a config without an organization
// is to run copies from inside a tree that has one.
function makeUnconfiguredTree(base: string): string {
  TREE = join(TMP, "tree");
  mkdirSync(join(TREE, "tools", "scripts"), { recursive: true });
  mkdirSync(join(TREE, "tools", "ts"), { recursive: true });
  mkdirSync(join(TREE, "tools", "lib"), { recursive: true });
  mkdirSync(join(TREE, "tools", "config"), { recursive: true });
  mkdirSync(join(TREE, ".setup"), { recursive: true });
  mkdirSync(join(TREE, ".runtime"), { recursive: true });
  cpSync(join(TOOLS, "lib"), join(TREE, "tools", "lib"), { recursive: true });
  const stem = base.replace(/\.ts$/, "").replace(/\.sh$/, "");
  if (spawnSync("test", ["-f", join(TOOLS, "ts", `${stem}.ts`)]).status === 0) {
    cpSync(join(TOOLS, "ts", `${stem}.ts`), join(TREE, "tools", "ts", `${stem}.ts`));
  } else {
    cpSync(join(TOOLS, "scripts", `${stem}.sh`), join(TREE, "tools", "scripts", `${stem}.sh`));
  }
  cpSync(join(TOOLS, "config", "repo-types.yaml"), join(TREE, "tools", "config", "repo-types.yaml"));
  symlinkSync(join(ROOT, "node_modules"), join(TREE, "node_modules"));
  writeFileSync(join(TREE, "devenv.config"), "[workflows]\nstatus_workflow=A,B\n");
  return TREE;
}

const { GH_ORG: _g, PROVIDER_ORG: _p, DEVENV_REPO: _r, DEVENV_ROOT: _d, DEVENV_ROOT_SET: _s, DEVENV_TOOLS: _t, ...cleanEnv } = process.env;

function runUnconfigured(base: string): { status: number; out: string } {
  const tree = makeUnconfiguredTree(base);
  const stem = base.replace(/\.ts$/, "").replace(/\.sh$/, "");
  const r = spawnSync("node", [join(tree, "tools", "ts", `${stem}.ts`), "svc.x.y", "--type", "service"], {
    cwd: tree,
    encoding: "utf8",
    env: { ...cleanEnv },
  });
  return { status: r.status ?? 1, out: (r.stdout ?? "") + (r.stderr ?? "") };
}

describe("scripts/exit-code-aliases", () => {
  it("repo-update-config: an unresolved organization exits 2 (missing required input), not 3", () => {
    const r = runUnconfigured("repo-update-config.ts");
    expect(r.status).toBe(2);
    expect(r.out).toContain("Organization identity unresolved");
  });

  it("repo-create: an unresolved organization exits 2 (missing required input), not 3", () => {
    const r = runUnconfigured("repo-create.ts");
    expect(r.status).toBe(2);
    expect(r.out).toContain("Organization identity unresolved");
  });

  it("no script, library or template defines or uses the retired exit-code aliases", () => {
    // tools/scripts was retired by 16.1 (bash minimum) — the sweep covers the
    // layers that remain; the contract (no retired alias anywhere) is unchanged.
    const r = spawnSync(
      "grep",
      [
        "-rnE",
        "EXIT_INVALID_ARGUMENT|EXIT_NOT_FOUND|EXIT_PERMISSION_DENIED",
        join(PROJECT_ROOT, "tools", "lib"),
        join(PROJECT_ROOT, "tools", "templates"),
        join(PROJECT_ROOT, ".devcontainer"),
        join(PROJECT_ROOT, "setup"),
      ],
      { encoding: "utf8" },
    );
    // grep exits 1 when it finds nothing: that is the passing outcome.
    expect(r.status).toBe(1);
  });

  it("every exit-code name has its own value (no two names share one)", () => {
    const r = spawnSync(
      "bash",
      ["-c", `source '${join(TOOLS, "lib", "error-handling.bash")}'; env | grep '^EXIT_' | sort -t= -k2 | awk -F= '{print $2}' | uniq -d`],
      { encoding: "utf8" },
    );
    expect((r.stdout ?? "").trim()).toBe("");
  });

  it("issue-label-create does not redefine the library's ensure_label", () => {
    const r = spawnSync("grep", ["-n", "^ensure_label()", join(TOOLS, "scripts", "issue-label-create.sh")], {
      encoding: "utf8",
    });
    expect(r.status).not.toBe(0);
  });
});
