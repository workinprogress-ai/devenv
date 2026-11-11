// harness/canary.ts — the no-network canary for the regular test run.
//
// What it enforces: every command in CANARY_COMMANDS (provider and network
// clients, package managers, remote-copy tools and host-affecting commands such
// as kubectl, docker, sudo, dotnet) and every `fetch`. `git` is not shimmed
// because the suites need it; instead the hermetic env restricts git to the
// file transport (GIT_ALLOW_PROTOCOL, see harness/env.ts), so a remote git
// operation fails. A suite that builds its
// own PATH from scratch bypasses the shims (use canaryEnv()). Three tripwires
// share one log file:
//   - shim executables for every CANARY_COMMANDS entry placed first on PATH: a
//     suite that stubs the CLI puts its own stub directory before them, so only
//     an unmocked call reaches a shim;
//   - a fetch guard (harness/canary-fetch.ts) preloaded into the worker and,
//     through NODE_OPTIONS, into every spawned node process;
//   - assertNoCanaryHits(), run after every test, which fails the test that
//     tripped either of the above.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { delimiter, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/** Executables whose real binary the regular run must never start: provider and
 * network clients plus every host-affecting command a tool may reach (directly
 * or through a shared library), so a probe that slips past the static
 * host-effect scan fails instead of touching the host. */
export const CANARY_COMMANDS = [
  "gh", "az", "curl", "wget", "ssh", "scp", "rsync",
  "pnpm", "npm", "npx", "tailscale",
  "kubectl", "docker", "sudo", "dotnet", "apt-get", "pkill",
  "mongorestore", "mongodump", "mongosh", "telepresence", "terraform",
] as const;

const FETCH_PRELOAD = fileURLToPath(new URL("./canary-fetch.ts", import.meta.url));

export function canaryLogPath(fixtureDir: string): string {
  return join(fixtureDir, "canary.log");
}

/** Write the shim executables and return the directory that holds them. */
export function installCanaryShims(fixtureDir: string): string {
  const binDir = join(fixtureDir, "canary-bin");
  mkdirSync(binDir, { recursive: true });
  const log = canaryLogPath(fixtureDir);
  for (const name of CANARY_COMMANDS) {
    writeFileSync(
      join(binDir, name),
      [
        "#!/bin/sh",
        `printf '%s %s\\n' '${name}' "$*" >> '${log}'`,
        `echo "devenv test canary: '${name}' ran without a stub — the regular test run must not reach a provider backend" >&2`,
        "exit 99",
        "",
      ].join("\n"),
      { mode: 0o755 },
    );
  }
  return binDir;
}

/** NODE_OPTIONS value that preloads the fetch canary into spawned node processes. */
export function canaryNodeOptions(existing: string | undefined, preload: string = FETCH_PRELOAD): string {
  // A file URL has no spaces (they are percent-encoded), so a checkout path
  // containing one survives NODE_OPTIONS' whitespace splitting.
  const flag = `--import=${pathToFileURL(preload).href}`;
  if (existing === undefined || existing === "") return flag;
  return existing.includes(flag) ? existing : `${existing} ${flag}`;
}

/** The canary-carrying variables of the current worker. A suite that builds a
 * minimal env for a child process spreads this in so the shims and the fetch
 * preload still apply to that child. With `basePath`, the child's PATH is that
 * path with only the shim directory prepended (a deliberately minimal PATH that
 * still carries the canary); without it, the worker's own PATH is passed on. */
export function canaryEnv(basePath?: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const name of ["PATH", "NODE_OPTIONS", "DEVENV_TEST_CANARY_LOG"]) {
    const value = process.env[name];
    if (value !== undefined) out[name] = value;
  }
  const fixture = process.env["DEVENV_TEST_FIXTURE_DIR"];
  if (basePath !== undefined && fixture !== undefined && fixture !== "") {
    out["PATH"] = `${join(fixture, "canary-bin")}${delimiter}${basePath}`;
  }
  return out;
}

/** The canary hits recorded since the last drain. */
export function canaryHits(): string[] {
  const log = process.env["DEVENV_TEST_CANARY_LOG"];
  if (log === undefined || !existsSync(log)) return [];
  return readFileSync(log, "utf8").split("\n").filter((l) => l !== "");
}

/** Return the recorded hits and clear the log (for suites that trip the canary on purpose). */
export function drainCanary(): string[] {
  const hits = canaryHits();
  const log = process.env["DEVENV_TEST_CANARY_LOG"];
  if (log !== undefined && hits.length > 0) writeFileSync(log, "");
  return hits;
}

/** Fail when anything reached a provider backend since the last drain. */
export function assertNoCanaryHits(): void {
  const hits = drainCanary();
  if (hits.length > 0) {
    throw new Error(
      `the regular test run reached a provider backend (every provider call must be mocked):\n  ${hits.join("\n  ")}`,
    );
  }
}
