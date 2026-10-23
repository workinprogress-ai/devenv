// domain/kube/kube.ts — Kubernetes listing + resolution primitives (the
// listing half of kube-selection.bash, per the Phase 3 split: listing →
// domain/kube; interactive pickers → ui flows in the calling tools).
//
// Every function shells to kubectl through spawnSyncCli — no direct kubectl
// call lives outside this module. All commands are argv arrays (never shell
// strings), so user-supplied patterns/namespaces are never interpolated into
// a shell; regex filters reach kubectl's JSON output through jq's --arg
// binding exactly as the bash lib did (metacharacter-safe).

import { spawnSync } from "node:child_process";

/** The one seam for kubectl in this module: tests assert the argv through
 * this function; the recording-stub suites drive it via PATH. */
export function spawnKubectl(args: string[]): { stdout: string; status: number } {
  const r = spawnSync("kubectl", args, { encoding: "utf8" });
  return { stdout: r.stdout ?? "", status: r.status ?? 1 };
}

/** True when interactive picking is allowed: TTY on stdin and
 * KUBE_NO_INTERACTIVE unset/0 (the bash `_kube_interactive` contract). */
export function kubeInteractive(): boolean {
  return process.env.KUBE_NO_INTERACTIVE !== "1" && process.stdin.isTTY === true;
}

// ---------------------------------------------------------------------------
// Namespaces
// ---------------------------------------------------------------------------

/** List all namespace names. Throws (caller decides) when kubectl fails. */
export function listNamespaces(): string[] {
  const { stdout, status } = spawnKubectl(["get", "namespaces", "-o", "json"]);
  if (status !== 0) throw new Error("kubectl get namespaces failed");
  return namesFromJson(stdout);
}

/** True when the namespace exists. */
export function namespaceExists(ns: string): boolean {
  if (ns === "") throw new Error("Namespace name is required");
  return spawnKubectl(["get", "namespace", ns]).status === 0;
}

// ---------------------------------------------------------------------------
// Resource listing (one implementation for pods/deployments/statefulsets)
// ---------------------------------------------------------------------------

/** Extract `.items[].metadata.name` from kubectl JSON output. */
function namesFromJson(json: string): string[] {
  try {
    const parsed = JSON.parse(json) as { items?: Array<{ metadata?: { name?: string } }> };
    return (parsed.items ?? [])
      .map((it) => it.metadata?.name ?? "")
      .filter((n) => n !== "");
  } catch {
    return [];
  }
}

export interface ListOptions {
  namespace?: string;
  /** Regex pattern matched against resource names (jq test() semantics). */
  filter?: string;
}

/** List resource names of KIND (pods/deployments/statefulsets/...). The
 * filter rides as a jq --arg variable — never interpolated into the program
 * — so regex metacharacters in user input are safe (bash parity). */
export function listResources(kind: string, opts: ListOptions = {}): string[] {
  const args = ["get", kind];
  if (opts.namespace) args.push("-n", opts.namespace);
  args.push("-o", "json");
  const { stdout, status } = spawnKubectl(args);
  if (status !== 0) throw new Error(`kubectl get ${kind} failed`);
  const names = namesFromJson(stdout);
  if (!opts.filter) return names;
  let re: RegExp;
  try {
    re = new RegExp(opts.filter);
  } catch {
    throw new Error(`invalid filter pattern: ${opts.filter}`);
  }
  return names.filter((n) => re.test(n));
}

export function listPods(opts: ListOptions = {}): string[] {
  return listResources("pods", opts);
}

export function listDeployments(opts: ListOptions = {}): string[] {
  return listResources("deployments", opts);
}

export function listStatefulsets(opts: ListOptions = {}): string[] {
  return listResources("statefulsets", opts);
}

// ---------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------

/** Case-insensitive substring matches of CANDIDATE against NAMES. */
export function partialMatches(candidate: string, names: string[]): string[] {
  const c = candidate.toLowerCase();
  return names.filter((n) => n.toLowerCase().includes(c));
}

/** Resolve a namespace: explicit arg → NAMESPACE env → exact match →
 * partial-match (unique auto-selects) → [caller handles ambiguity/picker]
 * → current-context default. The interactive legs live in the calling
 * tools (ui flows); this returns either a resolved name or a structured
 * "needs interaction" result. */
export type NamespaceResolution =
  | { kind: "resolved"; ns: string }
  | { kind: "unreachable"; message: string }
  | { kind: "ambiguous"; candidate: string; matches: string[] }
  | { kind: "no-match"; candidate: string; available: string[] };

export function resolveNamespace(argNs: string): NamespaceResolution {
  const candidate = argNs || process.env.NAMESPACE || "";
  if (candidate !== "" && namespaceExists(candidate)) {
    return { kind: "resolved", ns: candidate };
  }
  let all: string[];
  try {
    all = listNamespaces();
  } catch {
    return { kind: "unreachable", message: "Could not list namespaces (kubectl cluster unreachable?)" };
  }
  if (all.length === 0) {
    return { kind: "unreachable", message: "No namespaces returned by cluster" };
  }
  if (candidate !== "") {
    const matches = partialMatches(candidate, all);
    if (matches.length === 1) return { kind: "resolved", ns: matches[0] as string };
    if (matches.length > 1) return { kind: "ambiguous", candidate, matches };
    return { kind: "no-match", candidate, available: all };
  }
  // Nothing given: the caller decides interactive-vs-default; expose the
  // context default for the non-interactive leg here.
  return { kind: "resolved", ns: currentNamespaceDefault() };
}

/** The kubectl current-context default namespace (or "default"), with the
 * trailing hint text owned by the caller. */
export function currentNamespaceDefault(): string {
  const { stdout } = spawnKubectl(["config", "view", "--minify", "--output", "jsonpath={..namespace}"]);
  return stdout.trim() !== "" ? stdout.trim() : "default";
}

/** Resolve a name fragment to exactly one resource: refuses on zero matches
 * (candidates would be unhelpfully empty) and on multiple matches so a
 * partial name can never touch an unintended resource. Returns the single
 * name, or a structured refusal with the candidates. */
export type SingleMatchResolution =
  | { kind: "single"; name: string }
  | { kind: "none"; message: string }
  | { kind: "ambiguous"; matches: string[] };

export function resolveSingleMatch(
  listFn: (opts: ListOptions) => string[],
  opts: ListOptions,
): SingleMatchResolution {
  let matches: string[];
  try {
    matches = listFn(opts);
  } catch (err) {
    return { kind: "none", message: err instanceof Error ? err.message : String(err) };
  }
  if (matches.length === 0) {
    return { kind: "none", message: `No matching resources found for pattern: ${opts.filter ?? ""}` };
  }
  if (matches.length > 1) {
    return { kind: "ambiguous", matches };
  }
  return { kind: "single", name: matches[0] as string };
}

/** Get a pod/deployment's JSON description (get_pod_info/get_deployment_info
 * parity). Caller decides output. */
export function getResourceJson(kind: string, name: string, ns?: string): string {
  const args = ["get", kind, name];
  if (ns) args.push("-n", ns);
  args.push("-o", "json");
  const { stdout, status } = spawnKubectl(args);
  if (status !== 0) throw new Error(`kubectl get ${kind} ${name} failed`);
  return stdout;
}
