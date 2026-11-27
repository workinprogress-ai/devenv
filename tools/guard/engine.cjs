// engine.cjs — the command guard's hook entry point.
//
// One script serves every host (Claude Code, the Copilot Local harness, the shared
// Copilot runtime). It reads one hook payload on standard input, judges terminal
// commands with the policy's rules, and answers:
//   allow  exit 0, nothing written
//   deny   exit 2, the reason as one line of nested JSON on stdout AND as text on
//          stderr, because no single channel works on every host
// The I/O contract, with the measured behavior of each host, is docs/Command-Guard.md.
//
// No path exits 1. Two of the three hosts treat exit 1 as "the hook failed, run the
// command anyway", so a guard that crashes would silently turn itself off. Every
// failure — bad input, a bad policy, a rule that throws, a module that will not load
// — is therefore a deny with exit 2 and an explanation. Only `fs` is required at
// load time; everything else loads inside the guarded path, so a broken sibling
// file is caught like any other error.
//
// CommonJS with no dependencies: it runs in a hook process on every terminal command.
"use strict";

const fs = require("node:fs");

const TERMINAL_TOOLS = ["Bash", "run_in_terminal", "bash"];

// The hook protocol's two answers. Exit 1 is deliberately not a constant here:
// it must be unreachable (see the header).
const EXIT_ALLOW = 0;
const EXIT_DENY = 2;

// Rule modules register here, in order; the first to deny wins. A rule module
// exports { name, evaluate(invocations, ctx) } and returns null to pass or
// { reason } to deny.
const RULE_MODULES = ["./rules-provider.cjs"];

const isObject = (v) => typeof v === "object" && v !== null && !Array.isArray(v);
const messageOf = (e) => {
  const m = e instanceof Error ? e.message : String(e);
  return m.trim() === "" ? "unknown error" : m;
};

function denyDecision(reason, rule, observed) {
  return { action: "deny", reason, rule, observed };
}

function dialectOf(payload) {
  if (!isObject(payload)) return null;
  if ("tool_name" in payload || "tool_input" in payload) return "snake";
  if ("toolName" in payload || "toolArgs" in payload) return "camel";
  return null;
}

/** Judge one parsed payload. Throws on internal failure; run() turns that into a deny. */
function decide(payload, options) {
  const observed = [];
  const dialect = dialectOf(payload);
  if (dialect === null) {
    return denyDecision(
      "Unrecognized hook payload: expected snake_case tool_name and tool_input, or camelCase toolName and toolArgs, so the command cannot be checked and is not allowed.",
      "engine",
      observed,
    );
  }
  const event = dialect === "snake" ? payload.hook_event_name : undefined;
  if (event !== undefined && event !== "PreToolUse") return { action: "allow", observed };
  const tool = dialect === "snake" ? payload.tool_name : payload.toolName;
  if (!TERMINAL_TOOLS.includes(tool)) return { action: "allow", observed };

  let args = dialect === "snake" ? payload.tool_input : payload.toolArgs;
  if (typeof args === "string") {
    try {
      args = JSON.parse(args);
    } catch {
      return denyDecision("The terminal tool's toolArgs is not valid JSON, so the command cannot be checked and is not allowed.", "engine", observed);
    }
  }
  if (!isObject(args) || typeof args.command !== "string") {
    return denyDecision("A terminal tool call without a string `command` cannot be checked, so it is not allowed.", "engine", observed);
  }
  const command = args.command;

  const { parseCommand } = require("./parse.cjs");
  const schema = require("./policy-schema.cjs");
  const policy = options.policy !== undefined ? options.policy : schema.loadPolicy();
  const policyErrors = schema.validatePolicy(policy);
  if (policyErrors.length > 0) {
    return denyDecision(`The guard policy is invalid (${policyErrors[0]}), so commands are not allowed until it is repaired.`, "engine", observed);
  }

  const parsed = parseCommand(command);
  if (parsed.problems.length > 0 && policy.parse.onProblem === "deny") {
    return denyDecision(`${policy.parse.problemDenyText} (${parsed.problems[0]})`, "parse", observed);
  }
  for (const inv of parsed.invocations) {
    if (inv.dynamic) observed.push({ kind: "dynamic-program", command });
  }

  const rules = options.rules !== undefined ? options.rules : RULE_MODULES.map((m) => require(m));
  for (const rule of rules) {
    const verdict = rule.evaluate(parsed.invocations, { policy, command });
    if (verdict !== null && verdict !== undefined) {
      return denyDecision(verdict.reason, rule.name || "rule", observed);
    }
  }

  if (observed.length > 0 && policy.parse.onDynamicProgram === "deny") {
    return denyDecision(policy.parse.dynamicDenyText, "parse", observed);
  }
  return { action: "allow", observed };
}

function denyResult(reason, observed) {
  const body = { hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: reason } };
  return { exitCode: EXIT_DENY, stdout: `${JSON.stringify(body)}\n`, stderr: `${reason}\n`, observed };
}

/**
 * Judge hook input text and return what the process should do. Pure: it writes
 * nothing and exits nothing, so tests can drive it; main() performs the I/O.
 */
function run(inputText, options) {
  const opts = options || {};
  try {
    let payload;
    try {
      payload = JSON.parse(inputText);
    } catch {
      return denyResult("The hook input is not valid JSON, so the command cannot be checked and is not allowed.", []);
    }
    const d = decide(payload, opts);
    if (d.action === "allow") return { exitCode: EXIT_ALLOW, stdout: "", stderr: "", observed: d.observed };
    return denyResult(d.reason, d.observed);
  } catch (e) {
    return denyResult(`Guard error: ${messageOf(e)}. The command is not allowed until the guard is repaired; tell the user.`, []);
  }
}

function write(fd, text) {
  if (text === "") return;
  try {
    let buf = Buffer.from(text);
    for (let tries = 0; buf.length > 0 && tries < 1000; tries++) {
      try {
        const n = fs.writeSync(fd, buf);
        buf = buf.subarray(n);
      } catch (e) {
        if (!e || e.code !== "EAGAIN") return;
      }
    }
  } catch {
    // A closed pipe cannot be reported anywhere; the exit code still carries the verdict.
  }
}

function emergency(e) {
  write(2, `Guard error: ${messageOf(e)}. The command is not allowed until the guard is repaired; tell the user.\n`);
  process.exit(EXIT_DENY);
}

function main() {
  process.on("uncaughtException", emergency);
  process.on("unhandledRejection", emergency);
  let code = EXIT_DENY;
  try {
    let input = "";
    try {
      input = fs.readFileSync(0, "utf8");
    } catch {
      // Unreadable input is handled as invalid JSON, which denies.
    }
    const r = run(input);
    write(1, r.stdout);
    write(2, r.stderr);
    code = r.exitCode;
  } catch (e) {
    emergency(e);
  }
  process.exit(code);
}

module.exports = { run, decide, TERMINAL_TOOLS };

if (require.main === module) main();
