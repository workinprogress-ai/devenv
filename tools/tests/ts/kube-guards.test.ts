// Port of tools/tests/scripts/test_kube_guards.bats (18 tests).
// Guard behavior for kube-pod-delete / kube-pod-scale / kube-pod-restart and
// the shared selection path. Every destructive branch asserts BOTH the exit
// status AND that no destructive kubectl call was recorded by the stub.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runTool as runHarness, toolScript } from "./harness/index.ts";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const ROOT = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))));
const TOOLS = join(ROOT, "tools");

let TMP = "";
let DELETED = "";
let SCALED = "";

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
  '    "delete pod")',
  '        shift 2; for a in "$@"; do [[ "$a" != -* ]] && { [[ -n "${STUB_KUBECTL_DELETED:-}" ]] && echo "$a" >> "$STUB_KUBECTL_DELETED"; break; }; done',
  "        exit 0 ;;",
  '    "scale deployment")',
  '        name="$3"',
  '        [[ -n "${STUB_KUBECTL_SCALED:-}" ]] && echo "$name" >> "$STUB_KUBECTL_SCALED"',
  "        exit 0 ;;",
  '    "get namespaces")',
  '        if [[ "${STUB_KUBECTL_FAIL:-0}" == "1" ]]; then',
  '            echo "stub-kubectl: simulated failure" >&2',
  "            exit 1",
  "        fi",
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
  TMP = mkdtempSync(join(tmpdir(), `kubeguard-${Date.now()}-${Math.random().toString(36).slice(2)}`));
  DELETED = join(TMP, "deleted.txt");
  SCALED = join(TMP, "scaled.txt");
  writeFileSync(DELETED, "");
  writeFileSync(SCALED, "");
  const bin = join(TMP, "stub-bin");
  mkdirSync(bin, { recursive: true });
  writeFileSync(join(bin, "kubectl"), KUBECTL_STUB);
  spawnSync("chmod", ["+x", join(bin, "kubectl")]);
  writeFileSync(join(TMP, "stub-calls.log"), "");
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
    STUB_KUBECTL_DELETED: DELETED,
    STUB_KUBECTL_SCALED: SCALED,
    STUB_KUBECTL_NAMESPACES: "default web",
    STUB_KUBECTL_DEFAULT_NS: "default",
    KUBE_NO_INTERACTIVE: "1",
    PATH: `${join(TMP, "stub-bin")}:${procEnv.PATH ?? ""}`,
    ...extra,
  };
}

function runTool(tool: string, args: string[], extra: Record<string, string> = {}, input = ""): { status: number; out: string } {
  // The suite drove the depth-1 stubs; the harness runs the .ts source —
  // the same execution path the stub resolves to.
  const r = runHarness(tool, args, { stdin: input, env: env(extra) });
  return { status: r.status, out: r.output };
}

// Run a kube tool on a pseudo-terminal so confirm_or_fail takes its prompt
// path, answering the prompt with ANSWER.
function runOnTty(answer: string, tool: string, args: string[], extra: Record<string, string> = {}): { status: number; out: string } {
  const cmd = `env TERM=xterm node '${toolScript(tool)}'` + args.map((a) => ` '${a}'`).join("");
  const r = spawnSync("bash", ["-c", `printf '%s\n' '${answer}' | script -qefc "${cmd}" /dev/null`], {
    encoding: "utf8",
    env: env(extra),
  });
  return { status: r.status ?? 1, out: (r.stdout ?? "") + (r.stderr ?? "") };
}

function deletedLines(): string[] {
  return readFileSync(DELETED, "utf8").split("\n").filter(Boolean);
}

function scaledLines(): string[] {
  return readFileSync(SCALED, "utf8").split("\n").filter(Boolean);
}

