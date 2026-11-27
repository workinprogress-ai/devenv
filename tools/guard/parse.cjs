// parse.cjs — a shell-aware command parser for the command guard.
//
// parseCommand(text) turns a command string into the ordered list of programs it
// would run, so a rule can judge `git commit` however it is written: after a
// chain, inside a subshell or a substitution, under `bash -c`, behind `command`,
// `env`, `sudo` or `xargs`, with a `\` before it, or fed to a shell on a heredoc.
// A regular expression cannot do this; on a real command corpus a parser blocked
// no valid command where a regex blocked several.
//
// CommonJS with no dependencies: it runs inside a host's hook process on every
// terminal command, so it must be fast, and it must never throw or hang whatever
// it is given. It reads text and returns data; it never runs anything.
//
// Result: { invocations, problems }
//   invocation: {
//     program   resolved base name ("git"), or null when the program word is built
//               from an expansion or a glob and cannot be known (dynamic: true)
//     args      the argument words, quotes removed, expansions kept as text
//     env       leading VAR=value assignments (also those given to `env`)
//     cwd       the cd in effect: null, { path } or { unresolvable: true }
//     wrappers  wrapper programs seen through, outermost first (command, env, ...)
//     via       how the text was reached when nested: shell-c, eval, substitution,
//               process-substitution, heredoc-script, find-exec
//     dynamic   true when the program could not be resolved
//     heredoc   { delimiter, quoted, body } read by this command, or null
//     redirects the redirections, as text; never part of args
//   }
//   problems: strings describing what could not be parsed (unterminated quote,
//   substitution or heredoc; nesting past the depth limit). The parser keeps going
//   and returns what it found, so a caller can decide how to treat the gap.
//
// Known limits, by design: shell functions and aliases defined elsewhere, `source`d
// files, and a program name assembled at run time are not resolvable.
"use strict";

const posix = require("node:path").posix;

const MAX_DEPTH = 8;
const SHELLS = new Set(["bash", "sh", "zsh", "dash", "ksh", "ash", "fish", "csh", "tcsh"]);
// Words that only shape control flow: skipped so the command after them is seen.
const KEYWORDS = new Set(["if", "then", "else", "elif", "fi", "do", "done", "while", "until", "!", "{", "}", "esac"]);
// A segment that starts with these runs no command of its own.
const SKIP_SEGMENT = new Set(["for", "select", "case", "function"]);
const XARGS_SHORT_WITH_ARG = new Set(["I", "n", "P", "L", "d", "s", "a", "E"]);
const XARGS_LONG_WITH_ARG = new Set(["--max-args", "--max-procs", "--max-lines", "--delimiter", "--arg-file", "--eof", "--max-chars"]);
const SUDO_SHORT_WITH_ARG = new Set(["u", "g", "h", "p", "C", "D", "r", "t", "T", "U"]);

// ---------------------------------------------------------------------------
// Scanning helpers: find where a substitution, brace expansion or backtick ends.
// Each returns the index of the closing character, or -1 when it never closes.
// ---------------------------------------------------------------------------

function findBacktick(text, i) {
  while (i < text.length) {
    if (text[i] === "\\") i += 2;
    else if (text[i] === "`") return i;
    else i++;
  }
  return -1;
}

function skipDouble(text, i) {
  while (i < text.length) {
    const c = text[i];
    if (c === "\\") i += 2;
    else if (c === '"') return i + 1;
    else if (c === "$" && text[i + 1] === "(") {
      const end = scanParen(text, i + 2);
      if (end === -1) return -1;
      i = end + 1;
    } else if (c === "`") {
      const end = findBacktick(text, i + 1);
      if (end === -1) return -1;
      i = end + 1;
    } else i++;
  }
  return -1;
}

/** i is just past an opening "(": return the index of its matching ")". */
function scanParen(text, i) {
  let depth = 1;
  while (i < text.length) {
    const c = text[i];
    if (c === "\\") i += 2;
    else if (c === "'") {
      const end = text.indexOf("'", i + 1);
      if (end === -1) return -1;
      i = end + 1;
    } else if (c === '"') {
      i = skipDouble(text, i + 1);
      if (i === -1) return -1;
    } else if (c === "`") {
      const end = findBacktick(text, i + 1);
      if (end === -1) return -1;
      i = end + 1;
    } else if (c === "(") {
      depth++;
      i++;
    } else if (c === ")") {
      depth--;
      if (depth === 0) return i;
      i++;
    } else i++;
  }
  return -1;
}

