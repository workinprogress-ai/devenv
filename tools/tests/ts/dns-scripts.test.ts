// Fixture tests for the DNS container-start scripts
// (.devcontainer/install-extras/dns-hijack.sh and addon-scripts/dns-startup.sh).
// Every run goes through a temp tree: the scripts' path knobs point into it and
// sudo/service/dnsmasq/apt-get/devenv-add-custom-startup are PATH stubs, so
// nothing touches the real /etc, the service manager or apt.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { rmrf, stubCalls, stubCli, tmpDir } from "./harness/index.ts";

const ROOT = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))));
const EXTRAS = join(ROOT, ".devcontainer", "install-extras");
const STARTUP_SRC = join(EXTRAS, "addon-scripts", "dns-startup.sh");
const HIJACK_SRC = join(EXTRAS, "dns-hijack.sh");
const SAMPLE_CFG = join(EXTRAS, "config", "dns-mapping.cfg.sample");

// Tools the scripts need besides the stubs; linked into a private bin dir so
// the PATH holds nothing else (in particular no real dnsmasq/sudo/service).
const BASE_TOOLS = ["bash", "cat", "cp", "tee", "dirname", "sort", "grep", "mkdir", "ls", "sed", "head", "tr"];

let tmp = "";
let stubs = "";
let base = "";
let tree = "";
let confDir = "";
let resolv = "";
let upstream = "";

function link(dir: string, name: string): void {
  for (const d of ["/usr/bin", "/bin"]) {
    if (existsSync(join(d, name))) {
      symlinkSync(join(d, name), join(dir, name));
      return;
    }
  }
  throw new Error(`base tool not found: ${name}`);
}

function logStub(name: string): void {
  stubCli(stubs, name, `#!/bin/bash\nprintf '%s %s\\n' "${name}" "$*" >> "${join(stubs, "calls.log")}"\nexit 0`);
}

beforeEach(() => {
  tmp = tmpDir("dns-scripts");
  stubs = join(tmp, "stubs");
  base = join(tmp, "base");
  tree = join(tmp, "tree");
  confDir = join(tmp, "dnsmasq.d");
  resolv = join(tmp, "resolv.conf");
  upstream = join(tmp, "resolv.dnsmasq");
  for (const d of [stubs, base, confDir, join(tree, "addon-scripts"), join(tree, "config")]) mkdirSync(d, { recursive: true });
  for (const t of BASE_TOOLS) link(base, t);
  stubCli(stubs, "sudo", '#!/bin/bash\nexec "$@"');
  stubCli(stubs, "dnsmasq", "#!/bin/bash\nexit 0");
  for (const n of ["service", "apt-get", "devenv-add-custom-startup"]) logStub(n);
  // Same relative layout the installer expects: <dir>/dns-hijack.sh, <dir>/config, <dir>/addon-scripts.
  copyFileSync(HIJACK_SRC, join(tree, "dns-hijack.sh"));
  copyFileSync(STARTUP_SRC, join(tree, "addon-scripts", "dns-startup.sh"));
  copyFileSync(SAMPLE_CFG, join(tree, "config", "dns-mapping.cfg"));
  chmodSync(join(tree, "dns-hijack.sh"), 0o755);
  chmodSync(join(tree, "addon-scripts", "dns-startup.sh"), 0o755);
});

afterEach(() => rmrf(tmp));

function run(script: string, opts: { withDnsmasq?: boolean } = {}): { status: number; out: string } {
  const withDnsmasq = opts.withDnsmasq ?? true;
  if (!withDnsmasq) {
    // Rebuild the stub dir without dnsmasq; sudo/service remain.
    rmrf(join(stubs, "dnsmasq"));
  }
  const r = spawnSync("bash", [script], {
    encoding: "utf8",
    env: {
      PATH: `${stubs}:${base}`,
      HOME: tmp,
      DEVENV_DNS_CONF_DIR: confDir,
      DEVENV_DNS_RESOLV_CONF: resolv,
      DEVENV_DNS_UPSTREAM_FILE: upstream,
    },
  });
  return { status: r.status ?? 1, out: (r.stdout ?? "") + (r.stderr ?? "") };
}

const startup = (o?: { withDnsmasq?: boolean }) => run(join(tree, "addon-scripts", "dns-startup.sh"), o);
const hijack = () => run(join(tree, "dns-hijack.sh"));
const rd = (p: string) => readFileSync(p, "utf8");
const serviceCalls = () => stubCalls(stubs, "service");