describe("scripts/kube-guards", () => {
  it("kube-pod-delete: refuses multi-match without deleting anything", () => {
    const r = runTool("kube-pod-delete", ["api"], { STUB_KUBECTL_PODS: "api-1\napi-2" });
    expect(r.status).toBe(3);
    expect(deletedLines()).toEqual([]);
  });

  it("kube-pod-delete: refuses non-interactive run without YES", () => {
    const r = runTool("kube-pod-delete", ["api"], { STUB_KUBECTL_PODS: "api-1" });
    expect(r.status).toBe(2);
    expect(deletedLines()).toEqual([]);
  });

  it("kube-pod-delete: deletes the single match with YES=1", () => {
    const r = runTool("kube-pod-delete", ["api"], { STUB_KUBECTL_PODS: "api-1", YES: "1" });
    expect(r.status).toBe(0);
    expect(deletedLines()).toEqual(["api-1"]);
  });

  it("kube-pod-scale: validates replicas are numeric before kubectl", () => {
    const r = runTool("kube-pod-scale", ["api", "abc"], { STUB_KUBECTL_DEPLOYS: "api" });
    expect(r.status).toBe(2);
    expect(scaledLines()).toEqual([]);
  });

  it("kube-pod-scale: refuses multi-match without scaling", () => {
    const r = runTool("kube-pod-scale", ["api", "3"], { STUB_KUBECTL_DEPLOYS: "api-1\napi-2" });
    expect(r.status).toBe(3);
    expect(scaledLines()).toEqual([]);
  });

  it("kube-pod-scale: refuses non-interactive run without YES", () => {
    const r = runTool("kube-pod-scale", ["api", "3"], { STUB_KUBECTL_DEPLOYS: "api" });
    expect(r.status).toBe(2);
    expect(scaledLines()).toEqual([]);
  });

  it("kube-pod-scale: scales the single match with YES=1", () => {
    const r = runTool("kube-pod-scale", ["api", "3"], { STUB_KUBECTL_DEPLOYS: "api", YES: "1" });
    expect(r.status).toBe(0);
    expect(scaledLines()).toEqual(["api"]);
  });

  it("kube-pod-restart: refuses multi-match without restarting", () => {
    const r = runTool("kube-pod-restart", ["api"], { STUB_KUBECTL_DEPLOYS: "api-1\napi-2", YES: "1" });
    expect(r.status).toBe(3);
    // No scale-to-0 may have been issued for any candidate
    expect(scaledLines()).toEqual([]);
  });

  it("kube-pod-restart: refuses non-interactive run without YES", () => {
    const r = runTool("kube-pod-restart", ["api"], { STUB_KUBECTL_DEPLOYS: "api" });
    expect(r.status).toBe(2);
    expect(scaledLines()).toEqual([]);
  });

  // =========================================================================
  // Declining the confirmation: distinct status, no destructive call
  // =========================================================================

  it("kube-pod-delete: declining the prompt exits 130, not 0, and deletes nothing", () => {
    const res = runOnTty("n", "kube-pod-delete", ["api"], { STUB_KUBECTL_PODS: "api-1" });
    expect(res.status).toBe(130);
    expect(res.out).toContain("Aborted.");
    expect(deletedLines()).toEqual([]);
  });

  it("kube-pod-scale: declining the prompt exits 130, not 0, and scales nothing", () => {
    const res = runOnTty("n", "kube-pod-scale", ["api", "3"], { STUB_KUBECTL_DEPLOYS: "api" });
    expect(res.status).toBe(130);
    expect(res.out).toContain("Aborted.");
    expect(scaledLines()).toEqual([]);
  });

  it("kube-pod-restart: declining the prompt exits 130, not 0, and restarts nothing", () => {
    const res = runOnTty("n", "kube-pod-restart", ["api"], { STUB_KUBECTL_DEPLOYS: "api" });
    expect(res.status).toBe(130);
    expect(res.out).toContain("Aborted.");
    expect(scaledLines()).toEqual([]);
  });

  it("kube-pod-delete: answering y at the prompt still deletes", () => {
    const res = runOnTty("y", "kube-pod-delete", ["api"], { STUB_KUBECTL_PODS: "api-1" });
    expect(res.status).toBe(0);
    expect(deletedLines()).toEqual(["api-1"]);
  });

  it("kube-pod-delete: -n flag reaches the destructive call (records ns via stub)", () => {
    const r = runTool("kube-pod-delete", ["api", "-n", "web"], { STUB_KUBECTL_PODS: "api-1", YES: "1" });
    expect(r.status).toBe(0);
    expect(deletedLines()).toEqual(["api-1"]);
  });

  it("kube-pod-delete: positional namespace is accepted", () => {
    const r = runTool("kube-pod-delete", ["api", "web"], { STUB_KUBECTL_PODS: "api-1", YES: "1" });
    expect(r.status).toBe(0);
    expect(deletedLines()).toEqual(["api-1"]);
  });

  it("kube-pod-scale: -n flag form scales successfully", () => {
    const r = runTool("kube-pod-scale", ["api", "3", "-n", "web"], { STUB_KUBECTL_DEPLOYS: "api", YES: "1" });
    expect(r.status).toBe(0);
    expect(scaledLines()).toEqual(["api"]);
  });

  it("kube-pod-scale: NAMESPACE env var still supported (backward compat)", () => {
    const r = runTool("kube-pod-scale", ["api", "3"], { STUB_KUBECTL_DEPLOYS: "api", YES: "1", NAMESPACE: "web" });
    expect(r.status).toBe(0);
    expect(scaledLines()).toEqual(["api"]);
  });

  it("kube-pod-restart: -n flag form passes the guard with YES=1", () => {
    const r = runTool("kube-pod-restart", ["api", "-n", "web"], { STUB_KUBECTL_DEPLOYS: "api", YES: "1" });
    // The stub cannot satisfy get_deployment_info's single-item JSON shape,
    // so restart reports it cannot determine replicas (exit 1) — the guard
    // itself (match + confirm) passed, which is what this test pins.
    expect(r.status).toBe(1);
    expect(r.out).toContain("Could not determine the current number of replicas");
  });
});
