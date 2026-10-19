// boundary.ts — input validation at tool boundaries (port of validation.bash).
//
// The bash library mixed two concerns: generic format checks (this module)
// and domain-specific validators (issue numbers, repo names, …) that live in
// their owning domain modules — those port with their domains, not here.
// Format checks return a typed result instead of bash's log-and-return-1 so
// callers can choose to log, exit, or collect.

import { accessSync, statSync, constants as fsConstants } from "node:fs";

/** A validation failure: what was wrong and the human-readable reason. */
export interface ValidationError {
  readonly field: string;
  readonly reason: string;
}

/** Successful validation narrows to the (trimmed) input. */
export type ValidationResult =
  | { ok: true; value: string }
  | { ok: false; error: ValidationError };

function pass(value: string): ValidationResult {
  return { ok: true, value };
}

function fail(field: string, reason: string): ValidationResult {
  return { ok: false, error: { field, reason } };
}

export function validateNotEmpty(input: string, field = "value"): ValidationResult {
  if (input === "") return fail(field, `${field} cannot be empty`);
  return pass(input);
}

export function validateStringLength(
  input: string,
  min: number,
  max?: number,
  field = "string",
): ValidationResult {
  if (input.length < min) {
    return fail(field, `${field} must be at least ${min} characters (got ${input.length})`);
  }
  if (max !== undefined && input.length > max) {
    return fail(field, `${field} must not exceed ${max} characters (got ${input.length})`);
  }
  return pass(input);
}

export function validateAlphanumeric(input: string, field = "value"): ValidationResult {
  if (!/^[a-zA-Z0-9]+$/.test(input)) {
    return fail(field, `${field} must be alphanumeric (got "${input}")`);
  }
  return pass(input);
}

export function validateSlug(input: string, field = "slug"): ValidationResult {
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(input)) {
    return fail(field, `${field} must be a lowercase hyphenated slug (got "${input}")`);
  }
  return pass(input);
}

export function validateEmail(input: string, field = "email"): ValidationResult {
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(input)) {
    return fail(field, `${field} must be a valid email address (got "${input}")`);
  }
  return pass(input);
}

export function validateUrl(input: string, field = "url"): ValidationResult {
  let parsed: URL;
  try {
    parsed = new URL(input);
  } catch {
    return fail(field, `${field} must be a valid URL (got "${input}")`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return fail(field, `${field} must be an http(s) URL (got "${input}")`);
  }
  return pass(input);
}

export function validateInteger(input: string, field = "value"): ValidationResult {
  if (!/^-?[0-9]+$/.test(input)) {
    return fail(field, `${field} must be an integer (got "${input}")`);
  }
  return pass(input);
}

export function validatePositiveInteger(input: string, field = "value"): ValidationResult {
  const r = validateInteger(input, field);
  if (!r.ok) return r;
  if (Number.parseInt(r.value, 10) <= 0) {
    return fail(field, `${field} must be a positive integer (got "${input}")`);
  }
  return pass(input);
}

export function validateChoice(input: string, choices: readonly string[], field = "value"): ValidationResult {
  if (!choices.includes(input)) {
    return fail(field, `${field} must be one of: ${choices.join(", ")} (got "${input}")`);
  }
  return pass(input);
}

export function validateBranchName(input: string, field = "branch"): ValidationResult {
  // git check-ref-format rules, practical subset: no leading/trailing dash or
  // slash, no whitespace, no "..", no "~^:?*[\\", no "@{", no "//".
  if (
    input === "" ||
    /^\//.test(input) || /\/$/.test(input) || /-($|\/)/.test(input) ||
    /\s/.test(input) || input.includes("..") || /[~^:?*[\\]/.test(input) ||
    input.includes("@{") || input.includes("//")
  ) {
    return fail(field, `${field} is not a valid branch name (got "${input}")`);
  }
  return pass(input);
}

export function validateCommitHash(input: string, field = "commit"): ValidationResult {
  if (!/^[0-9a-f]{7,40}$/.test(input)) {
    return fail(field, `${field} must be a git commit hash (7-40 hex chars, got "${input}")`);
  }
  return pass(input);
}

export function validateSemver(input: string, field = "version"): ValidationResult {
  if (!/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?$/.test(input)) {
    return fail(field, `${field} must be a semver string (major.minor.patch, got "${input}")`);
  }
  return pass(input);
}

// ---------------------------------------------------------------------------
// filesystem checks — predicates (boolean), mirroring the bash require-style
// callers that branch on existence rather than collect errors
// ---------------------------------------------------------------------------

export function fileExists(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

export function directoryExists(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

export function directoryReadable(path: string): boolean {
  try {
    if (!statSync(path).isDirectory()) return false;
    accessSync(path, fsConstants.R_OK);
    return true;
  } catch {
    return false;
  }
}

export function directoryWritable(path: string): boolean {
  try {
    if (!statSync(path).isDirectory()) return false;
    accessSync(path, fsConstants.W_OK);
    return true;
  } catch {
    return false;
  }
}
