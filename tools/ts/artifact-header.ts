// artifact-header — parse, verify, and stamp DEVENV_ARTIFACT_V1 headers.
// Port of artifact-header.sh over lib/domain/artifacts.ts's byte-faithful
// parseHeaderJson. Modes: default (print header JSON), --field, --stamp,
// --set KEY=VALUE (repeatable; inserts missing keys before the closing -->).

import { readFileSync, writeFileSync, renameSync, existsSync } from "node:fs";
import { assertNodeFloor } from "../lib/core/node-floor.ts";
import { invalidArgs } from "../lib/core/args.ts";
import { logError } from "../lib/core/logging.ts";
import { parseHeaderJson } from "../lib/domain/artifacts.ts";

assertNodeFloor();

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
    -V, --verbose                Enable verbose logs
    -h, --help                   Show help and exit
    -v, --version                Show version and exit

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

const argv = process.argv.slice(2);
if (argv.includes("-h") || argv.includes("--help")) usage();
if (argv.includes("-v") || argv.includes("--version")) {
  console.log("1.0.0");
  process.exit(0);
}

let file = "";
let field = "";
let stamp = false;
const sets: string[] = [];

for (let i = 0; i < argv.length; i++) {
  const a = argv[i] as string;
  if (a === "--field") {
    const v = argv[i + 1];
    if (v === undefined) invalidArgs("Missing value for --field");
    field = v as string;
    i++;
  } else if (a === "--stamp") {
    stamp = true;
  } else if (a === "--set") {
    const v = argv[i + 1];
    if (v === undefined) invalidArgs("Missing value for --set (KEY=VALUE)");
    sets.push(v as string);
    i++;
  } else if (a === "-V" || a === "--verbose") {
    // accepted for CLI consistency
  } else {
    file = a;
  }
}

if (file === "") invalidArgs("FILE is required");
if (!existsSync(file)) invalidArgs(`File not found: ${file}`);

let body: string;
try {
  body = readFileSync(file, "utf8");
} catch (err) {
  logError(`Failed to read ${file}: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(4);
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

  const lines = body.split("\n");
  const out: string[] = [];
  let inBlock = false;
  const seen = new Set<string>();
  for (const line of lines) {
    if (line.includes("DEVENV_ARTIFACT_V1")) {
      inBlock = true;
      out.push(line);
      continue;
    }
    if (inBlock && /^-->/.test(line)) {
      for (const [k, v] of rewrite) {
        if (!seen.has(k)) out.push(`${k}: ${v}`);
      }
      out.push(line);
      inBlock = false;
      continue;
    }
    if (inBlock && /^[ \t]*[A-Za-z_]+[ \t]*:/.test(line)) {
      const indent = line.match(/^[ \t]*/)?.[0] ?? "";
      const key = line.trim().replace(/:.*/, "");
      if (rewrite.has(key)) {
        seen.add(key);
        out.push(`${indent}${key}: ${rewrite.get(key)}`);
        continue;
      }
    }
    out.push(line);
  }
  const tmp = `${file}.tmp-${process.pid}`;
  writeFileSync(tmp, out.join("\n"));
  renameSync(tmp, file);
}

// Report the (possibly updated) header.
const after = parseHeaderJson(readFileSync(file, "utf8"));
if (after === null || Object.keys(after).length === 0) {
  logError("Header lost after rewrite — this is a bug");
  process.exit(4);
}
console.log(JSON.stringify({ found: true, header: after }));
