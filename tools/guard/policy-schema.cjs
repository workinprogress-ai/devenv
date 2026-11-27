// policy-schema.cjs — the schema of the command guard's policy data and of its
// conformance fixtures. CommonJS with no dependencies: it is loaded by the guard
// engine inside a hook process, where a slow or crashing import would cost every
// tool call. Validators never throw; they return a list of error strings, empty
// when the data is valid, so a caller can report every problem at once.
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const EXPECTATIONS = ["allow", "deny"];
const RULES = ["provider", "git", "heredoc", "parse"];
const CWD_KINDS = ["workspace", "outside", "unresolvable"];
const OUTSIDE_VALUES = ["allow", "deny"];
const UNRESOLVABLE_VALUES = ["inside", "outside"];
const HEREDOC_MODES = ["observe", "deny"];
const PARSE_STANCES = ["deny", "allow"];

const isObject = (v) => typeof v === "object" && v !== null && !Array.isArray(v);
const isNonBlankString = (v) => typeof v === "string" && v.trim() !== "";
const isFlag = (v) => typeof v === "string" && /^-[A-Za-z0-9-]+$/.test(v);
const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function loadPolicy(file) {
  return JSON.parse(fs.readFileSync(file || path.join(__dirname, "policy.json"), "utf8"));
}

function checkProvider(p, errors) {
  if (!isObject(p)) {
    errors.push("provider: must be an object");
    return;
  }
  const names = [];
  if (!Array.isArray(p.clis) || p.clis.length === 0) {
    errors.push("provider.clis: must be a non-empty array");
  } else {
    p.clis.forEach((c, i) => {
      const at = `provider.clis[${i}]`;
      if (!isObject(c)) return errors.push(`${at}: must be an object`);
      if (typeof c.name !== "string" || !/^[a-z][a-z0-9-]*$/.test(c.name)) errors.push(`${at}.name: must be a lowercase program name`);
      else if (names.includes(c.name)) errors.push(`${at}.name: duplicate "${c.name}"`);
      else names.push(c.name);
      if (c.subcommands !== undefined && (!Array.isArray(c.subcommands) || c.subcommands.length === 0 || !c.subcommands.every(isNonBlankString))) {
        errors.push(`${at}.subcommands: must be a non-empty array of strings when present`);
      }
    });
  }
  const hosts = [];
  if (!Array.isArray(p.apiHosts) || p.apiHosts.length === 0) {
    errors.push("provider.apiHosts: must be a non-empty array");
  } else {
    p.apiHosts.forEach((h, i) => {
      const at = `provider.apiHosts[${i}]`;
      if (!isObject(h)) return errors.push(`${at}: must be an object`);
      if (typeof h.host !== "string" || !/^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/.test(h.host)) errors.push(`${at}.host: must be a bare lowercase host name`);
      else hosts.push(h.host);
      if (h.pathPrefix !== undefined && (typeof h.pathPrefix !== "string" || !h.pathPrefix.startsWith("/"))) {
        errors.push(`${at}.pathPrefix: must start with "/" when present`);
      }
    });
  }
  if (!isNonBlankString(p.denyText)) {
    errors.push("provider.denyText: must be a non-blank string");
  } else {
    // The deny text is shown to the model verbatim and the guard serves forks
    // that use different providers, so it must not name any particular one.
    for (const word of [...names, ...hosts]) {
      if (new RegExp(`(^|[^A-Za-z0-9-])${escapeRegExp(word)}([^A-Za-z0-9-]|$)`, "i").test(p.denyText)) {
        errors.push(`provider.denyText: must be provider-neutral but names "${word}"`);
      }
    }
  }
}

function checkGit(g, errors) {
  if (!isObject(g)) {
    errors.push("git: must be an object");
    return;
  }
  if (!Array.isArray(g.globalOptionsWithValue) || !g.globalOptionsWithValue.every(isFlag)) {
    errors.push("git.globalOptionsWithValue: must be an array of flags");
  }
  const seen = [];
  if (!Array.isArray(g.readOnly) || g.readOnly.length === 0) {
    errors.push("git.readOnly: must be a non-empty array");
  } else {
    g.readOnly.forEach((r, i) => {
      const at = `git.readOnly[${i}]`;
      if (!isObject(r)) return errors.push(`${at}: must be an object`);
      if (typeof r.subcommand !== "string" || !/^[a-z][a-z-]*$/.test(r.subcommand)) errors.push(`${at}.subcommand: must be a lowercase git subcommand`);
      else if (seen.includes(r.subcommand)) errors.push(`${at}.subcommand: duplicate "${r.subcommand}"`);
      else seen.push(r.subcommand);
      if (r.requireAnyOf !== undefined && (!Array.isArray(r.requireAnyOf) || r.requireAnyOf.length === 0 || !r.requireAnyOf.every(isFlag))) {
        errors.push(`${at}.requireAnyOf: must be a non-empty array of flags when present`);
      }
      if (r.requireFirstArg !== undefined && !isNonBlankString(r.requireFirstArg)) {
        errors.push(`${at}.requireFirstArg: must be a non-blank string when present`);
      }
    });
  }
  if (!isNonBlankString(g.denyText)) errors.push("git.denyText: must be a non-blank string");
}

