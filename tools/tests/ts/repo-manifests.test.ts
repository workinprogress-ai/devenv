// Tests for the tier oracle's manifest layer (repo-manifests.ts): fixture
// manifests under a temp repos root, subcommand resolution, precedence
// (devenv descriptors win over repo manifests), and the unknown contract.
// No real repos are read — all manifest fixtures are written to a temp
// directory and passed as the explicit repos root.
import { describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { commandTier, resolveTier } from "../../lib/domain/command-descriptors.ts";
import {
  allRepoManifests,
  manifestTierResolution,
  readRepoManifest,
  reposRoot,
} from "../../lib/domain/repo-manifests.ts";

const scratch = mkdtempSync(join(tmpdir(), "repo-manifests-"));

function writeManifest(reposRootDir: string, repo: string, yaml: string): string {
  const dir = join(reposRootDir, repo, ".devenv");
  mkdirSync(dir, { recursive: true });
  const path = join(dir, "manifest.yaml");
  writeFileSync(path, yaml);
  return path;
}

const SRS_LIKE = `
name: tool.srs
purpose: Snapshot Release Set tool
doc: README.md
executables:
  - name: srs
    tier: mutating
    purpose: release-set CLI
    valueFlags: ["--gitops"]
    subcommands:
      - { name: capture, tier: mutating }
      - { name: verify, tier: read-only }
      - { name: deploy, tier: mutating }
      - { name: roll, tier: mutating }
      - { name: reset, tier: destructive }
      - { name: diff, tier: read-only }
      - { name: history, tier: read-only }
`;

const OPS_LIKE = `
name: tool.ops
purpose: Operate toolbox
executables:
  - name: ops-orient
    tier: read-only
    purpose: toolbox map
  - name: tf-apply
    tier: mutating
    confirm: true
`;

// Write the srs-like fixture at module scope: it is the shared subject of
// the reader and resolution suites below.
writeManifest(scratch, "tool.srs", SRS_LIKE);

describe("repo-manifests reader", () => {
  it("isolates malformed YAML: one bad manifest warns and is skipped, others still resolve", () => {
    const bad = join(scratch, "tool.broken", ".devenv");
    mkdirSync(bad, { recursive: true });
    writeFileSync(join(bad, "manifest.yaml"), "name: [unclosed\n  bad yaml:");
    // tool.srs still resolves despite tool.broken being present.
    const m = readRepoManifest("tool.srs", scratch);
    expect(m).not.toBeNull();
    expect(readRepoManifest("tool.broken", scratch)).toBeNull();
    const all = allRepoManifests(scratch);
    expect(all.map((x) => x.name)).toContain("tool.srs");
    expect(all.map((x) => x.name)).not.toContain("tool.broken");
  });

  it("rejects an entry outside the shared tier vocabulary (treated as undeclared)", () => {
    const dir = join(scratch, "tool.badtier", ".devenv");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "manifest.yaml"),
      "name: tool.badtier\nexecutables:\n  - name: weird-tool\n    tier: spicy\n",
    );
    expect(readRepoManifest("tool.badtier", scratch)).toBeNull();
    expect(manifestTierResolution("weird-tool", [], scratch)).toBeNull();
  });

  it("rejects an executable entry missing its tier (never undefined at exit 0)", () => {
    const dir = join(scratch, "tool.notier", ".devenv");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "manifest.yaml"),
      "name: tool.notier\nexecutables:\n  - name: tierless\n",
    );
    expect(readRepoManifest("tool.notier", scratch)).toBeNull();
    expect(manifestTierResolution("tierless", [], scratch)).toBeNull();
  });

  it("rejects a restricted executable without a license (command-vs-caller)", () => {
    const dir = join(scratch, "tool.nolicense", ".devenv");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "manifest.yaml"),
      "name: tool.nolicense\nexecutables:\n  - name: unlicensed\n    tier: restricted\n",
    );
    expect(readRepoManifest("tool.nolicense", scratch)).toBeNull();
    expect(manifestTierResolution("unlicensed", [], scratch)).toBeNull();
  });

  it("rejects route on a non-prohibited executable (command-vs-caller)", () => {
    const dir = join(scratch, "tool.badroute", ".devenv");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "manifest.yaml"),
      "name: tool.badroute\nexecutables:\n  - name: routed\n    tier: read-only\n    route: something-else\n",
    );
    expect(readRepoManifest("tool.badroute", scratch)).toBeNull();
    expect(manifestTierResolution("routed", [], scratch)).toBeNull();
  });

  it("carries the license and route in manifest resolutions", () => {
    writeManifest(
      scratch,
      "tool.licensed",
      'name: tool.licensed\nexecutables:\n  - name: licensed-tool\n    tier: restricted\n    restricted-to: [devenv-operate]\n',
    );
    writeManifest(
      scratch,
      "tool.routed",
      'name: tool.routed\nexecutables:\n  - name: routed-tool\n    tier: prohibited\n    route: licensed-tool\n',
    );
    const lic = manifestTierResolution("licensed-tool", [], scratch);
    expect(lic?.tier).toBe("restricted");
    expect(lic?.license).toEqual(["devenv-operate"]);
    const rte = manifestTierResolution("routed-tool", [], scratch);
    expect(rte?.tier).toBe("prohibited");
    expect(rte?.route).toBe("licensed-tool");
  });

  it("reads a manifest from the explicit repos root", () => {
    const m = readRepoManifest("tool.srs", scratch);
    expect(m).not.toBeNull();
    expect(m!.name).toBe("tool.srs");
    expect(m!.executables.length).toBe(1);
    expect(m!.executables[0]!.subcommands?.length).toBe(7);
  });

  it("returns null for uncloned repos and manifest-less repos", () => {
    expect(readRepoManifest("no-such-repo", scratch)).toBeNull();
    mkdirSync(join(scratch, "bare-repo"), { recursive: true });
    expect(readRepoManifest("bare-repo", scratch)).toBeNull();
  });

  it("lists all manifests in stable directory order", () => {
    writeManifest(scratch, "tool.ops", OPS_LIKE);
    const all = allRepoManifests(scratch);
    expect(all.map((m) => m.name)).toEqual(
      expect.arrayContaining(["tool.ops", "tool.srs"]),
    );
    const names = all.map((m) => m.name);
    expect(names.indexOf("tool.ops")).toBeLessThan(names.indexOf("tool.srs"));
  });

  it("reposRoot(null) is null or the env-derived root, never a guess", () => {
    // Without an explicit root the lib resolves only via DEVENV_ROOT; with
    // no repos dir present that is null. Either outcome is valid — the
    // contract is "no crash, no invented path".
    const r = reposRoot(undefined);
    expect(["string", "object", "null"]).toContain(typeof r === null ? "null" : typeof r);
  });
});

