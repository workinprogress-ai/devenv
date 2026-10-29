// relations.ts — the blocked-by body-section convention (provider-neutral).
//
// GitHub has no native "blocked by" relation: the convention (shared with
// issue-create's buildBody) records blockers as `Blocked by #N` lines in a
// dedicated body section. Azure records the same information natively as
// Dependency-Forward predecessor links (see azure/issues.ts). This module
// owns the body-section parsing/editing both sides of the convention need,
// so create-time and update-time never diverge.

/** The exact heading line that opens the blocked-by section. */
const SECTION_HEADING = "## Blocked by";

/** The per-blocker line format. */
function blockerLine(blocker: number): string {
  return `Blocked by #${blocker}`;
}

/** Parse the blocker numbers from a body's blocked-by section (the section
 * runs from its heading to the next heading or end of body). Duplicate
 * numbers are collapsed; order is first-appearance. */
export function blockedByFrom(body: string): number[] {
  const lines = body.split("\n");
  const inSection = (): number => {
    for (let i = 0; i < lines.length; i++) {
      if (lines[i]?.trim() === SECTION_HEADING) return i;
    }
    return -1;
  };
  const start = inSection();
  if (start === -1) return [];
  const seen = new Set<number>();
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (/^#{1,6}\s/.test(line)) break; // next section
    const m = /^Blocked by #(\d+)\s*$/m.exec(line);
    if (m?.[1] !== undefined) seen.add(Number(m[1]));
  }
  return [...seen];
}

/** Add blockers to a body's blocked-by section (creating the section when
 * absent). Idempotent: an already-listed blocker is not duplicated. Returns
 * the new body; unchanged body when every blocker was already listed. */
export function blockedByAdd(body: string, blockers: number[]): string {
  const existing = new Set(blockedByFrom(body));
  const fresh = blockers.filter((b) => !existing.has(b));
  if (fresh.length === 0) return body;
  const lines = body.split("\n");
  const headingIndex = lines.findIndex((l) => l.trim() === SECTION_HEADING);
  if (headingIndex === -1) {
    const section = ["", SECTION_HEADING, ...fresh.map(blockerLine), ""];
    return `${body.replace(/\n*$/, "\n")}${section.join("\n")}`;
  }
  // Insert after the last existing blocker line in the section (keeps the
  // list contiguous before any following prose).
  let insertAt = headingIndex + 1;
  for (let i = headingIndex + 1; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (/^Blocked by #\d+\s*$/.test(line)) insertAt = i + 1;
    else if (/^#{1,6}\s/.test(line)) break;
  }
  lines.splice(insertAt, 0, ...fresh.map(blockerLine));
  return lines.join("\n");
}

/** Remove blockers from the section. Dropping the last blocker removes the
 * whole section; removing an absent blocker leaves the body unchanged. */
export function blockedByRemove(body: string, blockers: number[]): string {
  const listed = new Set(blockedByFrom(body));
  if (blockers.every((b) => !listed.has(b))) return body;
  const lines = body.split("\n");
  const headingIndex = lines.findIndex((l) => l.trim() === SECTION_HEADING);
  if (headingIndex === -1) return body;
  const drop = new Set(blockers);
  const kept: string[] = [];
  let inSection = false;
  let sectionBlockers = 0;
  for (const line of lines) {
    if (line.trim() === SECTION_HEADING) {
      inSection = true;
      kept.push(line);
      continue;
    }
    if (inSection && /^#{1,6}\s/.test(line)) inSection = false;
    if (inSection) {
      const m = /^Blocked by #(\d+)\s*$/.exec(line);
      if (m?.[1] !== undefined) {
        sectionBlockers++;
        if (!drop.has(Number(m[1]))) kept.push(line);
        continue;
      }
    }
    kept.push(line);
  }
  if (sectionBlockers - [...drop].filter((b) => listed.has(b)).length === 0) {
    // Section emptied: remove heading and its trailing blank lines.
    const out: string[] = [];
    let skipping = false;
    for (const line of kept) {
      if (line.trim() === SECTION_HEADING) {
        skipping = true;
        continue;
      }
      if (skipping && line.trim() === "") continue;
      if (skipping && /^#{1,6}\s/.test(line)) skipping = false;
      skipping = false;
      out.push(line);
    }
    return out.join("\n").replace(/\n{3,}$/, "\n\n");
  }
  return kept.join("\n");
}
