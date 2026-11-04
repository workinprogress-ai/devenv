// Port of tools/tests/devenv/test_devcontainer_json.bats (10 tests) — one vitest `it` per source `@test`.
import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))));

// The devcontainer.json as plain JSON (full-line // comments dropped).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function devcontainer(expr: (d: any) => unknown): string {
  const raw = readFileSync(join(ROOT, ".devcontainer/devcontainer.json"), "utf8");
  const d = JSON.parse(
    raw.split("\n").filter((l) => !l.trim().startsWith("//")).join("\n"),
  );
  const v = expr(d);
  return v === undefined ? "" : String(v);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DC = any;

// Port of tools/tests/devenv/test_devcontainer_json.bats — one vitest `it` per source `@test`.

// ── devcontainer.json (port of test_devcontainer_json.bats, 10) ──────────

// Commands approved to run without a prompt. This is an allowlist on purpose:
// a new entry fails the test until it is reviewed against the bar (reads
// only; never executes arbitrary code, writes state, or prints the env).
const APPROVED_TERMINAL_COMMANDS = [
  "/^git (diff|show|log|diff-tree|diff-index)( (--|--stat|--name-only|--name-status|--oneline|--graph|--no-color|--patch|-p|--shortstat|--numstat|--summary|--cached|--staged|-r|--no-commit-id|--root|--decorate|--abbrev-commit|-[0-9]+|-U[0-9]+|-n|--max-count=[0-9]+|--unified=[0-9]+|(?!(?:[^ /]*/)*\\.\\.(?:/| |$))[A-Za-z0-9_./^~@{}:][A-Za-z0-9_./^~@{}:-]*))*$/",
  "artifacts-list", "cat", "command -v", "cs-dependencies-trace", "cut", "date",
  "diff", "docker images", "docker ps", "docker version", "dotnet --info",
  "dotnet --version", "dotnet list package", "file", "get-services-config",
  "git cat-file", "git describe", "git for-each-ref", "git ls-files",
  "git merge-base", "git name-rev", "git rev-list", "git rev-parse",
  "git shortlog", "git status", "git-graph", "git-graph-all", "grep", "head",
  "id", "issue-comment-list", "issue-get", "issue-list", "jq", "kube-list-pods",
  "kube-logs", "lint-documentation", "lint-tools-scripts", "ls", "lsof",
  "markdown-plan-complete-ac", "markdown-plan-complete-task",
  "metrics-count-code-lines", "node --version", "pnpm list", "pnpm outdated",
  "pr-diff", "pr-get", "pr-list", "pr-threads-get", "repo-calc-version",
  "repo-get-web-url", "repo-version-list", "rg", "ss", "stat", "tail", "tree",
  "uname", "uniq", "wc", "which", "whoami",
];

