// Port of tools/tests/scripts/test_provider_routing_lock.bats (5 tests).
// Provider routing lock (slice 3/#36 follow-up): wrapper scripts and
// non-provider libs never invoke the `gh` CLI directly — all GitHub transport
// goes through provider verbs (or the provider_api escape hatch); scripts and
// non-provider libs never read the branded identity env vars directly.
import { describe, expect, it, vi } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const ROOT = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))));
const TOOLS = join(ROOT, "tools");

// Sanctioned direct-gh sites: file substring -> regex of allowed gh usages.
// The bash verb twins retired with the verb layer (Phase 10); no transport
// exception remains necessary outside the provider modules.
const ALLOWED_EXCEPTIONS: Array<[string, string]> = [];

// Transport patterns: any of these in executable code is a violation unless
// the file+line matches an allowed exception.
const TRANSPORT_PATTERNS = [
  "gh api",
  "gh issue",
  "gh pr ",
  "gh run ",
  "gh repo ",
  "gh label ",
  "gh release ",
  "gh project ",
  "gh workflow ",
  "gh auth",
  'gh "',
];

// Scan targets: wrappers + non-provider libs + bootstrap. The provider
// modules (tools/lib/providers/**) are where gh calls belong and are excluded.
const LOCK_TARGETS = ["tools/scripts", "tools/lib", ".devcontainer"];

// Residue patterns: executable reads of the branded identity vars.
const RESIDUE_PATTERNS = [
  "\\$\\{?GH_ORG:?[=-}]?",
  "\\$\\{?GH_USER:?[=-}]?",
  "\\$\\{?GH_REPO:?[=-}]?",
  "\\$\\{?GITHUB_ORG:?[=-}]?",
  "\\$\\{?GITHUB_REPO:?[=-}]?",
];

// Sanctioned non-provider sites: directory-anchored path key -> regex of
// allowed reads (see the bats source for the rationale per entry). The
// test_helper.bash entry retired with the helper (Phase 11).
const RESIDUE_ALLOWED: Array<[string, string]> = [
  ["lib/config-reader.bash", "GH_(ORG|USER):\\-\\}"],
];

function collectViolations(target: string, patterns: string[], allowed: Array<[string, string]>): string[] {
  const violations: string[] = [];
  for (const pattern of patterns) {
    const r = spawnSync(
      "bash",
      ["-c", `grep -nE -- '${pattern.replace(/'/g, "'\\''")}' '${target}'/*.sh '${target}'/*.bash 2>/dev/null || true`],
      { encoding: "utf8" },
    );
    for (const hit of ((r.stdout ?? "").split("\n")).filter(Boolean)) {
      const parts = hit.split(":");
      const file = String(parts[0] ?? "");
      const line = String(parts[1] ?? "");
      const text = parts.slice(2).join(":").trim();
      // Skip pure comment lines and message-emission lines: doc text
      // and user-facing messages may legitimately mention gh commands.
      if (/^\s*#/.test(text) || /^\s*\$/.test(text)) continue;
      if (/^(echo|log_info|log_warn|log_error|log_verbose|printf)(\s|$)/.test(text)) continue;
      // Usage-heredoc prose lines start with an uppercase letter —
      // sentence case — while executable lines start lowercase, '$', or
      // punctuation.
      if (/^[A-Z]/.test(text)) continue;
      const isAllowed = allowed.some(
        ([filePat, rx]) => file.includes(filePat) && new RegExp(rx).test(text),
      );
      if (isAllowed) continue;
      violations.push(`VIOLATION ${file}:${line} [${pattern}] ${text}`);
    }
  }
  return violations;
}

describe("scripts/provider-routing-lock", () => {
  it("routing lock: no direct gh transport in wrapper scripts or non-provider libs", () => {
    const violations: string[] = [];
    for (const dir of LOCK_TARGETS) {
      violations.push(...collectViolations(join(ROOT, dir), TRANSPORT_PATTERNS, ALLOWED_EXCEPTIONS));
    }
    expect(violations).toEqual([]);
  });

  it("routing lock: provider modules are the only sanctioned gh callers", () => {
    // Sanity on the other side of the contract: the provider modules must
    // still exist and still contain transport (i.e. the exclusion is real).
    const r = spawnSync(
      "bash",
      ["-c", `grep -rlE '(^|[^_a-zA-Z])\\bgh\\b ' '${join(TOOLS, "lib", "providers", "github")}' 2>/dev/null | wc -l`],
      { encoding: "utf8" },
    );
    expect(Number.parseInt((r.stdout ?? "0").trim(), 10)).toBeGreaterThanOrEqual(6);
  });

  it("routing lock: allowlist entries all match real files", () => {
    // A renamed/deleted file must not leave a stale exception behind — and
    // a live file whose excepted pattern no longer matches its content is
    // equally stale. Both the file AND the pattern must still exist.
    for (const [filePat, regex] of ALLOWED_EXCEPTIONS) {
      const files: string[] = [];
      for (const t of LOCK_TARGETS) {
        const r = spawnSync("find", [join(ROOT, t), "-name", `*${filePat}*`, "-type", "f"], { encoding: "utf8" });
        files.push(...(r.stdout ?? "").split("\n").filter(Boolean));
      }
      expect(files.length, `stale allowlist entry: no file matches '*${filePat}*'`).toBeGreaterThan(0);
      const matched = files.some((f) => spawnSync("grep", ["-Eq", regex, f]).status === 0);
      expect(matched, `stale allowlist entry: '*${filePat}*' exists but pattern '${regex}' matches nothing in it`).toBe(true);
    }
  });

  it("residue lock: no direct GH_ORG/GH_USER/GH_REPO/GITHUB_ORG reads outside providers", () => {
    const violations: string[] = [];
    for (const dir of LOCK_TARGETS) {
      violations.push(...collectViolations(join(ROOT, dir), RESIDUE_PATTERNS, RESIDUE_ALLOWED));
    }
    expect(violations).toEqual([]);
  });

  it("residue lock: negative control — injected residue fails the scan", () => {
    // Rot-proofing: if the scan can no longer detect residue (pattern rot,
    // over-broad exemptions), this control must fail.
    const scratch = join(TMP ?? "", "residue_control");
    mkdirSync(scratch, { recursive: true });
    writeFileSync(scratch + "/fake-wrapper.sh", '#!/usr/bin/env bash\norg="${GH_ORG:-}"\necho "$org"\n');
    const violations = collectViolations(scratch, RESIDUE_PATTERNS, RESIDUE_ALLOWED);
    expect(violations.length, "negative control failed: injected GH_ORG residue was NOT detected — scan is rotting").toBeGreaterThan(0);
  });
});

// Shared scratch for the negative control (mirrors TEST_TEMP_DIR lifetime).
const TMP = mkdtempSync(join(tmpdir(), `routinglock-`));
