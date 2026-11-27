// Tests for the command-descriptors sidecar: reader vocabulary, the
// ceiling rule and read-only-forms demotion, unknown-name contract, full
// coverage of every depth-1 tools/ executable (merge-blocking on gaps),
// the CLI surface (lookup, effective tier with ARGS, --list, unknown exit),
// and the org layer (cascade order, full-replacement semantics, validation
// isolation, empty-layer equivalence).
import { describe, expect, it, afterAll } from "vitest";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readdirSync, readFileSync, writeFileSync, mkdtempSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import {
  COMMAND_TIERS,
  allCommandDescriptors,
  commandDescriptor,
  commandTier,
  effectiveTier,
  resolveTier,
  orgDescriptors,
  manifestCollisions,
} from "../../lib/domain/command-descriptors.ts";

const ROOT = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))));
const TOOLS = join(ROOT, "tools");

// Depth-1 entries that are not commands. Directories only — every
// depth-1 FILE is a shipped executable and must be declared (the
// both-directions coverage below enforces it; `setup` the file is declared
// as prohibited, not excluded).
const NON_COMMAND_DIRS = new Set([
  "config",
  "custom",
  "fork",
  "git-hooks",
  "internal",
  "lib",
  "other",
  "templates",
  "tests",
  "ts",
]);

function shippedCommands(): string[] {
  return readdirSync(TOOLS).filter((f) => !NON_COMMAND_DIRS.has(f));
}

describe("command-descriptors reader", () => {
  it("resolves declared commands to their tiers", () => {
    expect(commandTier("kube-pod-delete")).toBe("destructive");
    expect(commandTier("kube-list-pods")).toBe("read-only");
    expect(commandTier("terraform-plan")).toBe("read-only");
    expect(commandTier("repo-commit")).toBe("restricted");
    expect(commandTier("repo-scratchpad")).toBe("restricted");
    expect(commandTier("install-extras")).toBe("mutating");
    expect(commandTier("setup")).toBe("prohibited");
    expect(commandTier("git-wip")).toBe("prohibited");
    expect(commandTier("git-repo")).toBe("mutating");
  });

  it("returns null for undeclared names — unknown is never a default tier", () => {
    expect(commandDescriptor("definitely-not-a-command")).toBeNull();
    expect(commandTier("")).toBeNull();
  });

  it("declares only vocabulary tiers", () => {
    for (const c of allCommandDescriptors()) {
      expect(COMMAND_TIERS).toContain(c.tier);
    }
  });

  it("FULL COVERAGE: every depth-1 tools/ executable is declared", () => {
    const declared = new Set(allCommandDescriptors().map((c) => c.name));
    for (const cmd of shippedCommands()) {
      expect(declared.has(cmd), `${cmd} missing from builtin-command-descriptors.yaml`).toBe(true);
    }
  });

  it("NO PHANTOMS: every declaration matches a shipped executable", () => {
    const shipped = new Set(shippedCommands());
    for (const c of allCommandDescriptors()) {
      expect(shipped.has(c.name), `${c.name} declared but not shipped in tools/`).toBe(true);
    }
  });

  it("has no duplicate declarations", () => {
    const names = allCommandDescriptors().map((c) => c.name);
    expect(new Set(names).size).toBe(names.length);
  });
});

