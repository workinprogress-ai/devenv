// Port of tools/tests/lib/test_provider_pipelines.bats (12 tests): contract
// tests for the github actions domain facade (provider_pipelines_*). Stubbed
// gh records argv; each test asserts the call shape the verbs must honor.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const ROOT = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))));
const TOOLS = join(ROOT, "tools");

let TMP = "";
let CALL_LOG = "";

// Recording gh stub: logs argv; `gh api` answers with STUB_GH_API_RESPONSE.
const GH_STUB = `#!/usr/bin/env bash
echo "gh $*" >> "\${STUB_CALL_LOG:?}"
if [[ "$1" == "api" ]]; then
    [[ -n "\${STUB_GH_API_RESPONSE:-}" ]] && cat "\${STUB_GH_API_RESPONSE}"
    exit 0
fi
exit 0
`;

beforeEach(() => {
  TMP = mkdtempSync(join(tmpdir(), `gpipe-${Date.now()}-${Math.random().toString(36).slice(2)}`));
  const stubDir = join(TMP, "stub-bin");
  mkdirSync(stubDir, { recursive: true });
  CALL_LOG = join(TMP, "stub-calls.log");
  writeFileSync(CALL_LOG, "");
  writeFileSync(join(stubDir, "gh"), GH_STUB);
  chmodSync(join(stubDir, "gh"), 0o755);
});

const ENV = (): Record<string, string> => ({
  TEST_TEMP_DIR: TMP,
  DEVENV_TOOLS: TOOLS,
  STUB_CALL_LOG: CALL_LOG,
  PATH: `${join(TMP, "stub-bin")}:${process.env.PATH ?? ""}`,
});

// verb ARGS: run a pipelines verb with the github module sourced.
function verb(call: string): { status: number; out: string } {
  const r = spawnSync(
    "bash",
    [
      "-c",
      `source '${TOOLS}/lib/providers/provider-core.bash'\n` +
      `provider_detect '${join(TMP, "absent.config")}'\n` +
      `source '${TOOLS}/lib/providers/github/pipelines.bash'\n` +
      call,
    ],
    { encoding: "utf8", env: ENV() },
  );
  return { status: r.status ?? 1, out: (r.stdout ?? "") + (r.stderr ?? "") };
}

function logHasExact(line: string): boolean {
  return readFileSync(CALL_LOG, "utf8").split("\n").some((l) => l === line);
}

// gh_last_call_equals EXPECTED: last `gh` line is exactly `gh EXPECTED`.
function ghLastCallEquals(expected: string): { ok: boolean; out: string } {
  const last = readFileSync(CALL_LOG, "utf8").split("\n").filter((l) => l.startsWith("gh ")).at(-1) ?? "";
  if (last !== `gh ${expected}`) {
    return { ok: false, out: `gh argv mismatch\n  expected: gh ${expected}\n  actual:   ${last}` };
  }
  return { ok: true, out: "" };
}

describe("actions module", () => {
  it("loads, registers pipelines capability, idempotent", () => {
    const r = spawnSync(
      "bash",
      [
        "-c",
        `source '${TOOLS}/lib/providers/provider-core.bash'\n` +
        `provider_detect '${join(TMP, "absent.config")}'\n` +
        `source '${TOOLS}/lib/providers/github/pipelines.bash'\n` +
        `provider_has_capability pipelines || exit 1\n` +
        `source '${TOOLS}/lib/providers/github/pipelines.bash'\n` +
        `declare -F provider_pipelines_run_list >/dev/null || exit 1`,
      ],
      { encoding: "utf8", env: ENV() },
    );
    expect(r.status ?? 1).toBe(0);
  });
});

describe("pipelines verb call shapes", () => {
  it("run list: -R repo and flags pass through", () => {
    const r = verb("provider_pipelines_run_list org/repo --branch main --limit 5");
    expect(r.status).toBe(0);
    expect(logHasExact("gh run list -R org/repo --branch main --limit 5")).toBe(true);
  });

  it("run view: run id and repo wired", () => {
    const r = verb("provider_pipelines_run_view org/repo 12345");
    expect(r.status).toBe(0);
    expect(logHasExact("gh run view 12345 -R org/repo")).toBe(true);
  });

  it("run watch: polling stays domain-local with repo wiring", () => {
    const r = verb("provider_pipelines_run_watch org/repo 42");
    expect(r.status).toBe(0);
    expect(logHasExact("gh run watch 42 -R org/repo")).toBe(true);
  });

  it("workflow list: passes repo", () => {
    const r = verb("provider_pipelines_workflow_list org/repo");
    expect(r.status).toBe(0);
    expect(logHasExact("gh workflow list -R org/repo")).toBe(true);
  });

  it("run artifacts: REST endpoint wired with jq extraction", () => {
    writeFileSync(join(TMP, "api.json"), '{"artifacts":[{"name":"a"}]}');
    const r = spawnSync(
      "bash",
      [
        "-c",
        `source '${TOOLS}/lib/providers/provider-core.bash'\n` +
        `provider_detect '${join(TMP, "absent.config")}'\n` +
        `source '${TOOLS}/lib/providers/github/pipelines.bash'\n` +
        `provider_pipelines_run_artifacts org/repo 77`,
      ],
      { encoding: "utf8", env: { ...ENV(), STUB_GH_API_RESPONSE: join(TMP, "api.json") } },
    );
    expect(r.status ?? 1).toBe(0);
    expect(logHasExact("gh api /repos/org/repo/actions/runs/77/artifacts --jq .artifacts")).toBe(true);
  });

  it("workflow run: dispatch wired with workflow name and repo", () => {
    const r = verb("provider_pipelines_workflow_run org/repo build.yml --ref main");
    expect(r.status).toBe(0);
    expect(logHasExact("gh workflow run build.yml -R org/repo --ref main")).toBe(true);
  });

  it("run rerun: run id and repo wired", () => {
    const r = verb("provider_pipelines_run_rerun org/repo 99");
    expect(r.status).toBe(0);
    expect(logHasExact("gh run rerun 99 -R org/repo")).toBe(true);
  });

  it("run cancel: -R form per inventory (provider-loader parity)", () => {
    const r = verb("provider_pipelines_run_cancel org/repo 55");
    expect(r.status).toBe(0);
    expect(logHasExact("gh run cancel -R org/repo 55")).toBe(true);
  });

  it("run download: run id, repo, flags wired", () => {
    const r = verb("provider_pipelines_run_download org/repo 77 --name art");
    expect(r.status).toBe(0);
    expect(logHasExact("gh run download 77 -R org/repo --name art")).toBe(true);
  });
});

describe("pipelines arg-order guards", () => {
  it("run view: bare number first arg is the run id, not a repo (regex guard)", () => {
    writeFileSync(CALL_LOG, "");
    verb('provider_pipelines_run_view "55" --json url');
    const r = ghLastCallEquals("run view 55 --json url");
    expect(r.ok, r.out).toBe(true);
  });

  it("run view: flags pass through after the run id", () => {
    writeFileSync(CALL_LOG, "");
    verb('provider_pipelines_run_view "org/repo" "55" --json url');
    const r = ghLastCallEquals("run view 55 -R org/repo --json url");
    expect(r.ok, r.out).toBe(true);
  });
});
