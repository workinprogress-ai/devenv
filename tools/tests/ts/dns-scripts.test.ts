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
const BASE_TOOLS = ["bash", "cat", "cp", "tee", "dirname", "sort", "grep", "mkdir", "ls", "sed", "head", "tr", "mv"];

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

  it("resolv.conf naming only dnsmasq itself and no upstream file: warns, changes nothing, exits 0", () => {
    writeFileSync(resolv, "nameserver 127.0.0.1\nnameserver ::1\nnameserver ::1%lo\n");
    const r = startup();
    expect(r.status).toBe(0);
    expect(r.out).toContain("⚠️");
    expect(rd(resolv)).toBe("nameserver 127.0.0.1\nnameserver ::1\nnameserver ::1%lo\n");
    expect(existsSync(upstream)).toBe(false);
    expect(serviceCalls()).toEqual([]);
  });

  it.each(["127.0.0.11", "127.0.0.53"])("%s (an embedded or stub resolver) is a real upstream: written to the upstream file and the hijack proceeds", (addr) => {
    writeFileSync(resolv, `nameserver ${addr}\n`);
    expect(startup().status).toBe(0);
    expect(rd(upstream)).toBe(`nameserver ${addr}\n`);
    expect(rd(resolv)).toBe("nameserver 127.0.0.1\n");
    expect(serviceCalls()).toEqual(["service dnsmasq restart"]);
  });

  it.each([
    ["only a loopback nameserver", "nameserver 127.0.0.1\n"],
    ["empty", ""],
    ["only comments", "# generated\nsearch example.test\n"],
  ])("loopback-only resolv.conf and an upstream file with %s: warns naming the file, changes nothing", (_label, content) => {
    writeFileSync(resolv, "nameserver 127.0.0.1\n");
    writeFileSync(upstream, content);
    const r = startup();
    expect(r.status).toBe(0);
    expect(r.out).toContain("⚠️");
    expect(r.out).toContain(upstream);
    expect(rd(resolv)).toBe("nameserver 127.0.0.1\n");
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

  it("dnsmasq-only resolv.conf keeps an upstream file with a real nameserver", () => {
    writeFileSync(resolv, "nameserver 127.0.0.1\n");
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

  // The upstream file keeps nameserver lines other than dnsmasq itself plus
  // search/domain/options; comments and all other lines are dropped.
  it("a dnsmasq nameserver next to a real one counts as real and is filtered out of the upstream file", () => {
    writeFileSync(resolv, "# generated by docker\nnameserver 127.0.0.1\nsearch corp.test\nnameserver 10.0.0.9\noptions ndots:2\n");
    expect(startup().status).toBe(0);
    expect(rd(upstream)).toBe("search corp.test\nnameserver 10.0.0.9\noptions ndots:2\n");
    expect(serviceCalls()).toEqual(["service dnsmasq restart"]);
  });

  it("filtering preserves the order of nameserver, search, domain and options lines and drops other lines", () => {
    writeFileSync(
      resolv,
      "nameserver 10.0.0.2\nsearch a.test b.test\nnameserver ::1\ndomain corp.test\nsortlist 10.0.0.0/8\nnameserver 10.0.0.3\noptions timeout:1\n",
    );
    expect(startup().status).toBe(0);
    expect(rd(upstream)).toBe("nameserver 10.0.0.2\nsearch a.test b.test\ndomain corp.test\nnameserver 10.0.0.3\noptions timeout:1\n");
  });

  it("an IPv6 real nameserver is kept", () => {
    writeFileSync(resolv, "nameserver 2001:4860:4860::8888\nnameserver fe80::1%eth0\n");
    expect(startup().status).toBe(0);
    expect(rd(upstream)).toBe("nameserver 2001:4860:4860::8888\nnameserver fe80::1%eth0\n");
    expect(serviceCalls()).toEqual(["service dnsmasq restart"]);
  });

  it("::1 and ::1%zone nameservers are filtered out", () => {
    writeFileSync(resolv, "nameserver ::1\nnameserver ::1%lo\nnameserver 10.0.0.9\n");
    expect(startup().status).toBe(0);
    expect(rd(upstream)).toBe("nameserver 10.0.0.9\n");
  });

  it("a CRLF resolv.conf naming only dnsmasq itself counts as no real nameserver: warns, changes nothing", () => {
    writeFileSync(resolv, "nameserver 127.0.0.1\r\n");
    const r = startup();
    expect(r.status).toBe(0);
    expect(r.out).toContain("⚠️");
    expect(rd(resolv)).toBe("nameserver 127.0.0.1\r\n");
    expect(existsSync(upstream)).toBe(false);
    expect(serviceCalls()).toEqual([]);
  });

  it("a CRLF resolv.conf with a real nameserver writes an upstream file without carriage returns", () => {
    writeFileSync(resolv, "search corp.test\r\nnameserver 10.0.0.2\r\noptions ndots:1\r\n");
    expect(startup().status).toBe(0);
    const text = rd(upstream);
    expect(text).not.toContain("\r");
    expect(text).toBe("search corp.test\nnameserver 10.0.0.2\noptions ndots:1\n");
  });

  it("a bare nameserver line is not usable: the existing good upstream file is not truncated (same path as no real nameserver)", () => {
    writeFileSync(resolv, "nameserver\n");
    writeFileSync(upstream, "nameserver 10.0.0.2\n");
    const r = startup();
    expect(r.status).toBe(0);
    expect(rd(upstream)).toBe("nameserver 10.0.0.2\n");
    expect(r.out).toContain("keeping existing");
    expect(rd(resolv)).toBe("nameserver 127.0.0.1\n");
    expect(serviceCalls()).toEqual(["service dnsmasq restart"]);
  });

  it("a bare nameserver line with no upstream file warns and changes nothing", () => {
    writeFileSync(resolv, "nameserver   \n");
    const r = startup();
    expect(r.status).toBe(0);
    expect(r.out).toContain("⚠️");
    expect(existsSync(upstream)).toBe(false);
    expect(rd(resolv)).toBe("nameserver   \n");
    expect(serviceCalls()).toEqual([]);
  });

  it("an upstream file holding only a bare nameserver is not a good upstream file", () => {
    writeFileSync(resolv, "nameserver 127.0.0.1\n");
    writeFileSync(upstream, "nameserver\n");
    const r = startup();
    expect(r.status).toBe(0);
    expect(r.out).toContain("⚠️");
    expect(rd(upstream)).toBe("nameserver\n");
    expect(serviceCalls()).toEqual([]);
  });

  it("comment tails are stripped, also without a space before the comment", () => {
    writeFileSync(resolv, "nameserver 8.8.8.8 # primary\nnameserver 127.0.0.1#x\nnameserver 10.0.0.2;backup\nsearch corp.test # c\n");
    expect(startup().status).toBe(0);
    expect(rd(upstream)).toBe("nameserver 8.8.8.8\nnameserver 10.0.0.2\nsearch corp.test\n");
  });

  it("a nameserver line that is only a comment tail after the key is bare", () => {
    writeFileSync(resolv, "nameserver # nothing here\n");
    const r = startup();
    expect(r.out).toContain("⚠️");
    expect(existsSync(upstream)).toBe(false);
  });

  it("the nameserver key is case-insensitive", () => {
    writeFileSync(resolv, "NAMESERVER 10.0.0.2\nNameServer 127.0.0.1\n");
    expect(startup().status).toBe(0);
    expect(rd(upstream)).toBe("nameserver 10.0.0.2\n");
    expect(rd(resolv)).toBe("nameserver 127.0.0.1\n");
  });

  it.each(["127.1", "127.0.1", "0.0.0.0", "0:0:0:0:0:0:0:1", "0000:0000:0000:0000:0000:0000:0000:0001", "0000:0000:0000:0000:0000:0000:0000:0001%lo", "::", "::%lo", "::1%lo", "::1"])(
    "self spelling %s is filtered out of the upstream file",
    (addr) => {
      writeFileSync(resolv, `nameserver ${addr}\nnameserver 10.0.0.9\n`);
      expect(startup().status).toBe(0);
      expect(rd(upstream)).toBe("nameserver 10.0.0.9\n");
    },
  );

  it.each(["127.1", "0.0.0.0", "0:0:0:0:0:0:0:1", "::", "::1%lo"])("a resolv.conf naming only %s counts as no real nameserver", (addr) => {
    writeFileSync(resolv, `nameserver ${addr}\n`);
    const r = startup();
    expect(r.out).toContain("⚠️");
    expect(existsSync(upstream)).toBe(false);
    expect(serviceCalls()).toEqual([]);
  });

  // Property-style: a resolv.conf without an existing upstream file hijacks
  // exactly when the filtered upstream file holds a nameserver line.
  it.each([
    ["nameserver 10.0.0.2", true],
    ["nameserver 10.0.0.2\r", true],
    ["NAMESERVER 10.0.0.2", true],
    ["  nameserver   10.0.0.2  ", true],
    ["\tnameserver\t10.0.0.2", true],
    ["nameserver 10.0.0.2#c", true],
    ["nameserver 10.0.0.2;c", true],
    ["nameserver 127.0.0.11", true],
    ["nameserver 127.0.0.53", true],
    ["nameserver 127.0.1.1", true],
    ["nameserver 2001:db8::1", true],
    ["nameserver fe80::1%eth0", true],
    ["nameserver", false],
    ["nameserver\r", false],
    ["nameserver #", false],
    ["nameserver ;x", false],
    ["#nameserver 10.0.0.2", false],
    [";nameserver 10.0.0.2", false],
    ["nameservers 10.0.0.2", false],
    ["nameserver 127.0.0.1", false],
    ["nameserver 127.0.0.1\r", false],
    ["nameserver 127.0.0.1#x", false],
    ["nameserver 127.0.0.1 ; self", false],
    ["NAMESERVER 127.1", false],
    ["nameserver 127.0.1", false],
    ["nameserver 0.0.0.0", false],
    ["nameserver ::", false],
    ["nameserver ::1", false],
    ["nameserver ::1%lo", false],
    ["nameserver ::1%LO", false],
    ["nameserver 0:0:0:0:0:0:0:1", false],
    ["nameserver 0000:0000:0000:0000:0000:0000:0000:0001", false],
    ["search corp.test", false],
    ["options ndots:2", false],
    ["", false],
  ] as const)("check and filter agree on %j: hijack happens exactly when the upstream file is non-empty", (line, usable) => {
    writeFileSync(resolv, `${line}\n`);
    const r = startup();
    expect(r.status).toBe(0);
    const hijacked = serviceCalls().length === 1;
    const nonEmpty = existsSync(upstream) && /^nameserver /m.test(rd(upstream));
    expect(hijacked).toBe(nonEmpty);
    expect(hijacked).toBe(usable);
  });

  it("a resolv.conf with only 127.0.0.11 writes that line and restarts dnsmasq", () => {
    writeFileSync(resolv, "nameserver 127.0.0.11\noptions ndots:0\n");
    expect(startup().status).toBe(0);
    expect(rd(upstream)).toBe("nameserver 127.0.0.11\noptions ndots:0\n");
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

  it("moves an old *-split.conf aside to .dpkg-old, keeping its content, and says why", () => {
    writeFileSync(join(confDir, "acme-split.conf"), "server=/old.test/10.9.9.9\n");
    const r = hijack();
    expect(r.status).toBe(0);
    expect(existsSync(join(confDir, "acme-split.conf"))).toBe(false);
    expect(rd(join(confDir, "acme-split.conf.dpkg-old"))).toBe("server=/old.test/10.9.9.9\n");
    expect(r.out).toContain(join(confDir, "acme-split.conf"));
    expect(r.out).toContain(join(confDir, "acme-split.conf.dpkg-old"));
    expect(r.out).toContain("loads every *.conf file");
    expect(r.out).toContain("both files would have stayed live");
    expect(r.out).toContain("skips the .dpkg-old suffix");
    expect(existsSync(conf())).toBe(true);
  });

  it("moves several old *-split.conf files aside", () => {
    writeFileSync(join(confDir, "acme-split.conf"), "a\n");
    writeFileSync(join(confDir, "zeta-split.conf"), "z\n");
    expect(hijack().status).toBe(0);
    expect(readdirSync(confDir).sort()).toEqual(["acme-split.conf.dpkg-old", "devenv-split.conf", "zeta-split.conf.dpkg-old"]);
    expect(rd(join(confDir, "zeta-split.conf.dpkg-old"))).toBe("z\n");
  });

  it("does not touch split-dns.conf or other files", () => {
    writeFileSync(join(confDir, "split-dns.conf"), "s\n");
    writeFileSync(join(confDir, "other.conf"), "o\n");
    expect(hijack().status).toBe(0);
    expect(readdirSync(confDir).sort()).toEqual(["devenv-split.conf", "other.conf", "split-dns.conf"]);
  });

  it("re-running is idempotent: no further moves and identical devenv-split.conf", () => {
    writeFileSync(join(confDir, "acme-split.conf"), "a\n");
    hijack();
    const first = rd(conf());
    const second = hijack();
    expect(rd(conf())).toBe(first);
    expect(readdirSync(confDir).sort()).toEqual(["acme-split.conf.dpkg-old", "devenv-split.conf"]);
    expect(second.out).not.toContain("Moved the old configuration");
  });

  it("an existing .dpkg-old file is not overwritten: a numbered suffix is used", () => {
    writeFileSync(join(confDir, "acme-split.conf.dpkg-old"), "first\n");
    writeFileSync(join(confDir, "acme-split.conf"), "second\n");
    expect(hijack().status).toBe(0);
    expect(rd(join(confDir, "acme-split.conf.dpkg-old"))).toBe("first\n");
    expect(rd(join(confDir, "acme-split.conf.dpkg-old.1"))).toBe("second\n");
    writeFileSync(join(confDir, "acme-split.conf"), "third\n");
    expect(hijack().status).toBe(0);
    expect(rd(join(confDir, "acme-split.conf.dpkg-old.2"))).toBe("third\n");
    expect(rd(join(confDir, "acme-split.conf.dpkg-old.1"))).toBe("second\n");
  });

  it("a failed move names both files, exits 1 and leaves the old file untouched next to the written devenv-split.conf", () => {
    writeFileSync(join(confDir, "acme-split.conf"), "old\n");
    stubCli(stubs, "sudo", '#!/bin/bash\n[ "$1" = "mv" ] && exit 1\nexec "$@"');
    const r = hijack();
    expect(r.status).toBe(1);
    expect(r.out).toContain(join(confDir, "acme-split.conf"));
    expect(r.out).toContain(join(confDir, "acme-split.conf.dpkg-old"));
    expect(r.out).toContain("still live");
    expect(rd(join(confDir, "acme-split.conf"))).toBe("old\n");
    expect(existsSync(join(confDir, "acme-split.conf.dpkg-old"))).toBe(false);
    expect(existsSync(conf())).toBe(true);
    expect(stubCalls(stubs, "devenv-add-custom-startup")).toHaveLength(0);
  });

  it("only devenv-split.conf present: no move and no message", () => {
    hijack();
    const r = hijack();
    expect(r.out).not.toContain("Moved the old configuration");
    expect(readdirSync(confDir)).toEqual(["devenv-split.conf"]);
  });

  it("startup after the move finds devenv-split.conf and never a .dpkg-old file", () => {
    writeFileSync(join(confDir, "acme-split.conf"), "a\n");
    hijack();
    writeFileSync(resolv, "nameserver 10.0.0.2\n");
    expect(startup().status).toBe(0);
    expect(serviceCalls()).toEqual(["service dnsmasq restart"]);
    // With devenv-split.conf removed only the .dpkg-old file is left: not a config.
    rmrf(conf());
    writeFileSync(resolv, "nameserver 10.0.0.2\n");
    const r = startup();
    expect(r.out).toContain("DNS hijack does not appear to be installed.");
    expect(serviceCalls()).toEqual(["service dnsmasq restart"]);
  });
});

describe("organisation neutrality", () => {
  it("neither script names an organisation", () => {
    for (const p of [STARTUP_SRC, HIJACK_SRC]) expect(readFileSync(p, "utf8").toLowerCase()).not.toContain("omsnic");
  });
});
