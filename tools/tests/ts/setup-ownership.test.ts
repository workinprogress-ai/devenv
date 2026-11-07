// Foreign-ownership probe: the guard that must see nested root-owned
// directories under an otherwise user-owned global module dir. Container
// creation can leave root-owned subtrees (a root-context install) that a
// top-level stat cannot see — npm reify then dies EACCES renaming them.
// The nested-ownership fixture needs passwordless sudo (the same capability
// the reclaim itself depends on); environments without it skip the
// root-fixture case rather than fail spuriously.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hasForeignOwnership } from "../../ts/setup-steps/ownership.ts";

const me = execFileSync("whoami", { encoding: "utf8" }).trim();
const sudoOk = spawnSync("sudo", ["-n", "true"], { encoding: "utf8" }).status === 0;

let dir = "";
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "own-probe-")); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

describe("hasForeignOwnership", () => {
  it("clean tree — nothing foreign", () => {
    mkdirSync(join(dir, "pnpm", "dist"), { recursive: true });
    writeFileSync(join(dir, "pnpm", "dist", "f.txt"), "x");
    expect(hasForeignOwnership(dir, me)).toBe(false);
  });

  it("nested foreign-owned subtree is detected — the top-level-stat blind spot", () => {
    if (!sudoOk) return; // sudo-less environments skip the root fixture
    const nested = join(dir, "pnpm", "dist");
    mkdirSync(nested, { recursive: true });
    writeFileSync(join(nested, "f.txt"), "x");
    spawnSync("sudo", ["chown", "-R", "root:root", nested]);
    expect(hasForeignOwnership(dir, me)).toBe(true);
    // Restore ownership so afterEach's rmSync can remove the fixture.
    spawnSync("sudo", ["chown", "-R", `${me}:${me}`, dir]);
  });

  it("missing directory — nothing to reclaim", () => {
    expect(hasForeignOwnership(join(dir, "does-not-exist"), me)).toBe(false);
  });
});
