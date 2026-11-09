// Port of tools/tests/lib/test_config_reader.bats (49 tests) — one vitest
// `it` per source `@test`. Tests for config-reader.bash: INI reading, template
// expansion locks, literal (non-regex) section/key matching, the one-reader
// variant agreement matrix, and the global-CONFIG_FILE isolation contracts.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const ROOT = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))));
const TOOLS = join(ROOT, "tools");
const CR = join(TOOLS, "lib", "config-reader.bash");

let TMP = "";
let CFG = "";

beforeEach(() => {
  TMP = mkdtempSync(join(tmpdir(), `cfgr-${Date.now()}-${Math.random().toString(36).slice(2)}`));
  CFG = join(TMP, "test.config");
});

// bash -c with combined output. GH_* env vars are neutralized so tests that
// assert "env has no effect" don't inherit a real value from the worker.
function sh(script: string, extraEnv: Record<string, string | undefined> = {}): { status: number; out: string } {
  const r = spawnSync("bash", ["-c", script], {
    encoding: "utf8",
    env: { ...process.env, GH_USER: "", GH_TOKEN: "", ...extraEnv } as Record<string, string>,
  });
  return { status: r.status ?? 1, out: (r.stdout ?? "") + (r.stderr ?? "") };
}

const TEST_CONFIG = `# Test configuration file

[organization]
name=Test Organization
org=test-org
email_domain=test.example.com

[container]
registry=docker.io

[nuget]
feed_url=https://nuget.pkg.github.com/\${PROVIDER_ORG}/index.json

[workflows]
status_workflow=TBD,Ready,In Progress,Done
issue_types=story,bug,enhancement
`;

function createTestConfig(): void {
  writeFileSync(CFG, TEST_CONFIG);
}

// The same text, in shapes people actually write, read through every reader.
const PROVIDER_VARIANTS: string[] = [
  "[provider]\nname=azure\n",
  "[provider]\nname = azure\n",
  "  [provider]  \n  name  =  azure  \n",
  "[provider]\r\nname=azure\r\n",
  "# a comment\n; another\n\n[provider]\n# note\nname=azure\n",
  "[other]\nname=wrong\n[provider]\nname=azure\n",
  "[provider-extra]\nname=wrong\n[provider]\nname=azure\n",
  "[provider]\nname=github\nname=azure\n",
];

