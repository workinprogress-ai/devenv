// Hook output must reach the terminal while the commit is still running: the
// pre-commit gate (the full test suite on this repo) takes minutes, and a
// captured, replayed-at-exit stderr looks like a hang. Each lane runs the tool
// under a pty with a slow pre-commit hook and asserts the hook's first line
// arrived well before the tool exited. Real git in throwaway fixture repos.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { chmodSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  createRepoCommitHarness,
  harnessGit,
  harnessRunToolTimed,
  harnessSeedCommit,
  harnessSetEditorMode,
  harnessStageFile,
  type Harness,
  type TimedRun,
} from "./harness/repo-commit.ts";

const HOOK_SLEEP_SECONDS = 3;
// The first hook line must land at least this long before exit; the hook
// sleeps HOOK_SLEEP_SECONDS after printing it.
const MIN_LEAD_MS = 1500;

let h: Harness;

beforeEach(() => {
  h = createRepoCommitHarness({ bareRemote: true, seed: { subject: "chore: base", file: "base.txt" } });
  harnessGit(h, "push", "-q", "origin", "master");
  harnessSetEditorMode(h, "save");
  const hook = join(h.repo, ".git", "hooks", "pre-commit");
  writeFileSync(hook, `#!/bin/sh\necho HOOK-FIRST-LINE >&2\nsleep ${HOOK_SLEEP_SECONDS}\necho HOOK-LAST-LINE >&2\nexit 0\n`);
  chmodSync(hook, 0o755);
});

afterEach(() => h.dispose());

function firstArrival(r: TimedRun, needle: string): number {
  const chunk = r.chunks.find((c) => c.text.includes(needle));
  if (chunk === undefined) throw new Error(`"${needle}" never appeared in output:\n${r.out}`);
  return chunk.at;
}

function expectStreamed(r: TimedRun): void {
  expect(r.status).toBe(0);
  expect(r.out).toContain("HOOK-LAST-LINE");
  expect(r.endedAt - firstArrival(r, "HOOK-FIRST-LINE")).toBeGreaterThanOrEqual(MIN_LEAD_MS);
}

describe("repo-commit streams hook output while the commit runs", () => {
  it("normal lane", async () => {
    harnessStageFile(h, "a.txt", "a\n");
    expectStreamed(await harnessRunToolTimed(h, ["feat: add a"]));
  });

  it("--amend lane", async () => {
    harnessSeedCommit(h, "feat: unpushed work", "work.txt");
    harnessStageFile(h, "extra.txt", "e\n");
    expectStreamed(await harnessRunToolTimed(h, ["--amend"]));
  });

  it("--reword lane", async () => {
    harnessSeedCommit(h, "feat: second", "b.txt");
    harnessSeedCommit(h, "feat: third", "c.txt");
    expectStreamed(await harnessRunToolTimed(h, ["--reword", "HEAD~1"]));
  });

  it("--fix lane", async () => {
    const second = harnessSeedCommit(h, "feat: second", "b.txt");
    harnessSeedCommit(h, "feat: third", "c.txt");
    harnessStageFile(h, "b.txt", "changed\n");
    expectStreamed(await harnessRunToolTimed(h, ["--fix", second], { env: { GIT_SEQUENCE_EDITOR: ":" } }));
  });
});
