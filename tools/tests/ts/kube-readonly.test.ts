// Port of tools/tests/scripts/test_kube_readonly.bats (9 tests).
// Read-only kube families: kube-list-pods, kube-logs, kube-pod-console,
// kube-pod-exec, kube-forward-ports, kube-intercept. Locks argument handling
// and consumption of the shared selection path; network lifecycle is out of
// scope.
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
let CALL_LOG = "";

const KUBECTL_STUB = [
  "#!/usr/bin/env bash",
  'echo "kubectl $*" >> "${STUB_CALL_LOG:?}"',
  'if [[ "${STUB_KUBECTL_FAIL:-0}" == "1" ]]; then',
  '    echo "stub-kubectl: simulated failure" >&2',
  "    exit 1",
  "fi",
  "emit() {",
  '    local items="" n',
  "    for n in $1; do",
  '        items="${items}{\\"metadata\\":{\\"name\\":\\"$n\\"}},"',
  "    done",
  "    printf '{\"items\":[%s]}\\n' \"${items%,}\"",
  "}",
  'case "$1 $2" in',
  '    "get pods")',
  '        if [[ "$*" == *"-o json"* ]]; then emit "${STUB_KUBECTL_PODS:-}"; else',
  '            [[ -n "${STUB_KUBECTL_PODS:-}" ]] && printf \'%s\\n\' ${STUB_KUBECTL_PODS}',
  "        fi",
  "        exit 0 ;;",
  '    "get deployments")',
  '        if [[ "$*" == *"-o json"* ]]; then emit "${STUB_KUBECTL_DEPLOYS:-}"; else',
  '            [[ -n "${STUB_KUBECTL_DEPLOYS:-}" ]] && printf \'%s\\n\' ${STUB_KUBECTL_DEPLOYS}',
  "        fi",
  "        exit 0 ;;",
  '    "get namespaces")',
  '        emit "${STUB_KUBECTL_NAMESPACES:-}"',
  "        exit 0 ;;",
  '    "get namespace")',
  '        ns="$3"',
  "        for n in ${STUB_KUBECTL_NAMESPACES:-}; do",
  '            [[ "$n" == "$ns" ]] && exit 0',
  "        done",
  "        exit 1 ;;",
  '    "config view")',
  '        echo "${STUB_KUBECTL_DEFAULT_NS:-}"',
  "        exit 0 ;;",
  "    *) exit 0 ;;",
  "esac",
  "",
].join("\n");

beforeEach(() => {
  TMP = mkdtempSync(join(tmpdir(), `kubero-${Date.now()}-${Math.random().toString(36).slice(2)}`));
  CALL_LOG = join(TMP, "calls.log");
  writeFileSync(CALL_LOG, "");
  writeFileSync(join(TMP, "stub-calls.log"), "");
  const bin = join(TMP, "bin");
  mkdirSync(bin, { recursive: true });
  writeFileSync(join(bin, "kubectl"), KUBECTL_STUB);
  spawnSync("chmod", ["+x", join(bin, "kubectl")]);
  // Recording stubs for the non-kubectl CLIs the mapping tools invoke.
  writeFileSync(
    join(bin, "jq"),
    ['#!/usr/bin/env bash', 'echo "jq $*" >> "${CALL_LOG:?}"', 'exec /usr/bin/jq "$@"', ""].join("\n"),
  );
  writeFileSync(
    join(bin, "kube-pod-select"),
    [
      "#!/usr/bin/env bash",
      'echo "kube-pod-select $*" >> "${CALL_LOG:?}"',
      "// Deterministic selection: emit the filter's first stub-pod match.",
      "while IFS= read -r pod; do",
      "    case \"$pod\" in",
      "        *\"${1:-}\"*) echo \"$pod\"; exit 0 ;;",
      "    esac",
      "done < <(printf '%s\\n' \"${STUB_KUBECTL_PODS:?}\")",
      "",
    ].join("\n"),
  );
  writeFileSync(
    join(bin, "telepresence"),
    [
      "#!/usr/bin/env bash",
      'echo "telepresence $*" >> "${CALL_LOG:?}"',
      'case "$1" in',
      "    status) echo '{\"user_daemon\": {\"status\": \"Connected\"}}' ;;",
      "    connect) exit 0 ;;",
      "    quit) exit 0 ;;",
      "    helm) exit 0 ;;",
      "    replace) exit 0 ;;",
      "    *) exit 0 ;;",
      "esac",
      "",
    ].join("\n"),
  );
  spawnSync("chmod", ["+x", join(bin, "jq"), join(bin, "kube-pod-select"), join(bin, "telepresence")]);
  // The helper's sandboxed config.
  const root = join(TMP, "devenv-root");
  mkdirSync(root, { recursive: true });
  writeFileSync(
    join(root, "devenv.config"),
    "[provider]\nname=github\n\n[organization]\nname=Test Organization\norg=test-org\nemail_domain=test.example.com\n\n[workflows]\nstatus_workflow=TBD,To-Groom,Ready,Implementing,Review,Merged,Staging,Production\n",
  );
});

