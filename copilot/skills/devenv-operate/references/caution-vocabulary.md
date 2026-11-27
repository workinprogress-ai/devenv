# Caution vocabulary — the tier oracle contract

The command-descriptor system is the workspace's shared caution-policy
data source. The skill is its judgment layer; the vocabulary is its
grammar. This reference defines the contract the skill reads.

## The vocabulary

Five words, each answering exactly one question:

| Word | Answers | Meaning |
|------|---------|---------|
| `read-only` | *what* | no side effects outside the caller's environment |
| `mutating` | *what* | changes world state (repo content, tracker, infra) |
| `destructive` | *what* | deletes or overwrites state; confirmation required |
| `restricted` | *who* | only named skills' sessions may invoke (the required `restricted-to:` license) |
| `prohibited` | *whether at all* | closed to raw agent judgment; optional `route:` names the sanctioned substitute |

Plus one orthogonal flag: `egress: true` marks network data flow —
read-only + egress never auto-allows (state-safe, exfiltration-capable;
judgment lane).

The three base tiers answer what the call does; `restricted` answers who
may call; `prohibited` answers whether the command is available at all.

## The layers and the cascade

Declarations live in four layers, resolved **first-match-wins**:

```
org → builtin → curated → repo manifests
```

1. **org** — this organization's standards (`tools/config/org-command-descriptors.yaml`, fork-stable, blank by default upstream). The deployment authority: org policy outranks provider self-description — an org that runs different standards overrides. Entries are **full replacements**, never field merges.
2. **builtin** — the commands this repo ships (`tools/config/builtin-command-descriptors.yaml`). Provider self-description.
3. **curated** — the machine's generic command surface (`tools/config/curated-command-descriptors.yaml`): git, gh, kubectl, curl, toolchains.
4. **repo manifests** — each cloned tool repo's `.devenv/manifest.yaml`. The least-trust layer: a repo manifest never shadows a workspace layer (the PATH-rule analogy — a repo tool can never shadow a devenv tool).

The `source:` column of every resolution says which layer answered —
`org` means a default was shadowed (an override is in play; look at the
org file to see what and why).

## The oracle

`command-tier NAME [-- ARGS]` is the universal lookup. Exit 0 with
`tier\tsource\tmatched` on stdout (plus `→ licensed: X` for restricted,
`→ route: Y` for prohibited). Exit **1** = unknown — a census-gap
signal, never a silent default tier.

In-process, the same oracle is `resolveTier` in
`tools/lib/domain/command-descriptors.ts` (pure domain module, safe to
import).

## The rules the skill enforces

- **Ceiling rule**: the declared tier is the worst state the command
  reaches without a built-in guard. `read-only-forms` (flag shapes like
  `--dry-run`, subcommand grammars like `git log`) demote a ceiling only
  when the layer declared that form — never the reverse, never invented.
- **The license check is the skill's own**: `restricted` names the skills
  whose sessions may invoke. A session in this skill checks itself
  against the license — `devenv-operate` is in the license or the command
  is not for this session. The license is data; the refusal is the
  skill's.
- **The route is the substitution, read never invented**: `prohibited`
  with a route hands the job to the routed command (which may itself be
  restricted — the substitution chain, e.g. raw `git` mutations →
  `repo-commit` → licensed to `devenv-commit`). Prohibited without a
  route = no agent path; hand to a human.
- **Egress is a judgment trigger**: read-only + egress (`curl`, `wget`)
  never auto-allows. The judgment weighs: what data the invocation moves
  (sensitivity), where it goes (destination), and how much (volume) —
  anything credential-bearing or bulk is a hard no without explicit
  user direction.
- **Unknown is a stop, not a guess**: an undeclared command is the
  census-gap signal. The lane: surface the gap to the user, propose the
  declaration (the entry text, the layer, the judgment), and let the
  declaration land through the workspace's normal change flow — the
  curated/org files are canonical, PR-reviewed surfaces; a session never
  edits them mid-session to keep moving. Propose, never write-then-run.
  Declare in the right layer (curated for generic machine surface, org
  for org-specific), with the per-command judgment surfaced — never
  default a tier to keep moving.
- **A human terminal is unrestricted**: the tiers route agents, they do
  not grade danger for humans.

## Semantics the skill must not bend

- This is a **caution vocabulary carrying coarse policy, not a permission
  system**. The data informs; judgment — env-class escalation,
  unknown-command handling — stays in the skill.
- The vocabulary is closed: five words plus egress. New words are a
  workspace-policy conversation, not a session invention.
- The carrier (devcontainer autoApprove) is generated from these layers —
  admission and enforcement read the same source of truth. Never
  hand-edit the carrier; if admission behavior must change, the change
  belongs in the descriptor layers or the generator, never the JSON.
