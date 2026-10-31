// Provider boundary contract: no file under tools/ts/ imports a provider
// module (providers/github/ or providers/azure/) directly — every provider
// access flows through the facade (tools/lib/providers/facade/<family>.ts).
//
// Sanctioned exceptions:
//   - tools/ts/provider-explain.ts: its job IS provider introspection; it
//     reads the provider modules to explain them.
//
// Same-family rule (facade files): a facade/<family>.ts may import only its
// own family's provider modules (the union of that family's per-provider
// manifest entries in provider-loader.ts). facade/issues.ts may not reach
// providers/github/repos.ts.
//
// Regression shape this test encodes: the antipattern where 48 tools imported
// provider modules directly, inlined `providerDetect() === "azure"` checks,
// and carried per-provider verb dispatch (issue-update's blocked-by) inside
// tool code — adding a provider would have meant touching every tool.
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const toolsDir = join(repoRoot, "tools");

// provider-core is the shared seam core (detection, repo targeting,
// capabilities, errors) — tools legitimately import it; the boundary is
// about provider IMPLEMENTATIONS (github/, azure/). All three import forms
// are matched: static `from "..."`, dynamic `import("...")`, and
// `require("...")` — a provider module reached through any of them is a
// boundary breach.
const providerModuleImport =
  /(?:from\s+|import\(\s*|require\(\s*)["'][^"']*providers\/(?:github|azure)\/[A-Za-z0-9_-]+\.ts["']/g;

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith(".ts")) out.push(p);
  }
  return out;
}

// The same-family rule's source of truth is the loader's manifest.
import { familyManifestModules } from "../../lib/providers/facade/provider-loader.ts";

// Ratchet allowlist: files whose families migrate in later plan phases
// (provider facade Phases 2-3). Each entry names the phase that REMOVES it;
// the list shrinks monotonically to empty. An entry here is a debt marker,
// not a permission — a new tool must never be added.
const PHASE_2_PROJECTS = "facade Phase 2 (projects family migration)";
const PHASE_2_PRS = "facade Phase 2 (prs family migration)";
// The allowlist may only shrink. CAP is the current entry count: removing
// an entry (a phase migration landing) decrements it; appending grows the
// list past CAP and this test fails — adding a provider-importing tool is a
// boundary breach, not an allowlist edit.
const RATCHET_CAP = 0;
const ratchetAllowlist: Array<{ file: string; removedWhen: string }> = [
];

describe("provider boundary contract", () => {
  it("no tools/ts file imports a provider module except provider-explain.ts and the phase ratchet allowlist", () => {
    const violations: string[] = [];
    if (ratchetAllowlist.length > RATCHET_CAP) {
      violations.push(
        `ratchet allowlist grew to ${ratchetAllowlist.length} (cap ${RATCHET_CAP}) — ` +
          `new provider-importing tools are boundary breaches, not allowlist entries`,
      );
    }
    const allowed = new Map(ratchetAllowlist.map((r) => [r.file, r.removedWhen]));
    for (const file of walk(join(toolsDir, "ts"))) {
      // Path-keyed (tools/ts-relative), not basename: a same-named file in a
      // future subdirectory must not inherit an exemption.
      const relTs = relative(join(toolsDir, "ts"), file);
      // Sanctioned exception: the introspection tool explains providers.
      if (relTs === "provider-explain.ts") continue;
      const src = readFileSync(file, "utf8");
      for (const m of src.matchAll(providerModuleImport)) {
        if (allowed.has(relTs)) continue; // ratcheted debt, removed in a later phase
        violations.push(`${relative(repoRoot, file)}: ${m[0]}`);
      }
    }
    expect(violations, `direct provider imports outside the facade:\n${violations.join("\n")}`).toEqual([]);
  });

  it("ratchet allowlist entries still violate (a satisfied entry must be removed)", () => {
    const stale: string[] = [];
    const baseDir = join(toolsDir, "ts");
    for (const r of ratchetAllowlist) {
      const src = readFileSync(join(baseDir, r.file), "utf8");
      if (!providerModuleImport.test(src)) {
        stale.push(`${r.file}: no longer imports providers — remove from the allowlist (${r.removedWhen})`);
      }
      providerModuleImport.lastIndex = 0;
    }
    expect(stale, `satisfied allowlist entries to remove:\n${stale.join("\n")}`).toEqual([]);
  });

  it("each facade file imports only its own family's provider modules", () => {
    const violations: string[] = [];
    const facadeDir = join(toolsDir, "lib", "providers", "facade");
    for (const file of readdirSync(facadeDir)) {
      if (!file.endsWith(".ts") || file === "provider-loader.ts") continue;
      const family = file.replace(/\.ts$/, "");
      const allowed = new Set(familyManifestModules(family).map((f) => `${family}/${f}`));
      // A family with no manifest row yet is a loader gap, not a boundary
      // violation — named here so the gap is visible.
      if (allowed.size === 0) {
        violations.push(`facade/${file}: no manifest row in provider-loader.ts`);
        continue;
      }
      const src = readFileSync(join(facadeDir, file), "utf8");
      for (const m of src.matchAll(providerModuleImport)) {
        const tail = (m[0].match(/providers\/(?:github|azure)\/([A-Za-z0-9_-]+\.ts)/) ?? [])[1] ?? "";
        if (!allowed.has(`${family}/${tail}`)) {
          violations.push(`facade/${file} imports outside family '${family}': ${m[0]}`);
        }
      }
    }
    expect(violations, `facade same-family violations:\n${violations.join("\n")}`).toEqual([]);
  });
});
