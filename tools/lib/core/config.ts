// config.ts — the one INI reader for devenv.config (port of config-reader.bash).
//
// Rules, identical on every path (behavioral contract carried from bash):
//   - a section header and a key are matched exactly, never as a prefix or pattern
//   - spaces/tabs around headers, keys and values are ignored, as are a trailing
//     CR (CRLF files), blank lines and full-line comments (# or ;)
//   - a value is everything after the first "=", so it may contain "="
//   - a key present twice reads as its last occurrence
//   - a key present but empty reads the same as an absent key: the caller's
//     default is returned
//   - token variables (${PROVIDER_ORG}/${PROVIDER_USER}) are expanded only by
//     the explicit expanding read; raw reads never expand, so provider identity
//     resolution cannot re-enter itself

import { existsSync, readFileSync } from "node:fs";

export interface ConfigReadOptions {
  /** Expand ${PROVIDER_ORG}/${PROVIDER_USER} via the given resolver functions. */
  expand?: {
    org: () => string;
    user: () => string;
  };
  /** Warn on stderr when a key appears more than once (expanding read default). */
  warnDuplicates?: boolean;
}

interface ScanResult {
  found: boolean;
  value: string;
}

/** The scanner every reader shares: SECTION/KEY in FILE, last occurrence wins. */
function scan(file: string, section: string, key: string, warnDuplicates: boolean): ScanResult {
  const lines = readFileSync(file, "utf8").split("\n");
  let inSection = false;
  let seen = 0;
  let value = "";

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!.replace(/\r$/, "").replace(/^[ \t]+|[ \t]+$/g, "");
    const header = line.match(/^\[([^[\]]*)\]/);
    if (header) {
      // anything after the closing bracket (a trailing comment) is ignored
      const name = header[1]!.trim();
      inSection = name === section;
      continue;
    }
    if (!inSection || line === "" || /^[#;]/.test(line)) continue;
    const idx = line.indexOf("=");
    if (idx === 0 || idx === -1) continue;
    const k = line.slice(0, idx).replace(/[ \t]+$/, "");
    if (k !== key) continue;
    const v = line.slice(idx + 1).replace(/^[ \t]+/, "");
    if (seen++ > 0 && warnDuplicates) {
      process.stderr.write(
        `WARNING: duplicate key ${section}.${key} in ${file} (line ${i + 1}) — using last value\n`,
      );
    }
    value = v;
  }
  return { found: seen > 0, value };
}

/**
 * Expand template tokens in a value over the ORIGINAL value only: a token
 * spelling arriving inside a resolved value is neutralized with a sentinel no
 * later pass matches, so sequential replaces cannot re-expand substituted
 * content (contract carried verbatim from the bash implementation).
 */
export function expandTokens(
  value: string,
  resolve: { org: () => string; user: () => string },
): string {
  const sentinel = "\x01";
  const neutralize = (s: string) => s.replaceAll("${", `${sentinel}{`);
  const org = neutralize(resolve.org() ?? "");
  const user = neutralize(resolve.user() ?? "");
  return value
    .replaceAll("${PROVIDER_ORG}", org)
    .replaceAll("${PROVIDER_USER}", user)
    .replaceAll(sentinel, "$");
}

/** Read a literal value from FILE (no expansion). `undefined` when absent key. */
export function configGetRaw(
  file: string,
  section: string,
  key: string,
): string | undefined {
  if (!fileExists(file)) return undefined;
  return scan(file, section, key, false).value;
}

/**
 * Read a value with ${PROVIDER_ORG}/${PROVIDER_USER} expanded. Duplicate keys
 * warn on stderr. `undefined` when the file does not exist; `null` is never
 * returned — an absent/empty key yields the caller's default at the call site.
 */
export function configGet(
  file: string,
  section: string,
  key: string,
  resolve?: ConfigReadOptions["expand"],
): string | undefined {
  if (!fileExists(file)) return undefined;
  const { found, value } = scan(file, section, key, true);
  if (!found) return undefined;
  if (resolve) return expandTokens(value, resolve);
  return value;
}

/**
 * Read a comma-separated value as a trimmed string array. Empty/absent keys
 * yield an empty array (bash callers treated empty as "not configured").
 */
export function configGetArray(
  file: string,
  section: string,
  key: string,
  resolve?: ConfigReadOptions["expand"],
): string[] {
  const value = configGet(file, section, key, resolve) ?? "";
  if (value === "") return [];
  return value
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s !== "");
}

/** List all keys in a section, in file order. */
export function configListSection(file: string, section: string): string[] {
  return sectionLines(file, section).map((kv) => kv.key);
}

/** Dump a section as ordered key/value pairs (for debugging). */
export function configDumpSection(
  file: string,
  section: string,
): Array<{ key: string; value: string }> {
  return sectionLines(file, section);
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function fileExists(file: string): boolean {
  return existsSync(file);
}

function sectionLines(
  file: string,
  section: string,
): Array<{ key: string; value: string }> {
  const out: Array<{ key: string; value: string }> = [];
  if (!fileExists(file)) return out;
  const lines = readFileSync(file, "utf8").split("\n");
  let inSection = false;
  for (const raw of lines) {
    const line = raw.replace(/\r$/, "").replace(/^[ \t]+|[ \t]+$/g, "");
    const header = line.match(/^\[([^[\]]*)\]/);
    if (header) {
      inSection = header[1]!.trim() === section;
      continue;
    }
    if (!inSection || line === "" || /^[#;]/.test(line)) continue;
    const idx = line.indexOf("=");
    if (idx <= 0) continue;
    out.push({
      key: line.slice(0, idx).replace(/[ \t]+$/, ""),
      value: line.slice(idx + 1).replace(/^[ \t]+/, ""),
    });
  }
  return out;
}
