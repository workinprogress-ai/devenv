// Without a terminal, repo-commit accepts exactly one human gate: a VS Code
// tab opened by the user's own git-config editor (`core.editor = code --wait`)
// through the real remote-cli found by absolute path under ~/.vscode-server.
// Env-supplied editors, any other core.editor, a missing VS Code session, a
// missing remote-cli, and a `code` planted on PATH all keep today's refusal.
// Real git in throwaway fixture repos; the remote-cli is a stub under a fake
// HOME, so no real VS Code window is ever opened.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { chmodSync, existsSync, mkdirSync, readFileSync, utimesSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { installChangeIdHook } from "./harness/fork-fixture.ts";
import {
  claimCommitApprovalRequest,
  commitApprovalDirectory,
  commitApprovalDigest,
  commitApprovalFileIsOwnerOnly,
  commitApprovalNeedsBroker,
  createCommitApprovalRequest,
  readCommitApprovalRequest,
  verifyCommitApproval,
  writeCommitApprovalRequest,
  type CommitApprovalIdentity,
  type CommitApprovalRequest,
  type CommitApprovalResponse,
} from "../../lib/core/commit-approval.ts";
import {
  createRepoCommitHarness,
  harnessGit,
  harnessHeadCount,
  harnessHeadSubject,
  harnessRunTool,
  harnessSeedCommit,
  harnessStageFile,
  type Harness,
} from "./harness/repo-commit.ts";

/** The workspace's tools/ (holds the real prepare-commit-msg hook body). */
const TOOLS = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

let h: Harness;
let home: string;

const HASH_A = "a".repeat(40);
const HASH_B = "b".repeat(40);

beforeEach(() => {
  h = createRepoCommitHarness({ seed: { subject: "chore: base", file: "base.txt" } });
  home = join(h.root, "home");
  harnessGit(h, "config", "core.editor", "code --wait");
  harnessStageFile(h, "a.txt", "a\n");
});

afterEach(() => h.dispose());

/** A stub remote-cli under the fake HOME: records its argv and the server
 * hash it belongs to, answers --version, and saves or empties the message. */
function stubRemoteCli(hash: string, log = join(h.root, "remote-cli.log")): string {
  const dir = join(home, ".vscode-server", "bin", hash, "bin", "remote-cli");
  mkdirSync(dir, { recursive: true });
  const bin = join(dir, "code");
  writeFileSync(
    bin,
    `#!/bin/sh
if [ "$1" = "--version" ]; then echo 1.0.0; exit 0; fi
echo "${hash} $*" >> '${log}'
for last; do :; done
if [ "$STUB_MODE" = "empty" ]; then : > "$last"; fi
exit 0
`,
  );
  chmodSync(bin, 0o755);
  return log;
}

function stubLog(log = join(h.root, "remote-cli.log")): string {
  return existsSync(log) ? readFileSync(log, "utf8") : "";
}

function run(env: Record<string, string> = {}, extra: Record<string, string> = {}): { status: number; out: string } {
  return harnessRunTool(h, ["feat: add a"], {
    noTty: true,
    envEditor: "",
    env: { HOME: home, VSCODE_IPC_HOOK_CLI: join(h.root, "vscode.sock"), ...env, ...extra },
  });
}

