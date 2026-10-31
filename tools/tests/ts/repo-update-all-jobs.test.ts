// Tests for repo-update-all's --jobs validation (15.105): a zero pool never
// launches and never completes — refused with a named error before spawn.
import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const TOOL = join(fileURLToPath(new URL(".", import.meta.url)), "../../ts/repo-update-all.ts");

function run(args: string[]): { status: number; output: string } {
  const r = spawnSync("node", [TOOL, ...args], {
    encoding: "utf8",
    input: "",
    timeout: 15000, // the old bug: a hang, not an exit
  });
  return { status: r.status ?? -1, output: (r.stdout ?? "") + (r.stderr ?? "") };
}

describe("repo-update-all --jobs", () => {
  it("--jobs 0 is a named error, never a hang", () => {
    const r = run(["--jobs", "0"]);
    expect(r.status).not.toBe(0);
    expect(r.output).toContain("--jobs 0 would deadlock");
  });

  it("--jobs 00 is a named error too", () => {
    const r = run(["--jobs", "00"]);
    expect(r.status).not.toBe(0);
    expect(r.output).toContain("--jobs 0 would deadlock");
  });
});
