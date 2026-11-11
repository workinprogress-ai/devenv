// Provider parity — the enforced provider contract.
//
// CONTRACT.md carries a machine-readable coverage table (the
// `<!-- contract:verbs -->` block): one row per verb with the facade,
// GitHub and Azure export it names. This suite imports the REAL modules —
// each provider and the facade, in a fresh node child per active provider —
// and compares their export names with the table, so a verb added, renamed
// or removed in code without a table change fails here, naming the verb and
// the provider. It also pins:
//   - every table verb has a row in the contract's human-readable tables;
//   - the shared seam exports listed in the `<!-- contract:seam -->` block
//     still exist in provider-core;
//   - the TS surface rejects unknown options by name (toolCli argv error
//     path) and invalid option values (limits, status words) instead of
//     returning everything.
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { canaryEnv } from "./harness/canary.ts";

vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });

const ROOT = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))));
const TOOLS = join(ROOT, "tools");
const PROVIDERS = join(TOOLS, "lib/providers");
const CONTRACT = join(PROVIDERS, "CONTRACT.md");

let TMP = "";

beforeEach(() => {
  TMP = mkdtempSync(join(tmpdir(), `azpar-${Date.now()}-${Math.random().toString(36).slice(2)}`));
  mkdirSync(join(TMP, "devenv-root"), { recursive: true });
  writeFileSync(join(TMP, "devenv-root/devenv.config"), "[provider]\nname=azure\nazure_org=org\nazure_project=proj\n");
});

// ---------------------------------------------------------------------------
// The contract tables (parsed with plain TypeScript)
// ---------------------------------------------------------------------------

type Who = "facade" | "github" | "azure";

/** A parsed coverage cell. */
type Cell =
  | { kind: "export"; module: string; name: string }
  | { kind: "ops"; key: string }
  | { kind: "none" }
  | { kind: "via-facade" }
  | { kind: "gap"; reason: string };

interface Row {
  verb: string;
  cells: Record<Who, Cell>;
  notes: string;
}

/** The text between the two markers of a named block, or throws. */
function contractBlock(name: string): string[] {
  const text = readFileSync(CONTRACT, "utf8");
  const open = `<!-- contract:${name} -->`;
  const close = `<!-- /contract:${name} -->`;
  const from = text.indexOf(open);
  const to = text.indexOf(close);
  if (from === -1 || to === -1 || to < from) throw new Error(`CONTRACT.md has no valid ${open} ... ${close} block`);
  return text
    .slice(from + open.length, to)
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l !== "" && !l.startsWith("```"));
}

function parseCell(raw: string): Cell {
  const cell = raw.trim();
  if (cell === "-") return { kind: "none" };
  if (cell === "via-facade") return { kind: "via-facade" };
  if (cell.startsWith("gap:")) return { kind: "gap", reason: cell.slice(4).trim() };
  if (cell.startsWith("ops:")) return { kind: "ops", key: cell.slice(4).trim() };
  const dot = cell.indexOf(".");
  if (dot <= 0 || dot === cell.length - 1 || /\s/.test(cell)) {
    throw new Error(`malformed coverage cell '${cell}' (expected module.export, ops:key, -, via-facade or gap: reason)`);
  }
  return { kind: "export", module: cell.slice(0, dot), name: cell.slice(dot + 1) };
}

function parseRows(): Row[] {
  return contractBlock("verbs").map((line) => {
    const parts = line.split("|").map((p) => p.trim());
    if (parts.length < 5) throw new Error(`coverage row needs 5 columns (verb | facade | github | azure | notes): '${line}'`);
    const [verb, facade, github, azure, ...rest] = parts as [string, string, string, string, ...string[]];
    return {
      verb,
      cells: { facade: parseCell(facade), github: parseCell(github), azure: parseCell(azure) },
      notes: rest.join(" | ").trim(),
    };
  });
}

/** `provider_prs_thread_reply` -> `prsThreadReply`. */
function camel(snake: string): string {
  return snake.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase());
}

/** The export a verb maps to: the camel-cased remainder after `provider_`. */
function conventionalName(verb: string): string {
  return camel(verb.replace(/^provider_/, ""));
}