describe("no-TTY lane: accepted", () => {
  it("opens the VS Code remote-cli by absolute path and commits when the message is saved", () => {
    stubRemoteCli(HASH_A);
    const before = harnessHeadCount(h);

    const r = run();

    expect(r.status).toBe(0);
    expect(r.out).toContain("commit created");
    expect(harnessHeadCount(h)).toBe(before + 1);
    expect(stubLog()).toMatch(new RegExp(`^${HASH_A} --wait .+`));
  });

  it("an emptied message cancels the commit", () => {
    stubRemoteCli(HASH_A);
    const before = harnessHeadCount(h);

    const r = run({ STUB_MODE: "empty" });

    expect(r.status).not.toBe(0);
    expect(r.out).toContain("commit did not complete");
    expect(harnessHeadCount(h)).toBe(before);
  });

  it("uses the server hash VSCODE_CWD names when several servers exist", () => {
    const log = stubRemoteCli(HASH_A);
    stubRemoteCli(HASH_B, log);
    // make A the newer one, so a pick-newest rule would choose it
    const later = new Date(Date.now() + 60_000);
    utimesSync(join(home, ".vscode-server", "bin", HASH_A, "bin", "remote-cli", "code"), later, later);

    const r = run({ VSCODE_CWD: `/vscode/vscode-server/bin/linux-x64/${HASH_B}` });

    expect(r.status).toBe(0);
    expect(stubLog(log)).toMatch(new RegExp(`^${HASH_B} `));
  });

  it("falls back to the newest server that has a remote-cli when VSCODE_CWD names none", () => {
    const log = stubRemoteCli(HASH_A);
    stubRemoteCli(HASH_B, log);
    const later = new Date(Date.now() + 60_000);
    utimesSync(join(home, ".vscode-server", "bin", HASH_B, "bin", "remote-cli", "code"), later, later);

    const r = run({ VSCODE_CWD: "/somewhere/else" });

    expect(r.status).toBe(0);
    expect(stubLog(log)).toMatch(new RegExp(`^${HASH_B} `));
  });
});

