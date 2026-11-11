// CLI contract for the kube-* tools: `--help`/`--version` exit 0 on stdout with
// no cluster access, a parse failure or missing operand is misuse (exit 2) before
// any kubectl call, and the forwarding tools stop reading their own options at
// the first command word so the child command's flags reach it untouched.
// kubectl is a recording stub; no cluster is involved.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathWithStubs, rmrf, stubCli, tmpDir, toolScript } from "./harness/index.ts";
import { EXIT_MISUSE, EXIT_SUCCESS } from "../../lib/core/exit-codes.ts";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

let TMP = "";

const { NAMESPACE: _ns, DEVENV_REPO: _dr, ...procEnv } = process.env;

function kubectlCalls(): string[] {
  try {
    return readFileSync(join(TMP, "kubectl.log"), "utf8").split("\n").filter((l) => l !== "");
  } catch {
    return [];
  }
}

beforeEach(() => {
  TMP = tmpDir("cli-contract-kube");
  const bin = join(TMP, "bin");
  mkdirSync(bin, { recursive: true });
  writeFileSync(join(TMP, "kubectl.log"), "");
  stubCli(
    bin,
    "kubectl",
    [
      "#!/usr/bin/env bash",
      `echo "kubectl $*" >> "${join(TMP, "kubectl.log")}"`,
      'case "$1 $2" in',
      '  "get namespaces") printf \'{"items":[{"metadata":{"name":"prod"}},{"metadata":{"name":"web"}}]}\' ;;',
      '  "get namespace") [ "$3" = "prod" ] || [ "$3" = "web" ] ;;',
      '  "get pods") printf \'{"items":[{"metadata":{"name":"myapp-1"}}]}\' ;;',
      '  "get deployments") printf \'{"items":[{"metadata":{"name":"myapp"}}]}\' ;;',
      "esac",
      "",
    ].join("\n"),
  );
  const root = join(TMP, "devenv-root");
  mkdirSync(root, { recursive: true });
  writeFileSync(
    join(root, "devenv.config"),
    "[provider]\nname=github\n\n[organization]\nname=Test Organization\norg=test-org\nemail_domain=test.example.com\n",
  );
});

afterEach(() => rmrf(TMP));

