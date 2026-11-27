// Tests for the command-descriptors sidecar: reader vocabulary, the
// ceiling rule and read-only-forms demotion, unknown-name contract, full
// coverage of every depth-1 tools/ executable (merge-blocking on gaps), and
// the CLI surface (lookup, effective tier with ARGS, --list, unknown exit).
import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readdirSync } from "node:fs";
import {
  COMMAND_TIERS,
  allCommandDescriptors,
  commandDescriptor,
  commandTier,
  effectiveTier,
  resolveTier,
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
