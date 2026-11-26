// attribution-patterns.ts — the shared matcher that rejects AI attribution in
// commit messages and in PR/issue bodies. The workspace attributes every change
// to the human who owns it; this is the one pattern list the commit wrapper, the
// commit-msg hook, CI and the body-posting tools use. The match is best-effort:
// it catches the shapes AI tools actually write, not every disguise.
//
// Two line shapes are attribution, both anchored to the start of a line so text
// that merely discusses attribution passes:
//   trailer  Co-Authored-By: Claude <noreply@anthropic.com>
//   footer   🤖 Generated with [Claude Code](https://claude.com/claude-code)
// A trailer needs a known key at column 0 (markdown emphasis around it is
// tolerated) and a value that names an AI. A footer must start, after any emoji
// or punctuation, with a "generated with/by" phrase followed by a name that
// names an AI.
//
// Whether a name "names an AI" is decided on the name part only (the text
// outside <addresses> and (parentheses)), so a human is not flagged for where
// they work or what their address contains:
//   - an identity that is not also a person's name (copilot, chatgpt, ...)
//     matches anywhere in the name;
//   - an identity that is also a person's name (claude, devin, gemini, ...)
//     matches only when the whole name is that identity plus qualifier words
//     such as "Code", "Agent" or a version ("Claude Sonnet 5.5", "Cursor Agent");
//   - an address on an AI vendor's domain matches whatever the name says.
//
// Lines inside fenced code blocks, indented code, block quotes and inline code
// never match: quote an example to discuss it. A fence counts only when a
// matching closing fence follows, so a stray opener cannot hide the rest of a
// text. Invisible format characters are ignored. A fork adds identities through
// `extraIdentities`, matched anywhere in the name like the unambiguous ones.
//
// Strip-only compatible: no parameter properties, enums, or namespaces.

export const TRAILER_KEYS = ["co-authored-by", "generated-by", "assisted-by", "authored-by", "created-by", "signed-off-by"] as const;

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
  "gpt",
] as const;

/** Identities that are also people's names: matched only as a whole name plus qualifiers. */
export const AMBIGUOUS_IDENTITIES = ["claude", "codex", "gemini", "cursor", "aider", "devin"] as const;

/** An address on one of these domains (or a subdomain) is an AI vendor's, whatever the name says. */
export const AI_EMAIL_DOMAINS = ["anthropic.com", "openai.com", "cursor.com"] as const;

export type AttributionRule = "trailer" | "footer";

export interface AttributionHit {
  /** 1-based line number. */
  line: number;
  rule: AttributionRule;
  /** The offending line, trimmed. */
  text: string;
}

export interface AttributionOptions {
  /** Identities added to the defaults, matched anywhere in the name. */
  extraIdentities?: readonly string[];
}

const FOOTER_VERBS = "generated|created|made|written|authored|assisted";
const QUALIFIERS = "code|agent|bot|ai|cli|assistant|sonnet|opus|haiku|fable|instant|pro|ultra|flash|nano|mini|v?\\d[\\d.]*";
const FENCE = /^ {0,3}(`{3,}|~{3,})/;
const INDENTED_CODE = /^(?: {4}|\t)/;
const BLOCK_QUOTE = /^\s*>/;
const EMPHASIS = "[*_]{0,3}";

const escapeRegExp = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const wordPattern = (words: readonly string[]): string =>
  `(?<![\\p{L}\\p{N}])(?:${words.map(escapeRegExp).join("|")})(?![\\p{L}\\p{N}])`;

/** The name part of a trailer value or footer remainder: no addresses, parentheses, links' targets or decoration. */
function nameOf(value: string): string {
  return value
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/<[^>]*>/g, " ")
    .replace(/\([^)]*\)/g, " ")
    .replace(/[^\p{L}\p{N}\s.+-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[.]+$/, "");
}

function addressDomainIsAi(value: string): boolean {
  const address = /<([^>]*)>/.exec(value)?.[1] ?? "";
  const domain = address.slice(address.lastIndexOf("@") + 1).toLowerCase();
  return domain !== "" && AI_EMAIL_DOMAINS.some((d) => domain === d || domain.endsWith(`.${d}`));
}

export function findAttribution(text: string, options: AttributionOptions = {}): AttributionHit[] {
  const extra = (options.extraIdentities ?? []).map((e) => e.trim()).filter((e) => e !== "");
  const unambiguous = [...AI_IDENTITIES.filter((id) => !(AMBIGUOUS_IDENTITIES as readonly string[]).includes(id)), ...extra];
  const anywhere = new RegExp(wordPattern(unambiguous), "iu");
  const wholeName = new RegExp(`^(?:github\\s+)?(?:${AMBIGUOUS_IDENTITIES.join("|")})(?:\\s+(?:${QUALIFIERS}))*$`, "iu");
  const namesAi = (name: string): boolean => anywhere.test(name) || wholeName.test(name);

  const trailer = new RegExp(`^${EMPHASIS}(?:${TRAILER_KEYS.join("|")})${EMPHASIS}\\s*:${EMPHASIS}\\s*(.*)$`, "iu");
  const footer = new RegExp(`^[^\\p{L}\\p{N}\`>]*(?:${FOOTER_VERBS})\\s+(?:with|by|using)\\s*:?\\s+(?:the\\s+)?(.*)$`, "iu");

  const hits: AttributionHit[] = [];
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i] as string;

    const open = FENCE.exec(raw);
    if (open !== null) {
      const marker = open[1] as string;
      const closer = new RegExp(`^ {0,3}${escapeRegExp(marker.charAt(0))}{${marker.length},}\\s*$`);
      const end = lines.findIndex((l, j) => j > i && closer.test(l));
      if (end !== -1) {
        i = end;
        continue;
      }
      // No closing fence: this is not a fence, so the lines after it are still checked.
    }
    if (INDENTED_CODE.test(raw) || BLOCK_QUOTE.test(raw)) continue;

    const line = raw.replace(/\p{Cf}/gu, "");
    const t = trailer.exec(line);
    if (t !== null && (namesAi(nameOf(t[1] as string)) || addressDomainIsAi(t[1] as string))) {
      hits.push({ line: i + 1, rule: "trailer", text: raw.trim() });
      continue;
    }
    const f = footer.exec(line);
    if (f !== null && namesAi(nameOf(f[1] as string))) {
      hits.push({ line: i + 1, rule: "footer", text: raw.trim() });
    }
  }
  return hits;
}

/** Instruction-style rejection text: what was found, what to do. Empty when there are no hits. */
export function attributionRejection(hits: readonly AttributionHit[], subject: string): string {
  if (hits.length === 0) return "";
  const lines = hits.map((h) => `  line ${h.line}: ${h.text}`);
  const article = /^[aeiou]/i.test(subject) ? "an" : "a";
  return [
    `AI attribution is not allowed in ${article} ${subject}; every change is attributed to the human who owns it.`,
    "Remove these lines and submit again:",
    ...lines,
    "To discuss attribution in the text, put the example in a code span or fenced block.",
  ].join("\n");
}
