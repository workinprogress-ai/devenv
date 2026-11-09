// Port of tools/tests/lib/test_copilot_knowledge.bats (2 tests) — one vitest
// `it` per source `@test`. The background fast-forward sync must authenticate
// the way the active provider expects (header shape: GitHub vs Azure).
import { beforeEach, describe, expect, it, vi } from "vitest";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const ROOT = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))));
const TOOLS = join(ROOT, "tools");

let TMP = "";
let DEVENV_ROOT = "";
let GIT_ARGS_LOG = "";

beforeEach(() => {
  TMP = mkdtempSync(join(tmpdir(), `cknow-${Date.now()}-${Math.random().toString(36).slice(2)}`));
  DEVENV_ROOT = join(TMP, "devenv-root");
  GIT_ARGS_LOG = join(TMP, "git-args.log");
  mkdirSync(join(TMP, "bin"), { recursive: true });
  mkdirSync(join(TMP, "repo", ".git"), { recursive: true });
  mkdirSync(DEVENV_ROOT, { recursive: true });
  writeFileSync(GIT_ARGS_LOG, "");
  // Spawned fixtures configure the provider per-test via their own devenv.config;
  // an inherited provider selection from the parent shell would beat that config
  // (provider_load short-circuits on a non-empty PROVIDER_NAME).
  delete process.env.PROVIDER_NAME;
  // nohup runs its command synchronously here so the test can read what git received.
  writeFileSync(join(TMP, "bin", "nohup"), '#!/usr/bin/env bash\nexec "$@"\n');
  writeFileSync(join(TMP, "bin", "git"), 'printf "%s\\n" "$*" >> "$GIT_ARGS_LOG"\nexit 0\n');
  chmodSync(join(TMP, "bin", "nohup"), 0o755);
  chmodSync(join(TMP, "bin", "git"), 0o755);
});

// run_sync <provider-config-block>: sources the library under that config,
// fakes the token, and runs one background-style sync of $TMP/repo.
function runSync(configBlock: string): { status: number; out: string } {
  writeFileSync(join(DEVENV_ROOT, "devenv.config"), configBlock.replace(/\\n/g, "\n"));
  const r = spawnSync(
    "bash",
    [
      "-c",
      `export DEVENV_ROOT='${DEVENV_ROOT}' DEVENV_ROOT_SET=1\n` +
      `source '${TOOLS}/lib/copilot-knowledge.bash'\n` +
      `provider_secret_get() { echo sekret; }\n` +
      `pull_copilot_side_repo_on_container_start '${join(TMP, "repo")}' x\n` +
      `wait\n`,
    ],
    {
      encoding: "utf8",
      env: {
        ...process.env,
        DEVENV_TOOLS: TOOLS,
        GIT_ARGS_LOG,
        PATH: `${join(TMP, "bin")}:${process.env.PATH ?? ""}`,
      },
    },
  );
  return { status: r.status ?? 1, out: (r.stdout ?? "") + (r.stderr ?? "") };
}

describe("copilot knowledge sync auth", () => {
  it("github provider: the sync authenticates with the GitHub basic-auth header", () => {
    runSync("[organization]\\nname=t\\norg=acme\\n");
    const expected = spawnSync("bash", ["-c", "printf 'x-access-token:sekret' | base64 -w0"], { encoding: "utf8" }).stdout?.trim();
    expect(GIT_ARGS_LOG.length > 0 || spawnSync("test", ["-s", GIT_ARGS_LOG]).status === 0).toBe(true);
    expect(
      spawnSync("grep", ["-q", `AUTHORIZATION: basic ${expected}`, GIT_ARGS_LOG]).status,
      `log: ${spawnSync("cat", [GIT_ARGS_LOG], { encoding: "utf8" }).stdout}`,
    ).toBe(0);
  });

  it("azure provider: the sync authenticates with the Azure PAT basic-auth header, not the GitHub one", () => {
    runSync("[organization]\\nname=t\\norg=acme\\n[provider]\\nname=azure\\nazure_org=acme\\nazure_project=proj\\n");
    const azure = spawnSync("bash", ["-c", "printf ':sekret' | base64 -w0"], { encoding: "utf8" }).stdout?.trim();
    const github = spawnSync("bash", ["-c", "printf 'x-access-token:sekret' | base64 -w0"], { encoding: "utf8" }).stdout?.trim();
    expect(spawnSync("grep", ["-q", `AUTHORIZATION: Basic ${azure}`, GIT_ARGS_LOG]).status).toBe(0);
    expect(spawnSync("grep", ["-F", github ?? "", GIT_ARGS_LOG]).status).not.toBe(0);
  });
});
