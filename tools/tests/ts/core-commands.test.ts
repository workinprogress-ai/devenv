// core-commands.test.ts — unit suite for lib/core/commands.ts.
import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { commandAvailable, requireCommand, MissingCommandError } from "../../lib/core/commands.ts";

describe("commands", () => {
  it("commandAvailable: true for git (always present in this container)", () => {
    expect(commandAvailable("git")).toBe(true);
  });

  it("commandAvailable: false for a nonexistent command", () => {
    expect(commandAvailable("definitely-not-a-real-command-xyz")).toBe(false);
  });

  it("requireCommand: passes silently when present", () => {
    expect(() => requireCommand("git")).not.toThrow();
  });

  it("requireCommand: throws MissingCommandError naming cmd + hint when absent", () => {
    try {
      requireCommand("not-a-cmd-xyz", "Install via apt");
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(MissingCommandError);
      const e = err as MissingCommandError;
      expect(e.message).toContain("not-a-cmd-xyz");
      expect(e.message).toContain("Install via apt");
    }
  });

  it("requireCommandOrExit: exits EXIT_MISUSE (2) with the log line (child process)", () => {
    const LIB = join(fileURLToPath(new URL(".", import.meta.url)), "../../lib/core/commands.ts");
    const r = spawnSync(
      "node",
      [
        "-e",
        `import(${JSON.stringify("file://" + LIB)}).then(m => m.requireCommandOrExit("not-a-cmd-xyz", "hint here"));`,
      ],
      { encoding: "utf8", input: "" },
    );
    expect(r.status).toBe(2);
    expect((r.stderr ?? "") + (r.stdout ?? "")).toContain("not-a-cmd-xyz");
  });
});
