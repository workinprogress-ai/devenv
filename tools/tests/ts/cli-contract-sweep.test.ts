// The suite-wide CLI contract, enforced on every tool entry point in tools/ts:
//   - the tool parses its arguments through toolCli, strictly, so an unknown flag
//     is misuse (exit 2) and `--help` is handled before anything else runs;
//   - no provider authentication happens at module load, before arguments are
//     parsed, so `--help` and misuse need neither network nor credentials;
//   - `--help` exits 0 and prints usage on stdout.
//
// The source checks cover every tool and execute nothing; they read the code
// through the TypeScript syntax tree, so a mention of `toolCli(` or
// `strict: false` in a comment, string, template or regex literal neither
// satisfies nor trips a check, whatever the literal contains.
//
// The probes execute only tools whose source, and whose transitive local
// imports (tools/lib), make no host-affecting calls (docker, sudo, package
// managers, kubectl, ...), in a throwaway git repo; the hermetic harness'
// canary shims those binaries and gh/az/curl and fails the test if a probed
// tool starts one, so "needs no provider and no host" is verified by the same
// run:
//   - `--help` and `--version` exit 0 with output on stdout;
//   - `--dry-run --help` (for tools that carry the dry-run flag) still prints
//     help: help wins over flags that precede it;
//   - an unknown flag exits 2 and leaves stdout empty (the hint goes to stderr);
//   - an empty value for a string option exits 2 before anything runs.
// The unknown-flag probe is the riskiest one: a tool that ignored the flag would
// run its real main path. It therefore runs ONLY for tools already executed for
// `--help` (no host-affecting calls) AND whose static strictness check passes
// (parsed through toolCli, no non-literal `strict`, no authentication or config
// read before the parse), so the flag is rejected at the parse. Tools that
// forward the rest of their argv to a child command are excluded, since an
// unknown first flag is the child's to judge, not theirs.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import ts from "typescript";
import { rmrf, tmpDir, toolScript } from "./harness/index.ts";
import { EXIT_MISUSE, EXIT_SUCCESS } from "../../lib/core/exit-codes.ts";

const TOOLS_DIR = join(import.meta.dirname, "..", "..", "ts");

const TOOLS = readdirSync(TOOLS_DIR)
  .filter((f) => f.endsWith(".ts"))
  .map((f) => f.slice(0, -3))
  .sort();

const raw = (tool: string): string => readFileSync(join(TOOLS_DIR, `${tool}.ts`), "utf8");

/** What the sweep needs to know about a module, read from its syntax tree. */
interface Analysis {
  /** Offset of the first `toolCli(` call, or -1. */
  parseAt: number;
  /** A `strict` option whose value is anything but the literal `true`. */
  nonLiteralStrict: boolean;
  /** The first call, outside any function or class body, to an authentication,
   * capability or config reader; it runs when the module loads. */
  loadCall: { name: string; at: number } | null;
  /** Every identifier in the code (comments and literals excluded). */
  identifiers: Set<string>;
  /** String literals in command position: the first argument of a call or the
   * first element of an array (`spawnSync("kubectl", ...)`, `["sudo", ...]`). */
  commandLiterals: string[];
  /** Local import specifiers (static, re-export and literal dynamic imports). */
  imports: string[];
  /** Names bound by static imports, keyed by module specifier. */
  importBindings: Map<string, string[]>;
  /** The toolCli call sets `rejectEmptyValues: true`. */
  rejectsEmpty: boolean;
  /** Option names declared with `type: "string"` in the toolCli call's options table. */
  stringOptions: string[];
  /** The first call, outside any function or class body, that spawns a process or
   * writes to stdout (directly or through a local function that does). */
  loadEffect: { name: string; at: number } | null;
}

/** Functions that need a provider, a capability or a workspace config. */
const LOAD_TIME_CALLEES = new Set(["ensureProviderAuth", "requireFamilyCapability", "loadConfig", "authStatusOk"]);

