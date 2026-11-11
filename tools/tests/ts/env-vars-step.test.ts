// env-vars setup step: the generated file is built from the .setup seeds,
// quotes values safely, and never takes user-added variables with it.
// Every run uses a throwaway toolbox root; the real .runtime/.setup are untouched.
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const STEP = fileURLToPath(new URL("../../ts/setup-steps/env-vars.ts", import.meta.url));

let box: string;
let envFile: string;
let userFile: string;

function runStep(): { status: number; out: string } {
  const r = spawnSync("node", [STEP], {
    encoding: "utf8",
    env: {
      PATH: process.env["PATH"] ?? "",
      HOME: box,
      DEVENV_TOOLBOX_ROOT: box,
      // Ambient values must not leak into the file: seeds are the source.
      USER_EMAIL: "ambient@example.com",
      DO_API_TOKEN: "ambient-token",
      DIGITALOCEAN_API_TOKEN: "ambient-token",
    },
  });
  return { status: r.status ?? 1, out: (r.stdout ?? "") + (r.stderr ?? "") };
}

function sourced(name: string): string {
  const r = spawnSync("bash", ["-c", `source '${envFile}'; printf '%s' "\${${name}-<unset>}"`], { encoding: "utf8" });
  return r.stdout ?? "";
}

beforeEach(() => {
  box = mkdtempSync(join(tmpdir(), "envvars-step-"));
  mkdirSync(join(box, ".setup"), { recursive: true });
  envFile = join(box, ".runtime", "env-vars.sh");
  userFile = join(box, ".runtime", "env-vars.user.sh");
});

afterEach(() => rmSync(box, { recursive: true, force: true }));

describe("env-vars step", () => {
  it("fills USER_EMAIL and the DigitalOcean token from the seeds, not the ambient env", () => {
    writeFileSync(join(box, ".setup", "email.txt"), "dev@example.com\n");
    writeFileSync(join(box, ".setup", "digitalocean_token.txt"), "do-seed-token\n");
    expect(runStep().status).toBe(0);
    expect(sourced("USER_EMAIL")).toBe("dev@example.com");
    expect(sourced("DIGITALOCEAN_API_TOKEN")).toBe("do-seed-token");
  });

  it("missing seeds produce empty values", () => {
    expect(runStep().status).toBe(0);
    expect(sourced("USER_EMAIL")).toBe("");
    expect(sourced("DIGITALOCEAN_API_TOKEN")).toBe("");
  });

  it("a seed with quotes and substitutions is stored literally and never executed", () => {
    const hostile = `a"b'c$(touch ${box}/RAN)\`touch ${box}/RAN2\``;
    writeFileSync(join(box, ".setup", "digitalocean_token.txt"), `${hostile}\n`);
    expect(runStep().status).toBe(0);
    expect(sourced("DIGITALOCEAN_API_TOKEN")).toBe(hostile);
    expect(existsSync(join(box, "RAN"))).toBe(false);
    expect(existsSync(join(box, "RAN2"))).toBe(false);
  });

  it("variables in env-vars.user.sh survive regeneration and win over generated ones", () => {
    mkdirSync(join(box, ".runtime"), { recursive: true });
    writeFileSync(userFile, "export MY_VAR='kept'\nexport DIGITALOCEAN_API_TOKEN='rotated'\n");
    writeFileSync(join(box, ".setup", "digitalocean_token.txt"), "stale-seed\n");
    expect(runStep().status).toBe(0);
    expect(sourced("MY_VAR")).toBe("kept");
    expect(sourced("DIGITALOCEAN_API_TOKEN")).toBe("rotated");
    expect(readFileSync(userFile, "utf8")).toContain("export MY_VAR='kept'");
  });

  it("a legacy env-vars.sh with appended variables is migrated into the user file once", () => {
    mkdirSync(join(box, ".runtime"), { recursive: true });
    writeFileSync(
      envFile,
      '#!/bin/bash\nexport TZ="UTC"\ncase "${GIT_EDITOR:-}" in\n    ""|":"|"true") unset GIT_EDITOR ;;\nesac\nexport OLD_ADDED=legacy\n',
    );
    expect(runStep().status).toBe(0);
    expect(sourced("OLD_ADDED")).toBe("legacy");
    expect(readFileSync(userFile, "utf8")).toContain("export OLD_ADDED=legacy");
    expect(runStep().status).toBe(0);
    expect(readFileSync(userFile, "utf8").match(/OLD_ADDED/g)?.length).toBe(1);
  });

  it("the generated file sources the user file when present", () => {
    expect(runStep().status).toBe(0);
    expect(readFileSync(envFile, "utf8")).toContain("env-vars.user.sh");
  });
});
