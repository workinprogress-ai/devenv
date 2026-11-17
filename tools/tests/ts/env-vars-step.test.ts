// env-vars setup step: the generated file is built from the .setup seeds,
// quotes values safely, and never takes user-added variables with it.
// Every run uses a throwaway toolbox root; the real .runtime/.setup are untouched.
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync, statSync } from "node:fs";
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

  const LEGACY_HEAD =
    '#!/bin/bash\nexport TZ="UTC"\ncase "${GIT_EDITOR:-}" in\n    ""|":"|"true") unset GIT_EDITOR ;;\nesac\n';

  it("keeps a user-added case block with its own esac when migrating", () => {
    mkdirSync(join(box, ".runtime"), { recursive: true });
    writeFileSync(
      envFile,
      `${LEGACY_HEAD}export BEFORE_CASE=1\ncase "$X" in\n  a) export IN_CASE=2 ;;\nesac\nexport AFTER_CASE=3\n`,
    );
    expect(runStep().status).toBe(0);
    const user = readFileSync(userFile, "utf8");
    for (const v of ["BEFORE_CASE", "IN_CASE", "AFTER_CASE"]) expect(user).toContain(v);
  });

  it("preserves export lines of a legacy file with no recognisable template", () => {
    mkdirSync(join(box, ".runtime"), { recursive: true });
    writeFileSync(envFile, "#!/bin/bash\nexport ONLY_ONE=kept\nexport OTHER='x y'\n");
    expect(runStep().status).toBe(0);
    const user = readFileSync(userFile, "utf8");
    expect(user).toContain("export ONLY_ONE=kept");
    expect(user).toContain("export OTHER='x y'");
    expect(sourced("ONLY_ONE")).toBe("kept");
  });

  it("backs up the legacy file as an owner-only .bak once and never clobbers it", () => {
    mkdirSync(join(box, ".runtime"), { recursive: true });
    const legacy = `${LEGACY_HEAD}export OLD_ADDED=legacy\n`;
    writeFileSync(envFile, legacy);
    expect(runStep().status).toBe(0);
    const bak = `${envFile}.bak`;
    expect(readFileSync(bak, "utf8")).toBe(legacy);
    expect(statSync(bak).mode & 0o777).toBe(0o600);
    expect(runStep().status).toBe(0);
    expect(readFileSync(bak, "utf8")).toBe(legacy);
    expect(readFileSync(userFile, "utf8").match(/OLD_ADDED/g)?.length).toBe(1);
  });

  it("does not overwrite an existing .bak when there is no user file yet", () => {
    mkdirSync(join(box, ".runtime"), { recursive: true });
    writeFileSync(`${envFile}.bak`, "first backup\n");
    writeFileSync(envFile, `${LEGACY_HEAD}export NEWER=1\n`);
    expect(runStep().status).toBe(0);
    expect(readFileSync(`${envFile}.bak`, "utf8")).toBe("first backup\n");
  });

  // Sourcing under a timeout: a self-sourcing user file recurses without end.
  function sourceExit(name: string): { status: number; value: string } {
    const r = spawnSync("timeout", ["10", "bash", "-c", `source '${envFile}'; printf '%s' "\${${name}-<unset>}"`], { encoding: "utf8" });
    return { status: r.status ?? 1, value: r.stdout ?? "" };
  }

  function expectNoSelfSource(user: string): void {
    expect(user).not.toMatch(/\bsource\b/);
    expect(user).not.toContain("if [ -f");
    expect(user).not.toContain("env-vars.user.sh");
  }

  it("migrates a current-format file with an appended export without sourcing the user file from itself", () => {
    expect(runStep().status).toBe(0);
    writeFileSync(envFile, `${readFileSync(envFile, "utf8")}export MY_TOKEN=abc\n`);
    expect(runStep().status).toBe(0);
    const user = readFileSync(userFile, "utf8");
    expect(user.match(/MY_TOKEN/g)?.length).toBe(1);
    expectNoSelfSource(user);
    expect(sourceExit("MY_TOKEN")).toEqual({ status: 0, value: "abc" });
  });

  it("keeps exports placed before the template trailer and drops the trailer", () => {
    expect(runStep().status).toBe(0);
    const generated = readFileSync(envFile, "utf8");
    const at = generated.indexOf("# User-added variables (");
    expect(at).toBeGreaterThan(0);
    writeFileSync(envFile, `${generated.slice(0, at)}export BEFORE_TRAILER=1\n${generated.slice(at)}export AFTER_TRAILER=2\n`);
    expect(runStep().status).toBe(0);
    const user = readFileSync(userFile, "utf8");
    expect(user.match(/BEFORE_TRAILER/g)?.length).toBe(1);
    expect(user.match(/AFTER_TRAILER/g)?.length).toBe(1);
    expectNoSelfSource(user);
    expect(sourceExit("BEFORE_TRAILER")).toEqual({ status: 0, value: "1" });
    expect(sourceExit("AFTER_TRAILER")).toEqual({ status: 0, value: "2" });
  });

  it("a rerun after the user edits the user file keeps the edit, does not re-migrate and leaves the backup alone", () => {
    expect(runStep().status).toBe(0);
    writeFileSync(envFile, `${readFileSync(envFile, "utf8")}export MY_TOKEN=abc\n`);
    expect(runStep().status).toBe(0);
    const backup = readFileSync(`${envFile}.bak`, "utf8");
    const edited = `${readFileSync(userFile, "utf8")}export EDITED=yes\n`;
    writeFileSync(userFile, edited);
    expect(runStep().status).toBe(0);
    expect(readFileSync(userFile, "utf8")).toBe(edited);
    expect(readFileSync(`${envFile}.bak`, "utf8")).toBe(backup);
    expect(sourceExit("EDITED")).toEqual({ status: 0, value: "yes" });
  });

  describe("hand-edited self-sourcing trailers", () => {
    beforeEach(() => mkdirSync(join(box, ".runtime"), { recursive: true }));

    const variants: Record<string, (u: string) => string> = {
      "else branch": (u) => `if [ -f "${u}" ]; then\n    source "${u}"\nelse\n    echo none\nfi\n`,
      "indented if": (u) => `  if [ -f "${u}" ]; then\n    source "${u}"\n  fi\n`,
      "extra line inside the if": (u) => `if [ -f "${u}" ]; then\n    echo loading\n    source "${u}"\nfi\n`,
      "single quotes": (u) => `if [ -f '${u}' ]; then\n    source '${u}'\nfi\n`,
      "one-line form": (u) => `if [ -f "${u}" ]; then source "${u}"; fi\n`,
      "CRLF trailer": (u) => `if [ -f "${u}" ]; then\r\n    source "${u}"\r\nfi\r\n`,
    };
    for (const [name, trailer] of Object.entries(variants)) {
      it(`${name} is not carried into the user file and sourcing exits 0`, () => {
        writeFileSync(envFile, `${LEGACY_HEAD}export BEFORE=1\n# User-added variables (x)\n${trailer(userFile)}export AFTER=2\n`);
        expect(runStep().status).toBe(0);
        expect(readFileSync(userFile, "utf8")).not.toContain("env-vars.user.sh");
        const r = spawnSync("timeout", ["10", "bash", "-c", `source '${envFile}'; echo "$BEFORE$AFTER"`], { encoding: "utf8" });
        expect(r.status).toBe(0);
        expect(r.stdout.trim()).toBe("12");
      });
    }

    it("keeps a user's unrelated if block", () => {
      writeFileSync(envFile, `${LEGACY_HEAD}export TOP=1\nif [ -f "$HOME/my.sh" ]; then\n  export MINE=yes\nfi\nexport MINE=yes\n`);
      expect(runStep().status).toBe(0);
      expect(readFileSync(userFile, "utf8")).toContain('if [ -f "$HOME/my.sh" ]; then');
      expect(sourceExit("MINE")).toEqual({ status: 0, value: "yes" });
    });

    it("refuses to write a user file that does not parse, keeps the backup and leaves env-vars.sh sourceable", () => {
      const legacy = `${LEGACY_HEAD}export KEEP=1\nfi\n`;
      writeFileSync(envFile, legacy);
      const r = runStep();
      expect(r.status).toBe(0);
      expect(r.out).toContain("env-vars.sh.bak");
      expect(existsSync(userFile)).toBe(false);
      expect(readFileSync(`${envFile}.bak`, "utf8")).toBe(legacy);
      const s = spawnSync("timeout", ["10", "bash", "-c", `source '${envFile}'`], { encoding: "utf8" });
      expect(s.status).toBe(0);
    });
  });

  it("the generated file sources the user file when present", () => {
    expect(runStep().status).toBe(0);
    expect(readFileSync(envFile, "utf8")).toContain("env-vars.user.sh");
  });
});