/** i is just past "${": return the index of its matching "}". */
function scanBrace(text, i) {
  let depth = 1;
  while (i < text.length) {
    const c = text[i];
    if (c === "\\") i += 2;
    else if (c === "{") {
      depth++;
      i++;
    } else if (c === "}") {
      depth--;
      if (depth === 0) return i;
      i++;
    } else i++;
  }
  return -1;
}

// ---------------------------------------------------------------------------
// Tokenizer
// ---------------------------------------------------------------------------

function newWord() {
  return { t: "word", value: "", quoted: false, dynamic: false, glob: false, subs: [] };
}

/** text[i] === "$": append the expansion to word w; return the next index. */
function dollar(text, i, w, problems) {
  const nx = text[i + 1];
  if (nx === "(") {
    const arithmetic = text[i + 2] === "(";
    const end = scanParen(text, i + 2);
    w.dynamic = true;
    if (end === -1) {
      problems.push("unterminated substitution");
      if (!arithmetic) w.subs.push({ text: text.slice(i + 2), kind: "substitution" });
      w.value += text.slice(i);
      return text.length;
    }
    if (!arithmetic) w.subs.push({ text: text.slice(i + 2, end), kind: "substitution" });
    w.value += text.slice(i, end + 1);
    return end + 1;
  }
  if (nx === "{") {
    const end = scanBrace(text, i + 2);
    w.dynamic = true;
    if (end === -1) {
      w.value += text.slice(i);
      return text.length;
    }
    w.value += text.slice(i, end + 1);
    return end + 1;
  }
  if (nx !== undefined && /[A-Za-z_0-9@*#?!$-]/.test(nx)) w.dynamic = true;
  w.value += "$";
  return i + 1;
}

/** text[i] === "`": append the backtick substitution to word w; return the next index. */
function backtick(text, i, w, problems) {
  const end = findBacktick(text, i + 1);
  w.dynamic = true;
  if (end === -1) {
    problems.push("unterminated substitution");
    w.subs.push({ text: text.slice(i + 1), kind: "substitution" });
    w.value += text.slice(i);
    return text.length;
  }
  w.subs.push({ text: text.slice(i + 1, end).replace(/\\`/g, "`"), kind: "substitution" });
  w.value += text.slice(i, end + 1);
  return end + 1;
}

/** Read a heredoc delimiter word starting at i: { value, quoted, end }. */
function readDelimiter(text, i) {
  let value = "";
  let quoted = false;
  while (i < text.length && !/[\s;|&()<>]/.test(text[i])) {
    const c = text[i];
    if (c === "'" || c === '"') {
      quoted = true;
      const end = text.indexOf(c, i + 1);
      if (end === -1) {
        value += text.slice(i + 1);
        return { value, quoted, end: text.length };
      }
      value += text.slice(i + 1, end);
      i = end + 1;
    } else if (c === "\\") {
      quoted = true;
      value += text[i + 1] === undefined ? "" : text[i + 1];
      i += 2;
    } else {
      value += c;
      i++;
    }
  }
  return { value, quoted, end: i };
}

/** Consume the bodies of the heredocs opened on the line that just ended. */
function readHeredocBodies(text, i, pending, problems) {
  for (const ref of pending) {
    let body = "";
    let closed = false;
    while (i < text.length) {
      let eol = text.indexOf("\n", i);
      const last = eol === -1;
      if (last) eol = text.length;
      let line = text.slice(i, eol);
      i = last ? text.length : eol + 1;
      if (ref.strip) line = line.replace(/^\t+/, "");
      if (line === ref.delimiter) {
        closed = true;
        break;
      }
      body += last ? line : `${line}\n`;
    }
    if (!closed) problems.push(`unterminated heredoc: ${ref.delimiter}`);
    ref.body = body;
  }
  pending.length = 0;
  return i;
}

function tokenize(text, problems) {
  const tokens = [];
  const pending = [];
  const n = text.length;
  let cur = null;
  let i = 0;
  const flush = () => {
    if (cur !== null) tokens.push(cur);
    cur = null;
  };
  const op = (v) => tokens.push({ t: "op", v });

  while (i < n) {
    const c = text[i];
    if (c === "\\" && text[i + 1] === "\n") {
      i += 2;
      continue;
    }
    if (c === "\n") {
      flush();
      op("\n");
      i = readHeredocBodies(text, i + 1, pending, problems);
      continue;
    }
    if (c === " " || c === "\t" || c === "\r") {
      flush();
      i++;
      continue;
    }
    if (c === "#" && cur === null) {
      while (i < n && text[i] !== "\n") i++;
      continue;
    }
    if (c === ";") {
      flush();
      op(";");
      i++;
      continue;
    }
    if (c === "&") {
      flush();
      if (text[i + 1] === "&") {
        op("&&");
        i += 2;
      } else if (text[i + 1] === ">") {
        const append = text[i + 2] === ">";
        tokens.push({ t: "redir", op: append ? "&>>" : "&>", fd: "" });
        i += append ? 3 : 2;
      } else {
        op("&");
        i++;
      }
      continue;
    }
    if (c === "|") {
      flush();
      if (text[i + 1] === "|") {
        op("||");
        i += 2;
      } else if (text[i + 1] === "&") {
        op("|&");
        i += 2;
      } else {
        op("|");
        i++;
      }
      continue;
    }
    if (c === "(" || c === ")") {
      flush();
      op(c);
      i++;
      continue;
    }
    if ((c === "<" || c === ">") && text[i + 1] === "(") {
      const w = cur === null ? (cur = newWord()) : cur;
      const end = scanParen(text, i + 2);
      w.dynamic = true;
      if (end === -1) {
        problems.push("unterminated substitution");
        w.subs.push({ text: text.slice(i + 2), kind: "process-substitution" });
        w.value += text.slice(i);
        i = n;
      } else {
        w.subs.push({ text: text.slice(i + 2, end), kind: "process-substitution" });
        w.value += text.slice(i, end + 1);
        i = end + 1;
      }
      continue;
    }
    if (c === "<" || c === ">") {
      let fd = "";
      if (cur !== null && !cur.quoted && cur.subs.length === 0 && /^[0-9]+$/.test(cur.value)) {
        fd = cur.value;
        cur = null;
      } else flush();
      let operator = c;
      i++;
      if (c === "<") {
        if (text[i] === "<") {
          if (text[i + 1] === "<") {
            operator = "<<<";
            i += 2;
          } else if (text[i + 1] === "-") {
            operator = "<<-";
            i += 2;
          } else {
            operator = "<<";
            i++;
          }
        } else if (text[i] === "&") {
          operator = "<&";
          i++;
        } else if (text[i] === ">") {
          operator = "<>";
          i++;
        }
      } else if (text[i] === ">") {
        operator = ">>";
        i++;
      } else if (text[i] === "&") {
        operator = ">&";
        i++;
      } else if (text[i] === "|") {
        operator = ">|";
        i++;
      }
      if (operator === "<<" || operator === "<<-") {
        while (text[i] === " " || text[i] === "\t") i++;
        const d = readDelimiter(text, i);
        i = d.end;
        const ref = { delimiter: d.value, quoted: d.quoted, strip: operator === "<<-", body: "" };
        pending.push(ref);
        tokens.push({ t: "heredoc", ref, fd });
      } else tokens.push({ t: "redir", op: operator, fd });
      continue;
    }

    const w = cur === null ? (cur = newWord()) : cur;
    if (c === "'") {
      w.quoted = true;
      const end = text.indexOf("'", i + 1);
      if (end === -1) {
        problems.push("unterminated quote");
        w.value += text.slice(i + 1);
        i = n;
      } else {
        w.value += text.slice(i + 1, end);
        i = end + 1;
      }
    } else if (c === '"') {
      w.quoted = true;
      i++;
      let closed = false;
      while (i < n) {
        const d = text[i];
        if (d === '"') {
          closed = true;
          i++;
          break;
        }
        if (d === "\\") {
          const e = text[i + 1];
          if (e === undefined) {
            w.value += "\\";
            i++;
          } else if (e === "\n") i += 2;
          else {
            w.value += '$`"\\'.includes(e) ? e : `\\${e}`;
            i += 2;
          }
        } else if (d === "$") i = dollar(text, i, w, problems);
        else if (d === "`") i = backtick(text, i, w, problems);
        else {
          w.value += d;
          i++;
        }
      }
      if (!closed) problems.push("unterminated quote");
    } else if (c === "\\") {
      if (text[i + 1] === undefined) {
        w.value += "\\";
        i++;
      } else {
        w.value += text[i + 1];
        w.quoted = true;
        i += 2;
      }
    } else if (c === "$") {
      if (text[i + 1] === "'") {
        w.quoted = true;
        i += 2;
        let closed = false;
        while (i < n) {
          if (text[i] === "\\") {
            w.value += text.slice(i, i + 2);
            i += 2;
          } else if (text[i] === "'") {
            closed = true;
            i++;
            break;
          } else {
            w.value += text[i];
            i++;
          }
        }
        if (!closed) problems.push("unterminated quote");
      } else if (text[i + 1] === '"') i++;
      else i = dollar(text, i, w, problems);
    } else if (c === "`") i = backtick(text, i, w, problems);
    else {
      if (c === "*" || c === "?" || c === "[") w.glob = true;
      w.value += c;
      i++;
    }
  }
  flush();
  for (const ref of pending) problems.push(`unterminated heredoc: ${ref.delimiter}`);
  return tokens;
}

// ---------------------------------------------------------------------------
// Builder: tokens -> invocations
// ---------------------------------------------------------------------------

const isAssignment = (w) => /^[A-Za-z_][A-Za-z0-9_]*=/.test(w.value);

function setEnv(env, w) {
  const eq = w.value.indexOf("=");
  const key = w.value.slice(0, eq);
  if (key !== "__proto__") env[key] = w.value.slice(eq + 1);
}

function recurse(text, via, ctx) {
  if (ctx.depth + 1 > ctx.maxDepth) {
    const msg = `nesting deeper than ${ctx.maxDepth} levels: depth limit reached`;
    if (!ctx.out.problems.includes(msg)) ctx.out.problems.push(msg);
    return;
  }
  parseInto(text, { out: ctx.out, maxDepth: ctx.maxDepth, depth: ctx.depth + 1, via: ctx.via.concat([via]), cwd: ctx.cwd });
}

function scanSubs(w, ctx) {
  for (const s of w.subs) recurse(s.text, s.kind, ctx);
}

/** Substitutions an unquoted heredoc body would run when the shell expands it. */
function bodySubstitutions(body) {
  const found = [];
  let i = 0;
  while (i < body.length) {
    const c = body[i];
    if (c === "\\") i += 2;
    else if (c === "$" && body[i + 1] === "(" && body[i + 2] !== "(") {
      const end = scanParen(body, i + 2);
      if (end === -1) {
        found.push(body.slice(i + 2));
        break;
      }
      found.push(body.slice(i + 2, end));
      i = end + 1;
    } else if (c === "`") {
      const end = findBacktick(body, i + 1);
      if (end === -1) {
        found.push(body.slice(i + 1));
        break;
      }
      found.push(body.slice(i + 1, end).replace(/\\`/g, "`"));
      i = end + 1;
    } else i++;
  }
  return found;
}

const baseName = (v) => v.slice(v.lastIndexOf("/") + 1);

/** Skip the options of a wrapper program; return the index of its command, or null for a lookup. */
function skipWrapper(name, words, i, base, ctx) {
  let j = i + 1;
  const v = (k) => words[k].value;
  if (name === "command") {
    let query = false;
    while (j < words.length && /^-/.test(v(j))) {
      if (/^-[a-zA-Z]*[vV]/.test(v(j))) query = true;
      j++;
    }
    return query ? null : j;
  }
  if (name === "env") {
    while (j < words.length) {
      const t = v(j);
      if (t === "--") return j + 1;
      if (t === "-S" || t === "--split-string") {
        if (words[j + 1] !== undefined) recurse(words[j + 1].value, "env-S", ctx);
        return words.length;
      }
      if (t.startsWith("--split-string=") || (t.startsWith("-S") && t.length > 2)) {
        recurse(t.startsWith("--") ? t.slice("--split-string=".length) : t.slice(2), "env-S", ctx);
        return words.length;
      }
      if (isAssignment(words[j])) {
        setEnv(base.env, words[j]);
        j++;
      } else if (/^-[uC]$/.test(t)) j += 2;
      else if (t.startsWith("-") && t.length > 1) j++;
      else break;
    }
    return j;
  }
  if (name === "sudo" || name === "doas") {
    while (j < words.length) {
      const t = v(j);
      if (t === "--") return j + 1;
      if (isAssignment(words[j])) {
        setEnv(base.env, words[j]);
        j++;
        continue;
      }
      if (!t.startsWith("-") || t === "-") break;
      j += t.length === 2 && SUDO_SHORT_WITH_ARG.has(t[1]) ? 2 : 1;
    }
    return j;
  }
  if (name === "timeout") {
    while (j < words.length && v(j).startsWith("-")) j += /^-[sk]$/.test(v(j)) ? 2 : 1;
    return j < words.length ? j + 1 : j;
  }
  if (name === "nice" || name === "ionice" || name === "stdbuf") {
    while (j < words.length && v(j).startsWith("-")) {
      const t = v(j);
      const takesArg = name === "nice" ? t === "-n" : name === "ionice" ? /^-[cnp]$/.test(t) : /^-[ioe]$/.test(t);
      j += takesArg ? 2 : 1;
    }
    return j;
  }
  if (name === "xargs") {
    while (j < words.length && v(j).startsWith("-") && v(j) !== "-") {
      const t = v(j);
      if (t === "--") return j + 1;
      if (t.startsWith("--")) j += t.includes("=") || !XARGS_LONG_WITH_ARG.has(t) ? 1 : 2;
      else j += t.length === 2 && XARGS_SHORT_WITH_ARG.has(t[1]) ? 2 : 1;
    }
    return j;
  }
  // builtin, exec, nohup, setsid, time: skip leading options (exec -a takes a name).
  while (j < words.length && /^-[A-Za-z-]*$/.test(v(j)) && v(j) !== "-") j += name === "exec" && v(j) === "-a" ? 2 : 1;
  return j;
}

const WRAPPERS = new Set(["command", "builtin", "exec", "env", "sudo", "doas", "nohup", "setsid", "time", "timeout", "nice", "ionice", "stdbuf", "xargs"]);

function record(ctx, base, program, dynamic, args) {
  ctx.out.invocations.push({
    program,
    args,
    env: Object.assign({}, base.env),
    cwd: ctx.cwd,
    wrappers: base.wrappers.slice(),
    via: base.via.slice(),
    dynamic,
    heredoc: base.heredoc === null ? null : { delimiter: base.heredoc.delimiter, quoted: base.heredoc.quoted, body: base.heredoc.body },
    redirects: base.redirects.slice(),
  });
}

function afterCd(args, ctx) {
  let j = 0;
  while (j < args.length && !args[j].dynamic && /^(?:--|-[PLe@]+)$/.test(args[j].value)) j++;
  const t = args[j];
  if (t === undefined || t.dynamic || t.glob || t.value === "-" || t.value.startsWith("~")) {
    ctx.cwd = { unresolvable: true };
    return;
  }
  const cur = ctx.cwd !== null && ctx.cwd.path !== undefined ? ctx.cwd.path : null;
  if (ctx.cwd !== null && ctx.cwd.unresolvable && !posix.isAbsolute(t.value)) return;
  let next = t.value;
  if (!posix.isAbsolute(next) && cur !== null) next = posix.join(cur, next);
  next = posix.normalize(next);
  if (next.length > 1 && next.endsWith("/")) next = next.slice(0, -1);
  ctx.cwd = { path: next };
}

/** Find the script argument of `bash -c`: the first non-flag word after a flag cluster containing c. */
function shellScript(args) {
  let wantsScript = false;
  for (let j = 0; j < args.length; j++) {
    const a = args[j];
    if (a.value === "--") return wantsScript && args[j + 1] ? args[j + 1] : null;
    if (/^-[a-zA-Z]*c[a-zA-Z]*$/.test(a.value)) wantsScript = true;
    else if (a.value === "-o" || a.value === "-O") j++;
    else if (/^[-+]/.test(a.value)) continue;
    else return wantsScript ? a : null;
  }
  return null;
}

function resolveWords(words, ctx, base) {
  let i = 0;
  while (i < words.length) {
    const w = words[i];
    const name = baseName(w.value);
    if (!w.dynamic && !w.quoted && KEYWORDS.has(w.value)) {
      i++;
      continue;
    }
    if (!w.dynamic && WRAPPERS.has(name) && w.value === name) {
      const next = skipWrapper(name, words, i, base, ctx);
      if (next === null) return;
      base.wrappers.push(name);
      i = next;
      continue;
    }
    break;
  }
  if (i >= words.length) return;

  const w = words[i];
  const rest = words.slice(i + 1);
  const args = rest.map((x) => x.value);
  const glob = w.glob && !/^\[\[?$/.test(w.value);
  if (w.dynamic || glob) {
    record(ctx, base, null, true, args);
    return;
  }
  const program = baseName(w.value);
  record(ctx, base, program, false, args);

  if (program === "cd") afterCd(rest, ctx);
  else if (program === "pushd" || program === "popd") ctx.cwd = { unresolvable: true };
  else if (program === "eval") {
    if (args.length > 0) recurse(args.join(" "), "eval", ctx);
  } else if (SHELLS.has(program)) {
    const script = shellScript(rest);
    if (script !== null) recurse(script.value, "shell-c", ctx);
    else if (base.heredoc !== null && !rest.some((x) => !/^[-+]/.test(x.value) && x.value !== "-s")) {
      recurse(base.heredoc.body, "heredoc-script", ctx);
    }
  } else if (program === "find") {
    for (let j = 0; j < rest.length; j++) {
      if (!/^-(?:exec|execdir|ok|okdir)$/.test(rest[j].value)) continue;
      let k = j + 1;
      while (k < rest.length && rest[k].value !== ";" && rest[k].value !== "+") k++;
      const inner = rest.slice(j + 1, k);
      if (inner.length > 0) {
        resolveWords(inner, ctx, { env: {}, wrappers: [], via: ctx.via.concat(["find-exec"]), heredoc: null, redirects: [] });
      }
      j = k;
    }
  }
}

function emit(words, redirs, heredocRef, ctx) {
  const base = {
    env: {},
    wrappers: [],
    via: ctx.via,
    heredoc: heredocRef,
    redirects: redirs.map((r) => `${r.fd}${r.op}${r.target === null ? "" : r.target.value}`),
  };
  let i = 0;
  while (i < words.length && isAssignment(words[i])) {
    setEnv(base.env, words[i]);
    scanSubs(words[i], ctx);
    i++;
  }
  const rest = words.slice(i);
  if (rest.length === 0) return;
  const head = rest[0];
  if (!head.dynamic && !head.quoted && SKIP_SEGMENT.has(head.value)) {
    for (const w of rest) scanSubs(w, ctx);
    return;
  }
  resolveWords(rest, ctx, base);
  for (const w of rest) scanSubs(w, ctx);
  if (heredocRef !== null && !heredocRef.quoted) {
    for (const s of bodySubstitutions(heredocRef.body)) recurse(s, "substitution", ctx);
  }
}

function build(tokens, ctx) {
  let words = [];
  let redirs = [];
  let heredocRef = null;
  let expectTarget = false;
  const scopes = [];
  const end = () => {
    if (words.length > 0 || redirs.length > 0 || heredocRef !== null) emit(words, redirs, heredocRef, ctx);
    words = [];
    redirs = [];
    heredocRef = null;
    expectTarget = false;
  };
  for (const t of tokens) {
    if (t.t === "word") {
      if (expectTarget) {
        redirs[redirs.length - 1].target = t;
        expectTarget = false;
        scanSubs(t, ctx);
      } else words.push(t);
    } else if (t.t === "redir") {
      redirs.push({ op: t.op, fd: t.fd, target: null });
      expectTarget = true;
    } else if (t.t === "heredoc") {
      if (heredocRef === null) heredocRef = t.ref;
      redirs.push({ op: "<<", fd: t.fd, target: null });
    } else if (t.v === "(") {
      end();
      scopes.push(ctx.cwd);
    } else if (t.v === ")") {
      end();
      if (scopes.length > 0) ctx.cwd = scopes.pop();
    } else end();
  }
  end();
}

function parseInto(text, ctx) {
  build(tokenize(text, ctx.out.problems), ctx);
}

function parseCommand(text, options) {
  const out = { invocations: [], problems: [] };
  if (typeof text !== "string") return out;
  const maxDepth = options !== undefined && options !== null && Number.isInteger(options.maxDepth) ? options.maxDepth : MAX_DEPTH;
  try {
    parseInto(text, { out, maxDepth, depth: 0, via: [], cwd: null });
  } catch (e) {
    out.problems.push(`internal parser error: ${e && e.message ? e.message : String(e)}`);
  }
  return out;
}

module.exports = { parseCommand, MAX_DEPTH };