/** Verbs whose export name differs from the convention, per cell owner.
 * The blocked-by verbs are named by their facade-level purpose, and each
 * provider spells its own link primitive differently. */
const EXCEPTIONS: Record<string, Partial<Record<Who, string>>> = {
  provider_issue_blocked_by_add: { facade: "blockedByAdd", github: "issueBlockedByLink", azure: "issueDependencyLink" },
  provider_issue_blocked_by_remove: { facade: "blockedByRemove", github: "issueBlockedByUnlink", azure: "issueDependencyUnlink" },
};

/** Facade exports that are containers, not verbs: `projectsOps()` returns
 * the object whose members the `ops:` cells name. */
const FACADE_CONTAINER_EXPORTS = new Set(["projects.projectsOps"]);

/** The known, named gaps: a verb the contract lists that a provider has not
 * implemented. The table's `gap:` cells must equal this list exactly, so a
 * new gap is a deliberate edit in two places and a closed gap is removed. */
const KNOWN_GAPS = [
  "provider_repos_default_branch@github",
  "provider_repos_protect_branch@github",
  "provider_issues_comment_edit@azure",
  "provider_org_packages_list@github",
  "provider_org_package_versions@github",
];

const FACADE_MODULES = ["issues", "prs", "repos", "org", "pipelines", "projects", "urls"];
const PROVIDER_MODULES = ["issues", "prs", "repos", "org", "pipelines", "projects", "urls"];
const AZURE_EXTRA_MODULES = ["policies", "auth"];

/** Provider exports that look like verbs (family-word prefix) must have a
 * row; helpers (`workItemTypeFor`, `mapBuild`, ...) do not start with one.
 * Exports that start with one but are helpers are listed explicitly. */
const HELPER_EXPORTS = new Set(["issuesArtifactBodyTransform"]);
const VERB_SHAPED = /^(issues|issue[A-Z]|prs|repos|org|pipelines|projects)/;
const VERB_SHAPED_MODULES = new Set(["issues", "prs", "repos", "org", "pipelines", "projects", "policies"]);

// ---------------------------------------------------------------------------
// Real exports, read from fresh node children
// ---------------------------------------------------------------------------

interface Surface {
  github: Record<string, string[]>;
  azure: Record<string, string[]>;
  facade: Record<string, string[]>;
  seam: string[];
  opsKeys: string[];
}

/** Import every provider module, every facade module and provider-core in a
 * fresh process whose active provider is `provider`, and print the sorted
 * function-export names per module plus the keys `projectsOps()` returns. */
function readSurface(provider: "github" | "azure"): Surface {
  const root = mkdtempSync(join(tmpdir(), `provsurf-${provider}-`));
  writeFileSync(
    join(root, "devenv.config"),
    `[provider]\nname=${provider}\nazure_org=org\nazure_project=proj\n\n[organization]\norg=fixture-org\n`,
  );
  const url = (rel: string) => pathToFileURL(join(PROVIDERS, rel)).href;
  const code = `
    const names = (m) => Object.keys(m).filter((k) => typeof m[k] === "function").sort();
    const out = { github: {}, azure: {}, facade: {} };
    for (const mod of ${JSON.stringify(PROVIDER_MODULES)}) out.github[mod] = names(await import(${JSON.stringify(url("github/"))} + mod + ".ts"));
    for (const mod of ${JSON.stringify([...PROVIDER_MODULES, ...AZURE_EXTRA_MODULES])}) out.azure[mod] = names(await import(${JSON.stringify(url("azure/"))} + mod + ".ts"));
    for (const mod of ${JSON.stringify(FACADE_MODULES)}) out.facade[mod] = names(await import(${JSON.stringify(url("facade/"))} + mod + ".ts"));
    const core = await import(${JSON.stringify(url("provider-core.ts"))});
    out.seam = Object.keys(core).sort();
    const facadeProjects = await import(${JSON.stringify(url("facade/projects.ts"))});
    out.opsKeys = Object.keys(await facadeProjects.projectsOps()).sort();
    process.stdout.write(JSON.stringify(out));
  `;
  const r = spawnSync("node", ["--input-type=module", "-e", code], {
    encoding: "utf8",
    env: { ...canaryEnv(), DEVENV_ROOT: root, HOME: root, AZURE_PAT: "fake-pat-for-test" },
  });
  if (r.status !== 0) throw new Error(`could not read the provider surface under '${provider}': ${r.stderr}`);
  return JSON.parse(r.stdout) as Surface;
}

