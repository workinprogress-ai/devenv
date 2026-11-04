// Port of tools/tests/devenv/test_outdated_comments.bats (11 tests) — one vitest `it` per source `@test`.
import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))));

function sh(script: string): { status: number; out: string } {
  const r = spawnSync("bash", ["-c", script], { encoding: "utf8" });
  return { status: r.status ?? 1, out: (r.stdout ?? "") + (r.stderr ?? "") };
}

function expectNoMatch(script: string): void {
  const r = sh(script);
  expect(r.status, `matched: ${r.out}`).not.toBe(0);
}

describe("outdated comments", () => {
  it("bootstrap.sh has valid syntax", () => {
    expect(spawnSync("bash", ["-n", join(ROOT, ".devcontainer/bootstrap.sh")]).status).toBe(0);
  });

  it("bootstrap.sh has no 'can be deleted later' comments", () => {
    expectNoMatch(`grep -i "can be deleted later" '${ROOT}/.devcontainer/bootstrap.sh'`);
  });

  it("bootstrap.sh has no 'TODO' comments", () => {
    expectNoMatch(`grep -i "# TODO" '${ROOT}/.devcontainer/bootstrap.sh'`);
  });

  it("bootstrap.sh has no 'FIXME' comments", () => {
    expectNoMatch(`grep -i "# FIXME" '${ROOT}/.devcontainer/bootstrap.sh'`);
  });

  it("scripts have no stale Azure DevOps references outside the azure provider", () => {
    // Azure is a supported provider (#40): key-update-azure legitimately
    // references it. Forbidden: Azure vocabulary in provider-unrelated scripts.
    expectNoMatch(
      `grep -ril 'Azure DevOps\\|azure-devops\\|AzDO' '${ROOT}/tools/ts/' '${ROOT}/tools/lib/domain/' '${ROOT}/tools/lib/core/' 2>/dev/null | grep -vE 'providers/azure|providers/github|domain/fork/'`,
    );
  });

  it("scripts have no Azure PAT references outside the azure provider", () => {
    expectNoMatch(
      `grep -ril 'AZURE.*TOKEN.*PAT\\|AZURE_DEVOPS_PAT' '${ROOT}/tools/ts/' '${ROOT}/tools/lib/domain/' '${ROOT}/tools/lib/core/' 2>/dev/null | grep -vE 'providers/azure|providers/github|domain/fork/'`,
    );
  });

  it("scripts have no work item references outside the azure provider", () => {
    expectNoMatch(
      `grep -rilE 'wiql|workitemsbatch|azureHttp|dev\\.azure\\.com' '${ROOT}/tools/ts/' '${ROOT}/tools/lib/domain/' '${ROOT}/tools/lib/core/' 2>/dev/null | grep -vE 'providers/azure|providers/github|domain/fork/'`,
    );
  });

  it("no commented-out large code blocks in bootstrap", () => {
    expectNoMatch(`awk '/^#[^!]/{c++; if(c>3) exit 0} c>0 && !/^#/{c=0} END{exit 1}' ${ROOT}/.devcontainer/bootstrap.sh`);
  });

  it("container-start.sh has no outdated comments", () => {
    expectNoMatch(`grep -i "can be deleted later\\|TODO\\|FIXME" '${ROOT}/.devcontainer/container-start.sh'`);
  });

  it("startup.sh has no outdated comments", () => {
    expectNoMatch(`grep -i "can be deleted later\\|TODO\\|FIXME" '${ROOT}/.devcontainer/startup.sh'`);
  });

  it("lib files have no outdated comments", () => {
    // DEVENV markers are tracked temporaries governed by devenv-marker-check,
    // not stale comments — excluded from this stale-comment gate.
    expectNoMatch(`grep -i 'can be deleted later\\|TODO\\|FIXME' '${ROOT}/tools/lib/'*.bash | grep -v 'DEVENV\\['`);
  });
});
