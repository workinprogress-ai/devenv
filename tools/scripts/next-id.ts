// next-id — resolve the next free numeric identifier deterministically.
// Port of next-id.sh: filename mode (--pattern with {N}) and in-document
// mode (--file + --prefix scanning PREFIX-NNN tokens).

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { assertNodeFloor } from "../lib/core/node-floor.ts";
import { invalidArgs } from "../lib/core/args.ts";

assertNodeFloor();

function usage(): never {
  console.log(`Usage: next-id [OPTIONS]

Resolve the next free numeric identifier deterministically. Two modes:

Filename mode (one of --pattern):
    next-id --pattern 'Plan-issue-42-{N}.md' [--dir DIR] [--width W] [--filename]
    Scans DIR for files matching the pattern with {N} as a digit run,
    finds the highest existing number, prints the next one.

In-document mode (--file + --prefix):
    next-id --file Specifications-orders-001.md --prefix 'SPEC-'
    Scans the file for PREFIX-NNN tokens (zero-padded or not),
    finds the highest, prints the next number (--full prints PREFIX-NNN).

Options:
    --pattern GLOB               Filename pattern containing {N} (filename mode)
    --dir DIR                    Directory to scan (default: current directory)
    --width W                    Zero-pad width override (default: widest existing, min 1)
    --filename                   Print the full next filename instead of just the number
    --file FILE                  Document to scan (in-doc mode)
    --prefix PREFIX              ID prefix to scan for, e.g. 'SPEC-', 'Q-', 'ADR-', 'AC-'
    --full                       In-doc mode: print 'PREFIX<NNN>' instead of the bare number
    -V, --verbose                Enable verbose logs
    -h, --help                   Show help and exit
    -v, --version                Show version and exit

Output: the next number (zero-padded like existing entries), or the full
filename / PREFIX-NNN with --filename / --full.

Exit Codes:
    0 success
    2 invalid arguments`);
  process.exit(0);
}

const argv = process.argv.slice(2);
if (argv.includes("-h") || argv.includes("--help")) usage();
if (argv.includes("-v") || argv.includes("--version")) {
  console.log("1.0.0");
  process.exit(0);
}

let pattern = "";
let dir = ".";
let file = "";
let prefix = "";
let width = "";
let printFilename = false;
let full = false;

for (let i = 0; i < argv.length; i++) {
  const a = argv[i] as string;
  const val = (): string => {
    const v = argv[i + 1];
    if (v === undefined) invalidArgs(`Missing value for ${a}`);
    i++;
    return v as string;
  };
  if (a === "--pattern") pattern = val();
  else if (a === "--dir") dir = val();
  else if (a === "--width") width = val();
  else if (a === "--filename") printFilename = true;
  else if (a === "--file") file = val();
  else if (a === "--prefix") prefix = val();
  else if (a === "--full") full = true;
  else if (a === "-V" || a === "--verbose") { /* CLI consistency */ }
  else invalidArgs(`Unknown option: ${a}`);
}

if (pattern !== "" && (file !== "" || prefix !== "")) {
  invalidArgs("--pattern cannot be combined with --file/--prefix");
}
if (file !== "" && prefix === "") invalidArgs("--prefix is required with --file");
if (pattern === "" && file === "") {
  invalidArgs("Provide --pattern (filename mode) or --file + --prefix (in-doc mode)");
}

let maxNum = 0;
let maxWidth = 0;

if (pattern !== "") {
  if (!existsSync(dir) || !statSync(dir).isDirectory()) {
    invalidArgs(`Directory not found: ${dir}`);
  }
  const npos = pattern.indexOf("{N}");
  if (npos < 0 || npos >= pattern.length - 1) {
    invalidArgs("--pattern must contain the {N} placeholder");
  }
  const literalPrefix = pattern.slice(0, npos);
  const suffix = pattern.slice(npos + 3); // fixed part after {N}
  for (const entry of readdirSync(dir)) {
    if (!entry.startsWith(literalPrefix)) continue;
    const rest = entry.slice(literalPrefix.length);
    const m = rest.match(/^(\d+)/);
    const digits = m?.[1];
    if (!digits) continue;
    // The {N} digit run; whatever follows must match the pattern's suffix
    // (fixed tail, or a prefix of it when the pattern has a -* tail).
    const after = rest.slice(digits.length);
    if (suffix === "" || after.startsWith(suffix.replace(/\*.*$/, ""))) {
      const n = Number(digits);
      if (n > maxNum) maxNum = n;
      if (digits.length > maxWidth) maxWidth = digits.length;
    }
  }
} else {
  if (!existsSync(file)) invalidArgs(`File not found: ${file}`);
  const content = readFileSync(file, "utf8");
  const esc = prefix.replaceAll("+", "\\+");
  const re = new RegExp(`${esc}(\\d+)`, "g");
  const seen = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    if (seen.has(m[1] as string)) continue;
    seen.add(m[1] as string);
    const n = Number(m[1]);
    if (n > maxNum) maxNum = n;
    if ((m[1] as string).length > maxWidth) maxWidth = (m[1] as string).length;
  }
}

const next = maxNum + 1;
const padWidth = width !== "" ? Number(width) : maxWidth > 0 ? maxWidth : 1;
const padded = String(next).padStart(padWidth, "0");

if (pattern !== "") {
  console.log(printFilename ? pattern.replace("{N}", padded) : padded);
} else {
  console.log(full ? `${prefix}${padded}` : padded);
}