const { NAMESPACE: _ns, DEVENV_REPO: _dr, ...procEnv } = process.env;

function env(extra: Record<string, string> = {}): Record<string, string> {
  return {
    ...procEnv,
    DEVENV_TOOLS: TOOLS,
    DEVENV_ROOT: join(TMP, "devenv-root"),
    DEVENV_ROOT_SET: "1",
    STUB_CALL_LOG: join(TMP, "stub-calls.log"),
    STUB_KUBECTL_NAMESPACES: "default web",
    STUB_KUBECTL_DEFAULT_NS: "default",
    KUBE_NO_INTERACTIVE: "1",
    CALL_LOG,
    PATH: `${join(TMP, "bin")}:${procEnv.PATH ?? ""}`,
    ...extra,
  };
}

function runKube(script: string, args: string[], extra: Record<string, string> = {}): { status: number; out: string } {
  const r = spawnSync("node", [toolScript(script), ...args], { encoding: "utf8", env: env(extra) });
  return { status: r.status ?? 1, out: (r.stdout ?? "") + (r.stderr ?? "") };
}

function callsContain(sub: string): boolean {
  return spawnSync("grep", ["-qF", "--", sub, CALL_LOG]).status === 0;
}

function stubCallsContain(sub: string): boolean {
  return spawnSync("grep", ["-qF", "--", sub, join(TMP, "stub-calls.log")]).status === 0;
}

describe("scripts/kube-readonly", () => {
  it("kube-list-pods: prints the pod list from the stub", () => {
    const r = runKube("kube-list-pods", [], { STUB_KUBECTL_PODS: "web-1\nweb-2\ndb-1" });
    expect(r.status).toBe(0);
    expect(r.out).toContain("web-1");
    expect(r.out).toContain("web-2");
    expect(r.out).toContain("db-1");
  });

  it("kube-list-pods: filter keeps only matching names", () => {
    const r = runKube("kube-list-pods", ["web"], { STUB_KUBECTL_PODS: "web-1\nweb-2\ndb-1" });
    expect(r.status).toBe(0);
    expect(r.out).toContain("web-1");
    expect(r.out).not.toMatch(/^db-1$/m);
  });

  it("kube-logs: fetches logs for the first-match pod", () => {
    const r = runKube("kube-logs", ["web"], { STUB_KUBECTL_PODS: "web-1\nweb-2" });
    expect(r.status).toBe(0);
    expect(r.out).toContain("Fetching logs for pod: web-1");
    expect(stubCallsContain("kubectl logs web-1")).toBe(true);
  });

  it("kube-logs: no match is refused before kubectl logs", () => {
    const r = runKube("kube-logs", ["nomatch"], { STUB_KUBECTL_PODS: "web-1" });
    expect(r.status).not.toBe(0);
    expect(stubCallsContain("kubectl logs web-1")).toBe(false);
  });

  it("kube-pod-exec: executes the command on the first-match pod", () => {
    const r = runKube("kube-pod-exec", ["web", "--", "ls", "-la"], { STUB_KUBECTL_PODS: "web-1\nweb-2" });
    expect(r.status).toBe(0);
    expect(r.out).toContain("Executing command for pod: web-1");
    expect(stubCallsContain("kubectl exec web-1")).toBe(true);
  });

  it("kube-pod-console: defaults to /bin/bash on the first-match pod", () => {
    const r = runKube("kube-pod-console", ["web"], { STUB_KUBECTL_PODS: "web-1\nweb-2" });
    expect(r.status).toBe(0);
    expect(r.out).toContain("Executing command on console for pod: web-1");
    expect(stubCallsContain("kubectl exec -it web-1")).toBe(true);
  });

  it("kube-forward-ports: usage refusal with no mappings issues no forward", () => {
    const r = runKube("kube-forward-ports", []);
    expect(r.status).toBe(2);
    expect(r.out).toContain("Usage:");
    expect(stubCallsContain("kubectl port-forward")).toBe(false);
  });

  it("kube-forward-ports: non-numeric port is refused before selection", () => {
    const r = runKube("kube-forward-ports", ["web=abc"]);
    expect(r.status).toBe(2);
    expect(r.out).toContain("Ports must be numeric");
    expect(callsContain("kube-pod-select")).toBe(false);
  });

  it("kube-intercept: invalid mapping format is refused before any telepresence call", () => {
    const r = runKube("kube-intercept", ["nonsense"]);
    expect(r.status).toBe(2);
    expect(r.out).toContain("Invalid mapping format");
    expect(callsContain("telepresence ")).toBe(false);
  });
});
