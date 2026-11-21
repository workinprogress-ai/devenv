// Behavior-lock tests for kube-intercept's parsing and resolution contract,
// written before the wrapper's full rewrite: file + argv mapping parsing, port-pair
// forms, multi-pod conflict refusal, namespace resolution legs, and the
// traffic-manager install guard. These must survive the rewrite unchanged
// where the contract is unchanged.
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
  '    printf \'{"items":[%s]}\\n\' "${items%,}"',
  "}",

  'case "$1 $2" in',
  '    "get deployment")',
  '        if [[ "$3" != "traffic-manager" && -n "${STUB_KUBECTL_DEPLOY_JSON:-}" ]]; then',
  '            printf \'%s\\n\' "$STUB_KUBECTL_DEPLOY_JSON"',
  '            exit 0',
  "        fi",
  "        exit 1 ;;",
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
  TMP = mkdtempSync(join(tmpdir(), `kint-${Date.now()}-${Math.random().toString(36).slice(2)}`));
  CALL_LOG = join(TMP, "calls.log");
  writeFileSync(CALL_LOG, "");
  writeFileSync(join(TMP, "stub-calls.log"), "");
  const bin = join(TMP, "bin");
  mkdirSync(bin, { recursive: true });
  writeFileSync(join(bin, "kubectl"), KUBECTL_STUB);
  writeFileSync(
    join(bin, "telepresence"),
    [
      "#!/usr/bin/env bash",
      'echo "telepresence $*" >> "${CALL_LOG:?}"',
      'case "$1" in',
      '    status) echo \'{"user_daemon": {"status": "Connected"}}\' ;;',
      "    *) exit 0 ;;",
      "esac",
      "",
    ].join("\n"),
  );
  spawnSync("chmod", ["+x", join(bin, "kubectl"), join(bin, "telepresence")]);
  const root = join(TMP, "devenv-root");
  mkdirSync(root, { recursive: true });
  writeFileSync(
    join(root, "devenv.config"),
    "[provider]\nname=github\n\n[organization]\nname=Test Organization\norg=test-org\nemail_domain=test.example.com\n\n[workflows]\nstatus_workflow=TBD,To-Groom,Ready,Implementing,Review,Merged,Staging,Production\n",
  );
});

const { NAMESPACE: _ns, KUBE_NAMESPACE: _kns, DEVENV_REPO: _dr, ...procEnv } = process.env;

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

function runIntercept(args: string[], extra: Record<string, string> = {}): { status: number; out: string } {
  const r = spawnSync("node", [toolScript("kube-intercept"), ...args], { encoding: "utf8", env: env(extra) });
  return { status: r.status ?? 1, out: (r.stdout ?? "") + (r.stderr ?? "") };
}

function callsContain(sub: string): boolean {
  return spawnSync("grep", ["-qF", "--", sub, CALL_LOG]).status === 0;
}

function kubectlArgvContains(sub: string): boolean {
  return spawnSync("grep", ["-qF", "--", sub, join(TMP, "stub-calls.log")]).status === 0;
}

