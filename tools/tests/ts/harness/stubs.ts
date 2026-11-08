// harness/stubs.ts — PATH-stub factories (the 25 per-suite installGhStub
// copies unified; cli-stubs.bash semantics absorbed per the
// bats-retirement phase).
//
// Every stub is mode-driven shell the suite writes; the factory owns only
// the boilerplate: write an executable to the stub dir, hand back the
// path, and (call log convention) append `name argv...` lines to
// <dir>/calls.log so suites can assert "destructive command NOT issued"
// by counting.
import { writeFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export const CALLS_LOG_NAME = "calls.log";

/** Write one executable stub into DIR. Returns its path. */
export function stubCli(dir: string, name: string, script: string): string {
  const p = join(dir, name);
  writeFileSync(p, script.endsWith("\n") ? script : script + "\n", { mode: 0o755 });
  return p;
}

/** The standard PATH prefix value that puts DIR first. */
export function pathWithStubs(dir: string): string {
  return `${dir}:${process.env.PATH ?? ""}`;
}

/** The canonical gh stub: auth-status ok; everything else logged + exit 0.
 * MODE script overrides the whole body when a suite needs different
 * behavior — the log line convention is the factory's one invariant. */
export function stubGh(dir: string, mode?: string): string {
  const body =
    mode ??
    [
      "#!/usr/bin/env bash",
      'if [ "$1" = "auth" ] && [ "$2" = "status" ]; then exit 0; fi',
      `printf '%s\\n' "gh $*" >> "${join(dir, CALLS_LOG_NAME)}"`,
      "exit 0",
      "",
    ].join("\n");
  return stubCli(dir, "gh", body);
}

/** The canonical git stub: rev-parse --show-toplevel answers REPO_ROOT,
 * everything else exit 0 (the devenv-repo safety gate's probe). */
export function stubGit(dir: string, repoRoot: string, mode?: string): string {
  const body =
    mode ??
    [
      "#!/usr/bin/env bash",
      'if [ "$1" = "rev-parse" ] && [ "$2" = "--show-toplevel" ]; then',
      `  printf '%s\\n' "${repoRoot}"`,
      "  exit 0",
      "fi",
      "exit 0",
      "",
    ].join("\n");
  return stubCli(dir, "git", body);
}

/** Recorded stub invocations (one shell-quoted line per call). */
export function stubCalls(dir: string, name?: string): string[] {
  const log = join(dir, CALLS_LOG_NAME);
  if (!existsSync(log)) return [];
  const lines = readFileSync(log, "utf8").split("\n").filter((l) => l !== "");
  return name ? lines.filter((l) => l.startsWith(`${name} `)) : lines;
}
