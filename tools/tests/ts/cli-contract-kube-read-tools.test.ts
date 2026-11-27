// CLI contract + behavior tests for the read-only kube wrappers
// (kube-events, kube-describe, kube-rollout, kube-top): the family contract
// (--help/--version exit 0 without cluster access, misuse exit 2 before any
// kubectl call), forwarding semantics, namespace resolution, the
// single-match rule, and the read-only boundary (kube-rollout refuses
// restart/undo). kubectl is a recording stub; no cluster is involved.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { pathWithStubs, rmrf, stubCli, tmpDir, toolScript } from "./harness/index.ts";
import { EXIT_MISUSE, EXIT_SUCCESS } from "../../lib/core/exit-codes.ts";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

let TMP = "";

const { NAMESPACE: _ns, KUBE_NAMESPACE: _kns, DEVENV_REPO: _dr, ...procEnv } = process.env;

function kubectlCalls(): string[] {
  try {
    return readFileSync(join(TMP, "kubectl.log"), "utf8").split("\n").filter((l) => l !== "");
  } catch {
    return [];
  }
}

beforeEach(() => {
  TMP = tmpDir("cli-contract-kube-read");
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
      '  "get statefulsets") printf \'{"items":[{"metadata":{"name":"db"}}]}\' ;;',
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

// Swap the kubectl stub's pod list to two entries — the ambiguity leg of
// the single-match rule (the default stub returns exactly one pod, so the
// multi-match refusal branch is otherwise never exercised).
function stubTwoPods(): void {
  const bin = join(TMP, "bin");
  stubCli(
    bin,
    "kubectl",
    [
      "#!/usr/bin/env bash",
      `echo "kubectl $*" >> "${join(TMP, "kubectl.log")}"`,
      'case "$1 $2" in',
      '  "get namespaces") printf \'{"items":[{"metadata":{"name":"prod"}},{"metadata":{"name":"web"}}]}\' ;;',
      '  "get namespace") [ "$3" = "prod" ] || [ "$3" = "web" ] ;;',
      '  "get pods") printf \'{"items":[{"metadata":{"name":"myapp-1"}},{"metadata":{"name":"myapp-2"}}]}\' ;;',
      '  "get deployments") printf \'{"items":[{"metadata":{"name":"myapp"}},{"metadata":{"name":"myapp2"}}]}\' ;;',
      '  "get statefulsets") printf \'{"items":[{"metadata":{"name":"db"}}]}\' ;;',
      "esac",
      "",
    ].join("\n"),
  );
}

describe("the single-match rule refuses on multiple matches (ambiguity leg)", () => {
  beforeEach(() => stubTwoPods());

  it("kube-events: an ambiguous pod fragment errors before kubectl get events", () => {
    const r = run("kube-events", ["myapp", "-n", "prod"]);
    expect(r.status).not.toBe(EXIT_SUCCESS);
    expect(r.stderr + r.stdout).toContain("ambiguous");
    expect(kubectlCalls().every((c) => !c.startsWith("kubectl get events"))).toBe(true);
  });

  it("kube-describe: an ambiguous pod fragment errors before any describe", () => {
    const r = run("kube-describe", ["myapp", "-n", "prod"]);
    expect(r.status).not.toBe(EXIT_SUCCESS);
    expect(r.stderr + r.stdout).toContain("ambiguous");
    expect(kubectlCalls().every((c) => !c.startsWith("kubectl describe"))).toBe(true);
  });

  it("kube-rollout: an ambiguous deployment fragment errors before any rollout call", () => {
    const r = run("kube-rollout", ["status", "myapp", "-n", "prod"]);
    expect(r.status).not.toBe(EXIT_SUCCESS);
    expect(r.stderr + r.stdout).toContain("ambiguous");
    expect(kubectlCalls().every((c) => !c.startsWith("kubectl rollout"))).toBe(true);
  });
});

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

const NEW_TOOLS = ["kube-events", "kube-describe", "kube-rollout", "kube-top"];

describe.each(NEW_TOOLS)("%s house flags", (tool) => {
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
    // kube-events is wordless-safe: unknown leading flags are kubectl's and
    // forward verbatim (not misuse) — the family's parse-error contract
    // still holds for the worded tools.
    const tools =
      tool === "kube-events" ? ["kube-describe", "kube-rollout", "kube-top"] : [tool];
    for (const t of tools) {
      const r = run(t, ["--bogus"]);
      expect(r.status).toBe(EXIT_MISUSE);
      expect(r.stdout + r.stderr).toContain("--help");
    }
    expect(kubectlCalls()).toEqual([]);
  });
});

