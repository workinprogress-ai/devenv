// Port of tools/tests/scripts/test_pr_management.bats (behavioral subset).
// Misuse refusals across the pr tool family, the thread-tool devenv gate,
// cursor first-page shape, and the source contracts (exit-codes/facade).
// The syntax/--help/source-grep boilerplate is superseded by tsc + per-tool
// vitest suites (16.11).
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runTool as runHarness } from "./harness/index.ts";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const ROOT = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))));
const TOOLS = join(ROOT, "tools");
const TS = join(TOOLS, "ts");

let TMP = "";

beforeEach(() => {
  TMP = mkdtempSync(join(tmpdir(), `prmgmt-${Date.now()}-${Math.random().toString(36).slice(2)}`));
});

afterEach(() => {
  rmSync(TMP, { recursive: true, force: true });
});

function node(args: string[], extra: Record<string, string> = {}, cwd?: string, input = ""): { status: number; out: string } {
  // args[0] is the ts file name; the harness takes the bare tool name.
  const name = args[0]?.replace(/\.ts$/, "") ?? "unknown";
  const r = runHarness(name, args.slice(1), {
    cwd,
    stdin: input,
    env: { ...extra },
  });
  return { status: r.status, out: r.output };
}

function srcHas(rel: string, pattern: string): boolean {
  return spawnSync("grep", ["-qE", pattern, join(TS, rel)]).status === 0;
}

// Thread-tool devenv gate fixture: a directory that looks like the devenv
// repo (name + bootstrap marker), not below a repos/ parent.
function fakeDevenvDir(): string {
  const fake = join(TMP, "devenv");
  mkdirSync(join(fake, ".devcontainer"), { recursive: true });
  writeFileSync(join(fake, ".devcontainer", "bootstrap.sh"), "");
  spawnSync("git", ["init", "-q", fake]);
  return fake;
}

