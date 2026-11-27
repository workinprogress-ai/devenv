// guard engine core: reads one hook payload, judges terminal commands with the
// policy's rules, and answers allow (exit 0, silent) or deny (exit 2, the same
// reason as nested JSON on stdout and as text on stderr). No path may exit 1: a
// guard that crashes with 1 silently disables itself on two of the three hosts.
import { afterEach, describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const require = createRequire(import.meta.url);
const GUARD_DIR = join(import.meta.dirname, "..", "..", "guard");

interface Invocation {
  program: string | null;
  args: string[];
  dynamic: boolean;
}
interface Rule {
  name?: string;
  evaluate: (invocations: Invocation[], ctx: { policy: Record<string, unknown>; command: string }) => { reason: string } | null;
}
interface RunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  observed: Array<{ kind: string; command: string }>;
}
const engine = require(join(GUARD_DIR, "engine.cjs")) as {
  run: (input: string, options?: { rules?: Rule[]; policy?: unknown }) => RunResult;
  TERMINAL_TOOLS: readonly string[];
};
type PolicyData = {
  schema: number;
  parse: { onProblem: string; problemDenyText: string; onDynamicProgram: string; dynamicDenyText: string };
} & Record<string, unknown>;
const { loadPolicy } = require(join(GUARD_DIR, "policy-schema.cjs")) as { loadPolicy: () => PolicyData };

const claude = (command: string, extra: Record<string, unknown> = {}): string =>
  JSON.stringify({ session_id: "s", hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command }, ...extra });
const copilotLocal = (command: string): string => JSON.stringify({ session_id: "s", tool_name: "run_in_terminal", tool_input: { command } });
const copilotShared = (command: string): string => JSON.stringify({ sessionId: "s", toolName: "bash", toolArgs: { command } });
const copilotSharedString = (command: string): string => JSON.stringify({ sessionId: "s", toolName: "bash", toolArgs: JSON.stringify({ command }) });

const REASON = "Use the workspace wrapper instead.";
const denyAll: Rule = { name: "test-rule", evaluate: () => ({ reason: REASON }) };
const allowAll: Rule = { name: "quiet", evaluate: () => null };

function expectAllow(r: RunResult): void {
  expect(r.exitCode).toBe(0);
  expect(r.stdout).toBe("");
  expect(r.stderr).toBe("");
}
function expectDeny(r: RunResult): string {
  expect(r.exitCode).toBe(2);
  const body = JSON.parse(r.stdout) as { hookSpecificOutput: { hookEventName: string; permissionDecision: string; permissionDecisionReason: string } };
  expect(Object.keys(body)).toEqual(["hookSpecificOutput"]);
  expect(body.hookSpecificOutput.hookEventName).toBe("PreToolUse");
  expect(body.hookSpecificOutput.permissionDecision).toBe("deny");
  const reason = body.hookSpecificOutput.permissionDecisionReason;
  expect(reason.trim()).not.toBe("");
  expect(r.stdout.trimEnd().split("\n").length).toBe(1);
  expect(r.stderr.trimEnd()).toBe(reason);
  return reason;
}

describe("guard/engine: what is judged", () => {
  it("lists the terminal tools of the three hosts", () => {
    expect([...engine.TERMINAL_TOOLS]).toEqual(["Bash", "run_in_terminal", "bash"]);
  });

  it("allows a harmless command in every dialect, with no output", () => {
    for (const payload of [claude("ls -la"), copilotLocal("ls -la"), copilotShared("ls -la"), copilotSharedString("ls -la")]) {
      expectAllow(engine.run(payload, { rules: [allowAll] }));
    }
  });

  it("allows any non-terminal tool without looking at it", () => {
    const read = JSON.stringify({ session_id: "s", hook_event_name: "PreToolUse", tool_name: "Read", tool_input: { file_path: "/etc/hosts" } });
    expectAllow(engine.run(read, { rules: [denyAll] }));
    expectAllow(engine.run(JSON.stringify({ sessionId: "s", toolName: "view", toolArgs: { path: "x" } }), { rules: [denyAll] }));
  });

  it("allows an event other than PreToolUse even when the payload is otherwise junk", () => {
    expectAllow(engine.run(claude("anything", { hook_event_name: "SessionStart" }), { rules: [denyAll] }));
    expectAllow(engine.run(JSON.stringify({ hook_event_name: "PostToolUse", tool_name: "Bash", tool_input: {} }), { rules: [denyAll] }));
  });

  it("judges a snake_case payload with no event name as PreToolUse", () => {
    expectDeny(engine.run(copilotLocal("rm -rf x"), { rules: [denyAll] }));
  });
});