describe("effective tier (ceiling rule)", () => {
  it("demotes to read-only only on a provider-declared form", () => {
    expect(effectiveTier("issue-create-batch", ["--dry-run", "issues.yaml"])).toBe("read-only");
    expect(effectiveTier("issue-create-batch", ["--create", "issues.yaml"])).toBe("mutating");
  });

  it("never promotes: a read-only form on a read-only command stays read-only", () => {
    expect(effectiveTier("kube-list-pods", ["-n", "services"])).toBe("read-only");
  });

  it("undeclared commands are unknown regardless of args", () => {
    expect(effectiveTier("no-such-command", ["--dry-run"])).toBeNull();
  });

  it("read-only-forms is a flag list; non-flag entries never match bare args", () => {
    // artifact-header formerly carried "--field" + a non-flag form; the
    // flag-presence demotion was unsound with co-present --stamp (round-1
    // F1) — the entry is gone and the ceiling is conservative-correct.
    expect(effectiveTier("artifact-header", ["--field", "doc_id", "plan.md"])).toBe("mutating");
    expect(effectiveTier("artifact-header", ["--stamp", "plan.md"])).toBe("mutating");
  });

  it("prohibited never demotes on flags — a routing wall, not a danger grade", () => {
    expect(effectiveTier("setup", ["devenvrc"])).toBe("prohibited");
    expect(effectiveTier("git-wip", ["some-args"])).toBe("prohibited");
  });

  it("command-vs-caller: restricted requires a license; route belongs on prohibited", () => {
    // A restricted entry without restricted-to is schema-invalid: the
    // entry is skipped (unknown), never silently re-read as anything.
    const restrictedNoLicense = (d: { name: string; tier: string }): boolean => {
      return d.tier === "restricted" && !Array.isArray((d as { "restricted-to"?: string[] })["restricted-to"]);
    };
    // The shipped file's entries all satisfy the model (the reader's
    // isValidDescriptor enforces it; the audit asserts the invariant).
    for (const d of allCommandDescriptors()) {
      expect(restrictedNoLicense(d as unknown as { name: string; tier: string }), `${d.name} restricted without license`).toBe(false);
      if (d.tier !== "prohibited" && d.tier !== "restricted") {
        expect(d.route, `${d.name} route on wrong tier`).toBeUndefined();
        expect(d["restricted-to"], `${d.name} license on wrong tier`).toBeUndefined();
      }
    }
  });

  it("resolveTier carries the license and the route when declared", () => {
    // git-wip is prohibited with no route: the answer carries no route.
    const wip = resolveTier("git-wip", []);
    expect(wip?.tier).toBe("prohibited");
    expect(wip?.route).toBeUndefined();
    // setup likewise.
    const setup = resolveTier("setup", []);
    expect(setup?.tier).toBe("prohibited");
    expect(setup?.license).toBeUndefined();
  });
});

describe("command-tier CLI", () => {
  function run(argv: string[]): { status: number | null; out: string } {
    const r = spawnSync("node", [join(TOOLS, "ts", "command-tier.ts"), ...argv], {
      encoding: "utf8",
    });
    return { status: r.status, out: (r.stdout ?? "") + (r.stderr ?? "") };
  }

  it("prints the tier with provenance for a known command", () => {
    const r = run(["kube-pod-scale"]);
    expect(r.status).toBe(0);
    expect(r.out.trim()).toBe("mutating\tbuiltin\tkube-pod-scale");
  });

  it("resolves the effective tier for an invocation via -- ARGS", () => {
    const r = run(["issue-create-batch", "--", "--dry-run", "manifest.yaml"]);
    expect(r.status).toBe(0);
    expect(r.out.trim()).toBe("read-only\tbuiltin\tissue-create-batch");
    const r2 = run(["issue-create-batch", "--", "--create", "manifest.yaml"]);
    expect(r2.status).toBe(0);
    expect(r2.out.trim()).toBe("mutating\tbuiltin\tissue-create-batch");
  });

  it("a bare flag without -- is parser-rejected and surfaced (never silently demoted)", () => {
    // The strict parser rejects unknown flags (exit 2, --help hint) — the
    // bare-flag form of an invocation must be refused loudly, never
    // silently ignored into the ceiling lookup.
    const r = run(["issue-create-batch", "--dry-run"]);
    expect(r.status).toBe(2);
    expect(r.out).toContain("Unknown option");
  });

  it("two extra positionals without -- is usage confusion (exit 2), surfaced", () => {
    const r = run(["issue-create-batch", "alpha", "beta"]);
    expect(r.status).toBe(2);
    expect(r.out).toContain("-- ARGS");
  });

  it("exits 1 with the scope rule for unknown names", () => {
    const r = run(["no-such-command"]);
    expect(r.status).toBe(1);
    expect(r.out).toContain("not declared");
    expect(r.out).toContain(".devenv/manifest.yaml");
  });

  it("lists every declaration from both layers as tier<TAB>command<TAB>source", () => {
    const r = run(["--list"]);
    expect(r.status).toBe(0);
    const lines = r.out.trim().split("\n");
    // At minimum every devenv declaration is present; the manifest layer
    // contributes fixtures only when a repos root is resolvable in this
    // environment (DEVENV_ROOT set) — the count floor is the devenv layer.
    expect(lines.length).toBeGreaterThanOrEqual(allCommandDescriptors().length);
    for (const line of lines) {
      const [tier, , source] = line.split("\t");
      expect(COMMAND_TIERS).toContain(tier as (typeof COMMAND_TIERS)[number]);
      expect(source?.length ?? 0).toBeGreaterThan(0);
    }
  });

  it("exits 2 (usage) when no NAME and no --list", () => {
    const r = run([]);
    expect(r.status).toBe(2);
    expect(r.out).toContain("missing NAME");
  });
});