describe("devcontainer.json", () => {
  it("devcontainer.json parses as JSON once comments are dropped", () => {
    expect(devcontainer((d: DC) => d["name"])).not.toBe("");
  });

  it("no VS Code extension is listed twice", () => {
    const dupes = devcontainer((d: DC) => {
      const exts: string[] = d["customizations"]["vscode"]["extensions"];
      return exts.filter((e, i) => exts.indexOf(e) !== i).sort().join("\n");
    });
    expect(dupes).toBe("");
  });

  it("the base image is pinned to a content digest, not just a moving tag", () => {
    const image = devcontainer((d: DC) => d["image"]);
    expect(image).toMatch(/^mcr\.microsoft\.com\/devcontainers\/base:[a-z0-9.-]+@sha256:[0-9a-f]{64}$/);
  });

  it("every forwarded port is one a configured feature actually serves", () => {
    const unserved = devcontainer((d: DC) =>
      d["forwardPorts"]
        .filter((p: number) => p !== d["features"]["ghcr.io/devcontainers/features/desktop-lite"]["webPort"]
          && p !== d["features"]["ghcr.io/devcontainers/features/desktop-lite"]["vncPort"])
        .join(" "),
    );
    expect(unserved).toBe("");
  });

  it("the desktop is reached in a browser on the documented web port, which is forwarded", () => {
    const forwarded = devcontainer(
      (d: DC) => (d["forwardPorts"] as number[]).includes(d["features"]["ghcr.io/devcontainers/features/desktop-lite"]["webPort"]),
    );
    expect(forwarded).toBe("true");
    expect(readFileSync(join(ROOT, "docs/Dev-container-environment.md"), "utf8"))
      .toContain("localhost:6090");
  });

  it("no script depends on the file command, so nothing needs installing after create", () => {
    const r = spawnSync(
      "grep",
      ["-nE", "\$\(file ", join(ROOT, ".devcontainer/bootstrap.sh"), join(ROOT, "setup"), join(ROOT, ".devcontainer/container-start.sh")],
      { encoding: "utf8" },
    );
    // rc 1 = no match; rc 2 = a path argument does not exist (equally fine —
    // the contract is no match, not "all files exist").
    expect([1, 2]).toContain(r.status);
    expect(devcontainer((d: DC) => "postCreateCommand" in d)).toBe("false");
  });

  it("workspace paths use containerWorkspaceFolder, not a hard-coded folder name", () => {
    const r = spawnSync("grep", ["-n", "/workspaces/", join(ROOT, ".devcontainer/devcontainer.json")], { encoding: "utf8" });
    expect(r.status).toBe(1);
  });

  it("terminal auto-approve holds only reviewed, read-only commands", () => {
    const actual = devcontainer((d: DC) => {
      const approve = d["customizations"]["vscode"]["settings"]["chat.tools.terminal.autoApprove"];
      return Object.keys(approve).filter((k) => approve[k]).sort().join("\n");
    });
    const extra = actual.split("\n").filter((key) => key !== "" && !APPROVED_TERMINAL_COMMANDS.includes(key));
    expect(extra).toEqual([]);
  });

  it("terminal auto-approve does not include test runners, repo cloning or environment dumps", () => {
    const banned = ["bats", "run-tests", "bash run-tests", "git-repo", "env", "printenv", "docker inspect", "docker logs", "find", "awk", "sort", "ps", "git branch", "dotnet build", "dotnet restore"];
    const present = devcontainer((d: DC) => {
      const approve = d["customizations"]["vscode"]["settings"]["chat.tools.terminal.autoApprove"];
      return Object.keys(approve).filter((k) => banned.includes(k)).join(" ");
    });
    expect(present).toBe("");
  });

  it("the git inspection approval admits only fixed read forms, and quoting, continuations and output flags cannot get through", () => {
    const re = devcontainer((d: DC) => {
      const approve = d["customizations"]["vscode"]["settings"]["chat.tools.terminal.autoApprove"];
      const keys = Object.keys(approve).filter((k) => approve[k]);
      return keys.filter((k) => k.startsWith("/"))[0]!.slice(1, -1);
    });
    const ok = [
      "git diff", "git diff --stat HEAD~1", "git diff --name-only HEAD..origin/master",
      "git show HEAD:tools/x.sh", "git log --oneline -n 5", "git log -5 --stat",
      "git diff-tree --name-only -r HEAD", "git diff HEAD -- docs/Forking.md",
      "git log --max-count=3 origin/master", "git diff HEAD..origin/master",
      "git diff HEAD~3..HEAD -- ./tools/x.sh", "git show origin/master:docs/a..b.md",
    ];
    for (const c of ok) {
      const r = spawnSync("python3", ["-c", "import re,sys; sys.exit(0 if re.fullmatch(sys.argv[1], sys.argv[2]) else 1)", re, c], { encoding: "utf8" });
      expect(r.status, `should be approved: ${c}`).toBe(0);
    }
    const bad = [
      "git diff --output=/tmp/x", "git diff --output /tmp/x", "git log -p --output=x",
      "git show --output x HEAD", "git diff --out''put=q.txt", 'git diff --ou"tput"=x',
      "git diff --ext-diff", "git show --textconv HEAD:f", "git diff \\\n--output=/tmp/x",
      "git diff\n--output=/tmp/x", "git diff; rm -rf x", "git diff && touch x",
      "git diff $(touch x)", "git diff `touch x`", "git diff | tee x", "git diff > x",
      "git diff --no-index /etc/passwd /dev/null", "git branch -D x",
      "git symbolic-ref HEAD refs/heads/x", "git -c core.pager=x diff",
      "git diff ../../etc/hostname ../../etc/hosts", "git diff -- ../../etc/hostname ../../etc/hosts",
      "git diff ..", "git diff a/../../b c", "git diff ../a ../b", "git log -p -- docs/../../x",
    ];
    for (const c of bad) {
      const r = spawnSync("python3", ["-c", "import re,sys; sys.exit(0 if re.fullmatch(sys.argv[1], sys.argv[2]) else 1)", re, c], { encoding: "utf8" });
      expect(r.status, `must not be approved: ${c}`).not.toBe(0);
    }
  });
});
