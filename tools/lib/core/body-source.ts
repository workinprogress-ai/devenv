// body-source.ts — shared markdown body-source resolution for tools (port
// of body-source.bash's resolve contract).
//
// One implementation of body-source semantics for tools that ingest
// markdown: --body TEXT, --body-file FILE, --body-file - (stdin), piped
// stdin auto-read, and the interactive-request fallback. The resolver is
// synchronous: stdin legs are read with readFileSync(0) after a TTY check,
// never a blocking stream pump.
//
// Precedence (the bash contract's decision D1, unchanged):
//   1. body text        -> text
//   2. body file        -> file ('-' means stdin)
//   3. no flags, stdin piped -> stdin (auto-read; never a TTY here)
//   4. no flags, stdin is a TTY -> interactive (caller offers its picker)
//
// Empty policy (uniform, including the '- leg' — the historical drift this
// port exists to close): empty body text, empty/whitespace-only stdin,
// and a missing file are named errors, never silent empty bodies. An empty
// body is never valid; silence is how caller bugs hide.
//
// Error contract: the resolver never exits and never logs; it returns a
// typed error so each tool maps codes to its own exit code and message
// wording (the per-tool observable contract stays caller-owned).
//
// Strip-only compatible: no parameter properties, enums, or namespaces.

import { readFileSync, existsSync, statSync } from "node:fs";

/** Error codes the resolver can return. Stable contract: tools switch on
 * these to preserve their historical exit codes and message wording. */
export type BodySourceErrorCode =
  | "multiple-sources" // both --body and --body-file given
  | "empty-body" // --body given but blank
  | "empty-stdin" // stdin leg: empty, whitespace-only, or closed pipe
  | "stdin-tty-refused" // --body-file - with no piped stdin
  | "file-not-found" // --body-file path missing (or not a regular file)
  | "file-read-failed"; // the file existed but could not be read

export interface BodySourceError {
  readonly code: BodySourceErrorCode;
  readonly message: string;
}

/** How the body was obtained — callers use `source` to decide whether an
 * interactive picker is theirs to offer (the `interactive` outcome hands
 * control back; the resolver never blocks on a TTY). */
export type BodySourceOutcome =
  | { ok: true; source: "text" | "file" | "stdin" | "interactive"; body: string }
  | { ok: false; error: BodySourceError };

function stdinIsTty(): boolean {
  return Boolean(process.stdin.isTTY);
}

function readStdinSync(): string {
  try {
    return readFileSync(0, "utf8");
  } catch {
    // A closed or unreadable stdin (fd 0 redirected to a dead pipe) reads
    // as empty — the empty-stdin refusal owns the error.
    return "";
  }
}

function isBlank(text: string): boolean {
  return text.replace(/\s/g, "") === "";
}

/** The one stdin capture: reads fd 0 fully (the caller has TTY-checked),
 * refuses blank streams. Used by both the '-' leg and the piped auto-read
 * leg so the two can never drift again — the original drift this module
 * exists to close. */
function captureStdin(): BodySourceOutcome {
  const content = readStdinSync();
  if (isBlank(content)) {
    return {
      ok: false,
      error: {
        code: "empty-stdin",
        message: "Refusing empty stdin body (pipe content or use --body/--body-file)",
      },
    };
  }
  return { ok: true, source: "stdin", body: content };
}

/**
 * Resolve the body from the given flag values plus the ambient stdin state.
 * Never exits, never logs, never blocks: TTY checks precede every read, and
 * stdin is consumed exactly once on the stdin outcomes.
 */
export function resolveBodySource(opts: {
  text?: string | undefined;
  file?: string | undefined;
}): BodySourceOutcome {
  const text = opts.text;
  const file = opts.file;

  if (text !== undefined && text !== "" && file !== undefined && file !== "") {
    return {
      ok: false,
      error: { code: "multiple-sources", message: "Only one body source may be specified" },
    };
  }

  if (text !== undefined && text !== "") {
    // A blank --body is an explicit empty body — same refusal as empty
    // stdin (an empty body is never valid).
    if (isBlank(text)) {
      return {
        ok: false,
        error: { code: "empty-body", message: "Refusing empty --body" },
      };
    }
    return { ok: true, source: "text", body: text };
  }

  if (file !== undefined && file !== "") {
    if (file === "-") {
      if (stdinIsTty()) {
        return {
          ok: false,
          error: {
            code: "stdin-tty-refused",
            message: "--body-file - requires piped stdin (refusing to read the terminal)",
          },
        };
      }
      return captureStdin();
    }
    if (!existsSync(file) || !statSync(file).isFile()) {
      return {
        ok: false,
        error: { code: "file-not-found", message: `File not found: ${file}` },
      };
    }
    try {
      return { ok: true, source: "file", body: readFileSync(file, "utf8") };
    } catch (err) {
      return {
        ok: false,
        error: {
          code: "file-read-failed",
          message: `Could not read ${file}: ${err instanceof Error ? err.message : String(err)}`,
        },
      };
    }
  }

  // No flags: piped stdin auto-reads; a TTY hands control to the caller's
  // interactive picker (the resolver never blocks on a terminal).
  if (!stdinIsTty()) {
    return captureStdin();
  }
  return { ok: true, source: "interactive", body: "" };
}
