// The hermetic test environment: the regular run never inherits the host's
// devenv root, config folders, provider credentials or devenv tools directories.
import { describe, it, expect } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { filterEnv, cleanPath, keepVariable, restoreAnchors } from "./harness/env.ts";
import { canaryEnv, canaryNodeOptions } from "./harness/canary.ts";
import { assertNoCanaryHits, canaryHits, drainCanary } from "./harness/canary.ts";
import { rmrf, stubGh, tmpStubBin } from "./harness/index.ts";
import { providerDetect } from "../../lib/providers/provider-core.ts";

describe("filterEnv", () => {
  it("drops devenv, provider, credential and identity variables", () => {
    const out = filterEnv({
      PATH: "/usr/bin",
      DEVENV_ROOT: "/workspace",
      DEVENV_TOOLS: "/workspace/tools",
      CONFIG_FOLDER: "/workspace/.debug/config",
      DATA_FOLDER: "/workspace/.debug/data",
      PROVIDER_NAME: "azure",
      AZURE_PAT: "secret",
      AZURE_DEVOPS_ORG: "org",
      GH_TOKEN: "secret",
      GITHUB_TOKEN: "secret",
      SSH_AUTH_SOCK: "/tmp/agent",
      DIGITALOCEAN_API_TOKEN: "secret",
      USER_EMAIL: "someone@example.com",
      EDITOR: "code --wait",
    });
    expect(Object.keys(out)).toEqual(["PATH"]);
  });

  it("keeps the variables a worker needs", () => {
    for (const name of ["PATH", "TMPDIR", "LANG", "LC_ALL", "TERM", "NODE_OPTIONS", "VITEST_WORKER_ID", "CI"]) {
      expect(keepVariable(name), name).toBe(true);
    }
  });
});

describe("cleanPath", () => {
  it("removes a directory that holds ts/ and lib/ (a devenv tools directory)", () => {
    const toolsDir = join(process.cwd(), "tools");
    expect(existsSync(join(toolsDir, "ts"))).toBe(true);
    const out = cleanPath(`${toolsDir}:/usr/bin:/bin`);
    expect(out).toBe("/usr/bin:/bin");
  });
});

describe("the worker environment", () => {
  it("points DEVENV_ROOT at a temporary fixture with a github-provider config", () => {
    const root = process.env["DEVENV_ROOT"] ?? "";
    expect(root.startsWith(tmpdir())).toBe(true);
    expect(readFileSync(join(root, "devenv.config"), "utf8")).toMatch(/^name=github$/m);
  });

  it("resolves the github provider regardless of the host's devenv.config", () => {
    expect(providerDetect(true)).toBe("github");
  });

  it("carries no provider, credential or config-folder variables", () => {
    const leaked = Object.keys(process.env).filter((n) =>
      /^(AZURE_|GH_|GITHUB_|PROVIDER_|DIGITALOCEAN_|CONFIG_FOLDER$|DATA_FOLDER$|SSH_AUTH_SOCK$|USER_EMAIL$)/.test(n),
    );
    expect(leaked).toEqual([]);
  });

  it("uses an empty HOME with a fixed git identity", () => {
    const home = process.env["HOME"] ?? "";
    expect(home.startsWith(tmpdir())).toBe(true);
    const r = spawnSync("git", ["config", "--global", "user.email"], { encoding: "utf8" });
    expect(r.stdout.trim()).toBe("test@example.com");
  });

  it("has no devenv tools directory on PATH", () => {
    const dirs = (process.env["PATH"] ?? "").split(":");
    expect(dirs.filter((d) => existsSync(join(d, "ts")) && existsSync(join(d, "lib")))).toEqual([]);
  });
});

