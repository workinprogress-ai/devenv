// Smoke tests for the lib/ts minimal core. These are also the exemplar of
// the black-box port pattern: spawn/assert on observable outcomes, preserve
// stderr/stdout semantics, no internals poking beyond what the contract
// exposes.
import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { selfRoot, resolveToolsRoot } from "../../lib/core/self-root.ts";
import { EXIT_MISUSE, EXIT_CONFLICT, EXIT_API_FAILURE } from "../../lib/core/exit-codes.ts";
import { logWarn } from "../../lib/core/logging.ts";
import { run, mustRun, SpawnError } from "../../lib/core/spawn.ts";

const HERE = new URL(".", import.meta.url).pathname;

describe("self-root", () => {
  it("derives the checkout root from a lib path", () => {
    const root = selfRoot(HERE);
    // Structural assertion, not a clone-name coupling: the root is the
    // checkout (owns devenv.config + copilot/ + tools/), HERE lives under
    // <root>/tools/tests/ts/.
    expect(existsSync(join(root, "devenv.config"))).toBe(true);
    expect(existsSync(join(root, "copilot"))).toBe(true);
    expect(HERE.startsWith(root)).toBe(true);
  });

  it("rejects a foreign DEVENV_TOOLS export", () => {
    process.env["DEVENV_TOOLS"] = "/foreign/checkout/tools";
    try {
      expect(resolveToolsRoot(HERE).endsWith("/tools")).toBe(true);
      expect(resolveToolsRoot(HERE)).not.toContain("/foreign/");
    } finally {
      delete process.env["DEVENV_TOOLS"];
    }
  });
});

describe("exit codes", () => {
  it("mirrors the bash contract values", () => {
    expect(EXIT_MISUSE).toBe(2);
    expect(EXIT_CONFLICT).toBe(3);
    expect(EXIT_API_FAILURE).toBe(4);
  });
});

describe("logging", () => {
  it("emits the suite format on stderr", () => {
    const errs: string[] = [];
    const orig = process.stderr.write.bind(process.stderr);
    (process.stderr as { write: (s: string) => boolean }).write = (s: string) => {
      errs.push(s);
      return true;
    };
    try {
      logWarn("probe");
    } finally {
      (process.stderr as { write: (s: string) => boolean }).write = orig;
    }
    expect(errs[0]).toMatch(/^\[\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\] WARN : probe/);
  });
});

describe("spawn", () => {
  it("captures status and stdout without a shell", async () => {
    const r = await run(["printf", "hello %s", "world"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toBe("hello world");
  });

  it("preserves argv boundaries (no quoting surprises)", async () => {
    const r = await run(["printf", "[%s]", "a b c"]);
    expect(r.stdout).toBe("[a b c]");
  });

  it("mustRun throws SpawnError on non-zero exit", async () => {
    await expect(mustRun(["false"])).rejects.toThrow(SpawnError);
  });

  it("reports a missing binary as launch failure", async () => {
    await expect(run(["definitely-not-a-binary-xyz"])).rejects.toThrow(SpawnError);
  });
});

describe("node-floor module (black-box spawn)", () => {
  it("runs directly and exits 0 on a compliant runtime", () => {
    const r = spawnSync("node", [`${HERE}../../lib/core/node-floor.ts`], { encoding: "utf8" });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("node-floor: ok");
  });
});
