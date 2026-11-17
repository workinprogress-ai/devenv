// harness/env.ts — the hermetic environment every test worker runs in.
//
// The regular test run must never reach a real provider backend. Two leaks make
// that happen on a runtime workspace: the container exports DEVENV_ROOT, the
// config folders and credentials, and a checkout's own devenv.config may name a
// real provider. This module removes both: process.env is reduced to an
// allow-list, DEVENV_ROOT points at a fixture root whose devenv.config is the
// committed github-provider fixture, HOME is an empty directory with a fixed git
// identity, and PATH loses every devenv tools directory (whose depth-1 stubs
// would run a different checkout's code).
import { existsSync, mkdirSync, mkdtempSync, rmSync, copyFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { fileURLToPath } from "node:url";
import { canaryLogPath, canaryNodeOptions, installCanaryShims } from "./canary.ts";

const FIXTURE_CONFIG = fileURLToPath(new URL("../../fixtures/devenv.test.config", import.meta.url));

/** Variables a worker keeps verbatim; every other variable is dropped. */
const KEEP_EXACT = new Set([
  "PATH",
  "TMPDIR",
  "TMP",
  "TEMP",
  "LANG",
  "TERM",
  "TZ",
  "USER",
  "LOGNAME",
  "SHELL",
  "CI",
  "NO_COLOR",
  "FORCE_COLOR",
  "COLORTERM",
  "TEST",
  "MODE",
  "DEVENV_TEST_FIXTURE_DIR",
  "DEVENV_TEST_CANARY_LOG",
]);
const KEEP_PREFIXES = ["LC_", "NODE_", "VITEST", "VITE_"];

/** Whether a variable name survives the scrub. */
export function keepVariable(name: string): boolean {
  return KEEP_EXACT.has(name) || KEEP_PREFIXES.some((p) => name.startsWith(p));
}

/** A devenv tools directory holds the generated depth-1 stubs next to ts/ and lib/. */
function isDevenvToolsDir(dir: string): boolean {
  return existsSync(join(dir, "ts")) && existsSync(join(dir, "lib"));
}

/** PATH with every devenv tools directory removed. */
export function cleanPath(path: string | undefined): string {
  return (path ?? "")
    .split(delimiter)
    .filter((entry) => entry !== "" && !isDevenvToolsDir(entry))
    .join(delimiter);
}

/** The allow-listed subset of BASE: pure, no filesystem writes. */
export function filterEnv(base: NodeJS.ProcessEnv): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(base)) {
    if (value !== undefined && keepVariable(name)) out[name] = value;
  }
  if (out["PATH"] !== undefined) out["PATH"] = cleanPath(out["PATH"]);
  return out;
}

const GIT_CONFIG = [
  "[user]",
  "\tname = Test User",
  "\temail = test@example.com",
  "[init]",
  "\tdefaultBranch = master",
  "[commit]",
  "\tgpgsign = false",
  "[advice]",
  "\tdetachedHead = false",
  "[protocol]",
  "\tallow = never",
  "[protocol \"file\"]",
  "\tallow = always",
  "",
].join("\n");

/** Create the worker's fixture directory (HOME, DEVENV_ROOT) once and return it. */
function ensureFixtureDir(): string {
  const existing = process.env["DEVENV_TEST_FIXTURE_DIR"];
  if (existing !== undefined && existing !== "" && existsSync(existing)) return existing;
  const dir = mkdtempSync(join(tmpdir(), "devenv-test-"));
  mkdirSync(join(dir, "home"), { recursive: true });
  mkdirSync(join(dir, "root"), { recursive: true });
  writeFileSync(join(dir, "home", ".gitconfig"), GIT_CONFIG);
  copyFileSync(FIXTURE_CONFIG, join(dir, "root", "devenv.config"));
  process.on("exit", () => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/** Re-establish the fixture anchors a suite's own cleanup may have deleted
 * (several suites `delete process.env.DEVENV_ROOT` in afterEach). A suite that
 * sets its own value keeps it; only an absent anchor is restored. */
export function restoreAnchors(): void {
  const dir = process.env["DEVENV_TEST_FIXTURE_DIR"];
  if (dir === undefined || dir === "") return;
  process.env["DEVENV_ROOT"] ??= join(dir, "root");
  process.env["HOME"] ??= join(dir, "home");
}

/** Reduce process.env to the hermetic allow-list and point it at fixtures. */
export function applyHermeticEnv(): void {
  const kept = filterEnv(process.env);
  for (const name of Object.keys(process.env)) {
    if (!(name in kept)) delete process.env[name];
  }
  if (kept["PATH"] !== undefined) process.env["PATH"] = kept["PATH"];

  const dir = ensureFixtureDir();
  process.env["DEVENV_TEST_FIXTURE_DIR"] = dir;
  process.env["HOME"] = join(dir, "home");
  process.env["DEVENV_ROOT"] = join(dir, "root");
  process.env["GIT_CONFIG_NOSYSTEM"] = "1";
  process.env["GIT_TERMINAL_PROMPT"] = "0";
  // Only the local file transport: a clone, fetch, push or ls-remote over https or ssh fails.
  process.env["GIT_ALLOW_PROTOCOL"] = "file";

  // The canary: shims first on PATH, and a fetch guard preloaded into every node process.
  process.env["DEVENV_TEST_CANARY_LOG"] = canaryLogPath(dir);
  const shimDir = installCanaryShims(dir);
  const path = process.env["PATH"] ?? "";
  if (!path.split(delimiter).includes(shimDir)) process.env["PATH"] = `${shimDir}${delimiter}${path}`;
  process.env["NODE_OPTIONS"] = canaryNodeOptions(process.env["NODE_OPTIONS"]);
}
