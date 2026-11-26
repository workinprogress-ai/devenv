// agent-marker.ts — grammar for the permanent, plan-less accepted-limit marker:
//
//   // AGENT(shortcut): <the limit> — upgrade when <trigger>
//
// The marker is addressed to the agent that reads the file: the parenthesised
// kind says how to read the comment, and the trigger says when the limit
// stops being acceptable. Only the `shortcut` kind is defined; the slot is
// reserved so later kinds need no grammar change. The `TODO:DEVENV` marker
// stays the plan-scoped marker and is never matched here.
//
// A marker is recognised only when it starts the text of a comment (`//`,
// `#`, `--` or `<!-- -->`), so prose, inline code and string literals that
// merely mention the syntax are ignored. Pure functions, no file access.
//
// Strip-only compatible: no parameter properties, enums, or namespaces.

export const AGENT_MARKER_KINDS = ["shortcut"] as const;

export type AgentMarkerKind = (typeof AGENT_MARKER_KINDS)[number];

export interface AgentMarker {
  /** 1-based line number. */
  line: number;
  kind: AgentMarkerKind;
  limit: string;
  trigger: string;
}

export type MalformedReason = "unknown-kind" | "missing-trigger" | "empty-limit";

export interface MalformedAgentMarker {
  /** 1-based line number. */
  line: number;
  reason: MalformedReason;
  /** The offending line, trimmed. */
  text: string;
}

export interface AgentMarkerScan {
  markers: AgentMarker[];
  malformed: MalformedAgentMarker[];
}

// A comment opener at the start of a line or after whitespace, immediately
// followed by `AGENT`, an optional `(kind)`, and a colon.
const MARKER_LINE = /(?:^|\s)(?:\/\/|#|--|<!--)\s*AGENT(\([^)]*\))?:\s*(.*)$/;

// `<limit> — upgrade when <trigger>`: the separator is a dash run (em dash,
// en dash or hyphens) set off by whitespace, so a hyphen inside the limit text
// is never read as the separator.
const LIMIT_AND_TRIGGER = /^(.*?)(?:^|\s)[—–-]+\s+upgrade when(?:\s+(.*))?$/i;

function isKnownKind(kind: string): kind is AgentMarkerKind {
  return (AGENT_MARKER_KINDS as readonly string[]).includes(kind);
}

export function parseAgentMarkers(text: string): AgentMarkerScan {
  const markers: AgentMarker[] = [];
  const malformed: MalformedAgentMarker[] = [];
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i] as string;
    const hit = MARKER_LINE.exec(raw);
    if (hit === null) continue;
    const line = i + 1;
    const bad = (reason: MalformedReason): void => {
      malformed.push({ line, reason, text: raw.trim() });
    };

    const kind = hit[1] === undefined ? "" : hit[1].slice(1, -1);
    if (!isKnownKind(kind)) {
      bad("unknown-kind");
      continue;
    }

    const rest = (hit[2] as string).replace(/\s*-->\s*$/, "").trim();
    const parts = LIMIT_AND_TRIGGER.exec(rest);
    const trigger = parts?.[2]?.trim() ?? "";
    if (parts === null || trigger === "") {
      bad("missing-trigger");
      continue;
    }
    const limit = (parts[1] as string).trim();
    if (limit === "") {
      bad("empty-limit");
      continue;
    }
    markers.push({ line, kind, limit, trigger });
  }
  return { markers, malformed };
}
