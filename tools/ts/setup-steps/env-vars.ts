#!/usr/bin/env node
// env-vars.ts — provision step: generate .runtime/env-vars.sh from the .setup
// configuration. Port of provision.bash generate_env_vars_file.
//
// The file is sourced by every shell (via devenvrc) and accumulates identity
// and tool settings; the bash heredoc is reproduced verbatim below with the
// dynamic slots (TZ, toolbox path, DO token, USER_EMAIL, editor overrides)
// interpolated in TS. Escaped \${VAR} sequences in the source stay escaped
// here — they must reach the file as runtime expansions (the GIT_EDITOR
// scrub case reads the SHELL's value, not this generator's).
//
// Idempotent: full rewrite each run. User-added variables live in the
// separate env-vars.user.sh, which the generated file sources last; a legacy
// env-vars.sh that still carries appended variables is migrated into it once.
// Permissions: owner-only 600 — the files accumulate secrets (tokens).

import { mkdirSync, mkdtempSync, rmSync, writeFileSync, chmodSync, existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bashQuote } from "../../lib/core/shell-quote.ts";
import { toolbox, setupDir, seed } from "./lib.ts";

const root = toolbox();
const out = join(root, ".runtime", "env-vars.sh");
const userOut = join(root, ".runtime", "env-vars.user.sh");
mkdirSync(join(root, ".runtime"), { recursive: true });

// The end of the template as earlier versions generated it: the GIT_EDITOR
// scrub case, followed (in later versions) by a comment line and the user-file
// source block. Variables appended by hand or by older key updates can sit
// before or after that trailer.
const SCRUB_CASE_END = '    ""|":"|"true") unset GIT_EDITOR ;;\nesac\n';
// The template's own source of the user file, matched structurally (any line
// that sources a path ending env-vars.user.sh, inside an `if [ -f ... ]` guard).
const USER_SOURCE_BLOCK =
  /^if \[ -f "[^"\n]*env-vars\.user\.sh" \]; then[ \t]*\n(?:[ \t]*(?:source|\.)[^\n]*env-vars\.user\.sh[^\n]*\n)+fi[ \t]*(?:\n|$)/gm;
const USER_SOURCE_COMMENT = /^# User-added variables \(.*\n/gm;

/** The user-added part of a legacy env-vars.sh: everything after the template minus the template's own user-file trailer, or every export line when no template is recognisable. */
function legacyUserTail(old: string): string {
  const scrub = old.indexOf(SCRUB_CASE_END);
  if (scrub === -1) {
    return old.split("\n").filter((l) => l.startsWith("export ")).join("\n") + "\n";
  }
  // Sourcing the user file from inside itself would recurse, so the trailer
  // never reaches the migrated file, wherever appended lines sit around it.
  return old
    .slice(scrub + SCRUB_CASE_END.length)
    .replace(USER_SOURCE_BLOCK, "")
    .replace(USER_SOURCE_COMMENT, "");
}