const calleeName = (call: ts.CallExpression): string | undefined => (ts.isIdentifier(call.expression) ? call.expression.text : undefined);

/** Modules whose imports run a process. */
const SPAWN_MODULE = /child_process|\/spawn(\.ts)?$|\/shell(\.ts)?$/;

const rootIdentifier = (expr: ts.Expression): string | undefined => {
  let e = expr;
  while (ts.isPropertyAccessExpression(e)) e = e.expression;
  return ts.isIdentifier(e) ? e.text : undefined;
};

const chainText = (expr: ts.Expression): string => (ts.isPropertyAccessExpression(expr) ? `${chainText(expr.expression)}.${expr.name.text}` : ts.isIdentifier(expr) ? expr.text : "");

/** Whether a call writes to stdout or (by import binding) spawns a process. */
function isEffectCall(call: ts.CallExpression, spawnNames: Set<string>): boolean {
  const text = chainText(call.expression);
  if (/^console\.(log|info|debug|table|dir)$/.test(text) || text === "process.stdout.write") return true;
  const root = rootIdentifier(call.expression);
  return root !== undefined && spawnNames.has(root);
}

function analyze(src: string): Analysis {
  const sf = ts.createSourceFile("module.ts", src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const out: Analysis = { parseAt: -1, nonLiteralStrict: false, loadCall: null, identifiers: new Set(), commandLiterals: [], imports: [], importBindings: new Map(), rejectsEmpty: false, stringOptions: [], loadEffect: null };
  const visit = (node: ts.Node): void => {
    if (ts.isIdentifier(node)) out.identifiers.add(node.text);
    else if (ts.isStringLiteralLike(node)) {
      const parent = node.parent;
      const inCommandPosition =
        (ts.isCallExpression(parent) && parent.arguments[0] === node) ||
        (ts.isArrayLiteralExpression(parent) && parent.elements[0] === node) ||
        // the script of `sh -c "<script>"`: the array ["-c", "<script>"]
        (ts.isArrayLiteralExpression(parent) &&
          parent.elements[1] === node &&
          ts.isStringLiteralLike(parent.elements[0] as ts.Expression) &&
          (parent.elements[0] as ts.StringLiteral).text === "-c");
      if (inCommandPosition) out.commandLiterals.push(node.text);
    }
    if (ts.isCallExpression(node)) {
      if (calleeName(node) === "toolCli" && (out.parseAt < 0 || node.getStart(sf) < out.parseAt)) out.parseAt = node.getStart(sf);
      const config = node.arguments[0];
      if (calleeName(node) === "toolCli" && config !== undefined && ts.isObjectLiteralExpression(config)) {
        const nameOf = (p: ts.ObjectLiteralElementLike): string | undefined =>
          p.name !== undefined && (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name)) ? p.name.text : undefined;
        for (const prop of config.properties) {
          if (!ts.isPropertyAssignment(prop)) continue;
          if (nameOf(prop) === "rejectEmptyValues" && prop.initializer.kind === ts.SyntaxKind.TrueKeyword) out.rejectsEmpty = true;
          if (nameOf(prop) === "options" && ts.isObjectLiteralExpression(prop.initializer)) {
            for (const opt of prop.initializer.properties) {
              if (!ts.isPropertyAssignment(opt) || !ts.isObjectLiteralExpression(opt.initializer)) continue;
              const typeProp = opt.initializer.properties.find((p) => ts.isPropertyAssignment(p) && nameOf(p) === "type");
              const optName = nameOf(opt);
              if (optName !== undefined && typeProp !== undefined && ts.isPropertyAssignment(typeProp) && ts.isStringLiteralLike(typeProp.initializer) && typeProp.initializer.text === "string") {
                out.stringOptions.push(optName);
              }
            }
          }
        }
      }
      const arg = node.arguments[0];
      if (node.expression.kind === ts.SyntaxKind.ImportKeyword && arg !== undefined && ts.isStringLiteralLike(arg)) out.imports.push(arg.text);
    }
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      const spec = node.moduleSpecifier;
      if (spec !== undefined && ts.isStringLiteral(spec)) out.imports.push(spec.text);
      if (ts.isImportDeclaration(node) && spec !== undefined && ts.isStringLiteral(spec)) {
        const clause = node.importClause;
        const names: string[] = [];
        if (clause?.name !== undefined) names.push(clause.name.text);
        const bindings = clause?.namedBindings;
        if (bindings !== undefined && ts.isNamespaceImport(bindings)) names.push(bindings.name.text);
        else if (bindings !== undefined) for (const el of bindings.elements) names.push(el.name.text);
        out.importBindings.set(spec.text, [...(out.importBindings.get(spec.text) ?? []), ...names]);
      }
    }
    if (ts.isPropertyAssignment(node) && (ts.isIdentifier(node.name) || ts.isStringLiteral(node.name)) && node.name.text === "strict") {
      if (node.initializer.kind !== ts.SyntaxKind.TrueKeyword) out.nonLiteralStrict = true;
    }
    if (ts.isShorthandPropertyAssignment(node) && node.name.text === "strict") out.nonLiteralStrict = true;
    ts.forEachChild(node, visit);
  };
  visit(sf);

  // Module-load code: everything that runs when the file is imported, which is
  // every statement outside function and class bodies, at any nesting depth.
  const load = (node: ts.Node): void => {
    if (ts.isFunctionLike(node) || ts.isClassLike(node)) return;
    if (ts.isCallExpression(node)) {
      const name = calleeName(node);
      if (name !== undefined && LOAD_TIME_CALLEES.has(name) && (out.loadCall === null || node.getStart(sf) < out.loadCall.at)) {
        out.loadCall = { name, at: node.getStart(sf) };
      }
    }
    ts.forEachChild(node, load);
  };
  load(sf);

  // Process spawns and stdout writes at module load, whatever the callee is
  // called: names bound by imports from a spawn module, console/process stdout
  // output, and local functions whose bodies do any of that.
  const spawnNames = new Set<string>();
  for (const [spec, names] of out.importBindings) if (SPAWN_MODULE.test(spec)) for (const n of names) spawnNames.add(n);
  const localFns = new Map<string, ts.Node>();
  for (const st of sf.statements) {
    if (ts.isFunctionDeclaration(st) && st.name !== undefined) localFns.set(st.name.text, st);
    if (ts.isVariableStatement(st)) {
      for (const d of st.declarationList.declarations) {
        if (ts.isIdentifier(d.name) && d.initializer !== undefined && ts.isFunctionLike(d.initializer)) localFns.set(d.name.text, d.initializer);
      }
    }
  }
  const effectful = new Set<string>();
  const containsEffect = (node: ts.Node): boolean => {
    let found = false;
    const walk = (n: ts.Node): void => {
      if (found) return;
      if (ts.isCallExpression(n)) {
        const callee = calleeName(n);
        if (isEffectCall(n, spawnNames) || (callee !== undefined && effectful.has(callee))) found = true;
      }
      ts.forEachChild(n, walk);
    };
    walk(node);
    return found;
  };
  for (let changed = true; changed; ) {
    changed = false;
    for (const [name, fn] of localFns) {
      if (!effectful.has(name) && containsEffect(fn)) {
        effectful.add(name);
        changed = true;
      }
    }
  }
  const loadEffects = (node: ts.Node): void => {
    if (ts.isFunctionLike(node) || ts.isClassLike(node)) return;
    if (ts.isCallExpression(node)) {
      const callee = calleeName(node);
      if ((isEffectCall(node, spawnNames) || (callee !== undefined && effectful.has(callee))) && (out.loadEffect === null || node.getStart(sf) < out.loadEffect.at)) {
        out.loadEffect = { name: chainText(node.expression) || "call", at: node.getStart(sf) };
      }
    }
    ts.forEachChild(node, loadEffects);
  };
  loadEffects(sf);
  return out;
}

