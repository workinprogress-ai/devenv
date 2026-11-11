// provider-core repo targeting and auth: the cwd leg resolves the repository
// from the clone's origin remote (the clone directory's name is free), and
// Azure's token/auth probe use the PAT that every Azure call authenticates
// with. Each case runs in a child node process: provider detection and the
// capability table are per-process state.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { canaryEnv } from "./harness/canary.ts";
import { pathWithStubs, rmrf, stubCli, tmpDir } from "./harness/index.ts";

const CORE = join(import.meta.dirname, "../../lib/providers/provider-core.ts");

let root = "";
let stubDir = "";

beforeEach(() => {
  root = tmpDir("pcore-root");
  stubDir = tmpDir("pcore-stubs");
});

afterEach(() => {
  rmrf(root);
  rmrf(stubDir);
});

function writeConfig(provider: string): void {
  writeFileSync(join(root, "devenv.config"), `[provider]\nname=${provider}\n\n[organization]\norg=acme\n`);
}

/** Run a snippet against provider-core in a child process (cwd given). */
function runCore(
  body: string,
  opts: { cwd?: string; env?: Record<string, string> } = {},
): { status: number; stdout: string; stderr: string } {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    ...canaryEnv(),
    PATH: pathWithStubs(stubDir),
    DEVENV_ROOT: root,
    DEVENV_REPO: "",
    GH_REPO: "",
    ...opts.env,
  };
  const r = spawnSync(
    process.execPath,
    ["--input-type=module", "-e", `const m = await import(${JSON.stringify(CORE)});\n${body}`],
    { encoding: "utf8", cwd: opts.cwd ?? root, env },
  );
  return { status: r.status ?? 1, stdout: (r.stdout ?? "").trim(), stderr: r.stderr ?? "" };
}

/** A throwaway git work tree named `dirName` (optionally with an origin). */
function cloneDir(dirName: string, origin?: string): string {
  const dir = join(root, dirName);
  mkdirSync(dir, { recursive: true });
  expect(spawnSync("git", ["init", "-q", dir]).status).toBe(0);
  if (origin !== undefined) {
    expect(spawnSync("git", ["-C", dir, "remote", "add", "origin", origin]).status).toBe(0);
  }
  return dir;
}

describe("providerRepoTarget cwd leg", () => {
  it("github: a clone whose directory name differs from the repo gets the origin's spec", () => {
    writeConfig("github");
    const dir = cloneDir("devenv.omsnic", "https://github.com/acme/real-name.git");
    expect(runCore("console.log(m.providerRepoTarget(''));", { cwd: dir }).stdout).toBe("acme/real-name");
  });

  it("github: an scp-style origin resolves too", () => {
    writeConfig("github");
    const dir = cloneDir("whatever", "git@github.com:acme/scp-name.git");
    expect(runCore("console.log(m.providerRepoTarget(''));", { cwd: dir }).stdout).toBe("acme/scp-name");
  });

  it("azure: the spec is the origin's project/repo, not org/dirname", () => {
    writeConfig("azure");
    const dir = cloneDir("some-dir", "https://acme@dev.azure.com/acme/proj/_git/azrepo");
    expect(runCore("console.log(m.providerRepoTarget(''));", { cwd: dir }).stdout).toBe("proj/azrepo");
  });

  it("azure: a plain https origin (no userinfo) resolves too", () => {
    writeConfig("azure");
    const dir = cloneDir("other-dir", "https://dev.azure.com/acme/proj/_git/azrepo");
    expect(runCore("console.log(m.providerRepoTarget(''));", { cwd: dir }).stdout).toBe("proj/azrepo");
  });

  it("falls back to org/directory-name only when there is no origin", () => {
    writeConfig("github");
    const dir = cloneDir("no-origin-dir");
    expect(runCore("console.log(m.providerRepoTarget(''));", { cwd: dir }).stdout).toBe("acme/no-origin-dir");
  });

  it("an origin on a foreign host falls back to the directory-name rule", () => {
    writeConfig("github");
    const dir = cloneDir("foreign-dir", "https://example.invalid/x/y.git");
    expect(runCore("console.log(m.providerRepoTarget(''));", { cwd: dir }).stdout).toBe("acme/foreign-dir");
  });
});

describe("azure auth through the PAT", () => {
  it("providerAuthToken returns the PAT and runs no process", () => {
    writeConfig("azure");
    const log = join(stubDir, "calls.log");
    for (const tool of ["az", "bash"]) {
      stubCli(stubDir, tool, `#!/bin/sh\necho "${tool} $*" >> "${log}"\nexit 1`);
    }
    const r = runCore("console.log(m.providerAuthToken());", { env: { AZURE_PAT: "pat-from-env-123" } });
    expect(r.stdout).toBe("pat-from-env-123");
    expect(existsSync(log) ? readFileSync(log, "utf8") : "").toBe("");
  });

  it("providerAuthToken reads the 0600 PAT file when no env PAT is set", () => {
    writeConfig("azure");
    const patFile = join(root, "pat");
    writeFileSync(patFile, "pat-from-file-456\n", { mode: 0o600 });
    const r = runCore("console.log(m.providerAuthToken());", { env: { AZURE_PAT: "", AZURE_PAT_FILE: patFile } });
    expect(r.stdout).toBe("pat-from-file-456");
  });

  it("ensureProviderAuth passes with only the AZURE_PAT env leg set", () => {
    writeConfig("azure");
    const r = runCore("m.ensureProviderAuth(); console.log('AUTH-OK');", {
      env: { AZURE_PAT: "pat-from-env-123", AZURE_PAT_FILE: join(root, "absent") },
    });
    expect(r.stdout).toBe("AUTH-OK");
  });

  it("ensureProviderAuth still refuses when neither leg exists", () => {
    writeConfig("azure");
    const r = runCore("m.ensureProviderAuth(); console.log('AUTH-OK');", {
      env: { AZURE_PAT: "", AZURE_PAT_FILE: join(root, "absent") },
    });
    expect(r.status).not.toBe(0);
    expect(r.stdout).not.toContain("AUTH-OK");
  });
});
