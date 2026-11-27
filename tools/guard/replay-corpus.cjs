#!/usr/bin/env node
// replay-corpus.cjs — builds and checks the command guard's replay corpus.
//
// The guard must block nothing legitimate, and that can only be shown on commands
// people really ran. This tool reads session transcripts, keeps the terminal
// commands, scrubs them so the result can be committed, and replays them through
// the engine. Real transcripts carry credentials, names and free text, so the raw
// data never enters the repository: only the scrubbed output does, and only after a
// person has reviewed it and set `signedOff` in its header.
//
// The scrub keeps the shape the guard judges (programs, flags, operators, public
// hosts) and replaces the rest with placeholders: secrets, URL credentials, emails,
// the organisation and project in URLs, unknown hosts, home and workspace names,
// repository names, commit and message text, long quoted strings, and the body of a
// heredoc that no shell reads. A command that still trips the secret scan after
// scrubbing is dropped, never kept.
//
// Placeholders are plain words (__SECRET__, __S__, __TEXT__, ...), never <angle
// brackets>: in a shell, < and > are redirections, so a bracketed placeholder would
// change how the guard parses the command it stands in for.
//
// Commands (all read-only on the raw data):
//   extract [--out FILE] [PATH...]   write the scrubbed corpus (default: standard output)
//   compare [PATH...]                judge each raw command and its scrubbed form and
//                                    report where they differ, without printing raw text
//   scan FILE                        run the secret scan over a file
// PATH is a transcript file or a directory searched for *.jsonl; with none given the
// local Claude and Copilot session folders are used.
//
// CommonJS with no dependencies.
"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const FORMAT = 1;
const MAX_LENGTH = 3000;
const SELF_REFERENCE = /replay-corpus|guard-replay/;
const LONG_QUOTED = 60;
const TERMINAL_TOOLS = new Set(["bash", "run_in_terminal"]);

// ---------------------------------------------------------------------------
// Extraction
// ---------------------------------------------------------------------------

