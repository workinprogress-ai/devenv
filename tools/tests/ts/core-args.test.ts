// Behavioral tests for core/args: the misuse contract — the swallowed-flag
// guard, env requirements, and the exit codes each helper uses. The exit*
// helpers terminate the process, so each is exercised in a child Node run.
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs, requireOptionValue } from "../../lib/core/args.ts";

const MODULE = new URL("../../lib/core/args.ts", import.meta.url).pathname;

/** Run a snippet in a child Node process that imports the module. */
function runInChild(code: string, env: NodeJS.ProcessEnv = {}): { status: number; out: string } {
  const bootstrap = `import { ${[
    "invalidArgs",
    "requireOptionValue",
    "requireEnv",
    "requireFile",
    "requireDirectory",
    "requirePermission",
  ].join(",")} } from ${JSON.stringify(MODULE)};\n${code}`;
  const r = spawnSync(process.execPath, ["--input-type=module", "-e", bootstrap], {
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
  return { status: r.status ?? 1, out: (r.stdout + r.stderr).trim() };
}

describe("requireOptionValue (in-process)", () => {
  it("passes real values through", () => {
    expect(requireOptionValue("--base", "main")).toBe("main");
    // free text starting with dashes (after --) is a value, not a flag
    expect(requireOptionValue("--note", "-x")).toBe("-x");
  });

  it("throws (exits) on undefined/empty in-process via exit hook", () => {
    // invalidArgs calls process.exit — assert the exit code by stubbing.
    const orig = process.exit;
    let code: number | undefined;
    process.exit = ((c?: number) => {
      code = c;
      throw new Error("exited");
    }) as typeof process.exit;
    try {
      for (const bad of [undefined, "", "--force"]) {
        code = undefined;
        expect(() => requireOptionValue("--base", bad)).toThrow("exited");
        expect(code).toBe(2);
      }
    } finally {
      process.exit = orig;
    }
  });
});

describe("parseArgs passthrough", () => {
  it("behaves like node:util parseArgs (strict by default)", () => {
    const { values } = parseArgs({ args: ["--name", "x"], options: { name: { type: "string" } } });
    expect(values.name).toBe("x");
  });
});

describe("exit contracts (child processes)", () => {
  let dir: string;
  let file: string;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "args-test-"));
    file = join(dir, "exists.txt");
    writeFileSync(file, "x");
    mkdirSync(join(dir, "subdir"));
  });

  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("invalidArgs exits 2 and prints the help hint", () => {
    const r = runInChild(`invalidArgs("bad usage");`);
    expect(r.status).toBe(2);
    expect(r.out).toContain("Use --help");
  });

  it("requireOptionValue exits 2 on missing and swallowed-flag values", () => {
    expect(runInChild(`requireOptionValue("--base", undefined);`).status).toBe(2);
    expect(runInChild(`requireOptionValue("--base", "");`).status).toBe(2);
    const swallowed = runInChild(`requireOptionValue("--base", "--force");`);
    expect(swallowed.status).toBe(2);
    expect(swallowed.out).toContain("--force");
  });

  it("requireEnv exits 2 when unset, returns the value when set", () => {
    expect(runInChild(`requireEnv("DEFINITELY_UNSET_VAR_XYZ");`).status).toBe(2);
    const ok = runInChild(
      `if (requireEnv("ARGS_TEST_VAR") === "hello") console.log("OK");`,
      { ARGS_TEST_VAR: "hello" },
    );
    expect(ok.out).toContain("OK");
  });

  it("requireFile/requireDirectory exit 4 (bash parity) when missing", () => {
    expect(runInChild(`requireFile("/definitely/missing/file.txt");`).status).toBe(4);
    expect(runInChild(`requireDirectory("/definitely/missing/dir");`).status).toBe(4);
    expect(runInChild(`requireFile(${JSON.stringify(file)}); console.log("OK");`).out).toContain("OK");
    expect(
      runInChild(`requireDirectory(${JSON.stringify(join(dir, "subdir"))}); console.log("OK");`).out,
    ).toContain("OK");
  });

  it("requirePermission exits 1 on denial, passes when allowed", () => {
    expect(runInChild(`requirePermission(${JSON.stringify(file)}, "r"); console.log("OK");`).out).toContain("OK");
    if (process.getuid?.() !== 0) {
      // root bypasses permission checks; only meaningful as non-root
      const denied = runInChild(`requirePermission("/proc/1/mem", "w");`);
      expect(denied.status).toBe(1);
    }
  });
});