// ── the org layer (Phase 5.6) ──────────
// The org file is a tracked workspace file; these tests swap its content
// for fixtures and restore the pristine copy afterward. The pristine file
// is BLANK upstream (commands: []) — the empty-layer equivalence test
// asserts exactly that state.

const ORG_PATH = join(TOOLS, "config", "org-command-descriptors.yaml");
const ORG_PRISTINE = readFileSync(ORG_PATH, "utf8");

function withOrg(yaml: string, fn: () => void): void {
  writeFileSync(ORG_PATH, yaml);
  try {
    fn();
  } finally {
    writeFileSync(ORG_PATH, ORG_PRISTINE);
  }
}

describe("org layer (cascade + replacement semantics)", () => {
  it("the pristine upstream org file is blank — the layer is empty by default", () => {
    expect(ORG_PRISTINE.trim().endsWith("commands: []")).toBe(true);
    expect(orgDescriptors()).toEqual([]);
  });

  it("an empty org layer changes nothing: every resolution passes through to the lower layers", () => {
    // The 5.5 behavior, byte-for-byte: builtin answers for its own, curated
    // for the machine surface, and the source column never says "org".
    expect(resolveTier("repo-commit")).toEqual({
      tier: "restricted",
      source: "builtin",
      matched: "repo-commit",
      license: ["devenv-commit"],
    });
    expect(resolveTier("curl")?.source).toBe("curated");
    expect(resolveTier("docker-restart")?.source).toBe("builtin");
  });

  it("org outranks builtin: an override is a full replacement, no field merge", () => {
    withOrg(
      `
commands:
  - name: docker-restart
    tier: prohibited
    route: "the org's own restart runbook"
  - name: repo-stage
    tier: mutating
`,
      () => {
        // prohibited+route replaces the builtin mutating entry wholesale.
        const d = resolveTier("docker-restart");
        expect(d?.tier).toBe("prohibited");
        expect(d?.source).toBe("org");
        expect(d?.route).toBe("the org's own restart runbook");
        // A restricted entry replaced by mutating carries NO license —
        // the org entry is the complete statement, never a patch.
        const s = resolveTier("repo-stage");
        expect(s).toEqual({ tier: "mutating", source: "org", matched: "repo-stage" });
        // The sibling restricted entry is untouched (no spillover).
        expect(resolveTier("repo-commit")?.source).toBe("builtin");
      },
    );
  });

  it("org outranks curated and declares org-only commands (the az class)", () => {
    withOrg(
      `
commands:
  - name: docker
    tier: prohibited
    route: "org container policy"
  - name: az
    tier: mutating
    egress: true
    note: org-specific CLI (fixture)
`,
      () => {
        const d = resolveTier("docker");
        expect(d?.tier).toBe("prohibited");
        expect(d?.source).toBe("org");
        // The git read grammar still works — the curated entry is shadowed
        // for `docker` only, not for anything else.
        expect(resolveTier("git", ["log"])?.tier).toBe("read-only");
        // An org-only command resolves from the org layer with egress.
        const a = resolveTier("az");
        expect(a).toEqual({ tier: "mutating", source: "org", matched: "az", egress: true });
      },
    );
  });

  it("org entries demote on both grammars: flags on a mutating ceiling, subcommands on a prohibited ceiling", () => {
    withOrg(
      `
commands:
  - name: orgtool
    tier: mutating
    read-only-forms: ["--report"]
  - name: orgclosed
    tier: prohibited
    route: "orgtool"
    read-only-forms: ["read"]
`,
      () => {
        expect(resolveTier("orgtool", ["--report"])?.tier).toBe("read-only");
        expect(resolveTier("orgtool", ["--mutate"])?.tier).toBe("mutating");
        // The read grammar demotes the prohibited ceiling; a non-read
        // subcommand keeps the ceiling and the route.
        expect(resolveTier("orgclosed", ["read"])?.tier).toBe("read-only");
        expect(resolveTier("orgclosed", ["read"])?.route).toBeUndefined();
        const closed = resolveTier("orgclosed", ["write"]);
        expect(closed?.tier).toBe("prohibited");
        expect(closed?.route).toBe("orgtool");
      },
    );
  });

  it("org entries carry licenses like any restricted declaration", () => {
    withOrg(
      `
commands:
  - name: orgtool
    tier: restricted
    restricted-to: [devenv-operate]
`,
      () => {
        const r = resolveTier("orgtool");
        expect(r?.tier).toBe("restricted");
        expect(r?.source).toBe("org");
        expect(r?.license).toEqual(["devenv-operate"]);
      },
    );
  });

  it("invalid org entries are warned and treated as absent — the isolation contract holds", () => {
    withOrg(
      `
commands:
  - name: unlicensed
    tier: restricted
  - name: misrouted
    tier: read-only
    route: "x"
  - name: overlicensed
    tier: prohibited
    restricted-to: [skill]
`,
      () => {
        expect(orgDescriptors().find((d) => d.name === "unlicensed")).toBeUndefined();
        expect(resolveTier("unlicensed")).toBeNull();
        expect(resolveTier("misrouted")).toBeNull();
        expect(resolveTier("overlicensed")).toBeNull();
      },
    );
  });

  it("a malformed org file never bricks the layer — its commands resolve unknown", () => {
    withOrg("commands: [ this is not yaml content", () => {
      expect(orgDescriptors()).toEqual([]);
      expect(resolveTier("anything-at-all")).toBeNull();
    });
  });

  it("manifest collisions are inert inventory, never shadowed answers", () => {
    // Fixture: a temp repos root whose manifest declares a name the
    // builtin layer already declares. The workspace layer wins every
    // lookup (the PATH-rule analogy); the inventory surface reports the
    // inert entry instead of letting it silently masquerade.
    const root = mkdtempSync(join(tmpdir(), "org-collision-"));
    const dir = join(root, "tool.dupe", ".devenv");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "manifest.yaml"),
      [
        "name: tool.dupe",
        "purpose: fixture",
        "executables:",
        "  - name: repo-commit",
        "    tier: read-only",
        "  - name: dupe-only",
        "    tier: mutating",
      ].join("\n"),
    );
    // Lookups: the builtin layer answers for repo-commit (the license
    // survives), the manifest answers for the non-colliding name.
    expect(resolveTier("repo-commit", [], root)?.source).toBe("builtin");
    expect(resolveTier("dupe-only", [], root)).toEqual({
      tier: "mutating",
      source: "tool.dupe",
      matched: "dupe-only",
    });
    // Inventory: the collision is reported, shadowed by the builtin layer.
    const collisions = manifestCollisions(root);
    expect(collisions).toEqual([
      {
        name: "repo-commit",
        source: "tool.dupe",
        tier: "read-only",
        shadowSource: "builtin",
        shadowTier: "restricted",
      },
    ]);
  });
});

afterAll(() => {
  // Belt and braces: the withOrg restore runs per test, but any failure
  // path that skipped the finally still must not leak fixtures into the
  // tree (the pristine file is blank upstream).
  writeFileSync(ORG_PATH, ORG_PRISTINE);
});
