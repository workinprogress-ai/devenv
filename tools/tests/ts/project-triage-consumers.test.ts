// Port of tools/tests/scripts/test_project_triage_consumers.bats (2 tests).
// Consumers that build or consume a repo spec and run under `set -u`:
// issue-triage (the milestone list targets the resolved repo, and the
// interactive menus read the terminal, not the issue list that is being
// iterated). The project-add-issue half of the source suite is covered by
// the TS port's own guard (see issue-triage.ts).
import { beforeEach, describe, expect, it, vi } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runTool as runHarness } from "./harness/index.ts";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const ROOT = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))));
const TOOLS = join(ROOT, "tools");

let TMP = "";

beforeEach(() => {
  TMP = mkdtempSync(join(tmpdir(), `triagec-${Date.now()}-${Math.random().toString(36).slice(2)}`));
  // The helper's sandboxed config: github provider.
  const root = join(TMP, "devenv-root");
  mkdirSync(root, { recursive: true });
  writeFileSync(
    join(root, "devenv.config"),
    "[provider]\nname=github\n\n[organization]\nname=Test Organization\norg=test-org\nemail_domain=test.example.com\n\n[workflows]\nstatus_workflow=TBD,To-Groom,Ready,Implementing,Review,Merged,Staging,Production\n",
  );
});

const { DEVENV_REPO: _dr, ...procEnv } = process.env;

describe("scripts/project-triage-consumers", () => {
  it("issue-triage: bundle edits target the resolved repo spec", () => {
    const bin = join(TMP, "bin");
    mkdirSync(bin, { recursive: true });
    writeFileSync(
      join(bin, "gh"),
      ['#!/usr/bin/env bash', 'echo "gh $*" >> "$TRIAGE_LOG"', "exit 0", ""].join("\n"),
    );
    // The bundle path runs the target-repo guard first; answer the toplevel
    // probe with a non-devenv directory so the run reaches the provider call.
    writeFileSync(
      join(bin, "git"),
      [
        "#!/usr/bin/env bash",
        '[ "$1" = "rev-parse" ] && { echo "$TRIAGE_FAKE_TOP"; exit 0; }',
        "exit 0",
        "",
      ].join("\n"),
    );
    spawnSync("chmod", ["+x", join(bin, "gh"), join(bin, "git")]);
    const triageLog = join(TMP, "gh-calls.log");
    writeFileSync(triageLog, "");
    const r = runHarness("issue-triage", ["42", "--milestone", "7"], {
      env: {
        ...procEnv,
        TRIAGE_LOG: triageLog,
        TRIAGE_FAKE_TOP: TMP,
        DEVENV_REPO: "my-proj/my-repo",
        DEVENV_ROOT: join(TMP, "devenv-root"),
        DEVENV_ROOT_SET: "1",
        PATH: `${bin}:${procEnv.PATH ?? ""}`,
      },
    });
    expect(r.status).toBe(0);
    const log = spawnSync("cat", [triageLog], { encoding: "utf8" }).stdout ?? "";
    expect(log).toContain("issue edit 42 -R my-proj/my-repo --milestone 7");
  });

  it("issue-triage: the interactive wizard is refused without a TTY", () => {
    const r = spawnSync("node", [join(TOOLS, "ts", "issue-triage.ts")], {
      input: "",
      encoding: "utf8",
      env: {
        ...procEnv,
        DEVENV_REPO: "my-proj/my-repo",
        DEVENV_ROOT: join(TMP, "devenv-root"),
        DEVENV_ROOT_SET: "1",
      },
    });
    expect(r.status).toBe(2);
    expect((r.stdout ?? "") + (r.stderr ?? "")).toContain("interactive terminal");
  });
});
