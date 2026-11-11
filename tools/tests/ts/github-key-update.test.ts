// The GitHub credential rotation entry point: a token piped on stdin reaches
// `gh auth login --with-token` through stdin only (never argv), and each failure
// shape exits with its documented code.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pathWithStubs, rmrf, stubCalls, stubCli, tmpStubBin, toolScript } from "./harness/index.ts";
import { EXIT_GENERAL_ERROR, EXIT_MISUSE } from "../../lib/core/exit-codes.ts";

const MODULE = join(toolScript("x"), "..", "..", "lib", "providers", "github", "key-update.ts");

let stubDir = "";

function installGh(loginExit: number): void {
  stubCli(
    stubDir,
    "gh",
    [
      "#!/usr/bin/env bash",
      `printf '%s\\n' "gh $*" >> "${stubDir}/calls.log"`,
      `if [ "$1" = "auth" ] && [ "$2" = "login" ]; then cat > "${stubDir}/stdin.txt"; exit ${loginExit}; fi`,
      "exit 0",
    ].join("\n"),
  );
}

function rotate(input: string, args: string[] = []): { status: number; out: string } {
  const r = spawnSync(process.execPath, [MODULE, ...args], {
    encoding: "utf8",
    input,
    env: { ...process.env, PATH: pathWithStubs(stubDir) },
  });
  return { status: r.status ?? 1, out: (r.stdout ?? "") + (r.stderr ?? "") };
}

beforeEach(() => {
  stubDir = tmpStubBin("gh-key-update");
});

afterEach(() => {
  rmrf(stubDir);
});

describe("github key-update", () => {
  it("a piped token reaches gh through stdin, never argv, and git is wired for https", () => {
    installGh(0);
    const r = rotate("ghp_testtoken123\n");
    expect(r.out).toContain("Success");
    expect(r.status).toBe(0);
    expect(readFileSync(join(stubDir, "stdin.txt"), "utf8")).toBe("ghp_testtoken123");
    const calls = stubCalls(stubDir, "gh");
    expect(calls).toEqual([
      "gh auth login --with-token --hostname github.com --skip-ssh-key",
      "gh auth setup-git --hostname github.com",
    ]);
    expect(calls.join("\n")).not.toContain("ghp_testtoken123");
  });

  it("an empty stdin is refused as misuse before gh is touched", () => {
    installGh(0);
    const r = rotate("");
    expect(r.status).toBe(EXIT_MISUSE);
    expect(r.out).toContain("No token provided");
    expect(stubCalls(stubDir, "gh")).toEqual([]);
  });

  it("a token gh rejects exits with the general error and skips the git wiring", () => {
    installGh(1);
    const r = rotate("ghp_rejected\n");
    expect(r.status).toBe(EXIT_GENERAL_ERROR);
    expect(r.out).toContain("credential import failed");
    expect(stubCalls(stubDir, "gh")).toEqual(["gh auth login --with-token --hostname github.com --skip-ssh-key"]);
  });

  it("a token given as an argument is refused so it never reaches the process list", () => {
    installGh(0);
    const r = rotate("", ["ghp_asargument"]);
    expect(r.status).toBe(EXIT_MISUSE);
    expect(r.out).toContain("not accepted as an argument");
    expect(stubCalls(stubDir, "gh")).toEqual([]);
  });
});
