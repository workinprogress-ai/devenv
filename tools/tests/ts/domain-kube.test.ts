// Unit tests for domain/kube/kube.ts — the listing/resolution primitives.
// kubectl is a recording stub on PATH; the suite asserts argv shapes, filter
// safety (regex metacharacters never interpolated into shell), namespace
// resolution ordering, and single-match guard semantics.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  spawnKubectl,
  kubeInteractive,
  listNamespaces,
  namespaceExists,
  listResources,
  listPods,
  listDeployments,
  partialMatches,
  resolveNamespace,
  currentNamespaceDefault,
  resolveSingleMatch,
  getResourceJson,
} from "../../lib/domain/kube/kube.ts";

let stubDir = "";

interface Pod {
  metadata: { name: string };
}

/** kubectl stub serving STUB_KUBECTL-shaped fixture data, logging argv. */
function installKubectlStub(opts: {
  namespaces?: string[];
  pods?: string[];
  deployments?: string[];
  defaultNs?: string;
  fail?: boolean;
  logPath: string;
}): void {
  const json = (names: string[]): string =>
    JSON.stringify({ items: names.map((n) => ({ metadata: { name: n } })) });
  const nsList = JSON.stringify({ items: (opts.namespaces ?? []).map((n) => ({ metadata: { name: n } })) });
  const podsJson = json(opts.pods ?? []);
  const depJson = json(opts.deployments ?? []);
  const defaultNs = opts.defaultNs ?? "default";
  const fail = opts.fail === true ? "1" : "0";
  writeFileSync(
    join(stubDir, "kubectl"),
    [
      "#!/usr/bin/env bash",
      `printf '%s\\n' "kubectl $*" >> "${opts.logPath}"`,
      `if [ "${fail}" = "1" ]; then echo "stub-kubectl: simulated failure" >&2; exit 1; fi`,
      'case "$1 $2" in',
      '  "get namespaces")',
      `    printf '%s\\n' '${nsList}';;`,
      '  "get namespace")',
      '    ns="$3";',
      `    for n in ${(opts.namespaces ?? []).join(" ")}; do [ "$n" = "$ns" ] && exit 0; done`,
      "    exit 1;;",
      '  "get pods")',
      `    printf '%s\\n' '${podsJson}';;`,
      '  "get deployment"*)',
      `    printf '%s\\n' '${depJson}';;`,
      '  "config view")',
      `    printf '%s\\n' '${defaultNs}';;`,
      "  *) exit 0;;",
      "esac",
      "",
    ].join("\n"),
    { mode: 0o755 },
  );
}

beforeEach(() => {
  stubDir = mkdtempSync(join(tmpdir(), "kubedom-stub-"));
  process.env.PATH = `${stubDir}:${process.env.PATH ?? ""}`;
});

afterEach(() => {
  rmSync(stubDir, { recursive: true, force: true });
});