const analysis = (tool: string): Analysis => analyze(raw(tool));

/** Tools that forward the rest of their argv to a child command: they import the forward-argv helper. */
const FORWARDERS = TOOLS.filter((t) => analysis(t).imports.some((s) => /(^|\/)forward-argv(\.ts)?$/.test(s)));

/** Tools that do not parse through toolCli. Each needs a stated reason. */
const EXEMPT_NO_TOOLCLI: Record<string, string> = {};

/** Tools that may accept unknown flags (strict: false). Each needs a stated reason. */
const EXEMPT_NON_STRICT: Record<string, string> = {};

/** Tools the unknown-flag probe skips although they are strict toolCli tools. Each needs a stated reason. */
const EXEMPT_UNKNOWN_FLAG: Record<string, string> = {
  "git-wip-recover": "documented exception to the exit-2 contract: an unknown option exits 1, as its predecessor did",
};

/** Coverage floors: a drop below these means probes silently stopped running. */
const PROBED_FLOOR = 95;
const UNKNOWN_FLAG_FLOOR = 90;
const EMPTY_VALUE_FLOOR = 55;

/** Source that makes a tool's main path host-affecting: never executed by this sweep. */
const HOST_AFFECTING = /\bsudo\b|\bdocker\b|apt-get|pkill|mongorestore|mongodump|mongosh|kubectl|telepresence|\bdotnet\b|terraform|\bssh\b/;

