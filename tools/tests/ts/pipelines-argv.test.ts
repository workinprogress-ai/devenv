// Port of tools/tests/scripts/test_pipelines_argv.bats (3 tests).
// The gh argv the pipelines wrappers produce: the flags a user passes must
// reach gh, and the repository must be named exactly once.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const ROOT = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))));
const TOOLS = join(ROOT, "tools");

let TMP = "";
let GH_CALL_LOG = "";

beforeEach(() => {
  TMP = mkdtempSync(join(tmpdir(), `plargv-${Date.now()}-${Math.random().toString(36).slice(2)}`));
  GH_CALL_LOG = join(TMP, "gh.log");
  writeFileSync(GH_CALL_LOG, "");
  const bin = join(TMP, "bin");
  mkdirSync(bin, { recursive: true });
  writeFileSync(
    join(bin, "gh"),
    [
      "#!/usr/bin/env bash",
      'printf \'gh %s\\n\' "$*" >> "$GH_CALL_LOG"',
      '[ "$1" = auth ] && exit 0',
      "case \"$*\" in",
      '    *"--json url"*) echo "https://example.invalid/run/123" ;;',
      "esac",
      "exit 0",
      "",
    ].join("\n"),
  );
  spawnSync("chmod", ["+x", join(bin, "gh")]);
  // The helper's sandboxed config: github provider.
  const root = join(TMP, "devenv-root");
  mkdirSync(root, { recursive: true });
  writeFileSync(
    join(root, "devenv.config"),
    "[provider]\nname=github\n\n[organization]\nname=Test Organization\norg=test-org\nemail_domain=test.example.com\n\n[workflows]\nstatus_workflow=TBD,To-Groom,Ready,Implementing,Review,Merged,Staging,Production\n",
  );
});

const { DEVENV_REPO: _dr, ...procEnv } = process.env;

function runRerun(args: string[]): { status: number; out: string } {
  const r = spawnSync(join(TOOLS, "pipelines-rerun"), args, {
    encoding: "utf8",
    env: {
      ...procEnv,
      GH_CALL_LOG,
      DEVENV_REPO: "acme/widgets",
      DEVENV_ROOT: join(TMP, "devenv-root"),
      DEVENV_ROOT_SET: "1",
      PATH: `${join(TMP, "bin")}:${procEnv.PATH ?? ""}`,
    },
  });
  return { status: r.status ?? 1, out: (r.stdout ?? "") + (r.stderr ?? "") };
}

function rerunCall(): string {
  const log = spawnSync("cat", [GH_CALL_LOG], { encoding: "utf8" }).stdout ?? "";
  return log.split("\n").find((l) => l.includes("gh run rerun")) ?? "";
}

describe("scripts/pipelines-argv", () => {
  it("pipelines-rerun --failed --debug reaches gh run rerun", () => {
    const r = runRerun(["123", "--repo", "acme/widgets", "--failed", "--debug"]);
    expect(r.status).toBe(0);
    const call = rerunCall();
    expect(call).toContain("--failed");
    expect(call).toContain("-d");
  });

  it("pipelines-rerun names the repository once, not twice", () => {
    const r = runRerun(["123", "--repo", "acme/widgets", "--failed"]);
    expect(r.status).toBe(0);
    const call = rerunCall();
    expect(call.split("-R acme/widgets").length - 1).toBe(1);
  });

  it("pipelines-rerun without flags reruns the whole run", () => {
    const r = runRerun(["123", "--repo", "acme/widgets"]);
    expect(r.status).toBe(0);
    const call = rerunCall();
    expect(call).not.toContain("--failed");
  });
});
