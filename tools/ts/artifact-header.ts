// artifact-header — parse, verify, and stamp DEVENV_ARTIFACT_V1 headers.
// Built over lib/domain/artifacts.ts's
// parseHeaderJson. Modes: default (print header JSON), --field, --stamp,
// --set KEY=VALUE (repeatable; inserts missing keys before the closing -->).

import { readFileSync, writeFileSync, renameSync, existsSync } from "node:fs";
import { assertNodeFloor } from "../lib/core/node-floor.ts";
import { errorMessage } from "../lib/core/logging.ts";
import { EXIT_API_FAILURE, EXIT_MISUSE } from "../lib/core/exit-codes.ts";
import { logError } from "../lib/core/logging.ts";
import { toolCli, usageCommonFlags } from "../lib/core/cli.ts";
import { invalidArgs } from "../lib/core/args.ts";
import { parseHeaderJson, headerField, headerSpan, HEADER_KEY_LINE } from "../lib/domain/artifacts.ts";

assertNodeFloor();

const SCRIPT_VERSION = "1.0.0";

function usage(): never {
  console.log(`Usage: artifact-header FILE [OPTIONS]

Read, verify, or update the DEVENV_ARTIFACT_V1 metadata block at the top of
a local artifact file. Without options, prints the parsed header as JSON.

Arguments:
    FILE                         Artifact file to inspect/update

Options:
    --field NAME                 Print the raw value of one header key (exit 1 if absent)
    --stamp                      Rewrite updated_at_utc to the current UTC time
                                 (inserts the line if the block lacks it)
    --set KEY=VALUE              Set/replace one header key (repeatable)
${usageCommonFlags({ noDryRun: true, noDevenv: true })}

Output:
    JSON object: {"found": true, "header": {<parsed key/value pairs>}}
    or {"found": false} (exit 1) when no DEVENV_ARTIFACT_V1 block is present.

Exit Codes:
    0 success
    1 no artifact header found / requested field absent
    2 invalid arguments
    4 I/O failure`);
  process.exit(0);
}

let file = "";
let field = "";
let stamp = false;
const sets: string[] = [];

try {
  const cli = toolCli({
    name: "artifact-header",
    version: SCRIPT_VERSION,
    argv: process.argv.slice(2),
    noDryRun: true,
    options: {
      field: { type: "string" },
      stamp: { type: "boolean", default: false },
      set: { type: "string", multiple: true },
    },
  });
  if (cli.common.help) usage();
  file = cli.positionals[0] ?? "";
  field = (cli.values["field"] as string | undefined) ?? "";
  stamp = cli.values["stamp"] === true;
  sets.push(...((cli.values["set"] as string[] | undefined) ?? []));
} catch (err) {
  logError(errorMessage(err));
  console.error("Use --help for usage information");
  process.exit(EXIT_MISUSE);
}

if (file === "") invalidArgs("FILE is required");
if (!existsSync(file)) invalidArgs(`File not found: ${file}`);

let body: string;
try {
  body = readFileSync(file, "utf8");
} catch (err) {
  logError(`Failed to read ${file}: ${errorMessage(err)}`);
  process.exit(EXIT_API_FAILURE);
}

const header = parseHeaderJson(body);
if (header === null || Object.keys(header).length === 0) {
  console.log('{"found": false}');
  process.exit(1);
}

// Read-only single-field mode.
if (field !== "" && !stamp && sets.length === 0) {
  const value = header[field];
  if (value === undefined || value === "") {
    logError(`Field not found in artifact header: ${field}`);
    process.exit(1);
  }
  console.log(value);
  process.exit(0);
}

if (stamp || sets.length > 0) {
  const now = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
  const rewrite = new Map<string, string>();
  for (const kv of sets) {
    const eq = kv.indexOf("=");
    if (eq <= 0) invalidArgs(`--set expects KEY=VALUE, got: ${kv}`);
    rewrite.set(kv.slice(0, eq), kv.slice(eq + 1));
  }
  if (stamp) rewrite.set("updated_at_utc", now);

  // The writer edits exactly the span the reader parses (headerSpan), so a
  // key it rewrites or inserts is a key the reader sees, and a body line
  // outside the span is never touched.
  //  - A key inside the span is replaced in place (indent kept); a key line
  //    carrying the inline closer keeps its ` -->`.
  //  - A missing key goes on its own line before the closing line. For a block
  //    closed inline on its last key line, new keys go before that line, so
  //    the existing line stays byte-identical and the comment stays closed.
  //    An unclosed block grows at the end of its leading key run.
  const span = headerSpan(body);
  if (span === null) {
    logError("No DEVENV_ARTIFACT_V1 header span to update");
    process.exit(1);
  }
  const lines = body.split("\n");
  const edited = lines.slice();
  const seen = new Set<string>();
  for (let i = span.firstLine; i < span.endLine; i++) {
    const raw = lines[i] ?? "";
    const cr = raw.endsWith("\r") ? "\r" : "";
    const line = cr === "" ? raw : raw.slice(0, -1);
    const key = line.match(HEADER_KEY_LINE)?.[1];
    if (key === undefined || !rewrite.has(key)) continue;
    seen.add(key);
    const indent = line.match(/^[ \t]*/)?.[0] ?? "";
    const inlineCloser = span.closerKind === "inline" && i === span.closerLine ? " -->" : "";
    edited[i] = `${indent}${key}: ${rewrite.get(key)}${inlineCloser}${cr}`;
  }
  const insertAt = span.closerKind === "inline" ? (span.closerLine ?? span.endLine) : span.endLine;
  const eolSource = span.closerKind === null ? span.endLine - 1 : insertAt;
  const insertEol = (lines[eolSource] ?? "").endsWith("\r") ? "\r" : "";
  const missing = [...rewrite].filter(([k]) => !seen.has(k)).map(([k, v]) => `${k}: ${v}${insertEol}`);
  edited.splice(insertAt, 0, ...missing);
  const updated = edited.join("\n");
  for (const [k, v] of rewrite) {
    if (headerField(updated, k) !== v.trim()) {
      logError(`Could not set header key '${k}': the value would not read back from the header block`);
      process.exit(EXIT_API_FAILURE);
    }
  }
  const tmp = `${file}.tmp-${process.pid}`;
  writeFileSync(tmp, updated);
  renameSync(tmp, file);
}

// Report the (possibly updated) header.
const after = parseHeaderJson(readFileSync(file, "utf8"));
if (after === null || Object.keys(after).length === 0) {
  logError("Header lost after rewrite — this is a bug");
  process.exit(EXIT_API_FAILURE);
}
console.log(JSON.stringify({ found: true, header: after }));