const moduleCache = new Map<string, Analysis>();
const moduleAt = (file: string): Analysis => {
  let a = moduleCache.get(file);
  if (a === undefined) {
    a = analyze(readFileSync(file, "utf8"));
    moduleCache.set(file, a);
  }
  return a;
};

const resolveLocal = (from: string, spec: string): string | undefined => {
  if (!spec.startsWith(".")) return undefined;
  const base = resolve(dirname(from), spec);
  return [base, `${base}.ts`, join(base, "index.ts")].find((f) => f.endsWith(".ts") && existsSync(f));
};

/** Every local module a file reaches through its imports, itself excluded. */
function transitiveImports(file: string): string[] {
  const seen = new Set<string>([file]);
  const queue = [file];
  while (queue.length > 0) {
    const current = queue.pop() as string;
    for (const spec of moduleAt(current).imports) {
      const target = resolveLocal(current, spec);
      if (target !== undefined && !seen.has(target)) {
        seen.add(target);
        queue.push(target);
      }
    }
  }
  seen.delete(file);
  return [...seen];
}

/** A tool is host-affecting when its own source mentions a host-affecting
 * command anywhere, or a module it transitively imports from the tools tree
 * runs one: a command-position string literal, not a mention in a comment, a
 * message, a URL or a table key. */
function hostAffectingSource(file: string): string | undefined {
  if (HOST_AFFECTING.test(readFileSync(file, "utf8"))) return file;
  return transitiveImports(file).find((f) => {
    return moduleAt(f).commandLiterals.some((c) => HOST_AFFECTING.test(c.split(/\s/, 1)[0] ?? ""));
  });
}

const isHostAffecting = (tool: string): boolean => hostAffectingSource(join(TOOLS_DIR, `${tool}.ts`)) !== undefined;

