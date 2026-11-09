// Provider parity — the surviving contract after the bash verb layer's
// retirement. The bats-era suite drove the bash verb twins
// (provider_load repos issues prs …); those modules are gone — the verbs
// now live as TS functions behind the facade. What the parity concept still
// owns, and this suite pins:
//   - the CONTRACT.md verb inventory is parseable and every listed verb has
//     a table row (the doc is the cross-provider vocabulary);
//   - the TS surface rejects unknown options by name (toolCli argv error
//     path) and invalid option values (limits, status words) instead of
//     returning everything.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });

const ROOT = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))));
const TOOLS = join(ROOT, "tools");
const CONTRACT = join(TOOLS, "lib/providers/CONTRACT.md");

let TMP = "";

beforeEach(() => {
  TMP = mkdtempSync(join(tmpdir(), `azpar-${Date.now()}-${Math.random().toString(36).slice(2)}`));
  mkdirSync(join(TMP, "devenv-root"), { recursive: true });
  writeFileSync(join(TMP, "devenv-root/devenv.config"), "[provider]\nname=azure\nazure_org=org\nazure_project=proj\n");
});

// contract_verbs [all|github|azure]: the verbs the contract lists for a provider
function contractVerbs(which: "all" | "github" | "azure"): string[] {
  const r = spawnSync(
    "bash",
    [
      "-c",
      `awk '/<!-- contract:verbs -->/{f=1;next} /<!-- \\/contract:verbs -->/{f=0} f' '${CONTRACT}'` +
      ` | grep -E '^provider_' | while read -r verb rest; do` +
      ` case "${which}" in` +
      ` all) echo "$verb" ;;` +
      ` github) [[ "$rest" == *"azure-only"* ]] || echo "$verb" ;;` +
      ` azure) [[ "$rest" == *"github-only"* ]] || echo "$verb" ;;` +
      ` esac; done`,
    ],
    { encoding: "utf8" },
  );
  return (r.stdout ?? "").split("\n").filter(Boolean);
}

describe("contract verb inventory", () => {
  it("the contract lists verbs, and the block is parsed", () => {
    expect(contractVerbs("all").length).toBeGreaterThanOrEqual(60);
  });

  it("every contract verb has a row in the contract's tables", () => {
    const contract = (spawnSync("bash", ["-c", `cat '${CONTRACT}'`], { encoding: "utf8" }).stdout ?? "");
    const exempt = new Set(["provider_api", "provider_api_paginate", "provider_issues_add_tag"]);
    const missing = contractVerbs("all").filter((v) => !exempt.has(v) && !contract.includes(`| \`${v}\``));
    expect(missing, `no table row for:${missing.join(" ")}`).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// TS-surface option semantics (ported from the bash-era pins: the verbs now
// live in TS; the same guarantees are pinned against the TS surface).
// ---------------------------------------------------------------------------

function runTsTool(script: string, args: string[]): { status: number; out: string } {
  const r = spawnSync("node", [join(TOOLS, "ts", script), ...args], {
    encoding: "utf8",
    env: { ...process.env, DEVENV_TOOLS: TOOLS, DEVENV_ROOT: join(TMP, "devenv-root") },
  });
  return { status: r.status ?? 1, out: (r.stdout ?? "") + (r.stderr ?? "") };
}

describe("unknown-option rejection (TS surface)", () => {
  it("option-taking tools reject an unknown option by name without issuing a request", () => {
    const failures: string[] = [];
    for (const [script, args] of [
      ["issue-list.ts", ["--no-such-option-xyz"]],
      ["pr-list.ts", ["--no-such-option-xyz"]],
    ] as const) {
      const r = runTsTool(script, [...args]);
      if (r.status === 0 || !r.out.includes("no-such-option-xyz")) failures.push(`${script}(${r.out.slice(0, 120)})`);
    }
    expect(failures, `tools that did not reject an unknown option:${failures.join(" ")}`).toEqual([]);
  });
});

describe("value-option handling (TS surface)", () => {
  it("filters reject values they cannot honor instead of returning everything", () => {
    const failures: string[] = [];
    for (const [script, args, needle] of [
      ["issue-list.ts", ["--limit", "abc"], "--limit"],
      ["pr-list.ts", ["--limit", "abc"], "limit"],
    ] as const) {
      const r = runTsTool(script, [...args]);
      if (r.status === 0 || !r.out.toLowerCase().includes(needle.toLowerCase())) failures.push(`${script}(${args.join(" ")},rc=${r.status})`);
    }
    expect(failures, `filters accepted an unusable value:${failures.join(" ")}`).toEqual([]);
  });

  it("the contract defines the --status words, and the azure pipeline mapping accepts every one of them", async () => {
    const contract = (spawnSync("bash", ["-c", `cat '${CONTRACT}'`], { encoding: "utf8" }).stdout ?? "");
    const { pipelinesRunList } = await import(join(TOOLS, "lib/providers/azure/pipelines.ts"));
    const realFetch = globalThis.fetch;
    const urls: string[] = [];
    globalThis.fetch = (async (url: string | URL) => {
      urls.push(String(url));
      return new Response(JSON.stringify({ value: [] }), { status: 200 });
    }) as typeof fetch;
    process.env.AZURE_PAT = "test-pat";
    process.env.AZURE_DEVOPS_ORG = "org";
    process.env.AZURE_DEVOPS_PROJECT = "proj";
    try {
      for (const word of ["queued", "in_progress", "completed", "success", "failure", "cancelled"]) {
        expect(contract, `contract missing status word ${word}`).toContain(`\`${word}\``);
        // Every contract word maps onto an Azure filter — a bogus one throws.
        // Empty repo = org-wide builds (no per-repo GUID leg).
        const out = await pipelinesRunList("", { status: word });
        expect(Array.isArray(out)).toBe(true);
      }
      await expect(pipelinesRunList("", { status: "banana" })).rejects.toThrow(/no Azure analog/);
      // The PAT never rides the URL.
      expect(urls.every((u) => !u.includes("test-pat"))).toBe(true);
    } finally {
      globalThis.fetch = realFetch;
      delete process.env.AZURE_PAT;
      delete process.env.AZURE_DEVOPS_ORG;
      delete process.env.AZURE_DEVOPS_PROJECT;
    }
  });
});
