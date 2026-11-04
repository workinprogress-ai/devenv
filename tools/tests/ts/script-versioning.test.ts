// Port of tools/tests/devenv/test_script_versioning.bats (12 tests) — one vitest `it` per source `@test`.
import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))));

// Port of tools/tests/devenv/test_script_versioning.bats — one vitest `it` per source `@test`.

// ── script versioning (port of test_script_versioning.bats, 12 tests) ────

describe("script versioning", () => {
  it("bootstrap.sh has valid bash syntax", () => {
    expect(spawnSync("bash", ["-n", join(ROOT, ".devcontainer/bootstrap.sh")]).status).toBe(0);
  });

  it("versioning library is present", () => {
    expect(existsSync(join(ROOT, "tools/lib/versioning.bash"))).toBe(true);
  });

  it("versioning library has valid syntax", () => {
    expect(spawnSync("bash", ["-n", join(ROOT, "tools/lib/versioning.bash")]).status).toBe(0);
  });

  it("versioning library defines check_environment_requirements function", () => {
    const r = spawnSync("grep", ["check_environment_requirements()", join(ROOT, "tools/lib/versioning.bash")], { encoding: "utf8" });
    expect(r.status).toBe(0);
  });

  it("versioning library defines MIN_BASH_VERSION", () => {
    const r = spawnSync("grep", ["readonly MIN_BASH_VERSION=", join(ROOT, "tools/lib/versioning.bash")], { encoding: "utf8" });
    expect(r.status).toBe(0);
  });

  it("versioning library defines MIN_GIT_VERSION", () => {
    const r = spawnSync("grep", ["readonly MIN_GIT_VERSION=", join(ROOT, "tools/lib/versioning.bash")], { encoding: "utf8" });
    expect(r.status).toBe(0);
  });

  it("repo-bump-version carries the error-handling equivalent", () => {
    const r = spawnSync("grep", ["core/exit-codes.ts", join(ROOT, "tools/ts/repo-bump-version.ts")], { encoding: "utf8" });
    expect(r.status).toBe(0);
  });

  it("repo-bump-version carries the git equivalent (repo-get + core spawn)", () => {
    const r = spawnSync("grep", ["repo-get", join(ROOT, "tools/ts/repo-bump-version.ts")], { encoding: "utf8" });
    expect(r.status).toBe(0);
  });

  it("repo-calc-version.sh has valid syntax", () => {
    expect(spawnSync("bash", ["-n", join(ROOT, "tools/repo-calc-version")]).status).toBe(0);
  });

  it("repo-calc-version carries the release version module", () => {
    const r = spawnSync("grep", ["domain/release/version.ts", join(ROOT, "tools/ts/repo-calc-version.ts")], { encoding: "utf8" });
    expect(r.status).toBe(0);
  });

  it("tooling-create-script.sh has valid syntax", () => {
    expect(spawnSync("bash", ["-n", join(ROOT, "tools/tooling-create-script")]).status).toBe(0);
  });

  it("tooling-create-script.sh references template file", () => {
    const r = spawnSync("grep", ["template", join(ROOT, "tools/ts/tooling-create-script.ts")], { encoding: "utf8" });
    expect(r.status).toBe(0);
  });
});