describe("pr management family (behavioral port)", () => {
  it("pr-get rejects non-numeric PR number", () => {
    expect(node(["pr-get.ts", "abc"]).status).not.toBe(0);
  });

  it("pr-comment rejects missing comment source", () => {
    // Closed stdin: no --body/--body-file and no piped body is a misuse failure.
    expect(node(["pr-comment.ts", "1"], {}, undefined, "").status).not.toBe(0);
  });

  it("pr-diff rejects mixing PR and ref modes", () => {
    expect(node(["pr-diff.ts", "1", "--base", "master", "--head", "feature"]).status).not.toBe(0);
  });

  it("pr-threads-get rejects non-numeric PR number", () => {
    expect(node(["pr-threads-get.ts", "abc"]).status).not.toBe(0);
  });

  it("pr-threads-get rejects missing PR number", () => {
    expect(node(["pr-threads-get.ts"]).status).not.toBe(0);
  });

  it("pr-threads-get rejects unknown option", () => {
    expect(node(["pr-threads-get.ts", "123", "--not-a-flag"]).status).not.toBe(0);
  });

  it("pr-threads-get does not send string null cursor on first page", () => {
    const bin = join(TMP, "bin");
    mkdirSync(bin, { recursive: true });
    const log = join(TMP, "gh.log");
    writeFileSync(log, "");
    writeFileSync(
      join(bin, "gh"),
      [
        "#!/usr/bin/env bash",
        `echo "gh $*" >> "${log}"`,
        '[ "$1" = auth ] && exit 0',
        'if [[ "$*" == *graphql* ]]; then',
        `  echo '{"data":{"repository":{"pullRequest":{"reviewThreads":{"pageInfo":{"hasNextPage":false,"endCursor":null},"nodes":[]}}}}}'`,
        "  exit 0",
        "fi",
        "exit 0",
        "",
      ].join("\n"),
    );
    spawnSync("chmod", ["+x", join(bin, "gh")]);
    // checkTargetRepo requires a real git repo (git rev-parse must pass).
    const repo = join(TMP, "repo");
    spawnSync("git", ["init", "-q", repo]);
    const r = spawnSync("node", [join(TS, "pr-threads-get.ts"), "123"], {
      encoding: "utf8",
      cwd: repo,
      env: {
        ...process.env,
        DEVENV_REPO: "workinprogress-ai/example-repo",
        STUB_CALL_LOG: log,
        PATH: `${bin}:${process.env.PATH ?? ""}`,
        GIT_TERMINAL_PROMPT: "0",
      },
    });
    expect(r.status).toBe(0);
    const calls = (spawnSync("grep", ["graphql", log], { encoding: "utf8" }).stdout ?? "");
    expect(calls).not.toContain("cursor=null");
    expect(calls).not.toContain('cursor="null"');
  });

  it("pr-thread-reply rejects missing comment-id", () => {
    expect(node(["pr-thread-reply.ts", "123", "--body", "hi"]).status).not.toBe(0);
  });

  it("pr-thread-reply rejects missing body source", () => {
    expect(node(["pr-thread-reply.ts", "123", "--comment-id", "456"], {}, undefined, "").status).not.toBe(0);
  });

  it("pr-thread-resolve rejects missing thread ID", () => {
    expect(node(["pr-thread-resolve.ts"]).status).not.toBe(0);
  });

  it("new pr-thread scripts use the core error contract and the facade", () => {
    for (const script of ["pr-threads-get.ts", "pr-thread-reply.ts", "pr-thread-resolve.ts"]) {
      expect(srcHas(script, "core/exit-codes.ts"), script).toBe(true);
    }
    expect(srcHas("pr-threads-get.ts", "prsThreadsPage")).toBe(true);
    expect(srcHas("pr-thread-reply.ts", "prsThreadReply")).toBe(true);
    expect(srcHas("pr-thread-resolve.ts", "prsThreadResolve")).toBe(true);
  });

  it("pr scripts use the core error contract", () => {
    expect(srcHas("pr-get.ts", "core/exit-codes")).toBe(true);
    expect(srcHas("pr-comment.ts", "core/exit-codes")).toBe(true);
    expect(srcHas("pr-diff.ts", "core/exit-codes")).toBe(true);
  });

  it("pr scripts source the provider facade", () => {
    expect(srcHas("pr-get.ts", "provider-core|facade")).toBe(true);
    expect(srcHas("pr-diff.ts", "provider-core|facade|prsDiff")).toBe(true);
  });

  it("pr-diff carries the facade import (the TS port's dispatch)", () => {
    expect(srcHas("pr-diff.ts", "facade|prsDiff")).toBe(true);
  });

  it("thread tools refuse the devenv repo as an implicit target", () => {
    const fake = fakeDevenvDir();
    const bin = join(TMP, "bin");
    mkdirSync(bin, { recursive: true });
    writeFileSync(join(bin, "gh"), "#!/usr/bin/env bash\nexit 0\n");
    spawnSync("chmod", ["+x", join(bin, "gh")]);
    const cases = [
      "pr-threads-get.ts 1",
      "pr-thread-reply.ts 1 --comment-id 2 --body x",
      "pr-thread-resolve.ts abc123",
      "pr-review-comment.ts 1 --file a.ts --line 1 --body x",
    ];
    for (const cmd of cases) {
      const r = spawnSync("bash", ["-c", `cd '${fake}' && node '${join(TS)}'/${cmd}`], {
        input: "",
        encoding: "utf8",
        env: {
          ...process.env,
          HOME: TMP,
          PATH: `${bin}:${process.env.PATH ?? ""}`,
          GIT_TERMINAL_PROMPT: "0",
        },
      });
      const out = (r.stdout ?? "") + (r.stderr ?? "");
      expect(r.status, `${cmd}: expected gate refusal`).not.toBe(0);
      expect(out, `${cmd}: gate message`).toContain("devenv repository itself");
    }
    // --devenv exempts: the run proceeds past the gate (fails later on the
    // missing provider auth, never with the gate message).
    const r = spawnSync("bash", ["-c", `cd '${fake}' && node '${join(TS)}'/pr-thread-resolve.ts abc123 --devenv`], {
      input: "",
      encoding: "utf8",
      env: {
        ...process.env,
        HOME: TMP,
        PATH: `${bin}:${process.env.PATH ?? ""}`,
        GIT_TERMINAL_PROMPT: "0",
      },
    });
    const out = (r.stdout ?? "") + (r.stderr ?? "");
    expect(r.status).not.toBe(0);
    expect(out).not.toContain("devenv repository itself");
  });

  it("pr-list rejects invalid state", () => {
    expect(node(["pr-list.ts", "--state", "bogus"]).status).not.toBe(0);
  });

  it("pr-list rejects non-numeric limit", () => {
    expect(node(["pr-list.ts", "--limit", "abc"]).status).not.toBe(0);
  });
});
