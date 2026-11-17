// The logging section of the tooling standards stays in step with the logging
// library it documents: levels, usage guidance, the verbose switch, output
// stream, examples, and the bootstrap-only bash logger that survives.
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))));
const DOC = readFileSync(join(ROOT, "docs", "Tooling-Standards.md"), "utf8");
const LOGGING_TS = join(ROOT, "tools/lib/core/logging.ts");
const ERROR_HANDLING_BASH = join(ROOT, "tools/lib/error-handling.bash");

const LOG_FUNCTIONS = ["logDebug", "logInfo", "logSuccess", "logWarn", "logError", "logFatal"];

// The text of the "Logging and error handling" section only, so a mention
// elsewhere in the document cannot satisfy a check.
function loggingSection(): string {
  const start = DOC.indexOf("\n## Logging and error handling");
  expect(start).toBeGreaterThanOrEqual(0);
  const rest = DOC.slice(start + 1);
  const next = rest.indexOf("\n## ", 1);
  return next === -1 ? rest : rest.slice(0, next);
}

describe("logging documentation", () => {
  it("has a logging and error handling section", () => {
    expect(DOC).toMatch(/^## Logging and error handling$/m);
  });

  it("documents every log level function", () => {
    const section = loggingSection();
    for (const fn of LOG_FUNCTIONS) expect(section).toContain(`\`${fn}\``);
  });

  it("documents only log functions the library exports", () => {
    const source = readFileSync(LOGGING_TS, "utf8");
    for (const fn of LOG_FUNCTIONS) expect(source).toMatch(new RegExp(`export (const|function) ${fn}\\b`));
  });

  it("names the logging library", () => {
    expect(loggingSection()).toContain("tools/lib/core/logging.ts");
  });

  it("explains how debug output is switched on", () => {
    expect(loggingSection()).toMatch(/-V\/--verbose/);
  });

  it("states the output stream and format", () => {
    expect(loggingSection()).toMatch(/stderr/);
    expect(loggingSection()).toMatch(/\[YYYY-MM-DD HH:MM:SS\] LEVEL: message/);
  });

  it("includes a TypeScript code example", () => {
    expect(loggingSection()).toMatch(/```ts\n[\s\S]*?logInfo\(/);
  });

  it("includes usage conventions", () => {
    expect(loggingSection()).toMatch(/^Conventions:$/m);
  });

  it("keeps the bootstrap bash logger described as the surviving bash layer", () => {
    expect(DOC).toMatch(/error-handling\.bash/);
  });

  it("the bootstrap bash logger exists and defines the four log functions", () => {
    expect(existsSync(ERROR_HANDLING_BASH)).toBe(true);
    const source = readFileSync(ERROR_HANDLING_BASH, "utf8");
    for (const fn of ["log_debug", "log_info", "log_warn", "log_error"]) {
      expect(source).toMatch(new RegExp(`^${fn}\\(\\)|^function ${fn}\\b`, "m"));
    }
  });
});
