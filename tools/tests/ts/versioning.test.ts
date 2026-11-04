// Port of test_versioning.bats (16 tests): lib/versioning.bash — version
// parsing, comparison, minimum checks. Pre-release/build suffixes ("-rc.1",
// "+build5") are ignored: versions compare by their numeric core.
import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))));
const LIB = join(ROOT, "tools/lib/versioning.bash");

function v(script: string): { status: number; out: string } {
  const r = spawnSync("bash", ["-c", `source '${LIB}' && ${script}`], { encoding: "utf8" });
  return { status: r.status ?? 1, out: (r.stdout ?? "") + (r.stderr ?? "") };
}

describe("versioning library", () => {
  it("versioning.bash has valid bash syntax", () => {
    expect(spawnSync("bash", ["-n", LIB]).status).toBe(0);
  });

  it("parse_version extracts version components", () => {
    const r = v("parse_version '1.2.3'");
    expect(r.status).toBe(0);
    expect(r.out.trim()).toBe("1 2 3");
  });

  it("compare_versions handles equality", () => {
    expect(v("compare_versions '1.2.3' '1.2.3'").status).toBe(0);
  });

  it("compare_versions identifies greater/less", () => {
    expect(v("compare_versions '2.0.0' '1.5.0'").status).toBe(1);
    expect(v("compare_versions '1.0.0' '2.0.0'").status).toBe(2);
  });

  it("version_gte returns correct truthiness", () => {
    expect(v("version_gte '2.0.0' '1.0.0'").status).toBe(0);
    expect(v("version_gte '1.0.0' '2.0.0'").status).not.toBe(0);
  });

  it("get_bash_version returns a version", () => {
    const r = v("get_bash_version");
    expect(r.status).toBe(0);
    expect(r.out.trim()).toMatch(/^[0-9]+\.[0-9]+/);
  });

  it("get_git_version returns a version", () => {
    const r = v("get_git_version");
    expect(r.status).toBe(0);
    expect(r.out.trim()).toMatch(/^[0-9]+\.[0-9]+/);
  });

  it("check_bash_version and check_git_version succeed for current tools", () => {
    expect(v("check_bash_version '4.0'").status).toBe(0);
    expect(v("check_git_version '2.0'").status).toBe(0);
  });

  it("check_bash_version fails for impossible requirement", () => {
    const r = v("check_bash_version '999.0'");
    expect(r.status).not.toBe(0);
    expect(r.out).toMatch(/ERROR/);
  });

  it("check_git_version fails for impossible requirement", () => {
    const r = v("check_git_version '999.0'");
    expect(r.status).not.toBe(0);
    expect(r.out).toMatch(/ERROR/);
  });

  it("require_script_version enforces minimums", () => {
    expect(v("require_script_version '2.0.0' '1.5.0' 'test.sh'").status).toBe(0);
    const r = v("require_script_version '1.0.0' '2.0.0' 'test.sh'");
    expect(r.status).not.toBe(0);
    expect(r.out).toMatch(/ERROR/);
    expect(r.out).toContain("test.sh");
  });

  it("MIN version constants are defined", () => {
    const bash = v("echo $MIN_BASH_VERSION");
    expect(bash.status).toBe(0);
    expect(bash.out.trim()).toMatch(/^[0-9]+\.[0-9]+/);
    const git = v("echo $MIN_GIT_VERSION");
    expect(git.status).toBe(0);
    expect(git.out.trim()).toMatch(/^[0-9]+\.[0-9]+/);
  });

  it("compare_versions: a pre-release suffix on the patch compares by its numeric core", () => {
    const gt = v("compare_versions 1.2.4-rc.1 1.2.3 2>&1; echo \"rc=$?\"");
    expect(gt.out.trim()).toBe("rc=1");
    const lt = v("compare_versions 1.2.2-rc.1 1.2.3 2>&1; echo \"rc=$?\"");
    expect(lt.out.trim()).toBe("rc=2");
  });

  it("compare_versions: a version equals its own pre-release (numeric core only)", () => {
    const r = v("compare_versions 1.2.3-rc.1 1.2.3 2>&1; echo \"rc=$?\"");
    expect(r.out.trim()).toBe("rc=0");
  });

  it("compare_versions: a build suffix on any segment is ignored without noise", () => {
    const gt = v("compare_versions 2.0.0+build5 1.9.9 2>&1; echo \"rc=$?\"");
    expect(gt.out.trim()).toBe("rc=1");
    const eq = v("compare_versions 1.2-beta 1.2.0 2>&1; echo \"rc=$?\"");
    expect(eq.out.trim()).toBe("rc=0");
  });

  it("version_gte works with a pre-release suffix", () => {
    expect(v("version_gte 2.1.0-rc.2 2.0.0").status).toBe(0);
    expect(v("version_gte 1.9.0-rc.2 2.0.0").status).not.toBe(0);
  });
});