describe("kube-events", () => {
  it("namespace events: resolves the namespace and forwards kubectl flags", () => {
    const r = run("kube-events", ["-n", "prod", "--watch"]);
    expect(r.status).toBe(EXIT_SUCCESS);
    expect(kubectlCalls()).toContain("kubectl get events -n prod --watch");
  });

  it("resource events: resolves the single pod match into a field selector", () => {
    const r = run("kube-events", ["myapp", "-n", "prod", "--sort-by=.lastTimestamp"]);
    expect(r.status).toBe(EXIT_SUCCESS);
    expect(kubectlCalls()).toContain(
      "kubectl get events -n prod --field-selector involvedObject.name=myapp-1 --sort-by=.lastTimestamp",
    );
  });

  it("-k deployment resolves the fragment against deployments", () => {
    const r = run("kube-events", ["-k", "deployment", "myapp", "-n", "prod"]);
    expect(r.status).toBe(EXIT_SUCCESS);
    expect(kubectlCalls()).toContain(
      "kubectl get events -n prod --field-selector involvedObject.name=myapp",
    );
  });

  it("unknown kind is misuse (exit 2) before any kubectl get events", () => {
    const r = run("kube-events", ["-k", "ingress", "myapp"]);
    expect(r.status).toBe(EXIT_MISUSE);
    expect(kubectlCalls().every((c) => !c.startsWith("kubectl get events"))).toBe(true);
  });

  it("a resource fragment matching nothing is an error before kubectl get events", () => {
    const r = run("kube-events", ["nosuch", "-n", "prod"]);
    expect(r.status).not.toBe(EXIT_SUCCESS);
    expect(kubectlCalls().every((c) => !c.startsWith("kubectl get events"))).toBe(true);
  });

  it("namespace may follow the resource word (family form)", () => {
    const r = run("kube-events", ["myapp", "-n", "pro"]);
    expect(r.status).toBe(EXIT_SUCCESS);
    expect(kubectlCalls()).toContain("kubectl get events -n prod --field-selector involvedObject.name=myapp-1");
  });
});

describe("kube-describe", () => {
  it("describes the single pod match (default kind)", () => {
    const r = run("kube-describe", ["myapp", "-n", "prod"]);
    expect(r.status).toBe(EXIT_SUCCESS);
    expect(kubectlCalls()).toContain("kubectl describe pod myapp-1 -n prod");
  });

  it("-k deployment resolves against deployments", () => {
    const r = run("kube-describe", ["-k", "deployment", "myapp", "-n", "prod"]);
    expect(r.status).toBe(EXIT_SUCCESS);
    expect(kubectlCalls()).toContain("kubectl describe deployment myapp -n prod");
  });

  it("-k statefulset resolves against statefulsets", () => {
    const r = run("kube-describe", ["--kind", "statefulset", "db", "-n", "prod"]);
    expect(r.status).toBe(EXIT_SUCCESS);
    expect(kubectlCalls()).toContain("kubectl describe statefulset db -n prod");
  });

  it("unknown kind is misuse (exit 2) before any kubectl call", () => {
    const r = run("kube-describe", ["-k", "ingress", "myapp"]);
    expect(r.status).toBe(EXIT_MISUSE);
    expect(kubectlCalls()).toEqual([]);
  });

  it("missing operand is misuse (exit 2)", () => {
    const r = run("kube-describe", []);
    expect(r.status).toBe(EXIT_MISUSE);
    expect(kubectlCalls()).toEqual([]);
  });

  it("kubectl options after the name are forwarded", () => {
    const r = run("kube-describe", ["myapp", "-n", "prod", "--show-events"]);
    expect(r.status).toBe(EXIT_SUCCESS);
    expect(kubectlCalls()).toContain("kubectl describe pod myapp-1 -n prod --show-events");
  });
});