describe("guard/engine: the deny output", () => {
  it("writes one nested JSON line on stdout, the same reason on stderr, and exits 2, in every dialect", () => {
    for (const payload of [claude("git push"), copilotLocal("git push"), copilotShared("git push"), copilotSharedString("git push")]) {
      expect(expectDeny(engine.run(payload, { rules: [denyAll] }))).toBe(REASON);
    }
  });

  it("escapes the reason safely in JSON", () => {
    const tricky: Rule = { evaluate: () => ({ reason: 'Use "quotes", a \\ backslash,\nand a newline.' }) };
    const r = engine.run(claude("x"), { rules: [tricky] });
    const reason = JSON.parse(r.stdout).hookSpecificOutput.permissionDecisionReason as string;
    expect(reason).toBe('Use "quotes", a \\ backslash,\nand a newline.');
    expect(r.exitCode).toBe(2);
  });

  it("lets the first denying rule win and does not call later rules", () => {
    const calls: string[] = [];
    const rules: Rule[] = [
      { name: "a", evaluate: () => (calls.push("a"), null) },
      { name: "b", evaluate: () => (calls.push("b"), { reason: "from b" }) },
      { name: "c", evaluate: () => (calls.push("c"), { reason: "from c" }) },
    ];
    expect(expectDeny(engine.run(claude("x"), { rules }))).toBe("from b");
    expect(calls).toEqual(["a", "b"]);
  });

  it("hands each rule the parsed invocations and the policy", () => {
    let seen: { program: string | null; args: string[] }[] = [];
    let policySeen: unknown;
    let commandSeen = "";
    const spy: Rule = {
      evaluate: (inv, ctx) => {
        seen = inv.map((i) => ({ program: i.program, args: i.args }));
        policySeen = ctx.policy;
        commandSeen = ctx.command;
        return null;
      },
    };
    engine.run(claude("cd x && git status -s"), { rules: [spy] });
    expect(seen).toEqual([
      { program: "cd", args: ["x"] },
      { program: "git", args: ["status", "-s"] },
    ]);
    expect(commandSeen).toBe("cd x && git status -s");
    expect((policySeen as { schema: number }).schema).toBe(1);
  });
});

describe("guard/engine: commands the parser cannot fully read", () => {
  it("denies with the policy's instruction when parsing leaves a problem", () => {
    const reason = expectDeny(engine.run(claude("echo 'unterminated"), { rules: [allowAll] }));
    expect(reason).toContain(loadPolicy().parse.problemDenyText);
    expect(reason).toMatch(/unterminated quote/);
  });

  it("denies nesting past the depth limit", () => {
    const nest = (n: number): string => (n === 0 ? "echo hi" : `bash -c ${JSON.stringify(nest(n - 1))}`);
    expect(expectDeny(engine.run(claude(nest(12)), { rules: [allowAll] }))).toMatch(/depth/);
  });

  it("allows a program it cannot resolve, and reports it as observed", () => {
    const r = engine.run(claude("g=git; $g push"), { rules: [allowAll] });
    expectAllow(r);
    expect(r.observed).toEqual([{ kind: "dynamic-program", command: "g=git; $g push" }]);
  });

  it("denies an unresolvable program when the policy says so", () => {
    const policy = loadPolicy();
    policy.parse.onDynamicProgram = "deny";
    const reason = expectDeny(engine.run(claude("$g push"), { rules: [allowAll], policy }));
    expect(reason).toContain(policy.parse.dynamicDenyText);
  });

  it("allows a parse problem when the policy says so", () => {
    const policy = loadPolicy();
    policy.parse.onProblem = "allow";
    expectAllow(engine.run(claude("echo 'unterminated"), { rules: [allowAll], policy }));
  });
});

describe("guard/engine: failure is always a deny, never exit 1", () => {
  const cases: Array<[string, string, RegExp]> = [
    ["empty input", "", /not valid JSON/],
    ["input that is not JSON", "{ nope", /not valid JSON/],
    ["a JSON array", "[]", /unrecognized/i],
    ["JSON null", "null", /unrecognized/i],
    ["a JSON number", "42", /unrecognized/i],
    ["an object with neither dialect's keys", JSON.stringify({ hello: "world" }), /unrecognized/i],
    ["a terminal call without a command", JSON.stringify({ tool_name: "Bash", tool_input: {} }), /command/],
    ["a terminal call whose command is not a string", JSON.stringify({ tool_name: "Bash", tool_input: { command: 5 } }), /command/],
    ["a terminal call with no arguments object", JSON.stringify({ tool_name: "Bash" }), /command|unrecognized/i],
    ["camelCase toolArgs that is not JSON", JSON.stringify({ toolName: "bash", toolArgs: "{ nope" }), /command|unrecognized/i],
    ["camelCase toolArgs that is an array", JSON.stringify({ toolName: "bash", toolArgs: [] }), /command|unrecognized/i],
  ];
  for (const [name, input, re] of cases) {
    it(`denies ${name}`, () => {
      const reason = expectDeny(engine.run(input, { rules: [allowAll] }));
      expect(reason).toMatch(re);
    });
  }

  it("denies, with the error named but no stack trace, when a rule throws", () => {
    const boom: Rule = { name: "boom", evaluate: () => { throw new Error("rule exploded"); } };
    const reason = expectDeny(engine.run(claude("ls"), { rules: [boom] }));
    expect(reason).toMatch(/guard error/i);
    expect(reason).toContain("rule exploded");
    expect(reason).not.toMatch(/\n\s+at /);
  });

  it("denies when a rule throws something that is not an Error", () => {
    const weird: Rule = { evaluate: () => { throw "just a string"; } };
    expectDeny(engine.run(claude("ls"), { rules: [weird] }));
  });

  it("denies when the policy is invalid", () => {
    const bad = loadPolicy();
    bad.schema = 99;
    const reason = expectDeny(engine.run(claude("ls"), { rules: [allowAll], policy: bad }));
    expect(reason).toMatch(/policy/i);
  });

  it("only ever exits 0 or 2, whatever it is given", () => {
    let seed = 987;
    const rand = (n: number): number => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed % n;
    };
    const frags = ["git", " push", "'", '"', "$(", ")", "`", ";", "&&", "|", "<<EOF\n", "EOF", "\\", "bash -c ", "{", "}", "x", "\n"];
    const randomCommand = (): string => Array.from({ length: rand(20) }, () => frags[rand(frags.length)]).join("");
    for (let n = 0; n < 1500; n++) {
      const mode = rand(4);
      const input =
        mode === 0 ? claude(randomCommand()) : mode === 1 ? copilotShared(randomCommand()) : mode === 2 ? randomCommand() : JSON.stringify({ tool_name: "Bash", tool_input: { command: randomCommand() }, extra: rand(9) });
      const r = engine.run(input, { rules: [allowAll] });
      expect([0, 2], input).toContain(r.exitCode);
      if (r.exitCode === 2) expect(r.stderr.trim(), input).not.toBe("");
    }
  });
});