/** Pull terminal commands out of JSONL transcript text (Claude and Copilot shapes). */
function extractCommands(text) {
  const out = [];
  for (const line of String(text).split("\n")) {
    if (line.trim() === "") continue;
    let d;
    try {
      d = JSON.parse(line);
    } catch {
      continue;
    }
    if (typeof d !== "object" || d === null || Array.isArray(d)) continue;
    const content = d.message && Array.isArray(d.message.content) ? d.message.content : [];
    for (const c of content) {
      if (c && c.type === "tool_use" && c.name === "Bash" && c.input && typeof c.input.command === "string") {
        out.push({ source: "claude", command: c.input.command });
      }
    }
    if (d.type === "tool.execution_start" && d.data && TERMINAL_TOOLS.has(d.data.toolName)) {
      const cmd = d.data.arguments && d.data.arguments.command;
      if (typeof cmd === "string") out.push({ source: "copilot", command: cmd });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Scrubbing
// ---------------------------------------------------------------------------

// Hosts that stay readable: the policy's API hosts (the rule under test depends on
// them) and a few public ones. Everything else becomes host.invalid.
const PUBLIC_HOSTS = [
  "github.com", "raw.githubusercontent.com", "objects.githubusercontent.com", "codeload.github.com",
  "registry.npmjs.org", "pypi.org", "files.pythonhosted.org", "nodejs.org", "example.com", "example.org",
  "localhost", "127.0.0.1",
];
const KEEP_SEGMENT = /^(?:_apis|_git|api|v\d+|repos|issues|pulls|releases|download|archive|git)$/;
// One shell word: quoted strings and $(...) substitutions count as part of it, so a value
// such as "$(cat file)" is replaced whole and never split in the middle of its quotes.
const WORD = "(?:\"(?:[^\"\\\\]|\\\\.)*\"|'[^']*'|\\$\\([^)]*\\)|[^\\s;|&\"'])+";
const MIXED_CASE_TOKEN = /\b(?=[A-Za-z0-9_-]*[a-z])(?=[A-Za-z0-9_-]*[A-Z])(?=[A-Za-z0-9_-]*\d)[A-Za-z0-9_-]{32,}\b/g;
const LONG_HEX = /\b[0-9a-f]{32,}\b/g;
const SHELL_WORD = /(?:^|[\s|;&(`])(?:ba|z|da|k)?sh(?=[\s|;&)]|$)/;
const SHELL_C = /(?:^|[\s;&|(])(?:ba|z|da|k)?sh(?:\s+-\w+)*\s+-\w*c\s*$/;

function keptHosts() {
  const policy = JSON.parse(fs.readFileSync(path.join(__dirname, "policy.json"), "utf8"));
  return PUBLIC_HOSTS.concat(policy.provider.apiHosts.map((h) => h.host));
}

function mapHost(host, kept) {
  const h = host.toLowerCase();
  if (h.endsWith(".visualstudio.com")) return "org.visualstudio.com";
  return kept.some((k) => h === k || h.endsWith(`.${k}`)) ? h : "host.invalid";
}

function scrubUrl(url, kept) {
  const m = /^([a-z][a-z0-9+.-]*):\/\/([^/?#\s]*)([^?#\s]*)(\?[^#\s]*)?(#\S*)?$/i.exec(url);
  if (m === null) return url;
  const host = m[2].replace(/:\d+$/, "");
  const segments = m[3] === "" ? [] : m[3].split("/").slice(1);
  const scrubbedPath = segments.length === 0 ? "" : `/${segments.map((s) => (s === "" || s.startsWith("__") || KEEP_SEGMENT.test(s) ? s : "__S__")).join("/")}`;
  return `${m[1]}://${mapHost(host, kept)}${scrubbedPath}${m[4] === undefined ? "" : "?__Q__"}`;
}

/** Blank the body of every heredoc that no shell reads; shell-fed bodies are code and stay. */
function scrubHeredocs(command) {
  const lines = command.split("\n");
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    out.push(line);
    const delimiters = [];
    for (const m of line.matchAll(/(?<!<)<<(?!<)(-?)\s*(['"]?)([A-Za-z_][A-Za-z0-9_]*)\2/g)) delimiters.push({ strip: m[1] === "-", name: m[3] });
    if (delimiters.length === 0) continue;
    const keep = SHELL_WORD.test(line);
    for (const d of delimiters) {
      let blanked = false;
      while (i + 1 < lines.length) {
        const next = lines[i + 1];
        const compare = d.strip ? next.replace(/^\t+/, "") : next;
        i++;
        if (compare === d.name) {
          out.push(next);
          break;
        }
        if (keep) out.push(next);
        else if (!blanked) {
          out.push("__TEXT__");
          blanked = true;
        }
      }
    }
  }
  return out.join("\n");
}

/**
 * Replace the body of every long quoted string with __TEXT__. A quote that opens inside a
 * `$(...)` pairs with the next one in that substitution, so the walk follows substitution
 * nesting instead of pairing quotes with a regular expression. A string holding a
 * substitution is code and is kept (its own nested strings are still handled), as is the
 * string after `sh -c`. An unterminated quote is copied through unchanged.
 */
function blankLongQuoted(input) {
  let i = 0;

  function singleQuoted() {
    const end = input.indexOf("'", i + 1);
    if (end === -1) return input[i++];
    const span = input.slice(i, end + 1);
    const before = input.slice(0, i);
    i = end + 1;
    return span.length - 2 <= LONG_QUOTED || SHELL_C.test(before) ? span : "'__TEXT__'";
  }

  function doubleQuoted() {
    const start = i;
    const before = input.slice(0, i);
    let body = "";
    let hasSubstitution = false;
    i++;
    while (i < input.length && input[i] !== '"') {
      if (input[i] === "\\" && i + 1 < input.length) {
        body += input.slice(i, i + 2);
        i += 2;
      } else if (input[i] === "$" && input[i + 1] === "(") {
        hasSubstitution = true;
        i += 2;
        body += `$(${command(true)}`;
      } else body += input[i++];
    }
    if (i >= input.length) {
      i = start + 1;
      return '"';
    }
    i++;
    if (hasSubstitution || body.length <= LONG_QUOTED || SHELL_C.test(before)) return `"${body}"`;
    return '"__TEXT__"';
  }

  /** Walk shell text; inside a substitution, stop after its closing parenthesis. */
  function command(inSubstitution) {
    let out = "";
    let depth = 0;
    while (i < input.length) {
      const c = input[i];
      if (c === "'") out += singleQuoted();
      else if (c === '"') out += doubleQuoted();
      else if (c === "\\" && i + 1 < input.length) {
        out += input.slice(i, i + 2);
        i += 2;
      } else if (c === "$" && input[i + 1] === "(") {
        i += 2;
        out += `$(${command(true)}`;
      } else if (c === "(") {
        depth++;
        out += input[i++];
      } else if (c === ")") {
        if (inSubstitution && depth === 0) {
          i++;
          return `${out})`;
        }
        if (depth > 0) depth--;
        out += input[i++];
      } else out += input[i++];
    }
    return out;
  }

  return command(false);
}

/** Case-insensitive patterns for names the scrubber cannot infer (an organization, a project, a person). */
function wordPatterns(words) {
  return (words || []).filter((w) => w !== "").map((w) => new RegExp(w, "gi"));
}

function scrubCommand(command, words) {
  const kept = keptHosts();
  let s = scrubHeredocs(String(command));
  for (const re of wordPatterns(words)) s = s.replace(re, "__S__");

  // Secrets first, while their shapes are intact.
  s = s
    .replace(/\bgh[pousr]_[A-Za-z0-9]{20,}/g, "__SECRET__")
    .replace(/\bgithub_pat_[A-Za-z0-9_]{20,}/g, "__SECRET__")
    .replace(/\bxox[abprs]-[A-Za-z0-9-]{10,}/g, "__SECRET__")
    .replace(/\bAKIA[0-9A-Z]{16}\b/g, "__SECRET__")
    .replace(/\bsk-[A-Za-z0-9_-]{20,}/g, "__SECRET__")
    .replace(/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, "__SECRET__")
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]{16,}/g, "Bearer __SECRET__")
    .replace(new RegExp(`\\b([A-Z0-9_]*(?:TOKEN|SECRET|PASSWORD|PASSWD|KEY|PAT)[A-Z0-9_]*)=(?!__SECRET__)${WORD}`, "g"), "$1=__SECRET__")
    .replace(new RegExp(`(--?(?:password|passwd|token|secret|api-key|apikey|auth)(?:=|\\s+))(?!__SECRET__)${WORD}`, "g"), "$1__SECRET__")
    .replace(/(?<=:\/\/)[^/\s@]+@/g, "__CRED__@");

  // scp-style remotes, then URLs, before emails and repository names.
  s = s.replace(/\b[A-Za-z0-9._-]+@([A-Za-z0-9.-]+\.[A-Za-z]{2,}):(?!\/\/)[A-Za-z0-9._/~-]+/g, (m, host) => `git@${mapHost(host, kept)}:__PATH__`);
  s = s.replace(/\b(?:https?|ssh|git):\/\/[^\s"'`)<>|;]+/g, (u) => scrubUrl(u, kept));
  s = s.replace(/\b[A-Za-z0-9._%+-]+@(?!host\.invalid\b)[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, "__EMAIL__");

  // Names in paths.
  s = s
    .replace(/\/home\/(?!user\b)[^/\s'"`;|&\\)]+/g, "/home/user")
    .replace(/\/Users\/(?!user\b)[^/\s'"`;|&\\)]+/g, "/Users/user")
    .replace(/\/workspaces\/(?!ws\b)[^/\s'"`;|&\\)]+/g, "/workspaces/ws")
    .replace(/\brepos\/(?!__)[^/\s'"`;|&\\)]+/g, "repos/__REPO__");

  // Organization identifiers no rule can know by name (the organization, its repository
  // families) are passed with --word; these cover the shapes that carry them.
  s = s
    .replace(/\/tmp\/claude-\d+\/[^\s'"`;|&\\)]*/g, "/tmp/claude-ws/__PATH__")
    .replace(/(\bDEVENV_REPO=)(?!__)[^\s'"`;|&)]+/g, "$1__S__/__REPO__")
    .replace(/(--project(?:=|\s+)|\bproject=)(?!__)[^\s'"`;|&)]+/g, "$1__S__");

  // Free text: message flags (the short -m only for git), then long quoted strings.
  const flags = /\bgit\b/.test(s) && /\b(?:commit|tag|merge|stash|notes|revert|rebase|am)\b/.test(s) ? "-m|--message" : "--message";
  s = s.replace(new RegExp(`(\\s(?:${flags}|--body|--title|--description|--notes|--comment|--subject)(?:=|\\s+))("(?:[^"\\\\]|\\\\.)*"|'[^']*'|[^\\s"'\`;|&)<>]+)`, "g"), '$1"__TEXT__"');
  s = blankLongQuoted(s);

  // Hashes and anything still shaped like a secret.
  s = s.replace(/\b(?:[0-9a-f]{40}|[0-9a-f]{64})\b/g, "__SHA__");
  // A token that looks random: mixed case with a digit, or a long run of hex. A long
  // file name or path is lower case or separated by slashes and dots, so it is not one.
  s = s.replace(MIXED_CASE_TOKEN, "__SECRET__").replace(LONG_HEX, "__SECRET__");
  return s;
}

// ---------------------------------------------------------------------------
// The secret scan: reports a pattern name and a line number, never the value.
// ---------------------------------------------------------------------------

const SCAN = [
  ["provider-token", /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|xox[abprs]-[A-Za-z0-9-]{10,}|sk-[A-Za-z0-9_-]{20,})/],
  ["aws-key", /\bAKIA[0-9A-Z]{16}\b/],
  ["jwt", /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/],
  ["bearer-value", /\bBearer\s+(?!__SECRET__)[A-Za-z0-9._~+/=-]{16,}/],
  ["private-key", /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ["url-credentials", /:\/\/(?!__CRED__@)[^/\s@]+@/],
  ["email-address", /\b[A-Za-z0-9._%+-]+@(?!host\.invalid\b)[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/],
  ["home-path", /\/(?:home|Users)\/(?!user\b)[^/\s'"`]+/],
  ["workspace-path", /\/workspaces\/(?!ws\b)[^/\s'"`]+/],
  ["long-hex", /\b[0-9a-f]{32,}\b/],
  ["long-secret", /\b(?=[A-Za-z0-9_-]*[a-z])(?=[A-Za-z0-9_-]*[A-Z])(?=[A-Za-z0-9_-]*\d)[A-Za-z0-9_-]{32,}\b/],
];

function scanForSecrets(text, words) {
  const findings = [];
  const named = wordPatterns(words).map((re) => ["named-word", new RegExp(re.source, "i")]);
  String(text).split("\n").forEach((line, i) => {
    for (const [name, re] of SCAN.concat(named)) {
      if (re.test(line)) {
        findings.push({ line: i + 1, pattern: name });
        break;
      }
    }
  });
  return findings;
}

// ---------------------------------------------------------------------------
// The corpus
// ---------------------------------------------------------------------------

function buildCorpus(items, words) {
  const counts = { extracted: items.length, kept: 0, duplicates: 0, dropped: {} };
  const seen = new Set();
  const records = [];
  const drop = (why) => {
    counts.dropped[why] = (counts.dropped[why] || 0) + 1;
  };
  for (const item of items) {
    // The commands that build and inspect the corpus carry the very identifiers being
    // scrubbed (they search for them), so they never belong in it.
    if (SELF_REFERENCE.test(item.command)) {
      drop("self-reference");
      continue;
    }
    const command = scrubCommand(item.command, words);
    if (command.length > MAX_LENGTH) {
      drop("oversize");
      continue;
    }
    if (scanForSecrets(command, words).length > 0) {
      drop("residual");
      continue;
    }
    if (seen.has(command)) {
      counts.duplicates++;
      continue;
    }
    seen.add(command);
    const record = { id: `replay-${String(records.length + 1).padStart(4, "0")}`, source: item.source, command };
    // Denials are labelled for the reviewer; `compare` lists them, and each one is a
    // correct block or a rule defect to report, never silently accepted.
    if (decide(command)) record.expect = "deny";
    records.push(record);
  }
  counts.kept = records.length;
  return { records, counts };
}

function serializeCorpus(corpus, meta) {
  const header = { meta: Object.assign({ format: FORMAT, scrub: 1, signedOff: false, counts: corpus.counts }, meta || {}) };
  return `${[header].concat(corpus.records).map((r) => JSON.stringify(r)).join("\n")}\n`;
}

function parseCorpus(jsonl) {
  let meta = null;
  const records = [];
  for (const line of String(jsonl).split("\n")) {
    if (line.trim() === "") continue;
    const d = JSON.parse(line);
    if (d.meta !== undefined) meta = d.meta;
    else records.push(d);
  }
  return { meta, records };
}

/** True when the engine denies the command. */
function decide(command) {
  const { run } = require("./engine.cjs");
  const payload = JSON.stringify({ session_id: "replay", hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command } });
  return run(payload).exitCode === 2;
}

// ---------------------------------------------------------------------------
// Command line
// ---------------------------------------------------------------------------

function defaultSources() {
  const out = [];
  const claude = path.join(os.homedir(), ".claude", "projects");
  const copilot = path.join(os.homedir(), ".copilot", "session-state");
  for (const root of [claude, copilot]) out.push(root);
  return out;
}

function collect(paths) {
  const files = [];
  const walk = (p) => {
    let st;
    try {
      st = fs.statSync(p);
    } catch {
      return;
    }
    if (st.isDirectory()) for (const e of fs.readdirSync(p)) walk(path.join(p, e));
    else if (p.endsWith(".jsonl")) files.push(p);
  };
  for (const p of paths.length > 0 ? paths : defaultSources()) walk(p);
  return files;
}

function usage() {
  process.stdout.write(`Usage: replay-corpus.cjs extract [--out FILE] [--word REGEX]... [PATH...]
       replay-corpus.cjs compare [--word REGEX]... [PATH...]
       replay-corpus.cjs scan [--word REGEX]... FILE

Build, compare and scan the command guard's replay corpus. Reads transcripts
read-only; only scrubbed text is ever written or printed. With no PATH, the local
Claude (~/.claude/projects) and Copilot (~/.copilot/session-state) folders are used.

  extract   scrub, deduplicate and write the corpus (to FILE, or standard output).
            The header says signedOff: false; review the output, then set it to true.
  compare   judge each raw command and its scrubbed form with the engine and report
            where the decisions differ, plus every denied command (scrubbed).
  scan      run the secret scan over FILE; exit 1 when it finds anything.

  --word REGEX  blank every case-insensitive match of REGEX, and have the scan flag it:
            for names no rule can infer, such as an organization, its repository naming
            families or a person. Repeatable. Nothing organization-specific lives in this
            tool; pass the names at extract time.
`);
}

function main(argv) {
  const [cmd, ...rest] = argv;
  if (cmd === undefined || cmd === "--help" || cmd === "-h") {
    usage();
    return 0;
  }
  if (cmd === "scan") {
    const scanWords = [];
    const scanFiles = [];
    for (let i = 0; i < rest.length; i++) {
      if (rest[i] === "--word") scanWords.push(rest[++i] === undefined ? "" : rest[i]);
      else scanFiles.push(rest[i]);
    }
    if (scanFiles.length !== 1) {
      process.stderr.write("scan needs exactly one FILE\n");
      return 2;
    }
    const found = scanForSecrets(fs.readFileSync(scanFiles[0], "utf8"), scanWords);
    for (const f of found) process.stdout.write(`line ${f.line}: ${f.pattern}\n`);
    process.stdout.write(found.length === 0 ? "clean\n" : `${found.length} finding(s)\n`);
    return found.length === 0 ? 0 : 1;
  }
  if (cmd !== "extract" && cmd !== "compare") {
    process.stderr.write(`unknown command: ${cmd}\n`);
    return 2;
  }
  let out = null;
  const paths = [];
  const words = [];
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === "--out") out = rest[++i] === undefined ? null : rest[i];
    else if (rest[i] === "--word") words.push(rest[++i] === undefined ? "" : rest[i]);
    else paths.push(rest[i]);
  }
  const items = [];
  for (const f of collect(paths)) items.push(...extractCommands(fs.readFileSync(f, "utf8")));

  if (cmd === "extract") {
    const corpus = buildCorpus(items, words);
    const text = serializeCorpus(corpus);
    if (out === null) process.stdout.write(text);
    else fs.writeFileSync(out, text);
    process.stderr.write(`extracted ${corpus.counts.extracted}, kept ${corpus.counts.kept}, duplicates ${corpus.counts.duplicates}, dropped ${JSON.stringify(corpus.counts.dropped)}\n`);
    return 0;
  }

  // compare: raw text is judged but never printed.
  const corpus = buildCorpus(items, words);
  let rawDenied = 0;
  const differs = [];
  const denied = [];
  const seen = new Set();
  for (const item of items) {
    const scrubbed = scrubCommand(item.command, words);
    if (seen.has(scrubbed)) continue;
    seen.add(scrubbed);
    const raw = decide(item.command);
    const clean = decide(scrubbed);
    if (raw) rawDenied++;
    if (raw !== clean) differs.push({ scrubbed, raw, clean });
    if (clean) denied.push(scrubbed);
  }
  process.stdout.write(`commands: ${items.length} extracted, ${corpus.counts.kept} kept after scrubbing\n`);
  process.stdout.write(`denied: ${rawDenied} raw, ${denied.length} scrubbed; decisions that differ: ${differs.length}\n`);
  for (const d of differs) process.stdout.write(`DIFFERS raw=${d.raw ? "deny" : "allow"} scrubbed=${d.clean ? "deny" : "allow"}: ${d.scrubbed}\n`);
  for (const d of denied) process.stdout.write(`DENIED: ${d}\n`);
  return differs.length === 0 ? 0 : 1;
}

module.exports = { extractCommands, scrubCommand, scanForSecrets, buildCorpus, serializeCorpus, parseCorpus, decide };

if (require.main === module) process.exit(main(process.argv.slice(2)));