function run(tool: string, args: string[]): { status: number; stdout: string; stderr: string } {
  const r = spawnSync("node", [toolScript(tool), ...args], {
    cwd: TMP,
    encoding: "utf8",
    input: "",
    env: {
      ...procEnv,
      DEVENV_ROOT: join(TMP, "devenv-root"),
      DEVENV_ROOT_SET: "1",
      KUBE_NO_INTERACTIVE: "1",
      PATH: pathWithStubs(join(TMP, "bin")),
    },
  });
  return { status: r.status ?? 1, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

const KUBE_TOOLS = [
  "kube-logs",
  "kube-pod-exec",
  "kube-pod-console",
  "kube-pod-delete",
  "kube-pod-scale",
  "kube-pod-restart",
  "kube-list-pods",
  "kube-pod-select",
  "kube-deployment-select",
  "kube-forward-ports",
  "kube-intercept",
];

describe.each(KUBE_TOOLS)("%s house flags", (tool) => {
  it("--help exits 0 with usage on stdout and never touches the cluster", () => {
    const r = run(tool, ["--help"]);
    expect(r.status).toBe(EXIT_SUCCESS);
    expect(r.stdout).toContain(`Usage: ${tool}`);
    expect(kubectlCalls()).toEqual([]);
  });

  it("--version exits 0 with a version on stdout", () => {
    const r = run(tool, ["--version"]);
    expect(r.status).toBe(EXIT_SUCCESS);
    expect(r.stdout.trim()).toMatch(/^\d+\.\d+\.\d+/);
    expect(kubectlCalls()).toEqual([]);
  });

  it("an unknown option before the first operand is misuse (exit 2) with a --help hint", () => {
    const r = run(tool, ["--bogus"]);
    expect(r.status).toBe(EXIT_MISUSE);
    expect(r.stdout + r.stderr).toContain("--help");
    expect(kubectlCalls()).toEqual([]);
  });
});

describe("operand misuse exits 2 before any kubectl call", () => {
  it.each(["kube-logs", "kube-pod-exec", "kube-pod-console"])("%s without a pod", (tool) => {
    const r = run(tool, []);
    expect(r.status).toBe(EXIT_MISUSE);
    expect(kubectlCalls()).toEqual([]);
  });

  it("kube-pod-exec without a command", () => {
    const r = run("kube-pod-exec", ["myapp"]);
    expect(r.status).toBe(EXIT_MISUSE);
    expect(kubectlCalls()).toEqual([]);
  });

  it("kube-pod-exec -n without a value", () => {
    const r = run("kube-pod-exec", ["-n"]);
    expect(r.status).toBe(EXIT_MISUSE);
  });

  it.each(["kube-forward-ports", "kube-intercept"])("%s without mappings", (tool) => {
    const r = run(tool, []);
    expect(r.status).toBe(EXIT_MISUSE);
    expect(r.stderr + r.stdout).toContain("Usage");
  });
});

describe("forwarding tools stop at the first command word", () => {
  it("kube-pod-exec: -n inside the command is the command's, not the namespace", () => {
    const r = run("kube-pod-exec", ["-n", "prod", "myapp", "echo", "-n", "hi"]);
    expect(r.status).toBe(EXIT_SUCCESS);
    expect(kubectlCalls().some((c) => c.startsWith("kubectl exec myapp-1 -n prod -- echo -n hi"))).toBe(true);
  });

  it("kube-pod-exec: -h inside the command is the command's, not help", () => {
    const r = run("kube-pod-exec", ["-n", "prod", "myapp", "ls", "-h"]);
    expect(r.status).toBe(EXIT_SUCCESS);
    expect(r.stdout).not.toContain("Usage: kube-pod-exec");
    expect(kubectlCalls().some((c) => c.includes("-- ls -h"))).toBe(true);
  });

  it("kube-pod-exec: -- ends option parsing", () => {
    const r = run("kube-pod-exec", ["-n", "prod", "--", "myapp", "ls", "-la"]);
    expect(r.status).toBe(EXIT_SUCCESS);
    expect(kubectlCalls().some((c) => c.includes("-- ls -la"))).toBe(true);
  });

  it("kube-logs: kubectl options after the pod are forwarded", () => {
    const r = run("kube-logs", ["-n", "prod", "myapp", "-f", "--tail=5", "-n", "other"]);
    expect(r.status).toBe(EXIT_SUCCESS);
    expect(kubectlCalls().some((c) => c.startsWith("kubectl logs myapp-1 -n prod -f --tail=5 -n other"))).toBe(true);
  });

  it("kube-pod-console: dashed command arguments are forwarded", () => {
    const r = run("kube-pod-console", ["-n", "prod", "myapp", "ls", "-la"]);
    expect(r.status).toBe(EXIT_SUCCESS);
    expect(kubectlCalls().some((c) => c.includes("-- ls -la"))).toBe(true);
  });
});

describe("the namespace option may follow the pod word", () => {
  it("kube-pod-exec: -n after the pod selects the namespace and the command stays unread", () => {
    const r = run("kube-pod-exec", ["myapp", "-n", "prod", "ls", "-la"]);
    expect(r.status).toBe(EXIT_SUCCESS);
    expect(kubectlCalls().some((c) => c === "kubectl exec myapp-1 -n prod -- ls -la")).toBe(true);
  });

  it("kube-pod-exec: a fuzzy namespace after the pod is resolved", () => {
    const r = run("kube-pod-exec", ["myapp", "--namespace", "pro", "ls"]);
    expect(r.status).toBe(EXIT_SUCCESS);
    expect(kubectlCalls().some((c) => c === "kubectl exec myapp-1 -n prod -- ls")).toBe(true);
  });

  it("kube-pod-exec: attached -nprod and --namespace=prod forms", () => {
    for (const form of [["-nprod"], ["--namespace=prod"]]) {
      writeFileSync(join(TMP, "kubectl.log"), "");
      const r = run("kube-pod-exec", ["myapp", ...form, "ls"]);
      expect(r.status).toBe(EXIT_SUCCESS);
      expect(kubectlCalls().some((c) => c === "kubectl exec myapp-1 -n prod -- ls")).toBe(true);
    }
  });

  it("kube-pod-exec: -- after the pod ends option scanning (the command's -n stays the command's)", () => {
    const r = run("kube-pod-exec", ["-n", "prod", "myapp", "--", "echo", "-n", "hi"]);
    expect(r.status).toBe(EXIT_SUCCESS);
    expect(kubectlCalls().some((c) => c === "kubectl exec myapp-1 -n prod -- echo -n hi")).toBe(true);
  });

  it("kube-pod-exec: a missing namespace value after the pod is misuse (exit 2)", () => {
    for (const flag of ["-n", "--namespace"]) {
      const r = run("kube-pod-exec", ["myapp", flag]);
      expect(r.status).toBe(EXIT_MISUSE);
    }
    expect(kubectlCalls()).toEqual([]);
  });

  it("kube-pod-exec: scanning stops at the first command word, so a later -n is the command's", () => {
    const r = run("kube-pod-exec", ["myapp", "-n", "prod", "echo", "-n", "web"]);
    expect(r.status).toBe(EXIT_SUCCESS);
    expect(kubectlCalls().some((c) => c === "kubectl exec myapp-1 -n prod -- echo -n web")).toBe(true);
  });

  it("kube-logs: -n after the pod is the namespace; later kubectl options are forwarded", () => {
    const r = run("kube-logs", ["myapp", "-n", "pro", "-f", "--tail=5"]);
    expect(r.status).toBe(EXIT_SUCCESS);
    expect(kubectlCalls().some((c) => c === "kubectl logs myapp-1 -n prod -f --tail=5")).toBe(true);
  });

  it("kube-logs: -n after kubectl options belongs to kubectl", () => {
    const r = run("kube-logs", ["-n", "prod", "myapp", "-f", "-n", "other"]);
    expect(r.status).toBe(EXIT_SUCCESS);
    expect(kubectlCalls().some((c) => c === "kubectl logs myapp-1 -n prod -f -n other")).toBe(true);
  });

  it("kube-logs: -- after the pod ends option scanning", () => {
    const r = run("kube-logs", ["-n", "prod", "myapp", "--", "-n", "other"]);
    expect(r.status).toBe(EXIT_SUCCESS);
    expect(kubectlCalls().some((c) => c === "kubectl logs myapp-1 -n prod -n other")).toBe(true);
  });

  it("kube-logs: a missing namespace value after the pod is misuse (exit 2)", () => {
    const r = run("kube-logs", ["myapp", "--namespace"]);
    expect(r.status).toBe(EXIT_MISUSE);
    expect(kubectlCalls()).toEqual([]);
  });

  it("kube-pod-console: -n after the pod, then the command", () => {
    const r = run("kube-pod-console", ["myapp", "-nprod", "ls", "-la"]);
    expect(r.status).toBe(EXIT_SUCCESS);
    expect(kubectlCalls().some((c) => c === "kubectl exec -it myapp-1 -n prod -- ls -la")).toBe(true);
  });
});

describe("non-forwarding tools reject stray options", () => {
  it.each([
    ["kube-pod-delete", ["myapp", "--bogus"]],
    ["kube-pod-scale", ["myapp", "2", "--bogus"]],
    ["kube-pod-restart", ["myapp", "--bogus"]],
    ["kube-list-pods", ["myapp", "--bogus"]],
    ["kube-pod-select", ["myapp", "--bogus"]],
    ["kube-deployment-select", ["myapp", "--bogus"]],
  ] as Array<[string, string[]]>)("%s", (tool, args) => {
    const r = run(tool, args);
    expect(r.status).toBe(EXIT_MISUSE);
    expect(kubectlCalls()).toEqual([]);
  });
});