let rows: Row[] = [];
let surfaces: Record<"github" | "azure", Surface>;

beforeAll(() => {
  rows = parseRows();
  surfaces = { github: readSurface("github"), azure: readSurface("azure") };
});

/** Exports of `module` for `who`, from the github-config child (the export
 * lists do not depend on the active provider). */
function exportsOf(who: Who, module: string): string[] | undefined {
  return surfaces.github[who][module];
}

/** The problems found, one line each; an empty list is a pass. */
function problems(): string[] {
  const out: string[] = [];
  const seenVerbs = new Set<string>();
  const covered: Record<Who, Set<string>> = { facade: new Set(), github: new Set(), azure: new Set() };
  // A provider module may re-export a verb another of its modules owns
  // (azure/org.ts re-exports the ruleset verbs of azure/policies.ts), so the
  // provider-side reverse check compares names, not modules.
  const coveredNames: Record<"github" | "azure", Set<string>> = { github: new Set(), azure: new Set() };

  for (const row of rows) {
    if (seenVerbs.has(row.verb)) out.push(`${row.verb}: listed twice in the coverage table`);
    seenVerbs.add(row.verb);
    for (const who of ["facade", "github", "azure"] as const) {
      const cell = row.cells[who];
      const label = `${row.verb} (${who})`;
      if (cell.kind === "none" && row.notes === "") out.push(`${label}: '-' needs a note saying why the verb is absent`);
      if (cell.kind === "gap" && cell.reason === "") out.push(`${label}: 'gap:' needs a reason`);
      if (cell.kind === "ops") {
        if (who !== "facade") out.push(`${label}: 'ops:' is only valid in the facade column`);
        const expected = camel(row.verb.replace(/^provider_projects_/, ""));
        if (cell.key !== expected) out.push(`${label}: ops key '${cell.key}' breaks the naming convention (expected '${expected}')`);
        for (const p of ["github", "azure"] as const) {
          if (!surfaces[p].opsKeys.includes(cell.key)) {
            out.push(`${row.verb}: the contract lists projectsOps().${cell.key} but the facade object under provider ${p} has no such member`);
          }
        }
      }
      if (cell.kind === "via-facade") {
        if (who === "facade") out.push(`${label}: 'via-facade' is only valid in a provider column`);
        const facade = row.cells.facade;
        if (facade.kind !== "export") out.push(`${label}: 'via-facade' needs a facade export that composes the verb`);
      }
      if (cell.kind === "export") {
        const key = `${cell.module}.${cell.name}`;
        covered[who].add(key);
        if (who !== "facade") coveredNames[who].add(cell.name);
        const expected = EXCEPTIONS[row.verb]?.[who] ?? conventionalName(row.verb);
        if (cell.name !== expected) out.push(`${label}: export '${cell.name}' breaks the naming convention (expected '${expected}'); add a documented exception if intended`);
        const list = exportsOf(who, cell.module);
        if (list === undefined) out.push(`${label}: module '${cell.module}' is not one the test knows`);
        else if (!list.includes(cell.name)) {
          out.push(`${row.verb}: the contract lists ${who} export ${key}, but the ${who === "facade" ? "facade" : `provider ${who}`} module does not export it`);
        }
      }
      if (cell.kind === "gap" || cell.kind === "via-facade") {
        // The export a gap/via-facade names by convention must still be absent.
        const expected = EXCEPTIONS[row.verb]?.[who] ?? conventionalName(row.verb);
        for (const [module, list] of Object.entries(surfaces.github[who === "facade" ? "facade" : who])) {
          if (list.includes(expected) && who !== "facade") {
            out.push(`${row.verb}: marked '${cell.kind}' for provider ${who}, but ${who}/${module}.ts now exports ${expected} — close the gap in the table`);
          }
        }
      }
    }
  }

  // Facade exports must each have a row (or be a documented container).
  for (const module of FACADE_MODULES) {
    for (const name of surfaces.github.facade[module] ?? []) {
      const key = `${module}.${name}`;
      if (!covered.facade.has(key) && !FACADE_CONTAINER_EXPORTS.has(key)) {
        out.push(`facade export ${key} has no contract row: add it to the coverage table (or to the facade-only rows)`);
      }
    }
  }

  // Provider verb-shaped exports must each have a row for that provider.
  for (const who of ["github", "azure"] as const) {
    const modules = who === "azure" ? [...PROVIDER_MODULES, ...AZURE_EXTRA_MODULES] : PROVIDER_MODULES;
    for (const module of modules) {
      if (!VERB_SHAPED_MODULES.has(module)) continue;
      for (const name of surfaces.github[who][module] ?? []) {
        if (!VERB_SHAPED.test(name) || HELPER_EXPORTS.has(name)) continue;
        if (!coveredNames[who].has(name)) {
          out.push(`provider ${who} exports ${module}.${name} but the contract has no row for it: add the verb to the coverage table`);
        }
      }
    }
  }
  return out;
}

