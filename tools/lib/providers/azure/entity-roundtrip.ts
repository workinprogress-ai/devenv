// azure/entity-roundtrip.ts — the pure text/field-mapping layer of the
// azure issues implementation: entity decode/normalize, tag join/split, the
// devenv-type → body-field config mapping, comment-ref parsing, and the
// artifact-marker survival transform. No I/O beyond config reads; the wire
// verbs stay in issues.ts.

import { ProviderError, providerConfigPath } from "../provider-core.ts";
import { configGetRaw } from "../../core/config.ts";

// ---------------------------------------------------------------------------
// Text round-trip (entity decode / newline pairing)
// ---------------------------------------------------------------------------

const ENTITY_SET: Array<[RegExp, string]> = [
  [/&quot;/g, '"'],
  [/&apos;/g, "'"],
  [/&#39;/g, "'"],
  [/&lt;/g, "<"],
  [/&gt;/g, ">"],
  // &amp; decodes LAST so &quot; never double-decodes to &.
  [/&amp;/g, "&"],
];

/** Un-escape the entity set Azure actually emits (azure_text_decode parity). */
export function azureTextDecode(text: string): string {
  let out = text;
  for (const [re, to] of ENTITY_SET) out = out.replace(re, to);
  return out;
}

/** Normalize text for storage: drop ONE trailing newline (the store re-adds
 * it), keeping interior formatting untouched. Pairs with the read-side trim. */
export function azureTextNormalize(text: string): string {
  return text.endsWith("\n") ? text.slice(0, -1) : text;
}

// ---------------------------------------------------------------------------
// Tags
// ---------------------------------------------------------------------------

/** System.Tags is one string, "a; b" as Azure returns it. Split into trimmed,
 * non-empty tags. */
export function azureTagsSplit(s: string): string[] {
  return s
    .split(";")
    .map((t) => t.trim())
    .filter((t) => t !== "");
}

/** Join tags the way the store expects: "; ". */
export function azureTagsJoin(tags: string[]): string {
  return tags.join("; ");
}

/** A devenv.config value from an arbitrary section; "" when absent. (The
 * bash seam's azure_config_get parity — section-scoped, not [provider].) */
export function issueTypesConfig(key: string): string {
  return configGetRaw(providerConfigPath(), "azure_issue_types", key) ?? "";
}

/** The Azure field the issue BODY is written to and read from for a devenv
 * issue type ([azure_body_fields] override, key = devenv type; absent key
 * defaults to System.Description). The field choice is an org/process fact —
 * different Azure processes put the working body in different fields (the
 * Bug form often displays ReproSteps and can hide Description) — so it is
 * config, not wrapper code. One authoritative field per type avoids the
 * dual-write read-ambiguity. */
export const DEFAULT_BODY_FIELD = "System.Description";

export function bodyFieldFor(type: string): string {
  if (type === "") return DEFAULT_BODY_FIELD;
  const section = providerConfigPath();
  // Config keys are case-sensitive: try the canonical devenv type first
  // (Bug), then the lowercase form users commonly write (bug).
  for (const key of [
    type,
    type.toLowerCase(),
    type.charAt(0).toUpperCase() + type.slice(1).toLowerCase(),
  ]) {
    const raw = configGetRaw(section, "azure_body_fields", key) ?? "";
    if (raw !== "") return raw;
  }
  return DEFAULT_BODY_FIELD;
}

/** Split an opaque comment ref into work item + comment id. A bare number is
 * rejected with guidance so callers never guess scope. */
export function splitCommentRef(ref: string): { workItem: string; commentId: string } {
  if (ref === "" || /[^0-9/]/.test(ref) || ref.split("/").length !== 2) {
    throw new ProviderError(
      `azure comment ref '${ref}' is malformed — take the id from issue-comment-list output`,
    );
  }
  const [workItem, commentId] = ref.split("/");
  return { workItem: workItem as string, commentId: commentId as string };
}

/** Artifact-marker survival transform (azure_marker_transform parity):
 * Azure strips HTML comments from markdown at write time, so a doc_id inside
 * the DEVENV_ARTIFACT_V1 comment header never reaches storage. Emit the
 * doc_id as a bare first line and drop the comment blocks ADO drops anyway
 * (everything from <!-- to -->, content between included — the bash awk
 * toggles a flag on the fence lines and skips in-between). Idempotent: a
 * body whose doc_id already survives outside comments passes through. */
export function azureMarkerTransform(body: string): string {
  const m = /^[ \t]*doc_id:[ \t]*(\S+)[ \t]*$/m.exec(body);
  if (m === null) return body;
  const docId = m[1] as string;
  let inComment = false;
  const stripped = body
    .split("\n")
    .filter((line) => {
      if (inComment) {
        if (line.startsWith("-->")) inComment = false;
        return false;
      }
      if (line.startsWith("<!--")) {
        inComment = true;
        return false;
      }
      return true;
    })
    .join("\n");
  const bareRe = new RegExp(`^[ \\t]*doc_id:[ \\t]*${docId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[ \\t]*$`, "m");
  if (bareRe.test(stripped)) return body;
  // Preserve every DEVENV_ARTIFACT_V1 field as a bare `key: value` block:
  // Azure storage strips HTML comments, and downstream consumers route on
  // planning_repo/artifact_type — dropping them (the old doc_id-only form)
  // silently broke identity. Bare key lines survive Azure storage and are
  // read back by the artifact tools' headerValue parser.
  const headerKeys = [
    "artifact_type",
    "doc_id",
    "issue_number",
    "planning_repo",
    "source_file",
    "updated_at_utc",
  ];
  const lines = body.split("\n");
  const header: string[] = [];
  let inHeaderComment = false;
  for (const line of lines) {
    if (inHeaderComment) {
      if (line.startsWith("-->")) inHeaderComment = false;
      const kv = /^([a-z_]+):[ \t]*(.+)$/.exec(line);
      if (kv && headerKeys.includes(kv[1] as string)) {
        header.push(`${kv[1]}: ${kv[2]}`);
      }
      continue;
    }
    if (line.startsWith("<!-- DEVENV_ARTIFACT_V1")) inHeaderComment = true;
  }
  if (header.length === 0) return `doc_id: ${docId}\n${stripped}`;
  return `${header.join("\n")}\n${stripped}`;
}

/** Upsert-hook shape: issue-artifact-upsert calls this around its doc_id
 * search so the marker it needs survives Azure storage. */
export function issuesArtifactBodyTransform(body: string): string {
  return azureMarkerTransform(body);
}

