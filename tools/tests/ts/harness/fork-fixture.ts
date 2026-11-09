// Fork fixture harness — the TS twin of test_helper.bash's fork section:
// the three-repo fixture (bare upstream, bare ado-origin, working clone,
// gh clone), the divergence scenario builders (deterministic dates so
// patch-ids and subjects are stable), and the clack keystroke driver for
// pty-driven picker tests.
import { spawnSync } from "node:child_process";
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export interface ForkFixture {
  upstream: string;
  adoOrigin: string;
  workingClone: string;
  ghClone: string;
}

export function git(repo: string | undefined, args: string[], opts: { env?: Record<string, string>; allowFail?: boolean } = {}): { status: number; out: string } {
  const r = spawnSync("git", repo ? ["-C", repo, ...args] : args, {
    encoding: "utf8",
    env: { ...process.env, ...opts.env },
  });
  return { status: r.status ?? 1, out: (r.stdout ?? "") + (r.stderr ?? "") };
}

/** The four-repo fork fixture. The prepare-commit-msg hook (Change-Id) is
 * NOT installed here — scenario builders install it where needed, exactly
 * as the bats helper did. */
export function createForkFixtureTrio(baseDir: string): ForkFixture {
  mkdirSync(baseDir, { recursive: true });
  const upstream = join(baseDir, "upstream.git");
  const adoOrigin = join(baseDir, "ado-origin.git");
  const workingClone = join(baseDir, "working-clone");
  const ghClone = join(baseDir, "gh-clone");
  const seed = join(baseDir, "_seed");

  git(undefined, ["init", "-q", "--bare", "-b", "master", upstream]);
  git(undefined, ["clone", "-q", upstream, seed]);
  git(seed, ["config", "user.email", "test@example.com"]);
  git(seed, ["config", "user.name", "Test User"]);
  git(seed, ["add", "README.md"] as string[]);
  // The seed needs a README before add
  const touch = spawnSync("bash", ["-c", `cd '${seed}' && touch README.md && git add README.md && git commit -q -m "Initial commit" && git push -q origin HEAD:master`], { encoding: "utf8" });
  if (touch.status !== 0) throw new Error(`fixture seed failed: ${touch.stdout} ${touch.stderr}`);
  git(undefined, ["clone", "-q", "--bare", upstream, adoOrigin]);
  git(undefined, ["clone", "-q", adoOrigin, workingClone]);
  git(workingClone, ["config", "user.email", "test@example.com"]);
  git(workingClone, ["config", "user.name", "Test User"]);
  git(undefined, ["clone", "-q", upstream, ghClone]);
  git(ghClone, ["config", "user.email", "test@example.com"]);
  git(ghClone, ["config", "user.name", "Test User"]);
  return { upstream, adoOrigin, workingClone, ghClone };
}

export function installChangeIdHook(repo: string, devenvTools: string): void {
  mkdirSync(join(repo, ".git/hooks"), { recursive: true });
  writeFileSync(join(repo, ".git/hooks/prepare-commit-msg"), `#!/bin/sh\nexec "${devenvTools}/internal/prepare-commit-msg" "$@"\n`, { mode: 0o755 });
  spawnSync("bash", ["-c", `chmod +x '${repo}/.git/hooks/prepare-commit-msg'`], { encoding: "utf8" });
}

/** Deterministic commit on the working clone. */
export function scenarioCommit(fx: ForkFixture, file: string, line: string, subject: string, date: string): void {
  appendFileSync(join(fx.workingClone, file), `${line}\n`);
  git(fx.workingClone, ["add", file]);
  git(fx.workingClone, ["commit", "-q", "-m", subject], { env: { GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date } });
}

export function scenarioPreChangeIdBacklog(fx: ForkFixture, count: number): void {
  for (let i = 1; i <= count; i++) {
    const date = `2026-09-01T10:${String(i).padStart(2, "0")}:00`;
    scenarioCommit(fx, "backlog.txt", `backlog line ${i}`, `backlog: pre-change-id commit ${i}`, date);
  }
}

export function scenarioExportAndEditTwin(fx: ForkFixture, devenvTools: string): { local: string; upstream: string } {
  installChangeIdHook(fx.workingClone, devenvTools);
  scenarioCommit(fx, "file_twin.txt", "twin base line", "feat: twin commit for export", "2026-09-02T10:00:00");
  const localSha = git(fx.workingClone, ["rev-parse", "HEAD"]).out.trim();
  const am = spawnSync("bash", ["-c", `git -C '${fx.workingClone}' format-patch -1 --stdout HEAD | git -C '${fx.ghClone}' am -q`], { encoding: "utf8" });
  if (am.status !== 0) throw new Error(`twin export failed: ${am.stderr}`);
  spawnSync("bash", ["-c", `printf 'target adaptation line\\n' >> '${fx.ghClone}/file_twin.txt' && git -C '${fx.ghClone}' add file_twin.txt && git -C '${fx.ghClone}' commit -q --amend --no-edit`], { encoding: "utf8" });
  const upstreamSha = git(fx.ghClone, ["rev-parse", "HEAD"]).out.trim();
  return { local: localSha, upstream: upstreamSha };
}

/** Clack keystroke driver: keys paced on script(1) stdin, ANSI stripped.
 * Spec: s=space, d=down, r=Enter, e=Escape, y/n=confirm, Y/N=+CR for
 * /dev/tty reads, A/C=a/c+CR, W=2.5s wait. */
export function driveClack(spec: string, command: string, env: Record<string, string> = {}): { status: number; out: string } {
  const driver = `
sleep 0.8
for k in ${spec.split(",").join(" ")}; do
    case "$k" in
        s) printf ' ' ;;
        d) printf '\\033[B' ;;
        r) printf '\\r' ;;
        e) printf '\\033' ;;
        y | n) printf '%s' "$k" ;;
        A) printf 'a\\r' ;;
        C) printf 'c\\r' ;;
        Y) printf 'y\\r' ;;
        N) printf 'n\\r' ;;
        W) sleep 2.5; continue ;;
        *) printf '%s\\r' "$k" ;;
    esac
    sleep 0.6
done
sleep 20`;
  const script = `{ ${driver} ; } | script -qec "${command.replace(/"/g, '\\"')}" /dev/null | sed -e 's/\\x1b\\[[0-9;?]*[a-zA-Z]//g' -e 's/│ *//g' -e 's/  */ /g'; status="\${PIPESTATUS[1]}"`;
  // PIPESTATUS[1] like the bats driver: sed's exit code must not mask the
  // tool's (sed dies of SIGPIPE when script(1) outlives it — status 141).
  const r = spawnSync("bash", ["-c", `${script}; exit "$status"`], {
    cwd: process.env.FORK_TEST_CWD,
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
  return { status: r.status ?? 1, out: (r.stdout ?? "") + (r.stderr ?? "") };
}
