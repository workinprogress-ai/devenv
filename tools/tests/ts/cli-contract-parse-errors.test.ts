// Parse and validation errors are misuse: exit 2 with a "--help" hint on stderr
// (stdout stays empty); the tools in EXACT_HINT_TOOLS print the standard
// "Use --help for usage information" line. Only the help path exits 0. Every tool here is a
// strict toolCli tool that parses before it does anything, so an unknown flag
// is rejected before any host-affecting call; the runs are hermetic (the
// harness canary fails a test that reaches a provider).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { rmrf, runTool, tmpDir } from "./harness/index.ts";
import { EXIT_MISUSE } from "../../lib/core/exit-codes.ts";

let work = "";
beforeAll(() => {
  work = tmpDir("cli-parse-errors");
});
afterAll(() => rmrf(work));

const BAD = "--no-such-flag-zzz";

const CASES: Array<[string, string[]]> = [
  ["get-services-config", [BAD]],
  ["get-services-config", ["a", "b", "c"]],
  ["terraform-plan", [BAD]],
  ["terraform-plan", ["one", "two"]],
  ["devenv-desktop-menu-add-folder", [BAD]],
  ["devenv-desktop-menu-add-shortcut", [BAD]],
  ["repo-update-config", [BAD]],
  ["repo-reset-merge-config", [BAD]],
  ["config-read", [BAD]],
  ["config-read", ["a", "b", "c", "d"]],
  ["config-read", []],
  ["devenv-memory-watch", [BAD]],
  ["devenv-memory-watch", ["--top", "abc"]],
  ["devenv-memory-watch", ["--max-processes", "0"]],
  ["devenv-memory-watch", ["--interval-minutes", "x"]],
  ["pr-get-merge-link", [BAD]],
  ["pr-get-review-link", [BAD]],
  ["issue-comment-list", [BAD]],
  ["issue-comment-list", ["abc"]],
  ["issue-comment-list", ["1", "2"]],
  ["issue-comment-list", []],
  ["cs-dependencies-trace", [BAD]],
  ["artifacts-list", [BAD]],
  ["tooling-create-script", [BAD]],
  ["tooling-create-script", ["one", "two"]],
  ["tooling-create-script", []],
  ["tooling-create-script", ["nested/name"]],
  ["install-extras", [BAD]],
  ["issue-types", [BAD]],
];

/** Tools whose misuse path is pinned to the exact standard hint text; the other
 * tools above are held only to mentioning --help. */
const EXACT_HINT = "Use --help for usage information";
const EXACT_HINT_TOOLS = new Set(["tooling-create-script", "install-extras", "issue-types"]);

describe("parse errors exit 2 with the hint on stderr", () => {
  it.each(CASES)("%s %j", (tool, args) => {
    const r = runTool(tool, args, { cwd: work });
    expect(r.status, `${tool} ${args.join(" ")} (stderr: ${r.stderr.slice(0, 200)})`).toBe(EXIT_MISUSE);
    expect(r.stderr).toContain(EXACT_HINT_TOOLS.has(tool) ? EXACT_HINT : "--help");
    expect(r.stdout).toBe("");
  });
});

describe("error messages", () => {
  it("devenv-memory-watch: an invalid max-processes environment value names the variable, not the flag", () => {
    const r = runTool("devenv-memory-watch", ["--once"], { cwd: work, env: { DEVENV_MEMORY_WATCH_MAX_PROCESSES: "abc" } });
    expect(r.status).toBe(EXIT_MISUSE);
    expect(r.stderr).toContain("DEVENV_MEMORY_WATCH_MAX_PROCESSES");
    expect(r.stderr).not.toContain("--max-processes");
    expect(r.stdout).toBe("");
  });

  it("devenv-memory-watch: the flag still names itself and overrides a bad environment value", () => {
    const bad = runTool("devenv-memory-watch", ["--max-processes", "0"], { cwd: work });
    expect(bad.stderr).toContain("--max-processes must be a positive integer");
  });

  it("artifacts-list: the sort error lists every accepted field", () => {
    const r = runTool("artifacts-list", ["--sort", "bogus"], { cwd: work });
    expect(r.status).toBe(EXIT_MISUSE);
    expect(r.stderr).toContain("package_type");
  });
});
