// Behavioral tests for core/boundary: format validators and filesystem
// predicates against real files/directories (the node-type contract — a
// file must not pass a directory check — is pinned here).
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  validateAlphanumeric,
  validateBranchName,
  validateChoice,
  validateCommitHash,
  validateEmail,
  validateInteger,
  validateNotEmpty,
  validatePositiveInteger,
  validateSemver,
  validateSlug,
  validateStringLength,
  validateUrl,
  directoryExists,
  directoryReadable,
  directoryWritable,
  fileExists,
} from "../../lib/core/boundary.ts";

describe("format validators", () => {
  it("notEmpty rejects only the empty string", () => {
    expect(validateNotEmpty("x").ok).toBe(true);
    expect(validateNotEmpty("", "name").ok).toBe(false);
  });

  it("stringLength honors min and max", () => {
    expect(validateStringLength("abc", 2, 5).ok).toBe(true);
    expect(validateStringLength("a", 2).ok).toBe(false);
    expect(validateStringLength("abcdef", 2, 5).ok).toBe(false);
  });

  it("alphanumeric/slug/email reject malformed input", () => {
    expect(validateAlphanumeric("a1").ok).toBe(true);
    expect(validateAlphanumeric("a-1").ok).toBe(false);
    expect(validateSlug("good-slug").ok).toBe(true);
    expect(validateSlug("Bad").ok).toBe(false);
    expect(validateEmail("a@b.co").ok).toBe(true);
    expect(validateEmail("nope").ok).toBe(false);
  });

  it("url accepts http(s) only", () => {
    expect(validateUrl("https://x.example").ok).toBe(true);
    expect(validateUrl("ftp://x.example").ok).toBe(false);
    expect(validateUrl("not a url").ok).toBe(false);
  });

  it("integer variants and choice", () => {
    expect(validateInteger("-3").ok).toBe(true);
    expect(validateInteger("1.5").ok).toBe(false);
    expect(validatePositiveInteger("0").ok).toBe(false);
    expect(validatePositiveInteger("3").ok).toBe(true);
    expect(validateChoice("b", ["a", "b"]).ok).toBe(true);
    expect(validateChoice("c", ["a", "b"]).ok).toBe(false);
  });

  it("branchName enforces the git check-ref-format subset", () => {
    for (const good of ["main", "feature/x", "release-1.4"]) {
      expect(validateBranchName(good).ok).toBe(true);
    }
    for (const bad of ["/lead", "trail/", "..", "a b", "x~1", "a@{0", "a//b"]) {
      expect(validateBranchName(bad).ok).toBe(false);
    }
  });

  it("commitHash and semver pin their shapes", () => {
    expect(validateCommitHash("abcdef0").ok).toBe(true);
    expect(validateCommitHash("ABCDEF0").ok).toBe(false);
    expect(validateCommitHash("abc").ok).toBe(false);
    expect(validateSemver("1.2.3").ok).toBe(true);
    expect(validateSemver("1.2.3-rc.1").ok).toBe(true);
    expect(validateSemver("1.2").ok).toBe(false);
  });
});

describe("filesystem predicates (node type matters)", () => {
  let dir: string;
  let file: string;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "boundary-test-"));
    file = join(dir, "plain.txt");
    writeFileSync(file, "content");
    mkdirSync(join(dir, "subdir"));
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("directoryExists rejects a file; fileExists rejects a directory", () => {
    expect(directoryExists(dir)).toBe(true);
    expect(directoryExists(file)).toBe(false);
    expect(fileExists(file)).toBe(true);
    expect(fileExists(dir)).toBe(false);
  });

  it("missing paths are false, never throwing", () => {
    const missing = join(dir, "nope");
    expect(directoryExists(missing)).toBe(false);
    expect(fileExists(missing)).toBe(false);
    expect(directoryReadable(missing)).toBe(false);
    expect(directoryWritable(missing)).toBe(false);
  });

  it("readable/writable accept only directories", () => {
    expect(directoryReadable(dir)).toBe(true);
    expect(directoryWritable(dir)).toBe(true);
    expect(directoryReadable(file)).toBe(false);
    expect(directoryWritable(file)).toBe(false);
  });

  it("writable reflects permission bits", () => {
    const ro = join(dir, "ro");
    mkdirSync(ro);
    chmodSync(ro, 0o555);
    try {
      expect(directoryReadable(ro)).toBe(true);
      // root bypasses W_OK; only assert the denial when non-root.
      if (process.getuid?.() !== 0) {
        expect(directoryWritable(ro)).toBe(false);
      }
    } finally {
      chmodSync(ro, 0o755);
    }
  });
});