describe("CLI contract: source checks (every tool, nothing executed)", () => {
  it("lists the tools and keeps every exemption justified and current", () => {
    expect(TOOLS.length).toBeGreaterThan(100);
    for (const [name, table] of [["toolCli", EXEMPT_NO_TOOLCLI], ["strict", EXEMPT_NON_STRICT], ["unknown-flag", EXEMPT_UNKNOWN_FLAG]] as const) {
      for (const [tool, reason] of Object.entries(table)) {
        expect(TOOLS, `${name} exemption for ${tool}: the tool no longer exists`).toContain(tool);
        expect(reason.length, `${name} exemption for ${tool} needs a reason`).toBeGreaterThan(10);
      }
    }
  });

  it.each(TOOLS.filter((t) => EXEMPT_NO_TOOLCLI[t] === undefined))("%s parses its arguments through toolCli", (tool) => {
    expect(analysis(tool).parseAt, `${tool} never calls toolCli`).toBeGreaterThanOrEqual(0);
  });

  it.each(TOOLS.filter((t) => EXEMPT_NON_STRICT[t] === undefined))("%s parses strictly (no strict other than the literal true)", (tool) => {
    expect(analysis(tool).nonLiteralStrict, `${tool} passes a strict option other than the literal true`).toBe(false);
  });

  it.each(TOOLS)("%s runs no authentication, capability or config call at module load before parsing", (tool) => {
    const { loadCall: load, parseAt: parse } = analysis(tool);
    if (load === null) return;
    expect(parse, `${tool} calls ${load.name} at module load and never parses via toolCli`).toBeGreaterThanOrEqual(0);
    expect(load.at, `${tool} calls ${load.name} at module load before parsing its arguments`).toBeGreaterThan(parse);
  });

  it.each(TOOLS)("%s spawns nothing and prints nothing at module load before parsing its arguments", (tool) => {
    const { loadEffect: effect, parseAt: parse } = analysis(tool);
    if (effect === null || parse < 0) return;
    expect(effect.at, `${tool} calls ${effect.name} at module load before parsing its arguments`).toBeGreaterThan(parse);
  });

  it("the load-effect scanner sees spawns, stdout writes and local helpers that do either, under any name", () => {
    const pre = 'import { spawnSync as run } from "node:child_process";\n';
    expect(analyze(`${pre}run("x"); toolCli({});`).loadEffect?.name).toBe("run");
    expect(analyze("console.log('banner'); toolCli({});").loadEffect?.name).toBe("console.log");
    expect(analyze("console.error('diagnostic'); toolCli({});").loadEffect).toBeNull();
    expect(analyze(`${pre}function cap(c: string) { return run("bash", [c]); }\nconst h = cap("x"); toolCli({});`).loadEffect?.name).toBe("cap");
    expect(analyze(`${pre}function cap() { run("x"); }\ntoolCli({});`).loadEffect).toBeNull();
    expect(analyze("const x = join('a', 'b'); toolCli({});").loadEffect).toBeNull();
  });

  it("the forwarder check reads imports, not words in comments", () => {
    expect(FORWARDERS.length).toBeGreaterThan(0);
    expect(analyze('// forward-argv is mentioned here\nconst a = 1;').imports).toEqual([]);
    expect(analyze('import { x } from "../lib/core/forward-argv.ts";').imports).toEqual(["../lib/core/forward-argv.ts"]);
  });

  it("command literals include the script of sh -c, not only the first argument", () => {
    expect(analyze('spawnSync("sh", ["-c", "docker ps"]);').commandLiterals).toEqual(["sh", "-c", "docker ps"]);
    expect(analyze('const a = ["x", "docker ps"];').commandLiterals).toEqual(["x"]);
  });

  it("the source scanner ignores comments and literals and sees real calls", () => {
    expect(analyze("// toolCli(\nconst a = 1;").parseAt).toBe(-1);
    expect(analyze("/* strict: false */ x").nonLiteralStrict).toBe(false);
    expect(analyze('const u = "http://x"; toolCli({});').parseAt).toBeGreaterThanOrEqual(0);
    const quoted = analyze("console.log(`strict: false toolCli(`);");
    expect(quoted.parseAt).toBe(-1);
    expect(quoted.nonLiteralStrict).toBe(false);
    expect(analyze("const config = loadConfig();").loadCall?.name).toBe("loadConfig");
    expect(analyze("ensureProviderAuth();").loadCall?.name).toBe("ensureProviderAuth");
    expect(analyze("const x = await authStatusOk();").loadCall?.name).toBe("authStatusOk");
    expect(analyze("  ensureProviderAuth();").loadCall?.name).toBe("ensureProviderAuth");
    expect(analyze("if (ready) {\n  ensureProviderAuth();\n}").loadCall?.name).toBe("ensureProviderAuth");
    expect(analyze("function main() { ensureProviderAuth(); }").loadCall).toBeNull();
    expect(analyze("const f = () => loadConfig();").loadCall).toBeNull();
    expect(analyze("toolCli({ strict : false });").nonLiteralStrict).toBe(true);
    expect(analyze("toolCli({ strict: cond });").nonLiteralStrict).toBe(true);
    expect(analyze("toolCli({ strict });").nonLiteralStrict).toBe(true);
    expect(analyze("toolCli({ strict: true });").nonLiteralStrict).toBe(false);
  });

  it("still sees strict: false and toolCli after a regex or nested template that would fool a text scan", () => {
    const regexEndingInSlashes = analyze("const re = /a\\//; toolCli({ strict: false });");
    expect(regexEndingInSlashes.nonLiteralStrict).toBe(true);
    expect(regexEndingInSlashes.parseAt).toBeGreaterThanOrEqual(0);
    const regexWithQuote = analyze("const re = /\"/;\ntoolCli({ strict: false });");
    expect(regexWithQuote.nonLiteralStrict).toBe(true);
    expect(regexWithQuote.parseAt).toBeGreaterThanOrEqual(0);
    const nested = analyze("const t = `a ${`b ${x}`} c`;\ntoolCli({ strict: false });");
    expect(nested.nonLiteralStrict).toBe(true);
    expect(nested.parseAt).toBeGreaterThanOrEqual(0);
    const hiddenLoad = analyze("const re = /\\//; loadConfig();\ntoolCli({});");
    expect(hiddenLoad.loadCall?.name).toBe("loadConfig");
    expect(hiddenLoad.loadCall?.at).toBeLessThan(hiddenLoad.parseAt);
  });

  it("walks transitive local imports, so a host effect hosted in a library excludes the tool", () => {
    const kube = ["kube-pod-delete", "kube-pod-restart", "kube-list-pods", "kube-pod-select", "kube-deployment-select"];
    for (const tool of kube) {
      expect(isHostAffecting(tool), `${tool} reaches kubectl through lib/domain/kube and must not be probed`).toBe(true);
    }
    expect(hostAffectingSource(join(TOOLS_DIR, "kube-pod-delete.ts"))).toBeDefined();
    expect(isHostAffecting("issue-get")).toBe(false);
  });
});