describe("dns-startup.sh", () => {
  beforeEach(() => writeFileSync(join(confDir, "devenv-split.conf"), "strict-order\n"));

  it("first run copies the real upstream, hijacks resolv.conf and restarts dnsmasq", () => {
    writeFileSync(resolv, "nameserver 10.0.0.2\n");
    const r = startup();
    expect(r.status).toBe(0);
    expect(rd(upstream)).toBe("nameserver 10.0.0.2\n");
    expect(rd(resolv)).toBe("nameserver 127.0.0.1\n");
    expect(serviceCalls()).toEqual(["service dnsmasq restart"]);
  });

  it("second run keeps the real upstream and leaves the hijacked resolv.conf alone", () => {
    writeFileSync(resolv, "nameserver 10.0.0.2\n");
    startup();
    const r = startup();
    expect(r.status).toBe(0);
    expect(rd(upstream)).toBe("nameserver 10.0.0.2\n");
    expect(rd(resolv)).toBe("nameserver 127.0.0.1\n");
  });

  it("loopback-only resolv.conf and no upstream file: warns, changes nothing, exits 0", () => {
    writeFileSync(resolv, "nameserver 127.0.0.53\nnameserver ::1\n");
    const r = startup();
    expect(r.status).toBe(0);
    expect(r.out).toContain("⚠️");
    expect(rd(resolv)).toBe("nameserver 127.0.0.53\nnameserver ::1\n");
    expect(existsSync(upstream)).toBe(false);
    expect(serviceCalls()).toEqual([]);
  });

  it.each([
    ["only a loopback nameserver", "nameserver 127.0.0.1\n"],
    ["empty", ""],
    ["only comments", "# generated\nsearch example.test\n"],
  ])("loopback-only resolv.conf and an upstream file with %s: warns naming the file, changes nothing", (_label, content) => {
    writeFileSync(resolv, "nameserver 127.0.0.53\n");
    writeFileSync(upstream, content);
    const r = startup();
    expect(r.status).toBe(0);
    expect(r.out).toContain("⚠️");
    expect(r.out).toContain(upstream);
    expect(rd(resolv)).toBe("nameserver 127.0.0.53\n");
    expect(rd(upstream)).toBe(content);
    expect(serviceCalls()).toEqual([]);
  });

  it("a real resolv.conf heals a poisoned upstream file and the hijack proceeds", () => {
    writeFileSync(resolv, "nameserver 10.0.0.2\n");
    writeFileSync(upstream, "nameserver 127.0.0.1\n");
    expect(startup().status).toBe(0);
    expect(rd(upstream)).toBe("nameserver 10.0.0.2\n");
    expect(rd(resolv)).toBe("nameserver 127.0.0.1\n");
    expect(serviceCalls()).toEqual(["service dnsmasq restart"]);
  });

  it("loopback-only resolv.conf keeps an upstream file with a real nameserver", () => {
    writeFileSync(resolv, "nameserver 127.0.0.53\n");
    writeFileSync(upstream, "nameserver 10.0.0.2\n");
    expect(startup().status).toBe(0);
    expect(rd(upstream)).toBe("nameserver 10.0.0.2\n");
    expect(serviceCalls()).toEqual(["service dnsmasq restart"]);
  });

  it("empty resolv.conf keeps an existing upstream file", () => {
    writeFileSync(resolv, "");
    writeFileSync(upstream, "nameserver 10.0.0.2\n");
    expect(startup().status).toBe(0);
    expect(rd(upstream)).toBe("nameserver 10.0.0.2\n");
  });

  it("missing resolv.conf keeps an existing upstream file", () => {
    writeFileSync(upstream, "nameserver 10.0.0.2\n");
    expect(startup().status).toBe(0);
    expect(rd(upstream)).toBe("nameserver 10.0.0.2\n");
    expect(rd(resolv)).toBe("nameserver 127.0.0.1\n");
  });

  it("a loopback nameserver next to a real one counts as real", () => {
    writeFileSync(resolv, "nameserver 127.0.0.1\nnameserver 10.0.0.9\n");
    expect(startup().status).toBe(0);
    expect(rd(upstream)).toBe("nameserver 127.0.0.1\nnameserver 10.0.0.9\n");
    expect(serviceCalls()).toEqual(["service dnsmasq restart"]);
  });
});