function checkParse(p, errors) {
  if (!isObject(p)) {
    errors.push("parse: must be an object");
    return;
  }
  if (!PARSE_STANCES.includes(p.onProblem)) errors.push(`parse.onProblem: must be one of ${PARSE_STANCES.join(", ")}`);
  if (!PARSE_STANCES.includes(p.onDynamicProgram)) errors.push(`parse.onDynamicProgram: must be one of ${PARSE_STANCES.join(", ")}`);
  if (!isNonBlankString(p.problemDenyText)) errors.push("parse.problemDenyText: must be a non-blank string");
  if (!isNonBlankString(p.dynamicDenyText)) errors.push("parse.dynamicDenyText: must be a non-blank string");
}

function checkScope(s, errors) {
  if (!isObject(s)) {
    errors.push("scope: must be an object");
    return;
  }
  if (s.workspaceRoot !== "derived") errors.push('scope.workspaceRoot: must be "derived" (the root is computed, never hardcoded)');
  if (!OUTSIDE_VALUES.includes(s.outsideWorkspace)) errors.push(`scope.outsideWorkspace: must be one of ${OUTSIDE_VALUES.join(", ")}`);
  if (!UNRESOLVABLE_VALUES.includes(s.unresolvableTarget)) errors.push(`scope.unresolvableTarget: must be one of ${UNRESOLVABLE_VALUES.join(", ")}`);
  const ok = (p) => typeof p === "string" && p !== "" && !path.isAbsolute(p) && !p.split(/[\\/]/).includes("..");
  if (!Array.isArray(s.insideSubpaths) || !s.insideSubpaths.every(ok)) {
    errors.push("scope.insideSubpaths: must be an array of relative paths that stay inside the workspace");
  }
}

function checkHeredoc(h, errors) {
  if (!isObject(h)) {
    errors.push("heredoc: must be an object");
    return;
  }
  if (!HEREDOC_MODES.includes(h.mode)) errors.push(`heredoc.mode: must be one of ${HEREDOC_MODES.join(", ")}`);
  const lower = (v) => Array.isArray(v) && v.length > 0 && v.every((x) => typeof x === "string" && /^[a-z][a-z0-9]*$/.test(x));
  if (!lower(h.interpreters)) errors.push("heredoc.interpreters: must be a non-empty array of lowercase program names");
  if (!lower(h.dataConsumers)) errors.push("heredoc.dataConsumers: must be a non-empty array of lowercase program names");
  if (lower(h.interpreters) && lower(h.dataConsumers)) {
    for (const x of h.interpreters) if (h.dataConsumers.includes(x)) errors.push(`heredoc: "${x}" is both an interpreter and a data consumer`);
  }
}

/** Validate the policy data. Returns a list of errors; empty means valid. */
function validatePolicy(policy) {
  if (!isObject(policy)) return ["policy: must be a JSON object"];
  const errors = [];
  if (policy.schema !== 1) errors.push("schema: must be 1");
  checkProvider(policy.provider, errors);
  checkGit(policy.git, errors);
  checkParse(policy.parse, errors);
  checkScope(policy.scope, errors);
  checkHeredoc(policy.heredoc, errors);
  return errors;
}

const FIXTURE_FIELDS = ["id", "command", "expect", "rule", "cwd", "tags", "note"];

/** Validate one conformance fixture: a command and the decision the guard must reach. */
function validateFixture(fx) {
  if (!isObject(fx)) return ["fixture: must be an object"];
  const errors = [];
  if (typeof fx.id !== "string" || !/^[a-z0-9][a-z0-9-]*$/.test(fx.id)) errors.push("id: must be a lowercase kebab-case string");
  if (!isNonBlankString(fx.command)) errors.push("command: must be a non-empty string");
  if (!EXPECTATIONS.includes(fx.expect)) errors.push(`expect: must be one of ${EXPECTATIONS.join(", ")}`);
  if (fx.rule !== undefined && !RULES.includes(fx.rule)) errors.push(`rule: must be one of ${RULES.join(", ")}`);
  if (fx.expect === "deny" && fx.rule === undefined) errors.push("rule: a deny fixture must name the rule that denies it");
  if (fx.cwd !== undefined && !CWD_KINDS.includes(fx.cwd)) errors.push(`cwd: must be one of ${CWD_KINDS.join(", ")}`);
  if (fx.tags !== undefined && (!Array.isArray(fx.tags) || !fx.tags.every(isNonBlankString))) errors.push("tags: must be an array of strings");
  if (fx.note !== undefined && !isNonBlankString(fx.note)) errors.push("note: must be a non-blank string when present");
  for (const key of Object.keys(fx)) if (!FIXTURE_FIELDS.includes(key)) errors.push(`unknown field: ${key}`);
  return errors;
}

/** Validate a list of fixtures: each one valid, ids unique. Errors name the entry's index. */
function validateFixtureSet(list) {
  if (!Array.isArray(list)) return ["fixtures: must be an array"];
  const errors = [];
  const ids = new Set();
  list.forEach((fx, i) => {
    for (const e of validateFixture(fx)) errors.push(`[${i}] ${e}`);
    if (isObject(fx) && typeof fx.id === "string") {
      if (ids.has(fx.id)) errors.push(`[${i}] duplicate id "${fx.id}"`);
      ids.add(fx.id);
    }
  });
  return errors;
}

module.exports = { EXPECTATIONS, RULES, CWD_KINDS, loadPolicy, validatePolicy, validateFixture, validateFixtureSet };