describe("the no-network canary", () => {
  it.each(["gh", "az", "curl", "kubectl", "docker", "sudo", "dotnet", "apt-get", "pkill", "mongosh", "telepresence", "terraform"])("a real %s that no stub shadows exits 99 and is recorded", (name) => {
    const r = spawnSync(name, ["some", "args"], { encoding: "utf8" });
    expect(r.status).toBe(99);
    expect(r.stderr).toContain("devenv test canary");
    expect(drainCanary()).toEqual([`${name} some args`]);
  });

  it("a stub directory ahead of the shims shadows them without tripping the canary", () => {
    const dir = tmpStubBin("canary-stub");
    try {
      stubGh(dir);
      const r = spawnSync("gh", ["auth", "status"], {
        encoding: "utf8",
        env: { ...process.env, PATH: `${dir}:${process.env["PATH"] ?? ""}` },
      });
      expect(r.status).toBe(0);
      expect(canaryHits()).toEqual([]);
    } finally {
      rmrf(dir);
    }
  });

  it("assertNoCanaryHits throws naming the call that escaped, then clears the log", () => {
    spawnSync("gh", ["issue", "view", "42"], { encoding: "utf8" });
    expect(() => assertNoCanaryHits()).toThrow(/gh issue view 42/);
    expect(() => assertNoCanaryHits()).not.toThrow();
  });

  it("rejects fetch to a real host in the worker and records it", async () => {
    await expect(fetch("https://dev.azure.com/org/_apis/wit")).rejects.toThrow(/canary/);
    expect(drainCanary()).toEqual(["fetch https://dev.azure.com/org/_apis/wit"]);
  });

  it("lets loopback fetches through to the network layer", async () => {
    const err = await fetch("http://127.0.0.1:1/").then(
      () => "",
      (e: Error) => e.message,
    );
    expect(err).not.toMatch(/canary/);
    expect(canaryHits()).toEqual([]);
  });

  it("rejects fetch to a real host in a spawned node process", () => {
    const r = spawnSync(
      process.execPath,
      ["-e", "fetch('https://api.github.com/rate_limit').catch((e) => console.log(e.message))"],
      { encoding: "utf8" },
    );
    expect(r.stdout).toMatch(/canary/);
    expect(drainCanary()).toEqual(["fetch https://api.github.com/rate_limit"]);
  });
});

describe("cleanPath keeps what it should keep", () => {
  function fixture(): string {
    return mkdtempSync(join(tmpdir(), "cleanpath-"));
  }

  it("keeps a directory that has ts/ but no lib/, or lib/ but no ts/", () => {
    const onlyTs = fixture();
    const onlyLib = fixture();
    mkdirSync(join(onlyTs, "ts"));
    mkdirSync(join(onlyLib, "lib"));
    expect(cleanPath(`${onlyTs}:${onlyLib}`)).toBe(`${onlyTs}:${onlyLib}`);
  });

  it("keeps a file entry and a directory that does not exist, and drops empty entries", () => {
    const dir = fixture();
    const file = join(dir, "not-a-dir");
    writeFileSync(file, "x");
    expect(cleanPath(`${file}:/no/such/dir::${dir}`)).toBe(`${file}:/no/such/dir:${dir}`);
  });

  it("drops a directory that has both ts/ and lib/", () => {
    const toolsDir = fixture();
    mkdirSync(join(toolsDir, "ts"));
    mkdirSync(join(toolsDir, "lib"));
    expect(cleanPath(`${toolsDir}:/usr/bin`)).toBe("/usr/bin");
  });
});