describe("approval broker contract", () => {
  const requestId = "a".repeat(48);
  const createdAt = Date.parse("2026-11-20T16:00:00.000Z");

  function identity(): CommitApprovalIdentity {
    return {
      repositoryRoot: h.repo,
      gitCommonDir: join(h.root, "git-common"),
      head: "b".repeat(40),
      stagedDigest: commitApprovalDigest("staged-diff"),
      proposedMessageDigest: commitApprovalDigest("feat: broker\n"),
      sessionId: "fixture-agent-session",
    };
  }

  function request(): CommitApprovalRequest {
    return createCommitApprovalRequest(
      {
        ...identity(),
        lane: "commit",
        target: "fixture",
        proposedMessage: "feat: broker\n",
      },
      { now: createdAt, requestId },
    );
  }

  function approve(finalMessage = "feat: broker\n"): CommitApprovalResponse {
    return {
      protocolVersion: 1,
      requestId,
      sessionId: "fixture-agent-session",
      outcome: "approve",
      finalMessage,
      finalMessageDigest: commitApprovalDigest(finalMessage),
    };
  }

  it("stores owner-only requests and atomically claims them once", () => {
    const pending = writeCommitApprovalRequest(identity().gitCommonDir, request());
    expect(commitApprovalFileIsOwnerOnly(commitApprovalDirectory(identity().gitCommonDir))).toBe(true);
    expect(commitApprovalFileIsOwnerOnly(pending)).toBe(true);

    const first = claimCommitApprovalRequest(pending);
    const replay = claimCommitApprovalRequest(pending);

    expect(first.ok).toBe(true);
    expect(replay).toEqual({ ok: false, reason: "missing-request" });
  });

  it("accepts an explicit approval or cancellation for the exact identity", () => {
    const pending = request();
    expect(verifyCommitApproval(pending, approve(), identity(), createdAt + 1_000)).toEqual({
      ok: true,
      outcome: "approve",
      finalMessage: "feat: broker\n",
    });
    expect(verifyCommitApproval(pending, {
      protocolVersion: 1,
      requestId,
      sessionId: pending.sessionId,
      outcome: "cancel",
    }, identity(), createdAt + 1_000)).toEqual({ ok: true, outcome: "cancel" });
  });

  it.each([
    { label: "malformed request", pending: () => null, response: () => approve(), identity, reason: "malformed-request" },
    { label: "malformed response", pending: request, response: () => ({ outcome: "approve" }), identity, reason: "malformed-response" },
    { label: "expired request", pending: request, response: () => approve(), identity, at: createdAt + 10 * 60_000, reason: "expired" },
    { label: "future request", pending: request, response: () => approve(), identity, at: createdAt - 1, reason: "not-yet-valid" },
    { label: "replayed request", pending: request, response: () => ({ ...approve(), requestId: "b".repeat(48) }), identity, reason: "request-mismatch" },
    { label: "cross-session response", pending: request, response: () => ({ ...approve(), sessionId: "other-session" }), identity, reason: "session-mismatch" },
    { label: "different repository", pending: request, response: () => approve(), identity: () => ({ ...identity(), repositoryRoot: "/other/repo" }), reason: "repository-mismatch" },
    { label: "different HEAD", pending: request, response: () => approve(), identity: () => ({ ...identity(), head: "c".repeat(40) }), reason: "head-mismatch" },
    { label: "different staged state", pending: request, response: () => approve(), identity: () => ({ ...identity(), stagedDigest: commitApprovalDigest("other") }), reason: "staged-mismatch" },
    { label: "different proposal", pending: request, response: () => approve(), identity: () => ({ ...identity(), proposedMessageDigest: commitApprovalDigest("other") }), reason: "proposed-message-mismatch" },
    { label: "empty approved message", pending: request, response: () => approve(" \n"), identity, reason: "empty-message" },
    { label: "message digest mismatch", pending: request, response: () => ({ ...approve(), finalMessage: "feat: changed\n" }), identity, reason: "final-message-mismatch" },
  ])("rejects $label", ({ pending, response, identity: currentIdentity, at, reason }) => {
    expect(verifyCommitApproval(
      pending(),
      response(),
      currentIdentity(),
      at ?? createdAt + 1_000,
    )).toEqual({
      ok: false,
      reason,
    });
  });

  describe("approval broker resume", () => {
    const sessionId = "fixture-agent-session";

    function requestBroker(args: string[]): { requestPath: string; out: string } {
      const r = harnessRunTool(h, ["--approval-session", sessionId, ...args], {
        noTty: true,
        envEditor: "",
        env: { HOME: home, VSCODE_CWD: "", VSCODE_IPC_HOOK_CLI: "" },
      });
      expect(r.status).not.toBe(0);
      const match = /approval-request=(.+)$/m.exec(r.out);
      expect(match?.[1]).toBeTruthy();
      return { requestPath: match?.[1]?.trim() ?? "", out: r.out };
    }

    function writeBrokerResponse(
      requestPath: string,
      outcome: "approve" | "cancel",
      finalMessage?: string,
    ): string {
      const request = readCommitApprovalRequest(requestPath);
      expect(request).not.toBeNull();
      const responsePath = join(h.root, "approval-response.json");
      const response = outcome === "approve"
        ? {
            protocolVersion: 1,
            requestId: request?.requestId,
            sessionId,
            outcome,
            finalMessage,
            finalMessageDigest: commitApprovalDigest(finalMessage ?? ""),
          }
        : {
            protocolVersion: 1,
            requestId: request?.requestId,
            sessionId,
            outcome,
          };
      writeFileSync(responsePath, `${JSON.stringify(response)}\n`, { mode: 0o600 });
      return responsePath;
    }

    function resumeBroker(requestPath: string, responsePath: string): { status: number; out: string } {
      return harnessRunTool(h, [
        "--approval-session", sessionId,
        "--approval-request", requestPath,
        "--approval-response", responsePath,
      ], {
        noTty: true,
        envEditor: "",
        env: { HOME: home, VSCODE_CWD: "", VSCODE_IPC_HOOK_CLI: "" },
      });
    }

    function switchToBareRemoteHarness(): void {
      h.dispose();
      h = createRepoCommitHarness({
        bareRemote: true,
        seed: { subject: "chore: base", file: "base.txt" },
      });
      home = join(h.root, "home");
      harnessGit(h, "push", "-q", "origin", "master");
      harnessGit(h, "config", "core.editor", "code --wait");
    }

    it("commits a normal request only after an explicit approved response", () => {
      const before = harnessHeadCount(h);
      const { requestPath } = requestBroker(["feat: broker commit"]);
      expect(harnessHeadCount(h)).toBe(before);

      const response = writeBrokerResponse(requestPath, "approve", "feat: broker commit\n");
      const resumed = resumeBroker(requestPath, response);

      expect(resumed.status).toBe(0);
      expect(resumed.out).toContain("commit created");
      expect(harnessHeadCount(h)).toBe(before + 1);
      expect(harnessHeadSubject(h)).toBe("feat: broker commit");
    });

    it("keeps the Change-Id trailer that prepare-commit-msg adds", () => {
      installChangeIdHook(h.repo, TOOLS);
      const { requestPath } = requestBroker(["feat: broker commit"]);
      const resumed = resumeBroker(requestPath, writeBrokerResponse(requestPath, "approve", "feat: broker commit\n"));
      expect(resumed.status).toBe(0);
      const message = harnessGit(h, "log", "-1", "--format=%B");
      expect(message.split("\n")[0]).toBe("feat: broker commit");
      expect(message).toMatch(/^Change-Id: [A-Za-z0-9]{12}$/m);
    });

    it("keeps a Change-Id the approved message carries instead of adding a second one", () => {
      installChangeIdHook(h.repo, TOOLS);
      const { requestPath } = requestBroker(["feat: broker commit"]);
      const approved = "feat: broker commit\n\nChange-Id: KeepThisId12\n";
      const resumed = resumeBroker(requestPath, writeBrokerResponse(requestPath, "approve", approved));
      expect(resumed.status).toBe(0);
      const ids = harnessGit(h, "log", "-1", "--format=%B").match(/^Change-Id: .*$/gm) ?? [];
      expect(ids).toEqual(["Change-Id: KeepThisId12"]);
    });

    it("accepts the approval request given as a path relative to the working directory", () => {
      const before = harnessHeadCount(h);
      const { requestPath } = requestBroker(["feat: relative request"]);
      const response = writeBrokerResponse(requestPath, "approve", "feat: relative request\n");
      const resumed = resumeBroker(relative(h.repo, requestPath), response);
      expect(resumed.status).toBe(0);
      expect(harnessHeadCount(h)).toBe(before + 1);
    });

    it("leaves HEAD and the index unchanged after cancellation", () => {
      const beforeHead = harnessGit(h, "rev-parse", "HEAD").trim();
      const beforeIndex = harnessGit(h, "diff", "--cached", "--binary");
      const { requestPath } = requestBroker(["feat: cancelled"]);

      const resumed = resumeBroker(requestPath, writeBrokerResponse(requestPath, "cancel"));

      expect(resumed.status).not.toBe(0);
      expect(resumed.out).toContain("cancelled the approval request");
      expect(harnessGit(h, "rev-parse", "HEAD").trim()).toBe(beforeHead);
      expect(harnessGit(h, "diff", "--cached", "--binary")).toBe(beforeIndex);
    });

    it("resumes amend with the approved final message", () => {
      switchToBareRemoteHarness();
      harnessSeedCommit(h, "feat: unpushed base", "unpushed.txt");
      const { requestPath } = requestBroker(["--amend"]);

      const resumed = resumeBroker(
        requestPath,
        writeBrokerResponse(requestPath, "approve", "feat: amended by broker\n"),
      );

      expect(resumed.status).toBe(0);
      expect(resumed.out).toContain("amended");
      expect(harnessHeadSubject(h)).toBe("feat: amended by broker");
    });

    it("an approved amend keeps the commit's existing Change-Id", () => {
      switchToBareRemoteHarness();
      installChangeIdHook(h.repo, TOOLS);
      harnessSeedCommit(h, "feat: unpushed base", "unpushed.txt");
      const before = /^Change-Id: (\S+)$/m.exec(harnessGit(h, "log", "-1", "--format=%B"))?.[1];
      expect(before).toBeTruthy();
      const { requestPath } = requestBroker(["--amend"]);
      const resumed = resumeBroker(requestPath, writeBrokerResponse(requestPath, "approve", "feat: amended by broker\n"));
      expect(resumed.status).toBe(0);
      const ids = harnessGit(h, "log", "-1", "--format=%B").match(/^Change-Id: .*$/gm) ?? [];
      expect(ids).toEqual([`Change-Id: ${before}`]);
    });

    it("an approved reword keeps the target commit's existing Change-Id", () => {
      switchToBareRemoteHarness();
      installChangeIdHook(h.repo, TOOLS);
      const target = harnessSeedCommit(h, "feat: first", "first.txt");
      const before = /^Change-Id: (\S+)$/m.exec(harnessGit(h, "log", "-1", "--format=%B", target))?.[1];
      expect(before).toBeTruthy();
      harnessSeedCommit(h, "feat: second", "second.txt");
      const { requestPath } = requestBroker(["--reword", target]);
      const resumed = resumeBroker(requestPath, writeBrokerResponse(requestPath, "approve", "feat: broker reword\n"));
      expect(resumed.status).toBe(0);
      const reworded = harnessGit(h, "log", "-1", "--format=%B", "HEAD~1");
      expect(reworded.split("\n")[0]).toBe("feat: broker reword");
      expect(reworded.match(/^Change-Id: .*$/gm) ?? []).toEqual([`Change-Id: ${before}`]);
    });

    it("resumes reword on the recorded target", () => {
      switchToBareRemoteHarness();
      const target = harnessSeedCommit(h, "feat: first", "first.txt");
      harnessSeedCommit(h, "feat: second", "second.txt");
      const { requestPath } = requestBroker(["--reword", target]);

      const resumed = resumeBroker(
        requestPath,
        writeBrokerResponse(requestPath, "approve", "feat: broker reword\n"),
      );

      expect(resumed.status).toBe(0);
      expect(resumed.out).toContain("reworded");
      expect(harnessGit(h, "log", "--format=%s", "-2")).toContain("feat: broker reword");
    });

    it("rejects a request after the staged state changes", () => {
      const before = harnessHeadCount(h);
      const { requestPath } = requestBroker(["feat: stale"]);
      const response = writeBrokerResponse(requestPath, "approve", "feat: stale\n");
      harnessStageFile(h, "later.txt", "later\n");

      const resumed = resumeBroker(requestPath, response);

      expect(resumed.status).not.toBe(0);
      expect(resumed.out).toContain("staged-mismatch");
      expect(harnessHeadCount(h)).toBe(before);
      expect(harnessGit(h, "diff", "--cached", "--name-only")).toContain("later.txt");
    });

    it("rechecks staged state after hooks run and before Git accepts the message", () => {
      const before = harnessHeadCount(h);
      const { requestPath } = requestBroker(["feat: hook drift"]);
      const response = writeBrokerResponse(requestPath, "approve", "feat: hook drift\n");
      const hook = join(h.repo, ".git", "hooks", "pre-commit");
      writeFileSync(
        hook,
        "#!/bin/sh\nprintf 'hook drift\\n' > hook-drift.txt\ngit add hook-drift.txt\n",
      );
      chmodSync(hook, 0o755);

      const resumed = resumeBroker(requestPath, response);

      expect(resumed.status).not.toBe(0);
      expect(resumed.out).toContain("staged-mismatch");
      expect(harnessHeadCount(h)).toBe(before);
      expect(harnessGit(h, "diff", "--cached", "--name-only")).toContain("hook-drift.txt");
    });
  });

  describe("approval broker activation", () => {
    it.each([
      ["both non-TTY", false, false, true],
      ["stdin-only TTY", true, false, true],
      ["stdout-only TTY", false, true, true],
      ["both TTY", true, true, false],
    ])("%s", (_label, stdin, stdout, expected) => {
      expect(commitApprovalNeedsBroker("session", stdin, stdout)).toBe(expected);
    });

    it("does not activate without an approval session", () => {
      expect(commitApprovalNeedsBroker("", false, false)).toBe(false);
    });
  });
});