describe("kube-rollout", () => {
  it("status resolves the deployment and forwards", () => {
    const r = run("kube-rollout", ["status", "myapp", "-n", "prod"]);
    expect(r.status).toBe(EXIT_SUCCESS);
    expect(kubectlCalls()).toContain("kubectl rollout status deployment/myapp -n prod");
  });

  it("history forwards revision flags", () => {
    const r = run("kube-rollout", ["history", "myapp", "-n", "prod", "--revision=2"]);
    expect(r.status).toBe(EXIT_SUCCESS);
    expect(kubectlCalls()).toContain("kubectl rollout history deployment/myapp -n prod --revision=2");
  });

  it("restart is refused — read-only by design (exit 2, no kubectl call)", () => {
    const r = run("kube-rollout", ["restart", "myapp", "-n", "prod"]);
    expect(r.status).toBe(EXIT_MISUSE);
    expect(r.stderr + r.stdout).toContain("restart");
    expect(kubectlCalls()).toEqual([]);
  });

  it("undo is refused — read-only by design", () => {
    const r = run("kube-rollout", ["undo", "myapp", "-n", "prod"]);
    expect(r.status).toBe(EXIT_MISUSE);
    expect(kubectlCalls()).toEqual([]);
  });

  it("missing subcommand or name is misuse (exit 2)", () => {
    expect(run("kube-rollout", []).status).toBe(EXIT_MISUSE);
    expect(run("kube-rollout", ["status"]).status).toBe(EXIT_MISUSE);
    expect(kubectlCalls()).toEqual([]);
  });
});

describe("kube-top", () => {
  it("top pods resolves the namespace and forwards kubectl flags", () => {
    const r = run("kube-top", ["-n", "prod", "pods", "--containers"]);
    expect(r.status).toBe(EXIT_SUCCESS);
    expect(kubectlCalls()).toContain("kubectl top pods -n prod --containers");
  });

  it("top nodes is cluster-scoped (no namespace flag)", () => {
    const r = run("kube-top", ["nodes", "--sort-by=memory"]);
    expect(r.status).toBe(EXIT_SUCCESS);
    expect(kubectlCalls()).toContain("kubectl top nodes --sort-by=memory");
  });

  it("unknown subcommand is misuse (exit 2)", () => {
    const r = run("kube-top", ["services"]);
    expect(r.status).toBe(EXIT_MISUSE);
    expect(kubectlCalls()).toEqual([]);
  });

  it("missing subcommand is misuse (exit 2)", () => {
    const r = run("kube-top", []);
    expect(r.status).toBe(EXIT_MISUSE);
    expect(kubectlCalls()).toEqual([]);
  });

  it("kubectl absent: nodes fails with the family error, not a silent exit", () => {
    // PATH containing node but NO kubectl (the container's /usr/bin has a
    // real kubectl — an empty bin dir guarantees absence). The preflight
    // must produce a readable error, never a zero-output exit 1.
    const nodeBin = dirname(process.execPath);
    const r = spawnSync("node", [toolScript("kube-top"), "nodes"], {
      cwd: TMP,
      encoding: "utf8",
      input: "",
      env: {
        ...procEnv,
        DEVENV_ROOT: join(TMP, "devenv-root"),
        DEVENV_ROOT_SET: "1",
        KUBE_NO_INTERACTIVE: "1",
        PATH: nodeBin,
      },
    });
    expect(r.status).not.toBe(0);
    expect((r.stderr ?? "") + (r.stdout ?? "")).toContain("kubectl");
  });
});
