// attribution-patterns.ts — the shared matcher that rejects AI attribution in
// commit messages and in PR/issue bodies. The workspace attributes every change
// to the human who owns it, with no carve-outs; this is the one pattern list
// the commit wrapper, the commit-msg hook, CI and the body-posting tools use.
//
// Two line shapes are attribution, both anchored to the start of a line so text
// that merely discusses attribution passes:
//   trailer  Co-Authored-By: Claude <noreply@anthropic.com>
//   footer   🤖 Generated with [Claude Code](https://claude.com/claude-code)
// A trailer needs a known key at column 0 and an AI identity in its value, so a
// human co-author passes. A footer must start (after any emoji or punctuation)
// with a "generated with/by" phrase followed by an AI identity.
//
// Lines inside fenced code blocks, indented code, block quotes and inline code
// never match: quote an example to discuss it. Identities match case-
// insensitively on word boundaries ("Claudia" is not "claude"); a fork adds its
// own through `extraIdentities`.
//
// Strip-only compatible: no parameter properties, enums, or namespaces.

export const TRAILER_KEYS = ["co-authored-by", "generated-by", "assisted-by", "authored-by", "created-by"] as const;

export const AI_IDENTITIES = [
  "claude",
  "anthropic",
  "copilot",
  "chatgpt",
  "openai",
  "codex",
  "gemini",
  "cursor",
  "aider",
  "devin",
  "windsurf",
] as const;

export type AttributionRule = "trailer" | "footer";

export interface AttributionHit {
  /** 1-based line number. */
  line: number;
  rule: AttributionRule;
  /** The offending line, trimmed. */
  text: string;
}

export interface AttributionOptions {
  /** Identities added to the defaults, matched like the defaults. */
  extraIdentities?: readonly string[];
}

const FOOTER_VERBS = "generated|created|made|written|authored|assisted";
const FENCE = /^ {0,3}(`{3,}|~{3,})/;
const INDENTED_CODE = /^(?: {4}|\t)/;
const BLOCK_QUOTE = /^\s*>/;

const escapeRegExp = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function identityPattern(extra: readonly string[]): string {
  const all = [...AI_IDENTITIES, ...extra.map((e) => e.trim()).filter((e) => e !== "")];
  return `(?<![\\p{L}\\p{N}])(?:${all.map(escapeRegExp).join("|")})(?![\\p{L}\\p{N}])`;
}

export function findAttribution(text: string, options: AttributionOptions = {}): AttributionHit[] {
  const ident = identityPattern(options.extraIdentities ?? []);
  const identity = new RegExp(ident, "iu");
  const trailer = new RegExp(`^(?:${TRAILER_KEYS.join("|")})\\s*:\\s*(.*)$`, "iu");
  const footer = new RegExp(
    `^[^\\p{L}\\p{N}\`>]*(?:${FOOTER_VERBS})\\s+(?:with|by|using)\\s+(?:the\\s+)?(?:github\\s+)?\\[?${ident}`,
    "iu",
  );

  const hits: AttributionHit[] = [];
  const lines = text.split(/\r?\n/);
  let fence: string | null = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] as string;
    const fenceMatch = FENCE.exec(line);
    if (fence !== null) {
      if (fenceMatch !== null && (fenceMatch[1] as string).startsWith(fence.charAt(0))) fence = null;
      continue;
    }
    if (fenceMatch !== null) {
      fence = fenceMatch[1] as string;
      continue;
    }
    if (INDENTED_CODE.test(line) || BLOCK_QUOTE.test(line)) continue;

    const t = trailer.exec(line);
    if (t !== null && identity.test(t[1] as string)) {
      hits.push({ line: i + 1, rule: "trailer", text: line.trim() });
    } else if (footer.test(line)) {
      hits.push({ line: i + 1, rule: "footer", text: line.trim() });
    }
  }
  return hits;
}

/** Instruction-style rejection text: what was found, what to do. Empty when there are no hits. */
export function attributionRejection(hits: readonly AttributionHit[], subject: string): string {
  if (hits.length === 0) return "";
  const lines = hits.map((h) => `  line ${h.line}: ${h.text}`);
  return [
    `AI attribution is not allowed in a ${subject}; every change is attributed to the human who owns it.`,
    "Remove these lines and submit again:",
    ...lines,
    "To discuss attribution in the text, put the example in a code span or fenced block.",
  ].join("\n");
}
