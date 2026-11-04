// Port of tools/tests/devenv/test_setup_pat_validation.bats (14 tests) — one vitest `it` per source `@test`.
import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync, mkdirSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))));

function sh(script: string, cwd?: string): { status: number; out: string } {
  const r = spawnSync("bash", ["-c", script], { encoding: "utf8", cwd });
  return { status: r.status ?? 1, out: (r.stdout ?? "") + (r.stderr ?? "") };
}

// Port of tools/tests/devenv/test_setup_pat_validation.bats — one vitest `it` per source `@test`.

// ── setup PAT validation (port of test_setup_pat_validation.bats) ────────
// setup: the provider token is checked for shape and validated against the
// provider API (one call per attempt) through the provider's host-side hooks;
// setup itself names no provider. The provider API is a stubbed curl; nothing
// here touches the network.
describe("setup PAT validation", () => {
  const setupScript = join(ROOT, "setup");
  const stubCurlBody = (callsFile: string, headersFile: string, codesFile: string): string =>
    [
      "#!/usr/bin/env bash",
      'for a in "$@"; do case "$a" in https://*) echo "$a" >> ' + JSON.stringify(callsFile) + " ;; esac; done",
      '[ -t 0 ] || cat >> ' + JSON.stringify(headersFile),
      'code=$(head -n 1 ' + JSON.stringify(codesFile) + '); sed -i 1d ' + JSON.stringify(codesFile),
      'printf \'%s\' "$code"',
      '[ "$code" != 000 ]',
    ].join("\n");

  let t: string;
  let setupDir: string;
  let bin: string;
  let calls: string;
  let headers: string;
  let codes: string;

  function setup(): void {
    t = mkdtempSync(join(tmpdir(), "pat-"));
    setupDir = join(t, ".setup");
    bin = join(t, "bin");
    calls = join(t, "curl.calls");
    headers = join(t, "curl.headers");
    codes = join(t, "codes");
    mkdirSync(setupDir, { recursive: true });
    mkdirSync(bin, { recursive: true });
    writeFileSync(calls, "");
    writeFileSync(headers, "");
    writeFileSync(codes, "");
    writeFileSync(join(bin, "curl"), stubCurlBody(calls, headers, codes));
    chmodSync(join(bin, "curl"), 0o755);
    writeFileSync(join(setupDir, "provider_org.txt"), "someorg\n");
  }

  function writeCodes(lines: string[]): void {
    writeFileSync(codes, lines.join("\n") + "\n");
  }

  // run_validate <stdin text> [provider]: runs validate_provider_token with
  // the stub curl first on PATH, using the named provider's hooks.
  function runValidate(stdinText: string, provider = "github"): { status: number; out: string } {
    const fnBash = join(t, "fn.bash");
    const src = readFileSync(setupScript, "utf8");
    const m = src.match(/^validate_provider_token\(\) \{[\s\S]*?^\}/m);
    if (!m) throw new Error("validate_provider_token() not found in setup");
    writeFileSync(fnBash, m[0]);
    const inner = `source '${ROOT}/tools/lib/providers/${provider}/setup.bash'; source '${fnBash}'; validate_provider_token`;
    const r = spawnSync("bash", ["-c", inner], {
      encoding: "utf8",
      input: stdinText,
      timeout: 20_000,
      env: { ...process.env, PATH: `${bin}:${process.env["PATH"]}`, SETUP_DIR: setupDir },
    });
    return { status: r.status ?? 1, out: (r.stdout ?? "") + (r.stderr ?? "") };
  }

  it("setup script exists and is executable", () => {
    expect(existsSync(setupScript)).toBe(true);
    expect(sh(`test -x '${setupScript}'`).status).toBe(0);
  });

  it("setup script has valid bash syntax", () => {
    expect(spawnSync("bash", ["-n", setupScript]).status).toBe(0);
  });

  it("the KNOWN GAP note about unverified tokens is gone", () => {
    const r = sh(`grep -n "KNOWN GAP" '${setupScript}'`);
    expect(r.status).not.toBe(0);
  });

  it("a token the API accepts is kept after exactly one /user call", () => {
    setup();
    writeFileSync(join(setupDir, "provider_token.txt"), "ghp_good\n");
    writeCodes(["200"]);
    const r = runValidate("");
    expect(r.status).toBe(0);
    expect(readFileSync(join(setupDir, "provider_token.txt"), "utf8")).toContain("ghp_good");
    expect(readFileSync(calls, "utf8")).toBe("https://api.github.com/user\n");
  });

  it("a ghp_ token the API rejects is cleared and re-prompted", () => {
    setup();
    writeFileSync(join(setupDir, "provider_token.txt"), "ghp_revoked\n");
    writeCodes(["401", "200"]);
    const r = runValidate("ghp_fresh\n");
    expect(r.status).toBe(0);
    expect(readFileSync(join(setupDir, "provider_token.txt"), "utf8")).toContain("ghp_fresh");
    expect(readFileSync(calls, "utf8").split("\n").filter((l) => l !== "").length).toBe(2);
  });

  it("the token is sent in a header read from stdin, not on the command line", () => {
    setup();
    writeFileSync(join(setupDir, "provider_token.txt"), "ghp_secret\n");
    writeCodes(["200"]);
    const r = runValidate("");
    expect(r.status).toBe(0);
    expect(readFileSync(headers, "utf8")).toContain("Authorization: Bearer ghp_secret");
  });

  it("an unreachable API warns and accepts the prefix-valid token instead of looping", () => {
    setup();
    writeFileSync(join(setupDir, "provider_token.txt"), "ghp_offline\n");
    writeCodes(["000"]);
    const r = runValidate("");
    expect(r.status).toBe(0);
    expect(readFileSync(join(setupDir, "provider_token.txt"), "utf8")).toContain("ghp_offline");
    expect(r.out).toContain("Could not verify");
  });

  it("a token without the ghp_ prefix is rejected without an API call", () => {
    setup();
    writeFileSync(join(setupDir, "provider_token.txt"), "notatoken\n");
    writeCodes(["200"]);
    const r = runValidate("ghp_next\n");
    expect(r.status).toBe(0);
    expect(readFileSync(join(setupDir, "provider_token.txt"), "utf8")).toContain("ghp_next");
    expect(readFileSync(calls, "utf8").split("\n").filter((l) => l !== "").length).toBe(1);
  });

  it("azure: a PAT the organization accepts is kept after one connectionData call", () => {
    setup();
    writeFileSync(join(setupDir, "provider_token.txt"), "somepat\n");
    writeCodes(["200"]);
    const r = runValidate("", "azure");
    expect(r.status).toBe(0);
    expect(readFileSync(join(setupDir, "provider_token.txt"), "utf8")).toContain("somepat");
    expect(readFileSync(calls, "utf8")).toContain("https://dev.azure.com/someorg/_apis/connectionData");
  });

  it("azure: a 203 sign-in page counts as a rejection and re-prompts", () => {
    setup();
    writeFileSync(join(setupDir, "provider_token.txt"), "badpat\n");
    writeCodes(["203", "200"]);
    const r = runValidate("goodpat\n", "azure");
    expect(r.status).toBe(0);
    expect(readFileSync(join(setupDir, "provider_token.txt"), "utf8")).toContain("goodpat");
    expect(readFileSync(calls, "utf8").split("\n").filter((l) => l !== "").length).toBe(2);
  });

  it("azure: the PAT travels in a header read from stdin, not on the command line", () => {
    setup();
    writeFileSync(join(setupDir, "provider_token.txt"), "secretpat\n");
    writeCodes(["200"]);
    const r = runValidate("", "azure");
    expect(r.status).toBe(0);
    expect(readFileSync(headers, "utf8")).toMatch(/^Authorization: Basic /m);
    expect(readFileSync(calls, "utf8")).not.toContain("secretpat");
  });

  it("azure: an unreachable service warns and keeps the token", () => {
    setup();
    writeFileSync(join(setupDir, "provider_token.txt"), "offlinepat\n");
    writeCodes(["000"]);
    const r = runValidate("", "azure");
    expect(r.status).toBe(0);
    expect(readFileSync(join(setupDir, "provider_token.txt"), "utf8")).toContain("offlinepat");
  });
});