describe("guard/engine: as a process", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  function runScript(script: string, input: string): { status: number | null; stdout: string; stderr: string } {
    const r = spawnSync("node", [script], { input, encoding: "utf8" });
    return { status: r.status, stdout: r.stdout, stderr: r.stderr };
  }

  /** A private copy of the guard directory that a test can break. */
  function copyOfGuard(): string {
    const d = mkdtempSync(join(tmpdir(), "guard-copy-"));
    dirs.push(d);
    cpSync(GUARD_DIR, d, { recursive: true });
    return d;
  }

  it("allows a harmless command: exit 0 and no output", () => {
    const r = runScript(join(GUARD_DIR, "engine.cjs"), claude("ls -la"));
    expect(r.status).toBe(0);
    expect(r.stdout).toBe("");
    expect(r.stderr).toBe("");
  });

  it("denies an unparseable command with all three channels", () => {
    const r = runScript(join(GUARD_DIR, "engine.cjs"), copilotShared("echo 'oops"));
    expect(r.status).toBe(2);
    const reason = JSON.parse(r.stdout).hookSpecificOutput.permissionDecisionReason as string;
    expect(r.stderr.trimEnd()).toBe(reason);
  });

  it("exits 2 on empty input and on garbage", () => {
    expect(runScript(join(GUARD_DIR, "engine.cjs"), "").status).toBe(2);
    expect(runScript(join(GUARD_DIR, "engine.cjs"), "\u0000\u0001 not json").status).toBe(2);
  });

  it("exits 2, not 1, when the policy file is missing", () => {
    const d = copyOfGuard();
    rmSync(join(d, "policy.json"));
    const r = runScript(join(d, "engine.cjs"), claude("ls"));
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/guard error/i);
  });

  it("exits 2, not 1, when the policy file is not JSON", () => {
    const d = copyOfGuard();
    writeFileSync(join(d, "policy.json"), "{ not json");
    expect(runScript(join(d, "engine.cjs"), claude("ls")).status).toBe(2);
  });

  it("exits 2, not 1, when the parser module throws on load", () => {
    const d = copyOfGuard();
    writeFileSync(join(d, "parse.cjs"), 'throw new Error("parser failed to load");\n');
    const r = runScript(join(d, "engine.cjs"), claude("ls"));
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("parser failed to load");
  });

  it("exits 2, not 1, when the parser module has a syntax error", () => {
    const d = copyOfGuard();
    writeFileSync(join(d, "parse.cjs"), "module.exports = {{{ broken\n");
    expect(runScript(join(d, "engine.cjs"), claude("ls")).status).toBe(2);
  });

  it("answers quickly: process start to verdict stays well under a second", () => {
    const times: number[] = [];
    for (let k = 0; k < 5; k++) {
      const start = Date.now();
      runScript(join(GUARD_DIR, "engine.cjs"), claude("git status"));
      times.push(Date.now() - start);
    }
    times.sort((a, b) => a - b);
    expect(times[2] as number).toBeLessThan(1000);
  });

  it("is plain CommonJS with no dependency outside Node and its own folder", () => {
    for (const f of ["engine.cjs", "parse.cjs", "policy-schema.cjs", "rules-provider.cjs"]) {
      const src = readFileSync(join(GUARD_DIR, f), "utf8");
      const required = [...src.matchAll(/require\(\s*["']([^"']+)["']\s*\)/g)].map((m) => m[1] as string);
      for (const r of required) expect(r.startsWith("node:") || r.startsWith("./"), `${f} requires ${r}`).toBe(true);
    }
  });
});