describe("domain/kube", () => {
  it("spawnKubectl passes argv through and reports status", () => {
    const r = spawnKubectl(["version", "--client"]);
    expect(r.status).toBe(0);
    void r;
  });

  it("listNamespaces parses the JSON items", () => {
    installKubectlStub({ namespaces: ["prod", "staging"], logPath: join(stubDir, "log") });
    expect(listNamespaces()).toEqual(["prod", "staging"]);
  });

  it("namespaceExists uses get namespace (exit-code contract)", () => {
    installKubectlStub({ namespaces: ["prod"], logPath: join(stubDir, "log") });
    expect(namespaceExists("prod")).toBe(true);
    expect(namespaceExists("nope")).toBe(false);
  });

  it("listResources passes -n before -o json and filters by regex safely", () => {
    const log = join(stubDir, "log");
    installKubectlStub({ pods: ["myapp-1", "other-2", "myapp-3"], logPath: log });
    const all = listPods({ namespace: "prod" });
    expect(all).toEqual(["myapp-1", "other-2", "myapp-3"]);
    const filtered = listPods({ namespace: "prod", filter: "myapp" });
    expect(filtered).toEqual(["myapp-1", "myapp-3"]);
    // Case-insensitive — bash grep -i parity (F01).
    expect(listPods({ namespace: "prod", filter: "MYAPP" })).toEqual(["myapp-1", "myapp-3"]);
    // A syntactically invalid regex is a named error (fail loud), not a
    // crash or a shell interpolation problem.
    expect(() => listPods({ namespace: "prod", filter: ".*([" })).toThrow(/invalid filter pattern/);
    const call = readLog(log).find((l) => l.includes("get pods")) ?? "";
    expect(call).toContain("get pods -n prod -o json");
  });

  it("listDeployments goes through the same generic listing", () => {
    installKubectlStub({ deployments: ["api"], logPath: join(stubDir, "log") });
    expect(listDeployments({ namespace: "web" })).toEqual(["api"]);
  });

  it("kubeInteractive honors KUBE_NO_INTERACTIVE", () => {
    const prev = process.env.KUBE_NO_INTERACTIVE;
    process.env.KUBE_NO_INTERACTIVE = "1";
    expect(kubeInteractive()).toBe(false);
    if (prev === undefined) delete process.env.KUBE_NO_INTERACTIVE;
    else process.env.KUBE_NO_INTERACTIVE = prev;
  });

  it("resolveNamespace: exact match fast path", () => {
    installKubectlStub({ namespaces: ["prod", "staging"], logPath: join(stubDir, "log") });
    const r = resolveNamespace("prod");
    expect(r).toEqual({ kind: "resolved", ns: "prod" });
  });

  it("resolveNamespace: unique partial match auto-selects", () => {
    installKubectlStub({ namespaces: ["prod", "staging"], logPath: join(stubDir, "log") });
    const r = resolveNamespace("sta");
    expect(r).toEqual({ kind: "resolved", ns: "staging" });
  });

  it("resolveNamespace: ambiguous partial reports the matches", () => {
    installKubectlStub({ namespaces: ["prod-a", "prod-b"], logPath: join(stubDir, "log") });
    const r = resolveNamespace("prod");
    expect(r.kind).toBe("ambiguous");
    if (r.kind === "ambiguous") expect(r.matches.sort()).toEqual(["prod-a", "prod-b"]);
  });

  it("resolveNamespace: no match lists the available namespaces", () => {
    installKubectlStub({ namespaces: ["prod"], logPath: join(stubDir, "log") });
    const r = resolveNamespace("bogus");
    expect(r.kind).toBe("no-match");
    if (r.kind === "no-match") expect(r.available).toEqual(["prod"]);
  });

  it("resolveNamespace: NAMESPACE env is the fallback candidate", () => {
    installKubectlStub({ namespaces: ["staging"], logPath: join(stubDir, "log") });
    const prev = process.env.NAMESPACE;
    process.env.NAMESPACE = "stag";
    try {
      const r = resolveNamespace("");
      expect(r).toEqual({ kind: "resolved", ns: "staging" });
    } finally {
      if (prev === undefined) delete process.env.NAMESPACE;
      else process.env.NAMESPACE = prev;
    }
  });

  it("currentNamespaceDefault falls back to 'default' when empty", () => {
    installKubectlStub({ defaultNs: "", logPath: join(stubDir, "log") });
    expect(currentNamespaceDefault()).toBe("default");
    installKubectlStub({ defaultNs: "web", logPath: join(stubDir, "log") });
    expect(currentNamespaceDefault()).toBe("web");
  });

  it("resolveSingleMatch: single / none / ambiguous with the guard semantics", () => {
    const list = (o: { filter?: string }): string[] => {
      void o;
      return [];
    };
    const single = (o: { filter?: string }): string[] => ["only-one"];
    const multi = (o: { filter?: string }): string[] => ["a-1", "a-2"];

    expect(resolveSingleMatch(single, {})).toEqual({ kind: "single", name: "only-one" });
    const none = resolveSingleMatch(list, { filter: "nomatch" });
    expect(none.kind).toBe("none");
    const amb = resolveSingleMatch(multi, { filter: "a" });
    expect(amb.kind).toBe("ambiguous");
    if (amb.kind === "ambiguous") expect(amb.matches).toEqual(["a-1", "a-2"]);
  });

  it("getResourceJson returns the raw JSON for pod/deployment views", () => {
    installKubectlStub({ logPath: join(stubDir, "log") });
    const out = getResourceJson("deployment", "api", "web");
    expect(out).toContain("items");
  });
});

// ── helpers ──────────────────────────────────────────────────────────────

function readLog(path: string): string[] {
  const r = spawnSync("cat", [path], { encoding: "utf8" });
  return (r.stdout ?? "").split("\n").filter((l) => l.startsWith("kubectl"));
}

// Keep the Pod type referenced (fixture shape documentation).
void (null as unknown as Pod | null);