describe("canary plumbing", () => {
  it("canaryNodeOptions appends to a host value and is idempotent", () => {
    const once = canaryNodeOptions("--max-old-space-size=512");
    expect(once.startsWith("--max-old-space-size=512 --import=")).toBe(true);
    expect(canaryNodeOptions(once)).toBe(once);
    expect(canaryNodeOptions(undefined)).toMatch(/^--import=/);
    expect(canaryNodeOptions("")).toMatch(/^--import=/);
  });

  it("the preload loads from a checkout path containing a space", () => {
    const dir = mkdtempSync(join(tmpdir(), "canary space "));
    try {
      const preload = join(dir, "checkout with space", "canary-fetch.ts");
      mkdirSync(join(dir, "checkout with space"), { recursive: true });
      writeFileSync(preload, readFileSync(join(import.meta.dirname, "harness", "canary-fetch.ts")));
      const log = join(dir, "canary.log");
      const r = spawnSync(
        "node",
        ["-e", "fetch('https://example.invalid/x').catch(() => console.log('blocked'))"],
        {
          encoding: "utf8",
          env: { PATH: process.env["PATH"] ?? "", NODE_OPTIONS: canaryNodeOptions(undefined, preload), DEVENV_TEST_CANARY_LOG: log },
        },
      );
      expect(r.stderr).not.toContain("ERR_MODULE_NOT_FOUND");
      expect(r.status).toBe(0);
      expect(r.stdout.trim()).toBe("blocked");
      expect(readFileSync(log, "utf8")).toContain("fetch https://example.invalid/x");
    } finally {
      rmrf(dir);
    }
  });

  it("canaryEnv carries the shims, the preload and the log path to a child with a minimal env", () => {
    const env = canaryEnv();
    expect(Object.keys(env).sort()).toEqual(["DEVENV_TEST_CANARY_LOG", "NODE_OPTIONS", "PATH"]);
    const r = spawnSync(
      process.execPath,
      ["-e", "fetch('https://example.test/x').catch((e) => console.log(e.message))"],
      { encoding: "utf8", env },
    );
    expect(r.stdout).toMatch(/canary/);
    expect(drainCanary()).toEqual(["fetch https://example.test/x"]);
  });

  it("a child given only the shim PATH cannot start wget or ssh either", () => {
    for (const name of ["wget", "ssh"]) {
      const r = spawnSync(name, ["host"], { encoding: "utf8", env: canaryEnv() });
      expect(r.status).toBe(99);
    }
    expect(drainCanary()).toEqual(["wget host", "ssh host"]);
  });
});

describe("the test fixture config", () => {
  function keys(file: string): Set<string> {
    const out = new Set<string>();
    let section = "";
    for (const raw of readFileSync(file, "utf8").split("\n")) {
      const line = raw.replace(/\r$/, "").trim();
      const header = /^\[([^\]]*)\]/.exec(line);
      if (header) {
        section = header[1]!.trim();
        continue;
      }
      if (line === "" || /^[#;]/.test(line)) continue;
      const eq = line.indexOf("=");
      if (eq > 0) out.add(`${section}.${line.slice(0, eq).trim()}`);
    }
    return out;
  }

  it("defines only sections and keys that the real devenv.config defines", () => {
    const repoRoot = join(process.cwd());
    const fixture = keys(join(repoRoot, "tools", "tests", "fixtures", "devenv.test.config"));
    const real = keys(join(repoRoot, "devenv.config"));
    expect([...fixture].filter((k) => !real.has(k))).toEqual([]);
  });
});

describe("restoreAnchors", () => {
  it("restores an absent DEVENV_ROOT and HOME but keeps a value a suite set itself", () => {
    const savedRoot = process.env["DEVENV_ROOT"];
    const savedHome = process.env["HOME"];
    try {
      process.env["DEVENV_ROOT"] = "/a/suite/chosen/root";
      restoreAnchors();
      expect(process.env["DEVENV_ROOT"]).toBe("/a/suite/chosen/root");

      delete process.env["DEVENV_ROOT"];
      delete process.env["HOME"];
      restoreAnchors();
      expect(process.env["DEVENV_ROOT"]).toBe(join(process.env["DEVENV_TEST_FIXTURE_DIR"] ?? "", "root"));
      expect(process.env["HOME"]).toBe(join(process.env["DEVENV_TEST_FIXTURE_DIR"] ?? "", "home"));
    } finally {
      if (savedRoot === undefined) delete process.env["DEVENV_ROOT"];
      else process.env["DEVENV_ROOT"] = savedRoot;
      if (savedHome === undefined) delete process.env["HOME"];
      else process.env["HOME"] = savedHome;
    }
  });

  it("canaryEnv(basePath) keeps the path minimal and puts only the shim directory first", () => {
    const env = canaryEnv("/usr/bin:/bin");
    expect(env["PATH"]).toBe(`${join(process.env["DEVENV_TEST_FIXTURE_DIR"] ?? "", "canary-bin")}:/usr/bin:/bin`);
    expect(env["NODE_OPTIONS"]).toMatch(/--import=/);
  });
});