describe("config reader", () => {
  it("config-reader: library can be sourced", () => {
    const r = sh(`source ${CR} && echo loaded`);
    expect(r.status).toBe(0);
    expect(r.out).toMatch(/loaded/);
  });

  it("config-reader: config_init fails with missing file", () => {
    const r = sh(`source ${CR} && config_init /nonexistent/file.config`);
    expect(r.status).not.toBe(0);
    expect(r.out).toMatch(/not found/);
  });

  it("config-reader: config_init succeeds with valid file", () => {
    createTestConfig();
    const r = sh(`source ${CR} && config_init ${CFG} && echo success`);
    expect(r.status).toBe(0);
    expect(r.out).toMatch(/success/);
  });

  it("config-reader: config_read_value retrieves simple value", () => {
    createTestConfig();
    const r = sh(`source ${CR} && config_init ${CFG} && config_read_value organization name`);
    expect(r.status).toBe(0);
    expect(r.out.trim()).toBe("Test Organization");
  });

  it("config-reader: config_read_value returns default when key missing", () => {
    createTestConfig();
    const r = sh(`source ${CR} && config_init ${CFG} && config_read_value organization missing_key fallback_value`);
    expect(r.status).toBe(0);
    expect(r.out.trim()).toBe("fallback_value");
  });

  it("config-reader: config_read_value returns empty string when key missing and no default", () => {
    createTestConfig();
    const r = sh(`source ${CR} && config_init ${CFG} && config_read_value organization missing_key`);
    expect(r.status).toBe(0);
    expect(r.out.trim()).toBe("");
  });

  it("config-reader: config_read_array parses comma-separated values", () => {
    createTestConfig();
    const r = sh(`source ${CR} && config_init ${CFG} && config_read_array workflows issue_types`);
    expect(r.status).toBe(0);
    expect(r.out).toMatch(/story/);
    expect(r.out).toMatch(/bug/);
    expect(r.out).toMatch(/enhancement/);
  });

  it("config-reader: config_read_array trims whitespace from elements", () => {
    writeFileSync(CFG, "[test]\nitems=one, two , three  , four\n");
    const r = sh(`source ${CR} && config_init ${CFG} && config_read_array test items`);
    expect(r.status).toBe(0);
    expect(r.out).toMatch(/^one/m);
    expect(r.out).toMatch(/two/m);
    expect(r.out).toMatch(/three/m);
    expect(r.out).toMatch(/four$/m);
  });

  it("config-reader: config_read_array fails when key missing", () => {
    createTestConfig();
    const r = sh(`source ${CR} && config_init ${CFG} && config_read_array workflows missing_key`);
    expect(r.status).not.toBe(0);
  });

  it("config-reader: config_validate_required succeeds when keys exist", () => {
    createTestConfig();
    const r = sh(`source ${CR} && config_init ${CFG} && config_validate_required organization name org email_domain`);
    expect(r.status).toBe(0);
  });

  it("config-reader: config_validate_required fails when key missing", () => {
    createTestConfig();
    const r = sh(`source ${CR} && config_init ${CFG} && config_validate_required organization name missing_key`);
    expect(r.status).not.toBe(0);
    expect(r.out).toMatch(/Required configuration missing/);
  });

  it("config-reader: config_validate_required reports all missing keys", () => {
    createTestConfig();
    const r = sh(`source ${CR} && config_init ${CFG} && config_validate_required organization missing1 missing2 missing3 2>&1`);
    expect(r.status).not.toBe(0);
    expect(r.out).toMatch(/missing1/);
    expect(r.out).toMatch(/missing2/);
    expect(r.out).toMatch(/missing3/);
  });

  it("config-reader: template variables are expanded in values", () => {
    createTestConfig();
    // Expansion is accessor-fed: load the provider core and scope identity to
    // a temp DEVENV_ROOT seed so the real workspace config cannot leak in.
    mkdirSync(join(TMP, "ident-root", ".setup"), { recursive: true });
    writeFileSync(join(TMP, "ident-root", ".setup", "provider_org.txt"), "test-org\n");
    const r = sh(
      `export DEVENV_TOOLS='${TOOLS}' DEVENV_ROOT='${join(TMP, "ident-root")}' DEVENV_ROOT_SET=1 && source '${TOOLS}/lib/providers/provider-core.bash' && source ${CR} && config_init ${CFG} && config_read_value nuget feed_url`,
    );
    expect(r.status).toBe(0);
    expect(r.out).toContain("https://nuget.pkg.github.com/test-org/index.json");
  });

  it("config-reader: config_list_section returns all keys in section", () => {
    createTestConfig();
    const r = sh(`source ${CR} && config_init ${CFG} && config_list_section organization`);
    expect(r.status).toBe(0);
    expect(r.out).toMatch(/name/);
    expect(r.out).toMatch(/org/);
    expect(r.out).toMatch(/email_domain/);
  });

  it("config-reader: config_dump outputs all key=value pairs in section", () => {
    createTestConfig();
    const r = sh(`source ${CR} && config_init ${CFG} && config_dump organization`);
    expect(r.status).toBe(0);
    expect(r.out).toContain("name=Test Organization");
    expect(r.out).toContain("org=test-org");
    expect(r.out).toContain("email_domain=test.example.com");
  });

  it("config-reader: config_get_status_workflow fails when status_workflow missing", () => {
    writeFileSync(CFG, "[workflows]\n");
    const r = sh(`source ${CR} && config_init ${CFG} && config_get_status_workflow`);
    expect(r.status).not.toBe(0);
    expect(r.out).toMatch(/not configured/);
  });

  it("config-reader: config_get_status_workflow succeeds and returns workflow", () => {
    createTestConfig();
    const r = sh(`source ${CR} && config_init ${CFG} && config_get_status_workflow`);
    expect(r.status).toBe(0);
    expect(r.out).toMatch(/TBD/);
    expect(r.out).toMatch(/Ready/);
    expect(r.out).toMatch(/Done/);
  });

  it("config-reader: handles comments correctly", () => {
    writeFileSync(CFG, "[test]\n# This is a comment\nkey1=value1\n# Another comment\nkey2=value2\n");
    const r = sh(`source ${CR} && config_init ${CFG} && config_read_value test key1`);
    expect(r.status).toBe(0);
    expect(r.out.trim()).toBe("value1");
  });

  it("config-reader: handles empty values", () => {
    writeFileSync(CFG, "[test]\nempty_key=\nnonempty_key=value\n");
    const r = sh(`source ${CR} && config_init ${CFG} && config_read_value test empty_key default`);
    expect(r.status).toBe(0);
    expect(r.out.trim()).toBe("default");
  });

  it("config-reader: handles values with spaces", () => {
    writeFileSync(CFG, "[test]\nkey=value with spaces in it\n");
    const r = sh(`source ${CR} && config_init ${CFG} && config_read_value test key`);
    expect(r.status).toBe(0);
    expect(r.out.trim()).toBe("value with spaces in it");
  });

  // ── Expansion behavior locks ─────────────────────────────────────────────

  it("config-reader: GH_USER env has no effect on template expansion", () => {
    writeFileSync(CFG, "[organization]\nname=t\nuser=cfg-user\n");
    const r = sh(`export GH_USER=env-user && source ${CR} && config_init ${CFG} && config_read_value organization user`);
    expect(r.status).toBe(0);
    expect(r.out.trim()).toBe("cfg-user");
  });

  it("config-reader: only PROVIDER_ORG/PROVIDER_USER expand; other vars stay literal", () => {
    writeFileSync(CFG, "[template]\nvalue=prefix-\${PROVIDER_USER_DOES_NOT_EXIST}-suffix\n");
    const r = sh(`source ${CR} && config_init ${CFG} && config_read_value template value`);
    expect(r.status).toBe(0);
    expect(r.out.trim()).toBe("prefix-\${PROVIDER_USER_DOES_NOT_EXIST}-suffix");
  });

  it("config-reader: without the provider layer, tokens stay literal", () => {
    writeFileSync(CFG, "[template]\nvalue=prefix-\${PROVIDER_ORG}-mid-\${PROVIDER_USER}-suffix\n");
    const r = sh(`source ${CR} && config_init ${CFG} && config_read_value template value`);
    expect(r.status).toBe(0);
    expect(r.out.trim()).toBe("prefix-\${PROVIDER_ORG}-mid-\${PROVIDER_USER}-suffix");
  });

  it("config-reader: unresolvable identity expands tokens to empty string", () => {
    writeFileSync(CFG, "[template]\nvalue=prefix-\${PROVIDER_ORG}-mid-\${PROVIDER_USER}-suffix\n");
    const emptyRoot = join(TMP, "empty-ident");
    mkdirSync(emptyRoot, { recursive: true });
    const r = sh(
      `export DEVENV_TOOLS='${TOOLS}' DEVENV_ROOT='${emptyRoot}' DEVENV_ROOT_SET=1 && source '${TOOLS}/lib/providers/provider-core.bash' && source ${CR} && config_init ${CFG} && config_read_value template value`,
    );
    expect(r.status).toBe(0);
    expect(r.out.trim()).toBe("prefix--mid--suffix");
  });

  it("config-reader: expansion is single-pass (raw org value holding a token is not re-expanded)", () => {
    // The accessor reads the org value RAW. When that raw value is itself a
    // template token, the org resolves to the literal text and expansion
    // must not run a second pass over it.
    const tmplRoot = join(TMP, "tmpl-ident");
    mkdirSync(tmplRoot, { recursive: true });
    writeFileSync(join(tmplRoot, "devenv.config"), "[organization]\nname=t\norg=\${PROVIDER_USER}\n");
    writeFileSync(CFG, "[template]\nnested=\${PROVIDER_ORG}\n");
    const r = sh(
      `export DEVENV_TOOLS='${TOOLS}' DEVENV_ROOT='${tmplRoot}' DEVENV_ROOT_SET=1 && source '${TOOLS}/lib/providers/provider-core.bash' && source ${CR} && config_init ${CFG} && config_read_value template nested`,
    );
    expect(r.status).toBe(0);
    expect(r.out.trim()).toBe("\${PROVIDER_USER}");
  });

  it("config-reader: GH_TOKEN is never interpolated", () => {
    writeFileSync(CFG, "[template]\nvalue=token=\${GH_TOKEN}\n");
    const r = sh(`export GH_TOKEN='ghp_secret' && source ${CR} && config_init ${CFG} && config_read_value template value`);
    expect(r.status).toBe(0);
    expect(r.out).not.toContain("ghp_secret");
  });

  it("config-reader: PROVIDER_ORG template resolves via provider accessor when loaded", () => {
    // The accessor chain (config → seed) backs template expansion when the
    // provider layer is present; raw reads prevent re-entry.
    writeFileSync(join(TMP, "devenv.config"), "[organization]\nname=t\norg=cfg-org\n");
    writeFileSync(join(TMP, "tpl.config"), "[t]\nv=\${PROVIDER_ORG}-suffix\n");
    const r = sh(
      `export DEVENV_TOOLS='${TOOLS}' DEVENV_ROOT='${TMP}' DEVENV_ROOT_SET=1\n` +
        `source '${TOOLS}/lib/providers/provider-core.bash'\nsource ${CR}\n` +
        `config_init '${join(TMP, "tpl.config")}'\nconfig_read_value t v`,
    );
    expect(r.status).toBe(0);
    expect(r.out.trim()).toBe("cfg-org-suffix");
  });

  it("config-reader: template expansion does not recurse through the accessor", () => {
    // A config whose org itself contains the template: the accessor reads it
    // RAW, expansion happens once in config-reader, done.
    writeFileSync(join(TMP, "devenv.config"), "[organization]\nname=t\norg=\${PROVIDER_ORG}\n");
    writeFileSync(join(TMP, "tpl2.config"), "[t]\nv=\${PROVIDER_ORG}\n");
    const r = sh(
      `export DEVENV_TOOLS='${TOOLS}' DEVENV_ROOT='${TMP}' DEVENV_ROOT_SET=1\n` +
        `source '${TOOLS}/lib/providers/provider-core.bash'\nsource ${CR}\n` +
        `config_init '${join(TMP, "tpl2.config")}'\nconfig_read_value t v`,
    );
    expect(r.status).toBe(0);
    expect(r.out.trim()).toBe("\${PROVIDER_ORG}");
  });

  // ── Literal matching ─────────────────────────────────────────────────────

  it("raw read: [provider-x] section never satisfies a [provider] read", () => {
    const cfg = join(TMP, "anchor.config");
    writeFileSync(cfg, "[provider-tokens]\nname=malicious\n\n[provider]\nname=github\n");
    const r = sh(`source ${CR}\nconfig_init '${cfg}'\nconfig_read_value_raw provider name`);
    expect(r.status).toBe(0);
    expect(r.out.trim()).toBe("github");
  });

  // read_cfg: runs a config-reader function against TEST_CONFIG_FILE.
  function readCfg(call: string): { status: number; out: string } {
    return sh(`source '${CR}'; config_init '${CFG}'; ${call}`);
  }

  it("a key containing a dot matches only that key, not any single-character lookalike", () => {
    writeFileSync(CFG, "[s]\nkey.name=right\nkeyXname=wrong\n");
    const r = readCfg("config_read_value s key.name");
    expect(r.status).toBe(0);
    expect(r.out.trim()).toBe("right");
  });

  it("a key containing brackets is read as written", () => {
    writeFileSync(CFG, "[s]\na1=wrong\na[1]=right\n");
    const r = readCfg("config_read_value s 'a[1]'");
    expect(r.out.trim()).toBe("right");
  });

  it("a section name containing a dot does not also match its lookalikes", () => {
    writeFileSync(CFG, "[a.b]\nk=right\n[aXb]\nk=wrong\n");
    const r = readCfg("config_read_value a.b k");
    expect(r.out.trim()).toBe("right");
  });

  it("listing and dumping a dotted section ignores its lookalike sections", () => {
    writeFileSync(CFG, "[a.b]\nmine=1\n[aXb]\ntheirs=2\n");
    let r = readCfg("config_list_section a.b");
    expect(r.out.trim()).toBe("mine");
    r = readCfg("config_dump a.b");
    expect(r.out.trim()).toBe("mine=1");
  });

  it("the raw reader returns the value (not the whole line) for a key with regex characters", () => {
    writeFileSync(CFG, "[s]\na+b=value\n");
    const r = readCfg("config_read_value_raw s 'a+b'");
    expect(r.out.trim()).toBe("value");
  });

  it("text after a section header's closing bracket is still tolerated", () => {
    writeFileSync(CFG, "[s] # a note\nk=v\n");
    const r = readCfg("config_read_value s k");
    expect(r.out.trim()).toBe("v");
  });

  it("a key that is present but empty reads as the default (documented semantics)", () => {
    writeFileSync(CFG, "[s]\nk=\n");
    let r = readCfg("config_read_value s k fallback");
    expect(r.out.trim()).toBe("fallback");
    r = readCfg("config_read_value s k");
    expect(r.out.trim()).toBe("");
  });

  it("the header documents how an empty value reads", () => {
    const r = spawnSync("grep", ["-n", "-i", "empty", join(TOOLS, "lib", "config-reader.bash")], { encoding: "utf8" });
    expect(r.status).toBe(0);
    const out = (r.stdout ?? "") + (r.stderr ?? "");
    expect(out.includes("present but empty") || out.includes("present-but-empty")).toBe(true);
  });

  // ── One reader: every path agrees on the same file ───────────────────────

  function writeVariant(v: string): void {
    writeFileSync(CFG, v);
  }

  it("config_get_raw reads the value from every variant, without a prior config_init", () => {
    for (const v of PROVIDER_VARIANTS) {
      writeVariant(v);
      const r = sh(`source '${CR}'; config_get_raw '${CFG}' provider name`);
      expect(r.status, `variant: ${JSON.stringify(v)} -> [${r.out}]`).toBe(0);
      expect(r.out.trim(), `variant: ${JSON.stringify(v)}`).toBe("azure");
    }
  });

  it("config_get (the expanding reader) agrees on every variant", () => {
    for (const v of PROVIDER_VARIANTS) {
      writeVariant(v);
      const r = sh(`source '${CR}'; config_get '${CFG}' provider name 2>/dev/null`);
      expect(r.out.trim(), `variant: ${JSON.stringify(v)}`).toBe("azure");
    }
  });

  it("config_read_value and config_read_value_raw agree on every variant", () => {
    for (const v of PROVIDER_VARIANTS) {
      writeVariant(v);
      const r = sh(
        `source '${CR}'; config_init '${CFG}'; echo "$(config_read_value provider name 2>/dev/null)|$(config_read_value_raw provider name)"`,
      );
      expect(r.out.trim(), `variant: ${JSON.stringify(v)}`).toBe("azure|azure");
    }
  });

  it("provider_detect agrees on every variant", () => {
    for (const v of PROVIDER_VARIANTS) {
      writeVariant(v);
      const r = sh(
        `export DEVENV_TOOLS='${TOOLS}'\n` +
          `source '${TOOLS}/lib/error-handling.bash'\n` +
          `source '${TOOLS}/lib/providers/provider-core.bash'\n` +
          `provider_detect '${CFG}'\necho "$PROVIDER_NAME"`,
      );
      expect(r.out.trim(), `variant: ${JSON.stringify(v)}`).toBe("azure");
    }
  });

  it("the provider identity accessor agrees on every variant", () => {
    for (const v of PROVIDER_VARIANTS) {
      writeVariant(v);
      const r = sh(
        `export DEVENV_TOOLS='${TOOLS}' PROVIDER_IDENTITY_CONFIG='${CFG}'\n` +
          `source '${TOOLS}/lib/error-handling.bash'\n` +
          `source '${TOOLS}/lib/providers/provider-core.bash'\n` +
          `_provider_identity_raw_read provider name`,
      );
      expect(r.out.trim(), `variant: ${JSON.stringify(v)}`).toBe("azure");
    }
  });


  it("a value that contains = keeps everything after the first =", () => {
    writeFileSync(CFG, "[x]\nurl = https://h/p?a=b&c=d\n");
    const r = sh(`source '${CR}'; config_get_raw '${CFG}' x url`);
    expect(r.out.trim()).toBe("https://h/p?a=b&c=d");
  });

  it("an absent key reads as the default, and an absent file is a failure with no output", () => {
    writeFileSync(CFG, "[x]\nk=v\n");
    let r = sh(`source '${CR}'; config_get_raw '${CFG}' x missing fallback`);
    expect(r.out.trim()).toBe("fallback");
    r = sh(`source '${CR}'; config_get_raw '${join(TMP, "none.config")}' x k fallback`);
    expect(r.status).not.toBe(0);
    expect(r.out.trim()).toBe("");
  });

  // ── Reading another file never re-points the global ─────────────────────

  it("provider_detect on another file leaves the initialised CONFIG_FILE alone", () => {
    writeFileSync(join(TMP, "a.config"), "[a]\nk=from-a\n");
    writeFileSync(join(TMP, "b.config"), "[provider]\nname=github\n");
    const r = sh(
      `export DEVENV_TOOLS='${TOOLS}'\n` +
        `source '${TOOLS}/lib/error-handling.bash'\n` +
        `source '${TOOLS}/lib/config-reader.bash'\n` +
        `source '${TOOLS}/lib/providers/provider-core.bash'\n` +
        `config_init '${join(TMP, "a.config")}'\n` +
        `provider_detect '${join(TMP, "b.config")}'\n` +
        `echo "$CONFIG_FILE"\nconfig_read_value a k`,
    );
    const lines = r.out.split("\n").map((l) => l.trim());
    expect(lines[0]).toBe(join(TMP, "a.config"));
    expect(lines[1]).toBe("from-a");
  });



});
