// logging.ts — leveled logging (port of error-handling.bash log functions).
// Output format is preserved verbatim: "[YYYY-MM-DD HH:MM:SS] LEVEL: message"
// on stderr, level right-padded to 5 chars. Colors mirror the bash palette
// and stay off when not a TTY (NO_COLOR honored).
import { EOL } from "node:os";

export const LOG_LEVEL_DEBUG = 0;
export const LOG_LEVEL_INFO = 1;
export const LOG_LEVEL_WARN = 2;
export const LOG_LEVEL_ERROR = 3;
export const LOG_LEVEL_FATAL = 4;

export type LogLevel = "DEBUG" | "INFO" | "SUCCESS" | "WARN" | "ERROR" | "FATAL";

const LEVEL_NUM: Record<LogLevel, number> = {
  DEBUG: LOG_LEVEL_DEBUG,
  INFO: LOG_LEVEL_INFO,
  SUCCESS: LOG_LEVEL_INFO,
  WARN: LOG_LEVEL_WARN,
  ERROR: LOG_LEVEL_ERROR,
  FATAL: LOG_LEVEL_FATAL,
};

const COLOR_RESET = "\u001B[0m";
const COLORS: Record<LogLevel, string> = {
  DEBUG: "\u001B[0;90m",
  INFO: "\u001B[0;34m",
  SUCCESS: "\u001B[0;32m",
  WARN: "\u001B[0;33m",
  ERROR: "\u001B[0;31m",
  FATAL: "\u001B[0;31m",
};

/** Mutable threshold (bash: ERROR_HANDLING_LOG_LEVEL). */
let threshold = LOG_LEVEL_INFO;

export function setLogLevel(level: number): void {
  threshold = level;
}

function useColors(): boolean {
  // Parity with error-handling.bash: only NO_COLOR=1 disables; other values
  // (e.g. NO_COLOR=0) keep color, matching the bash original's check.
  if (process.env["NO_COLOR"] === "1") return false;
  return process.stderr.isTTY === true;
}

function timestamp(): string {
  const now = new Date();
  const p = (n: number, w = 2): string => String(n).padStart(w, "0");
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())} ` +
    `${p(now.getHours())}:${p(now.getMinutes())}:${p(now.getSeconds())}`;
}

export function logMessage(level: LogLevel, ...parts: unknown[]): void {
  if (LEVEL_NUM[level] < threshold) return;
  const message = parts.map((p) => String(p)).join(" ");
  let color = "";
  let reset = "";
  if (useColors()) {
    color = COLORS[level];
    reset = COLOR_RESET;
  }
  process.stderr.write(
    `${color}[${timestamp()}] ${level.padEnd(5)}: ${message}${reset}${EOL}`,
  );
}

export const logDebug = (...p: unknown[]): void => logMessage("DEBUG", ...p);
export const logInfo = (...p: unknown[]): void => logMessage("INFO", ...p);
export const logWarn = (...p: unknown[]): void => logMessage("WARN", ...p);
export const logError = (...p: unknown[]): void => logMessage("ERROR", ...p);
export const logFatal = (...p: unknown[]): void => logMessage("FATAL", ...p);
export const logSuccess = (...p: unknown[]): void => logMessage("SUCCESS", ...p);
/** Legacy alias some bash libs used; preserved for translation parity. */
export const errorMsg = logError;
