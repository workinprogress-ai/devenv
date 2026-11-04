// Port of tools/tests/scripts/test_key_update_guidance_lock.bats (3 tests).
// Guidance-currency lock: auth-failure instructions must name a command the
// environment actually defines. The credential-rotation entry point is
// `key-update-provider`; the historical `key-update-git` name was retired.
import { describe, expect, it, vi } from "vitest";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const ROOT = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))));
const TOOLS = join(ROOT, "tools");

function grepOffenders(args: string[]): string {
  const r = spawnSync("grep", ["-rn", "key-update-git", ...args], { encoding: "utf8" });
  return (r.stdout ?? "").trim();
}

describe("scripts/key-update-guidance-lock", () => {
  it("no retired key-update-git name remains in shipped code", () => {
    const offenders = grepOffenders([
      join(TOOLS, "scripts"),
      join(TOOLS, "ts"),
      join(TOOLS, "lib", "provider-loader.bash"),
      join(TOOLS, "lib", "providers", "github", "key-update.sh"),
      join(ROOT, ".devcontainer", "bootstrap.bash"),
    ]);
    expect(offenders).toBe("");
  });

  it("no retired key-update-git name remains in the docs or the skill/protocol references", () => {
    const offenders = grepOffenders([join(ROOT, "docs"), join(ROOT, "copilot")]);
    expect(offenders).toBe("");
  });

  it("the provider protocol documents provider_auth_import_token as stdin-fed, never argv", () => {
    // The token must stay out of process lists: the verb reads stdin by contract.
    const f = join(ROOT, "copilot", "skills", "_shared", "references", "provider-protocols", "github.md");
    const r = spawnSync("grep", ["-nE", "provider_auth_import_token[[:space:]]+TOKEN", f], { encoding: "utf8" });
    expect(r.status).not.toBe(0);
    expect(spawnSync("grep", ["-qE", "provider_auth_import_token[^`]*(<<<|<)", f]).status).toBe(0);
  });
});