describe("kube-intercept parse/resolution behavior locks", () => {
  it("bare DEPLOYMENT=PORT mapping resolves the deployment and intercepts with the same local/pod port", () => {
    const r = runIntercept(["api=8080"], { STUB_KUBECTL_DEPLOYS: "api-1" });
    expect(r.status).toBe(0);
    expect(callsContain("--port 8080:8080")).toBe(true);
  });

  it("LOCAL:POD pair maps to --port local:pod", () => {
    const r = runIntercept(["api=5678:80"], { STUB_KUBECTL_DEPLOYS: "api-1" });
    expect(r.status).toBe(0);
    expect(callsContain("--port 5678:80")).toBe(true);
  });

  it("comma-separated pairs each get their own --port segment", () => {
    const r = runIntercept(["api=5678:80,9090:9090"], { STUB_KUBECTL_DEPLOYS: "api-1" });
    expect(r.status).toBe(0);
    expect(callsContain("--port 5678:80 --port 9090:9090")).toBe(true);
  });

  it("multiple deployments matching are refused, never blind-picked", () => {
    const r = runIntercept(["api=8080"], { STUB_KUBECTL_DEPLOYS: "api-1 api-2" });
    expect(r.status).not.toBe(0);
    expect(r.out).toContain("cannot pick among 2 deployments matching 'api'");
  });

  it("zero deployments matching fails loud", () => {
    const r = runIntercept(["api=8080"], { STUB_KUBECTL_DEPLOYS: "" });
    expect(r.status).toBe(1);
    expect(r.out).toContain("Failed to select deployment");
  });

  it("mapping file lines are merged with argv mappings; comments and blanks skipped", () => {
    const file = join(TMP, "mappings.txt");
    writeFileSync(file, "# comment\n\nweb=3000\n");
    const r = runIntercept([file, "api=8080"], { STUB_KUBECTL_DEPLOYS: "api-1 web-1" });
    expect(r.status).toBe(0);
    expect(callsContain("--port 8080:8080")).toBe(true);
    expect(callsContain("--port 3000:3000")).toBe(true);
  });

  it("explicit -n namespace wins over the context default", () => {
    const r = runIntercept(["-n", "web", "api=8080"], { STUB_KUBECTL_DEPLOYS: "api-1" });
    expect(r.status).toBe(0);
    expect(kubectlArgvContains("kubectl get deployments -n web")).toBe(true);
  });

  it("no namespace given falls back to the context default namespace", () => {
    const r = runIntercept(["api=8080"], { STUB_KUBECTL_DEPLOYS: "api-1", STUB_KUBECTL_DEFAULT_NS: "stage" });
    expect(r.status).toBe(0);
    expect(kubectlArgvContains("kubectl get deployments -n stage")).toBe(true);
  });

  it("unique partial-match namespace auto-selects; ambiguity is refused", () => {
    const partial = runIntercept(["-n", "we", "api=8080"], { STUB_KUBECTL_DEPLOYS: "api-1" });
    expect(partial.status).toBe(0);
    expect(kubectlArgvContains("kubectl get deployments -n web")).toBe(true);
    const ambiguous = runIntercept(["-n", "e", "api=8080"], { STUB_KUBECTL_DEPLOYS: "api-1", STUB_KUBECTL_NAMESPACES: "web dept" });
    expect(ambiguous.status).not.toBe(0);
    expect(ambiguous.out).toContain("ambiguous");
  });

  it("missing traffic-manager deployment triggers the install path", () => {
    const r = runIntercept(["api=8080"], { STUB_KUBECTL_DEPLOYS: "api-1" });
    expect(r.status).toBe(0);
    expect(callsContain("telepresence helm install")).toBe(true);
  });

  it("a non-numeric local port is refused before any intercept call", () => {
    // The LOCAL side of a pair must be numeric; the named-port form is
    // DEPLOY=PORTNAME bare or DEPLOY=LOCAL:PORTNAME. api=abc:8080 puts a
    // name where a local port number belongs.
    const r = runIntercept(["api=abc:8080"], { STUB_KUBECTL_DEPLOYS: "api-1" });
    expect(r.status).not.toBe(0);
    expect(r.out).toContain("Local port must be numeric");
    expect(callsContain("telepresence intercept")).toBe(false);
  });

  it("the bare named-port form resolves the containerPort from the deployment", () => {
    // api=http must look up the deployment's declared containerPort for
    // the local side; the stub serves it via STUB_KUBECTL_DEPLOY_JSON.
    const r = runIntercept(["api=http"], {
      STUB_KUBECTL_DEPLOYS: "api",
      STUB_KUBECTL_DEPLOY_JSON: '{"spec":{"template":{"spec":{"containers":[{"ports":[{"name":"http","containerPort":8080}]}]}}}}',
    });
    expect(r.status).toBe(0);
    expect(callsContain("--port 8080:http")).toBe(true);
  });

  it("the bare named-port form refuses an undeclared port name", () => {
    const r = runIntercept(["api=grpc"], {
      STUB_KUBECTL_DEPLOYS: "api",
      STUB_KUBECTL_DEPLOY_JSON: '{"spec":{"template":{"spec":{"containers":[{"ports":[{"name":"http","containerPort":8080}]}]}}}}',
    });
    expect(r.status).not.toBe(0);
    expect(r.out).toContain("declares no port named 'grpc'");
  });

  it("a kubectl failure during pair-form port validation reads as an environment error, not 'port not declared'", () => {
    // The pair form validates the declared target name via the same
    // status-aware resolution path as the bare form: a failed kubectl read
    // (stub exits 1 — no DEPLOY_JSON served) must surface "Cannot read
    // deployment", never "declares no port" — a transient failure misread
    // as a mapping typo sends the user chasing a phantom error.
    const r = runIntercept(["api=5678:http"], { STUB_KUBECTL_DEPLOYS: "api" });
    expect(r.status).not.toBe(0);
    expect(r.out).toContain("Cannot read deployment");
    expect(r.out).not.toContain("declares no port");
    expect(callsContain("telepresence intercept")).toBe(false);
  });

  it("duplicate mappings for one deployment are refused at parse time", () => {
    // Two mappings for the same deployment would run a second intercept
    // under the same default name (replacing the first's ports) and leave
    // twice on cleanup — refuse and tell the user to combine the ports.
    const r = runIntercept(["api=8080:http", "api=9090:http"], {
      STUB_KUBECTL_DEPLOYS: "api",
      STUB_KUBECTL_DEPLOY_JSON: '{"spec":{"template":{"spec":{"containers":[{"ports":[{"name":"http","containerPort":8080}]}]}}}}',
    });
    expect(r.status).not.toBe(0);
    expect(r.out).toContain("Duplicate mapping for deployment api");
    expect(callsContain("telepresence intercept")).toBe(false);
  });

  it("a port pair with three colon segments is refused", () => {
    const r = runIntercept(["api=8080:http:grpc"], { STUB_KUBECTL_DEPLOYS: "api" });
    expect(r.status).not.toBe(0);
    expect(r.out).toContain("too many ':' segments");
    expect(callsContain("telepresence intercept")).toBe(false);
  });
});