describe("contract coverage table vs real exports", () => {
  it("the table is parsed and lists the verbs", () => {
    expect(rows.length).toBeGreaterThanOrEqual(60);
  });

  it("the facade and both providers export exactly what the table says", () => {
    const found = problems();
    expect(found, `contract and code disagree:\n${found.join("\n")}`).toEqual([]);
  });

  it("the facade-level projects ops are the same members under both providers", () => {
    expect(surfaces.azure.opsKeys).toEqual(surfaces.github.opsKeys);
  });

  it("the export lists read under each active provider agree", () => {
    // Importing a module must not depend on which provider is active.
    expect(surfaces.azure.github).toEqual(surfaces.github.github);
    expect(surfaces.azure.azure).toEqual(surfaces.github.azure);
    expect(surfaces.azure.facade).toEqual(surfaces.github.facade);
  });

  it("the known gaps are exactly the table's gap cells, and are reported", () => {
    const gaps: string[] = [];
    for (const row of rows) {
      for (const who of ["github", "azure"] as const) {
        const cell = row.cells[who];
        if (cell.kind === "gap") gaps.push(`${row.verb}@${who}`);
      }
    }
    for (const g of gaps) console.warn(`known provider gap: ${g}`);
    expect([...gaps].sort(), "table gap cells and KNOWN_GAPS differ").toEqual([...KNOWN_GAPS].sort());
  });

  it("every verb has a row in the contract's human-readable tables", () => {
    const contract = readFileSync(CONTRACT, "utf8");
    const missing = rows.map((r) => r.verb).filter((v) => !contract.includes(`| \`${v}\``));
    expect(missing, `no table row for:${missing.join(" ")}`).toEqual([]);
  });

  it("the seam block lists exports provider-core still has", () => {
    const names = contractBlock("seam").map((l) => (l.split("|")[0] ?? "").trim());
    expect(names.length).toBeGreaterThan(5);
    const have = new Set(surfaces.github.seam);
    const missing = names.filter((n) => !have.has(n));
    expect(missing, `provider-core no longer exports:${missing.join(" ")}`).toEqual([]);
  });

  it("the checker names the verb and provider when a listed export is missing", () => {
    const saved = rows;
    try {
      rows = saved.map((r) =>
        r.verb === "provider_prs_merge"
          ? { ...r, cells: { ...r.cells, azure: { kind: "export", module: "prs", name: "prsMergeRenamed" } as Cell } }
          : r,
      );
      const found = problems().join("\n");
      expect(found).toContain("provider_prs_merge");
      expect(found).toContain("azure");
      expect(found).toContain("prsMergeRenamed");
    } finally {
      rows = saved;
    }
  });

  it("the checker flags a facade export that has no contract row", () => {
    const saved = rows;
    try {
      rows = saved.filter((r) => r.verb !== "provider_issue_blocked_by_add");
      expect(problems().join("\n")).toContain("facade export issues.blockedByAdd has no contract row");
    } finally {
      rows = saved;
    }
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
    const contract = readFileSync(CONTRACT, "utf8");
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
