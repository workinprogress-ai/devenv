// Port of tools/tests/scripts/test_kube_chain.bats (4 tests).
// End-to-end behavior of the pod listing/selection chain with -n <ns> before
// the name filter. kubectl is a recording stub; no cluster is involved.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { toolScript } from "./harness/index.ts";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const ROOT = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))));
const TOOLS = join(ROOT, "tools");

let TMP = "";
let KUBECTL_LOG = "";

beforeEach(() => {
  TMP = mkdtempSync(join(tmpdir(), `kubechain-${Date.now()}-${Math.random().toString(36).slice(2)}`));
  KUBECTL_LOG = join(TMP, "kubectl.log");
  writeFileSync(KUBECTL_LOG, "");
  const bin = join(TMP, "bin");
  mkdirSync(bin, { recursive: true });
  writeFileSync(
    join(bin, "kubectl"),
    [
      "#!/usr/bin/env bash",
      'echo "kubectl $*" >> "$KUBECTL_LOG"',
      'case "$1 $2" in',
      '    "get namespaces")',
      '        printf \'{"items":[{"metadata":{"name":"prod"}},{"metadata":{"name":"staging"}}]}\' ;;',
      '    "get namespace")',
      '        [ "$3" = "prod" ] || [ "$3" = "staging" ] ;;',
      '    "get pods")',
      '        printf \'{"items":[{"metadata":{"name":"myapp-1"}},{"metadata":{"name":"other-2"}},{"metadata":{"name":"myapp-3"}}]}\' ;;',
      "esac",
      "",
    ].join("\n"),
  );
  // fzf stand-in for the menu shown when several pods match: first line wins.
  writeFileSync(join(bin, "fzf"), "#!/usr/bin/env bash\nhead -n 1\n");
  spawnSync("chmod", ["+x", join(bin, "kubectl"), join(bin, "fzf")]);
  // The tools/ entry points are how sibling scripts find each other.
  const root = join(TMP, "devenv-root");
  mkdirSync(root, { recursive: true });
  writeFileSync(
    join(root, "devenv.config"),
    "[provider]\nname=github\n\n[organization]\nname=Test Organization\norg=test-org\nemail_domain=test.example.com\n\n[workflows]\nstatus_workflow=TBD,To-Groom,Ready,Implementing,Review,Merged,Staging,Production\n",
  );
});

const { NAMESPACE: _ns, DEVENV_REPO: _dr, ...procEnv } = process.env;

function kubeEnv(): Record<string, string> {
  return {
    ...procEnv,
    KUBECTL_LOG,
    PATH: `${join(TMP, "bin")}:${TOOLS}:${procEnv.PATH ?? ""}`,
    KUBE_NO_INTERACTIVE: "1",
  };
}

function runKube(script: string, args: string[]): { status: number; stdout: string; stderr: string } {
  const r = spawnSync("node", [toolScript(script), ...args], { encoding: "utf8", env: kubeEnv() });
  return { status: r.status ?? 1, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

function logHas(pattern: string): boolean {
  return spawnSync("grep", ["-q", pattern, KUBECTL_LOG]).status === 0;
}

describe("scripts/kube-chain", () => {
  it("kube-list-pods: -n <ns> before the filter filters by the name, not by the flag", () => {
    const r = runKube("kube-list-pods", ["-n", "prod", "myapp"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toBe("myapp-1\nmyapp-3\n");
    expect(logHas("get pods -n prod")).toBe(true);
  });

  it("kube-list-pods: the filter alone still works", () => {
    const r = runKube("kube-list-pods", ["other"]);
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toBe("other-2");
  });

  it("kube-pod-select: -n <ns> before the filter reaches the listing and selects the match", () => {
    const r = runKube("kube-pod-select", ["-n", "prod", "other"]);
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toBe("other-2");
    expect(logHas("get pods -n prod")).toBe(true);
  });

  it("kube-pod-select: finds its sibling by the entry-point name and filters correctly", () => {
    // With -n first the filter used to be read as "-n", and the sibling was
    // invoked as kube-list-pods.sh, a name no PATH entry provides.
    const r = runKube("kube-pod-select", ["-n", "staging", "myapp"]);
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toBe("myapp-1");
    expect(r.stderr).not.toContain("command not found");
    expect(logHas("get pods -n staging")).toBe(true);
  });
});