describe("dns-startup.sh config lookup", () => {
  // The startup proceeds past the lookup only when a config file is found;
  // a non-empty service log tells which case happened.
  function found(): boolean {
    writeFileSync(resolv, "nameserver 10.0.0.2\n");
    const r = startup();
    expect(r.status).toBe(0);
    return serviceCalls().length === 1;
  }

  it.each(["devenv-split.conf", "split-dns.conf", "acme-split.conf"])("finds %s", (name) => {
    writeFileSync(join(confDir, name), "strict-order\n");
    expect(found()).toBe(true);
  });

  it("an unrelated file in the directory is not a config", () => {
    writeFileSync(join(confDir, "other.conf"), "x\n");
    expect(found()).toBe(false);
  });

  it("with several files devenv-split.conf wins over split-dns.conf and the glob", () => {
    for (const n of ["acme-split.conf", "split-dns.conf", "devenv-split.conf"]) writeFileSync(join(confDir, n), "x\n");
    expect(found()).toBe(true);
  });

  it("split-dns.conf wins over a legacy glob match", () => {
    for (const n of ["acme-split.conf", "split-dns.conf"]) writeFileSync(join(confDir, n), "x\n");
    expect(found()).toBe(true);
  });

  it("no config: prints the not-installed message and touches nothing", () => {
    writeFileSync(resolv, "nameserver 10.0.0.2\n");
    const r = startup();
    expect(r.status).toBe(0);
    expect(r.out).toContain("DNS hijack does not appear to be installed.");
    expect(rd(resolv)).toBe("nameserver 10.0.0.2\n");
    expect(existsSync(upstream)).toBe(false);
    expect(serviceCalls()).toEqual([]);
  });

  it("dnsmasq not installed: same message, exit 0, nothing touched", () => {
    writeFileSync(join(confDir, "devenv-split.conf"), "x\n");
    writeFileSync(resolv, "nameserver 10.0.0.2\n");
    const r = startup({ withDnsmasq: false });
    expect(r.status).toBe(0);
    expect(r.out).toContain("DNS hijack does not appear to be installed.");
    expect(rd(resolv)).toBe("nameserver 10.0.0.2\n");
    expect(existsSync(upstream)).toBe(false);
    expect(serviceCalls()).toEqual([]);
  });
});

describe("dns-hijack.sh", () => {
  const conf = () => join(confDir, "devenv-split.conf");

  it("writes devenv-split.conf with the mapping rules and the upstream knob path", () => {
    const r = hijack();
    expect(r.status).toBe(0);
    const text = rd(conf());
    expect(text).toContain(`resolv-file=${upstream}`);
    expect(text).toContain("strict-order");
    expect(text).toContain("server=/example.local/192.168.1.201");
    expect(r.out).toContain(conf());
    expect(readdirSync(confDir)).toEqual(["devenv-split.conf"]);
    expect(stubCalls(stubs, "devenv-add-custom-startup")).toHaveLength(1);
  });

  it("writes mapping content literally (no second expansion)", () => {
    const line = "server=/lit.example/$HOME/`echo pwned`/$(echo pwned)";
    writeFileSync(join(tree, "config", "dns-mapping.cfg"), `${line}\n`);
    expect(hijack().status).toBe(0);
    const text = rd(conf());
    expect(text).toContain(line);
    expect(text).not.toContain(`server=/lit.example/${tmp}`);
  });

  it("re-running produces identical content", () => {
    hijack();
    const first = rd(conf());
    hijack();
    expect(rd(conf())).toBe(first);
  });

  it("warns when another *-split.conf exists", () => {
    writeFileSync(join(confDir, "acme-split.conf"), "x\n");
    const r = hijack();
    expect(r.status).toBe(0);
    expect(r.out).toContain("acme-split.conf");
    expect(r.out).toContain("uses");
  });

  it("does not warn when only devenv-split.conf exists", () => {
    hijack();
    expect(hijack().out).not.toContain("Another configuration file");
  });
});

describe("organisation neutrality", () => {
  it("neither script names an organisation", () => {
    for (const p of [STARTUP_SRC, HIJACK_SRC]) expect(readFileSync(p, "utf8").toLowerCase()).not.toContain("omsnic");
  });
});
