# Memory — /agent/memory/ in the memory repo

Memory lives in the memory repo (resolved from `[ops]
memory_repo`), under `agent/memory/`, organized per subject. The skill
writes memory freely; commits only on ask.

## What memory holds

- **Tool knowledge**: behaviors, quirks, gaps — what the skill learned
  that the manifests and descriptors don't carry ("k9s's alt-buffer
  makes scripted capture useless; use kubectl for facts").
- **Environment facts**: what is actually running where — accumulated
  from guided scans and diagnosis sessions.
- **Census-gap history**: which tools appeared and how they were judged —
  the living tooling-gap record — maintained by memory, not frozen.

## The write rules

- Writes are free (file writes in the working tree of the memory repo).
- Commits only on explicit user ask — same lane as everything else.
- Durable facts (things that outlive the environment) get *offered* into
  canonical docs — destination resolved at runtime from the org's own
  configuration, never named here — and offered, never unilaterally
  edited.
- Subject organization: one file per subject (`agent/memory/kube-tools.md`,
  `agent/memory/env-local.md`…) — never one growing blob.
- The **session coordination file** (the workspace's session-record
  convention, under the repo's `.local-artifacts/`) carries the live
  session state: the intake's toolbox map, the diagnosis evidence chain,
  and any active bypass records (what was unlocked, for which incident
  class, when). It survives context compaction; the transcript does not.
  Memory holds durable knowledge; the session file holds this session's
  working state.

## The contradiction trigger

When the discovery scan and memory disagree — a tool's behavior changed,
a manifest shifted, an environment drifted — that is the trigger:
refresh memory from the scan, surface the drift in chat, and never
silently trust either side. Memory is accumulated judgment; the scan is
current state; the skill reconciles.

## Self-evolution boundary (the meta lane)

The skill proposes its own improvements through the normal skill
maintenance lane (`/devenv-skill-maintenance`, improvement reports,
issues) — it never rewrites its own SKILL.md mid-session, never
self-applies rule changes. One-writer doctrine: the skill file is
authored in the devenv repo, merged by PR.