describe("kube-intercept k3d-context regression guard", () => {
  // k3d context names (k3d-<cluster>) must never resolve as namespace
  // candidates: the resolver matches within the namespace list only, and a
  // context-shaped string given to -n is a no-match error, never a
  // misresolved namespace.
  it("a k3d-context-shaped -n value is refused as a namespace (no silent misresolution)", () => {
    const r = runIntercept(["-n", "k3d-smoke", "api=8080"], { STUB_KUBECTL_DEPLOYS: "api-1" });
    expect(r.status).not.toBe(0);
    expect(r.out).toContain("No namespace matches 'k3d-smoke'");
    expect(callsContain("telepresence intercept")).toBe(false);
  });

  it("a partial k3d-context-shaped -n value is also refused when it matches nothing", () => {
    const r = runIntercept(["-n", "k3d-sm", "api=8080"], { STUB_KUBECTL_DEPLOYS: "api-1" });
    expect(r.status).not.toBe(0);
    expect(r.out).toContain("No namespace matches 'k3d-sm'");
  });

  it("a namespace literally named like a context still resolves (right dimension wins)", () => {
    const r = runIntercept(["-n", "k3d-smoke", "api=8080"], { STUB_KUBECTL_DEPLOYS: "api-1", STUB_KUBECTL_NAMESPACES: "default k3d-smoke" });
    expect(r.status).toBe(0);
    expect(kubectlArgvContains("kubectl get deployments -n k3d-smoke")).toBe(true);
  });
});
