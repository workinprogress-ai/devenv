// refs.ts — shared issue-reference parsing, unified so the per-tool parsers
// cannot drift. Lives beside the issues-graph domain module.

/** Parse an issue reference (bare number or a full web URL ending in one)
 * into its number; null when the reference names nothing. */
export function issueNumberFromRef(ref: string): number | null {
  const trimmed = ref.trim();
  if (/^[0-9]+$/.test(trimmed)) return Number.parseInt(trimmed, 10);
  const m = /^https?:\/\/[^?#]*\/([0-9]+)\/?([?#].*)?$/.exec(trimmed);
  return m?.[1] !== undefined ? Number.parseInt(m[1], 10) : null;
}