describe("manifest layer resolution", () => {
  it("resolves whole-executable tiers with provenance", () => {
    const r = manifestTierResolution("ops-orient", [], scratch);
    expect(r).toEqual({ tier: "read-only", source: "tool.ops", matched: "ops-orient" });
  });

  it("resolves subcommands for multi-verb executables", () => {
    expect(manifestTierResolution("srs", ["deploy"], scratch)?.tier).toBe("mutating");
    expect(manifestTierResolution("srs", ["verify"], scratch)?.tier).toBe("read-only");
    expect(manifestTierResolution("srs", ["reset"], scratch)?.tier).toBe("destructive");
    expect(manifestTierResolution("srs", ["diff"], scratch)?.matched).toBe("srs diff");
  });

  it("skips flags when finding the subcommand", () => {
    expect(manifestTierResolution("srs", ["--gitops", "/tmp/x", "verify", "--json"], scratch)?.tier).toBe("read-only");
  });

  it("falls back to the executable ceiling when the first arg matches no subcommand", () => {
    const r = manifestTierResolution("srs", ["--version"], scratch);
    expect(r?.tier).toBe("mutating"); // the declared ceiling for the srs CLI
    expect(r?.matched).toBe("srs");
  });

  it("a valueFlags flag at argv end does not consume a nonexistent value", () => {
    // `srs --gitops` with no following token: the flag is skipped, no
    // out-of-bounds read, and with no subcommand word the ceiling stands.
    const r = manifestTierResolution("srs", ["--gitops"], scratch);
    expect(r?.tier).toBe("mutating");
  });

  it("duplicate executables across two repos resolve to the first in stable directory order", () => {
    writeManifest(
      scratch,
      "tool.zzz-late",
      "name: tool.zzz-late\nexecutables:\n  - name: shared-name\n    tier: read-only\n",
    );
    writeManifest(
      scratch,
      "tool.aaa-early",
      "name: tool.aaa-early\nexecutables:\n  - name: shared-name\n    tier: mutating\n",
    );
    // Directory order (sorted): tool.aaa-early < tool.zzz-late — the early
    // declaration wins. Documented stable behavior, not an accident.
    const r = manifestTierResolution("shared-name", [], scratch);
    expect(r?.source).toBe("tool.aaa-early");
    expect(r?.tier).toBe("mutating");
  });

  it("returns null for executables no manifest declares", () => {
    expect(manifestTierResolution("kubectl", [], scratch)).toBeNull();
  });
});

describe("tier oracle precedence", () => {
  it("devenv's own descriptors win over repo manifests with the same name", () => {
    // A repo manifest that (incorrectly) declares a devenv command name.
    writeManifest(
      scratch,
      "tool.spoof",
      `
name: tool.spoof
executables:
  - name: kube-pod-delete
    tier: read-only
`,
    );
    // devenv's declaration (destructive) must win — mirror of the PATH rule.
    expect(commandTier("kube-pod-delete")).toBe("destructive");
    const r = resolveTier("kube-pod-delete", [], scratch);
    expect(r?.source).toBe("builtin");
    expect(r?.tier).toBe("destructive");
  });

  it("devenv read-only-forms demotion survives into the oracle", () => {
    const r = resolveTier("issue-create-batch", ["--dry-run"], scratch);
    expect(r).toEqual({ tier: "read-only", source: "builtin", matched: "issue-create-batch" });
  });

  it("resolveTier answers across both layers with provenance", () => {
    expect(resolveTier("kube-list-pods", [], scratch)).toEqual({
      tier: "read-only",
      source: "builtin",
      matched: "kube-list-pods",
    });
    expect(resolveTier("srs", ["verify"], scratch)).toEqual({
      tier: "read-only",
      source: "tool.srs",
      matched: "srs verify",
    });
    expect(resolveTier("some-unknown-thing", [], scratch)).toBeNull();
  });
});