describe("CLI contract: probes (tools with no host-affecting calls)", () => {
  let workDir = "";
  beforeAll(() => {
    workDir = tmpDir("cli-contract");
    spawnSync("git", ["init", "-q"], { cwd: workDir });
  });
  afterAll(() => rmrf(workDir));

  const probed = TOOLS.filter((t) => EXEMPT_NO_TOOLCLI[t] === undefined && !isHostAffecting(t));

  const probe = (tool: string, args: string[]) =>
    spawnSync("node", [toolScript(tool), ...args], {
      cwd: workDir,
      encoding: "utf8",
      input: "",
      timeout: 20_000,
      env: process.env,
    });

  const staticallyStrict = (tool: string): boolean => {
    const { loadCall: load, parseAt: parse, nonLiteralStrict } = analysis(tool);
    return (
      EXEMPT_NO_TOOLCLI[tool] === undefined &&
      EXEMPT_NON_STRICT[tool] === undefined &&
      parse >= 0 &&
      !nonLiteralStrict &&
      (load === null || load.at > parse)
    );
  };

  it("probes a substantial share of the tools", () => {
    expect(probed.length).toBeGreaterThan(PROBED_FLOOR);
  });

  it.each(probed)("%s --help exits 0 with usage on stdout, offline and unauthenticated", (tool) => {
    const r = probe(tool, ["--help"]);
    expect(r.status, `${tool} --help exit status (stderr: ${(r.stderr ?? "").slice(0, 200)})`).toBe(EXIT_SUCCESS);
    expect((r.stdout ?? "").length, `${tool} --help printed nothing on stdout`).toBeGreaterThan(0);
  }, 30_000);

  it.each(probed.filter((t) => !analysis(t).identifiers.has("noVersionExit")))("%s --version exits 0 with a version on stdout", (tool) => {
    const r = probe(tool, ["--version"]);
    expect(r.status, `${tool} --version exit status (stderr: ${(r.stderr ?? "").slice(0, 200)})`).toBe(EXIT_SUCCESS);
    expect((r.stdout ?? "").trim().length, `${tool} --version printed nothing on stdout`).toBeGreaterThan(0);
  }, 30_000);

  it.each(probed.filter((t) => !analysis(t).identifiers.has("noDryRun")))("%s --dry-run --help still prints help", (tool) => {
    const r = probe(tool, ["--dry-run", "--help"]);
    expect(r.status, `${tool} --dry-run --help exit status (stderr: ${(r.stderr ?? "").slice(0, 200)})`).toBe(EXIT_SUCCESS);
    expect((r.stdout ?? "").length, `${tool} --dry-run --help printed nothing on stdout`).toBeGreaterThan(0);
  }, 30_000);

  const unknownFlagProbed = probed.filter((t) => staticallyStrict(t) && !FORWARDERS.includes(t) && EXEMPT_UNKNOWN_FLAG[t] === undefined);

  it("runs the unknown-flag probe for a substantial share of the tools", () => {
    expect(unknownFlagProbed.length).toBeGreaterThan(UNKNOWN_FLAG_FLOOR);
  });

  it.each(unknownFlagProbed)("%s rejects an unknown flag with exit 2", (tool) => {
    const r = probe(tool, ["--no-such-flag-zzz"]);
    expect(r.status, `${tool} unknown flag exit status (stderr: ${(r.stderr ?? "").slice(0, 200)})`).toBe(EXIT_MISUSE);
    expect(r.stdout, `${tool} printed on stdout for an unknown flag; misuse text belongs on stderr`).toBe("");
  }, 30_000);

  const emptyValueProbes = unknownFlagProbed.flatMap((t) => (analysis(t).rejectsEmpty ? analysis(t).stringOptions.map((o) => [t, o] as const) : []));

  it("runs the empty-value probe for the tools that adopted rejectEmptyValues", () => {
    expect(emptyValueProbes.length).toBeGreaterThan(EMPTY_VALUE_FLOOR);
  });

  it("the option scanner reads rejectEmptyValues and string option names from the syntax tree", () => {
    const a = analyze('toolCli({ rejectEmptyValues: true, options: { body: { type: "string" }, "x-y": { type: "string", short: "x" }, flag: { type: "boolean" } } });');
    expect(a.rejectsEmpty).toBe(true);
    expect(a.stringOptions).toEqual(["body", "x-y"]);
    expect(analyze("// rejectEmptyValues: true\ntoolCli({});").rejectsEmpty).toBe(false);
  });

  it.each(emptyValueProbes)("%s refuses an empty value for --%s with exit 2 and empty stdout", (tool, option) => {
    const r = probe(tool, [`--${option}`, ""]);
    expect(r.status, `${tool} --${option} "" exit status (stderr: ${(r.stderr ?? "").slice(0, 200)})`).toBe(EXIT_MISUSE);
    expect(r.stdout, `${tool} printed on stdout for an empty --${option}`).toBe("");
  }, 30_000);
});