const USER_FILE_NAME = "env-vars.user.sh";
const OPENS_IF = /(?:^|[;&|(]|\bthen\b|\belse\b|\bdo\b)\s*if\b/g;
const CLOSES_IF = /(?:^|[;&|(]|\bthen\b|\belse\b|\bdo\b)\s*fi\b/g;

/**
 * Backstop after the structural strip: a hand-edited trailer (else branch,
 * indentation, extra lines, single quotes, one-line form, CRLF) can still
 * source the user file from inside itself. Drops every `if` block that opens
 * on a line mentioning the user file (through its matching `fi`, tracked by
 * nesting depth) and then any other line that still mentions it. Line endings
 * are normalised first so CRLF cannot hide a match.
 */
function dropUserFileSourcing(tail: string): string {
  const lines = tail.replace(/\r\n?/g, "\n").split("\n");
  const kept: string[] = [];
  let depth = 0;
  for (const line of lines) {
    if (depth > 0 || (line.includes(USER_FILE_NAME) && /^\s*if\b/.test(line))) {
      depth += (line.match(OPENS_IF)?.length ?? 0) - (line.match(CLOSES_IF)?.length ?? 0);
      if (depth < 0) depth = 0;
      continue;
    }
    if (!line.includes(USER_FILE_NAME)) kept.push(line);
  }
  return kept.join("\n");
}

/** True when the content parses as bash (`bash -n`, nothing is executed). */
function isValidBash(content: string): boolean {
  const dir = mkdtempSync(join(tmpdir(), "env-vars-check-"));
  try {
    const file = join(dir, "candidate.sh");
    writeFileSync(file, content, { mode: 0o600 });
    return spawnSync("bash", ["-n", file]).status === 0;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// Before the first rewrite of an existing file that has no user file yet, keep
// the old content in an owner-only backup (the first backup is never
// overwritten), then carry appended variables over into the user file.
if (!existsSync(userOut) && existsSync(out)) {
  const old = readFileSync(out, "utf8");
  const backup = `${out}.bak`;
  if (!existsSync(backup)) {
    writeFileSync(backup, old, { mode: 0o600 });
    chmodSync(backup, 0o600);
  }
  const tail = dropUserFileSourcing(legacyUserTail(old));
  if (/^export /m.test(tail)) {
    const candidate = `#!/bin/bash\n# User-added variables; sourced by env-vars.sh and kept across updates.\n${tail}`;
    // A user file that would not parse or still names itself is never written:
    // the regenerated env-vars.sh only sources the user file when it exists, so
    // nothing recurses, and the backup keeps every migrated line recoverable.
    if (candidate.includes(USER_FILE_NAME) || !isValidBash(candidate)) {
      console.error(`env-vars: warning: could not migrate appended variables safely; ${userOut} not written. Recover them from ${backup}`);
    } else {
      writeFileSync(userOut, candidate, { mode: 0o600 });
      chmodSync(userOut, 0o600);
    }
  }
}

// Timezone: seed file wins, else the ambient TZ, else UTC (the bash order).
const tzFile = join(setupDir(), "timezone.txt");
const tz = existsSync(tzFile)
  ? readFileSync(tzFile, "utf8").trim()
  : (process.env.TZ || "UTC");

// Steps run as separate processes, so the values come from the seeds.
const doToken = seed("digitalocean_token.txt");
const userEmail = seed("email.txt");

// The content below is the bash heredoc verbatim: only the timezone, root,
// DigitalOcean token and USER_EMAIL slots are resolved here;
// every other ${VAR} the bash source escaped (\${...}) is kept escaped so
// the file expands at SHELL runtime, exactly as before.
const content = `#!/bin/bash
# This file is auto-generated by bootstrap.sh from .setup/*.txt files
# Do not edit manually - changes will be overwritten on next bootstrap

# Timezone
export TZ=${bashQuote(tz)}

# .NET settings
export DOTNET_HOSTBUILDER__RELOADCONFIGONCHANGE=false
export DOTNET_USE_POLLING_FILE_WATCHER=true

# Core paths
export DEVENV_ROOT="${root}"
export devenv="${root}"
export DEVENV_TOOLS="${root}/tools"
export CONFIG_FOLDER="${root}/.debug/config"
export DATA_FOLDER="${root}/.debug/data"

# Environment
export ENV_NAME="\${ENV_NAME:-local}"
export DICTIONARY_SERVER="\${DICTIONARY_SERVER:-localhost:6379}"
export DOCUMENT_SERVER="\${DOCUMENT_SERVER:-mongodb://localhost}"
export MESSAGE_BROKER_SERVER="\${MESSAGE_BROKER_SERVER:-nats://localhost:4222}"
export GIT_TERMINAL_PROMPT=1

# Cloud / registry
export DIGITALOCEAN_API_TOKEN=${bashQuote(doToken)}
export DIGITALOCEAN_REGISTRY="\${DIGITALOCEAN_REGISTRY:-}"
export DO_APP_NAME="\${DO_APP_NAME:-}"
export DO_REGION="\${DO_REGION:-}"

# Provider identity: no GH_* exports — tools resolve identity via the
# provider accessors (config → seed); no env var participates.

# User identity
export USER_EMAIL=${bashQuote(userEmail)}

# Update-check interval
export DEVENV_UPDATE_INTERVAL="\${DEVENV_UPDATE_INTERVAL:-7200}"

# Convenience paths 
export repos="${root}/repos"
export playground="${root}/playground"
export debug="${root}/.debug"
# Editor defaults
# Preferred editor fallback (used when VS Code is not available)
export FALLBACK_EDITOR="\${FALLBACK_EDITOR:-nano}"
export PREF_EDITOR="\${PREF_EDITOR:-\${FALLBACK_EDITOR}}"
# Point EDITOR/VISUAL to the tool wrapper, which blocks until closed
export EDITOR="\${EDITOR:-${root}/tools/editor}"
export VISUAL="\${VISUAL:-${root}/tools/editor}"
# Scrub a no-op GIT_EDITOR (":" or "true") injected by automation wrappers:
# git honors GIT_EDITOR over core.editor, so a leftover no-op silently turns
# an interactive commit into an instant commit with no editor. Unsetting
# restores the core.editor fallback (the devenv editor wrapper / VS Code).
# NOTE: inside this unquoted heredoc, \$ must stay escaped so the case reads
# the RUNTIME GIT_EDITOR, not the generator's.
case "\${GIT_EDITOR:-}" in
    ""|":"|"true") unset GIT_EDITOR ;;
esac

# User-added variables (devenv-add-env-vars, key updates) win over the above
if [ -f "${root}/.runtime/env-vars.user.sh" ]; then
    source "${root}/.runtime/env-vars.user.sh"
fi
`;

writeFileSync(out, content);
// Sourced, never executed, and it accumulates secrets (tokens, auth keys):
// owner-only, not executable.
chmodSync(out, 0o600);
console.log(`env-vars: wrote ${out}`);
