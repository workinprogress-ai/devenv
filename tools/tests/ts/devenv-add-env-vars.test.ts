// devenv-add-env-vars behavioral tests (port of test_devenv_add_env_vars.bats).
// Values must survive being sourced back, exactly: %q quoting keeps spaces,
// quotes, command substitution, globs and newlines literal; a plain token
// stays readable and unquoted. The tool writes to
// $DEVENV_ROOT/.runtime/env-vars.user.sh, so every test points DEVENV_ROOT at a
// throwaway directory; the real file is never touched.
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const TOOL = "devenv-add-env-vars";

let root: string;
let envFile: string;

function runTool(...args: string[]): { status: number; out: string } {
  const r = runHarness(TOOL, args, { env: { DEVENV_ROOT: root } });
  return { status: r.status, out: r.output };
}

// Print the value a fresh shell sees for NAME after sourcing the file.
function sourcedValue(name: string): string {
  const r = spawnSync("bash", ["-c", `source '${envFile}'; printf '%s' "\${${name}-<unset>}"`], {
    encoding: "utf8",
  });
  return r.stdout ?? "";
}

beforeEach(() => {
  root = join(tmpdir(), `envvars-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(join(root, ".runtime"), { recursive: true });
  envFile = join(root, ".runtime", "env-vars.user.sh");
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("devenv-add-env-vars", () => {
  it("a value with spaces and quotes round-trips exactly", () => {
    const value = `two words, it's "quoted" \\back`;
    expect(runTool(`MY_VAR=${value}`).status).toBe(0);
    expect(sourcedValue("MY_VAR")).toBe(value);
  });

  it("command substitution in a value is stored literally and never executed", () => {
    const r = runTool("MY_VAR=$(touch RAN_SUBSHELL)", "OTHER=`touch RAN_BACKTICK`", "THIRD=a;touch RAN_SEMICOLON");
    expect(r.status).toBe(0);
    expect(sourcedValue("MY_VAR")).toBe("$(touch RAN_SUBSHELL)");
    expect(sourcedValue("OTHER")).toBe("`touch RAN_BACKTICK`");
    expect(sourcedValue("THIRD")).toBe("a;touch RAN_SEMICOLON");
    expect(() => statSyncOrThrow(join(root, "RAN_SUBSHELL"))).toThrow();
    expect(existsSyncQuiet(join(root, "RAN_BACKTICK"))).toBe(false);
    expect(existsSyncQuiet(join(root, "RAN_SEMICOLON"))).toBe(false);
  });

  it("shell metacharacters, globs and edge whitespace round-trip", () => {
    expect(runTool("A=a & b # not a comment", "B=*.nomatch?[x]", "C= padded ").status).toBe(0);
    expect(sourcedValue("A")).toBe("a & b # not a comment");
    expect(sourcedValue("B")).toBe("*.nomatch?[x]");
    expect(sourcedValue("C")).toBe(" padded ");
  });

  it("a multi-line value stays one assignment and round-trips", () => {
    expect(runTool("MULTI=line one\nline two").status).toBe(0);
    expect(sourcedValue("MULTI")).toBe("line one\nline two");
    // Updating it later must replace it as a unit, not leave half behind.
    expect(runTool("MULTI=short").status).toBe(0);
    expect(sourcedValue("MULTI")).toBe("short");
    expect(readFileSync(envFile, "utf8").match(/^export MULTI=/gm)?.length).toBe(1);
  });

  it("an empty value sets the variable to empty", () => {
    expect(runTool("EMPTY=").status).toBe(0);
    expect(sourcedValue("EMPTY")).toBe("");
  });

  it("a plain token is written the way it always was, readable and unquoted", () => {
    expect(runTool("TS_AUTHKEY=tskey-abc123def456").status).toBe(0);
    const lines = readFileSync(envFile, "utf8").split("\n");
    expect(lines).toContain("export TS_AUTHKEY=tskey-abc123def456");
  });

  it("updating an existing variable replaces its line", () => {
    runTool("MY_VAR=first");
    expect(runTool("MY_VAR=second value").status).toBe(0);
    expect(readFileSync(envFile, "utf8").match(/^export MY_VAR=/gm)?.length).toBe(1);
    expect(sourcedValue("MY_VAR")).toBe("second value");
  });

  it("never touches the generated env-vars.sh", () => {
    const generated = join(root, ".runtime", "env-vars.sh");
    writeFileSync(generated, "#!/bin/bash\n# generated\n");
    expect(runTool("MY_VAR=1").status).toBe(0);
    expect(readFileSync(generated, "utf8")).toBe("#!/bin/bash\n# generated\n");
  });

  it("the user file is owner-only", () => {
    expect(runTool("MY_VAR=1").status).toBe(0);
    expect(statSync(envFile).mode & 0o777).toBe(0o600);
  });

  it("an invalid variable name is still refused", () => {
    const r = runTool("lower=case");
    expect(r.status).toBe(2);
    expect(r.out).toContain("Invalid environment variable format");
  });
});

import { existsSync, statSync } from "node:fs";
import { runTool as runHarness } from "./harness/index.ts";
function existsSyncQuiet(p: string): boolean {
  return existsSync(p);
}
function statSyncOrThrow(p: string): void {
  statSync(p);
}
