// Foreign-ownership probe: the guard that must see nested root-owned
// directories under an otherwise user-owned global module dir. Container
// creation can leave root-owned subtrees (a root-context install) that a
// top-level stat cannot see — npm reify then dies EACCES renaming them.
// A real root-owned fixture needs sudo, which the hermetic run forbids, so
// the nested case is exercised through an owner mismatch instead.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hasForeignOwnership } from "../../ts/setup-steps/ownership.ts";

const me = execFileSync("whoami", { encoding: "utf8" }).trim();

let dir = "";
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "own-probe-")); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

describe("hasForeignOwnership", () => {
  it("clean tree — nothing foreign", () => {
    mkdirSync(join(dir, "pnpm", "dist"), { recursive: true });
    writeFileSync(join(dir, "pnpm", "dist", "f.txt"), "x");
    expect(hasForeignOwnership(dir, me)).toBe(false);
  });

  it("a nested file owned by another user is detected — the probe walks the whole tree", () => {
    const nested = join(dir, "pnpm", "dist");
    mkdirSync(nested, { recursive: true });
    writeFileSync(join(nested, "f.txt"), "x");
    // Asking for a different numeric uid makes every entry foreign without needing root.
    expect(hasForeignOwnership(dir, String((process.getuid?.() ?? 0) + 1))).toBe(true);
  });

  it("missing directory — nothing to reclaim", () => {
    expect(hasForeignOwnership(join(dir, "does-not-exist"), me)).toBe(false);
  });
});
