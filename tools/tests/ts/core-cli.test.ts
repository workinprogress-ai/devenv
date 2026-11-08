// core-cli.test.ts — unit suite for lib/core/cli.ts (toolCli): house-flag
// parsing, verbose wiring, version exit, caller-table merge, positional
// passthrough.
import { describe, it, expect, vi, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const LIB = join(fileURLToPath(new URL(".", import.meta.url)), "../../lib/core/cli.ts");

// Simpler and honest: drive toolCli in-process for non-exiting cases and
// child-process only for the exit case.
import { toolCli, usageCommonFlags, usageEnvBlock } from "../../lib/core/cli.ts";
import { LOG_LEVEL_DEBUG, setLogLevel, LOG_LEVEL_INFO } from "../../lib/core/logging.ts";

afterEach(() => {
  setLogLevel(LOG_LEVEL_INFO);
});

describe("toolCli", () => {
  it("lifts the five house flags", () => {
    const r = toolCli({ name: "t", version: "1.0.0", argv: ["-h"] });
    expect(r.common.help).toBe(true);
    expect(r.common.version).toBe(false);
    const r2 = toolCli({ name: "t", version: "1.0.0", argv: ["-n", "--devenv"] });
    expect(r2.common.dryRun).toBe(true);
    expect(r2.common.devenv).toBe(true);
  });

  it("merges caller options and passes values through", () => {
    const r = toolCli({
      name: "t",
      version: "1.0.0",
      argv: ["--format", "json"],
      options: { format: { type: "string", default: "table" } },
    });
    expect(r.values["format"]).toBe("json");
  });

  it("caller entry overrides a house flag's definition (tool-specific --repo stays)", () => {
    const r = toolCli({
      name: "t",
      version: "1.0.0",
      argv: ["--devenv", "special-value"],
      options: { devenv: { type: "string", default: "no" } },
    });
    // The caller's devenv replaced the boolean house flag: lifted common
    // reads the boolean coercion of the string value.
    expect(r.values["devenv"]).toBe("special-value");
  });

  it("positionals pass through untouched", () => {
    const r = toolCli({
      name: "t",
      version: "1.0.0",
      argv: ["123", "--devenv", "456"],
      options: { body: { type: "string" } },
    });
    expect(r.common.devenv).toBe(true);
    expect(r.positionals).toEqual(["123", "456"]);
  });

  it("-V wires setLogLevel(DEBUG)", () => {
    const r = toolCli({ name: "t", version: "1.0.0", argv: ["-V"] });
    expect(r.common.verbose).toBe(true);
    // The level threshold is module-private; the DEBUG side effect is
    // asserted via the logging-level probe in the -V side-effect test below.
  });

  it("unknown flag throws under strict (caller catches → usage error)", () => {
    expect(() => toolCli({ name: "t", version: "1.0.0", argv: ["--bogus"] })).toThrow();
  });

  it("allowPositionals defaults true (back-compat: positional-consuming tools)", () => {
    const r = toolCli({ name: "t", version: "1.0.0", argv: ["123"] });
    expect(r.positionals).toEqual(["123"]);
  });

  it("allowPositionals:false rejects a stray positional (strict tools keep exit-2 semantics)", () => {
    expect(() =>
      toolCli({ name: "t", version: "1.0.0", argv: ["--pretty", "stray-arg"], allowPositionals: false, options: { pretty: { type: "boolean", default: false } } }),
    ).toThrow();
    // and accepts the same argv without the stray
    expect(() =>
      toolCli({ name: "t", version: "1.0.0", argv: ["--pretty"], allowPositionals: false, options: { pretty: { type: "boolean", default: false } } }),
    ).not.toThrow();
  });

  it("-v prints the version and exits 0 (child process)", () => {
    const r = spawnSync(
      "node",
      [
        "-e",
        `import(${JSON.stringify("file://" + LIB)}).then(m => {` +
          ` m.toolCli({ name: "t", version: "9.9.9", argv: ["-v"] });` +
          ` console.log("SHOULD-NOT-PRINT"); });`,
      ],
      { encoding: "utf8", input: "" },
    );
    expect(r.status).toBe(0);
    expect((r.stdout ?? "").trim()).toBe("9.9.9");
  });

  it("-V side effect: DEBUG threshold reached — a debug message prints only under -V (child process)", () => {
    // The threshold is module-private; observe it through logDebug's gate:
    // without -V the message is suppressed, with -V it prints. The logging
    // module is imported alongside cli (setLogLevel lives there; cli wires
    // it under -V).
    const LOGGING = join(fileURLToPath(new URL(".", import.meta.url)), "../../lib/core/logging.ts");
    const probe = (args: string[]) =>
      spawnSync(
        "node",
        [
          "--input-type=module",
          "-e",
          `Promise.all([import(${JSON.stringify("file://" + LIB)}), import(${JSON.stringify("file://" + LOGGING)})])` +
            `.then(([cli, log]) => { cli.toolCli({ name: "t", version: "9.9.9", argv: ${JSON.stringify(args)} }); log.logDebug("probe-marker-9f2c"); });`,
        ],
        { encoding: "utf8", input: "" },
      ).stderr ?? "";
    expect(probe(["-V"]).includes("probe-marker-9f2c")).toBe(true);
    expect(probe([]).includes("probe-marker-9f2c")).toBe(false);
  });

  it("noVersionExit defers the banner to the caller", () => {
    const r = toolCli({ name: "t", version: "9.9.9", argv: ["-v"], noVersionExit: true });
    expect(r.common.version).toBe(true);
  });

  it("noDryRun drops the house dry-run entry (a tool whose -n belongs to its own flag)", () => {
    const r = toolCli({ name: "t", version: "9.9.9", argv: ["-n", "42"], options: { limit: { type: "string", short: "n", default: "30" } }, noDryRun: true });
    expect(r.values["limit"]).toBe("42");
    expect(r.common.dryRun).toBe(false);
  });

  it("caller dry-run entry keeps -n/--dry-run working (caller wins on key collision)", () => {
    const r = toolCli({ name: "t", version: "9.9.9", argv: ["--dry-run"], options: { "dry-run": { type: "boolean", short: "n", default: false } } });
    expect(r.common.dryRun).toBe(true);
  });
});

describe("usage text blocks", () => {
  it("common-flags block names the five flags with house wording", () => {
    const text = usageCommonFlags();
    expect(text).toContain("-h, --help");
    expect(text).toContain("-v, --version");
    expect(text).toContain("-V, --verbose");
    expect(text).toContain("-n, --dry-run");
    expect(text).toContain("--devenv");
  });

  it("long-only dry-run block drops the -n short", () => {
    const text = usageCommonFlags({ noDryRunShort: true });
    expect(text).toContain("    --dry-run");
    expect(text).not.toContain("-n, --dry-run");
    expect(text).toContain("-h, --help");
  });

  it("noDryRun block omits the dry-run line entirely (an advertised flag must parse)", () => {
    const text = usageCommonFlags({ noDryRun: true });
    expect(text).not.toContain("--dry-run");
    expect(text).not.toContain("-n");
    expect(text).toContain("-h, --help");
    expect(text).toContain("--devenv");
  });

  it("usage↔parse lock: every flag the rendered block advertises parses via toolCli (noDryRun variant)", () => {
    // The advertised-flags-must-parse contract: extract long flags from the
    // rendered block, parse them through toolCli with the same noDryRun
    // setting, and assert nothing threw (strict parse would reject a flag
    // the tool doesn't carry). -h/-v take effect inside toolCli (help
    // renders via the caller; version prints+exits), so the lock feeds
    // noVersionExit and excludes them from the assert set — the parse lock
    // covers the flags whose acceptance is toolCli's own decision.
    const text = usageCommonFlags({ noDryRun: true });
    const flags = [...text.matchAll(/(?<!\S)--?[a-z][a-z-]*/gi)].map((m) => m[0]).filter((f) => f.startsWith("--") && f !== "--help" && f !== "--version");
    expect(flags).toContain("--verbose");
    expect(flags).toContain("--devenv");
    expect(flags).not.toContain("--dry-run");
    expect(() => toolCli({ name: "t", version: "9.9.9", argv: flags, noDryRun: true, noVersionExit: true })).not.toThrow();
  });

  it("usage↔parse lock: full block's advertised flags parse via toolCli (default variant)", () => {
    const text = usageCommonFlags();
    const flags = [...text.matchAll(/(?<!\S)--?[a-z][a-z-]*/gi)].map((m) => m[0]).filter((f) => f.startsWith("--") && f !== "--help" && f !== "--version");
    expect(flags).toContain("--dry-run");
    expect(() => toolCli({ name: "t", version: "9.9.9", argv: flags, noVersionExit: true })).not.toThrow();
  });

  it("env block documents DEVENV_REPO", () => {
    expect(usageEnvBlock()).toContain("DEVENV_REPO");
  });
});