describe("no-TTY lane: refused, nothing opened, nothing committed", () => {
  function expectRefused(r: { status: number; out: string }, before: number): void {
    expect(r.status).not.toBe(0);
    expect(r.out).toContain("without a terminal");
    expect(stubLog()).toBe("");
    expect(harnessHeadCount(h)).toBe(before);
  }

  it("ignores env-supplied editors: only git config counts", () => {
    harnessGit(h, "config", "--unset", "core.editor");
    stubRemoteCli(HASH_A);
    const before = harnessHeadCount(h);

    const r = harnessRunTool(h, ["feat: add a"], {
      noTty: true,
      envEditor: "code --wait",
      env: { HOME: home, VSCODE_IPC_HOOK_CLI: "/tmp/x.sock", VISUAL: "code --wait", EDITOR: "code --wait" },
    });

    expectRefused(r, before);
  });

  it.each(["true", "nano", "code", "code --wait --new-window", "code-insiders --wait", "env code --wait", "/usr/bin/code --wait"])(
    "refuses core.editor = %s",
    (value) => {
      harnessGit(h, "config", "core.editor", value);
      stubRemoteCli(HASH_A);
      const before = harnessHeadCount(h);

      expectRefused(run(), before);
    },
  );

  it("refuses when no VS Code session is attached (VSCODE_IPC_HOOK_CLI unset)", () => {
    stubRemoteCli(HASH_A);
    const before = harnessHeadCount(h);

    const r = harnessRunTool(h, ["feat: add a"], { noTty: true, envEditor: "", env: { HOME: home, VSCODE_IPC_HOOK_CLI: "" } });

    expectRefused(r, before);
  });

  it("preserves HEAD and the staged index in the Copilot host shape", () => {
    const beforeHead = harnessGit(h, "rev-parse", "HEAD").trim();
    const beforeIndex = harnessGit(h, "diff", "--cached", "--binary");

    const r = harnessRunTool(h, ["feat: add a"], {
      noTty: true,
      envEditor: "",
      env: {
        HOME: home,
        COPILOT_AGENT_SESSION_ID: "fixture-copilot-session",
        VSCODE_CWD: "",
        VSCODE_IPC_HOOK_CLI: "",
      },
    });

    expect(r.status).not.toBe(0);
    expect(r.out).toContain("VSCODE_IPC_HOOK_CLI is unset");
    expect(stubLog()).toBe("");
    expect(harnessGit(h, "rev-parse", "HEAD").trim()).toBe(beforeHead);
    expect(harnessGit(h, "diff", "--cached", "--binary")).toBe(beforeIndex);
  });

  it("refuses when no remote-cli exists under ~/.vscode-server", () => {
    mkdirSync(join(home, ".vscode-server", "bin", HASH_A), { recursive: true });
    const before = harnessHeadCount(h);

    expectRefused(run(), before);
  });

  it("never resolves code through PATH: a planted `code` is not run", () => {
    const planted = join(h.root, "planted");
    mkdirSync(planted, { recursive: true });
    const marker = join(h.root, "planted-ran");
    writeFileSync(join(planted, "code"), `#!/bin/sh\necho ran >> '${marker}'\nexit 0\n`);
    chmodSync(join(planted, "code"), 0o755);
    const before = harnessHeadCount(h);

    const r = run({ PATH: `${planted}:${process.env.PATH ?? ""}` });

    expectRefused(r, before);
    expect(existsSync(marker)).toBe(false);
  });
});
