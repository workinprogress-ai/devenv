# Discovery intake — ops-orient and the manual floor

The operate skill never holds tool facts. Every tool, manifest, and
registry location resolves at runtime. The intake has one accelerator
and one floor.

## The [ops] config anchor

`devenv.config` carries the `[ops]` section (read via `config-read`,
fork-customization surface):

```ini
[ops]
memory_repo=<owner/repo>    # home of /agent/memory/ and the env registry
tool_repos=<owner/repo>[,<owner/repo>...]
```

The skill never hardcodes either value. `config-read ops memory_repo`
and `config-read ops tool_repos` resolve them. An association in
`tool_repos` is deliberate — adding a tool there is a reviewed act.

## The accelerator: ops-orient

`ops-orient` reads `[ops]` + every associated repo's `.devenv/manifest.yaml`
and emits the toolbox map: JSON + human summary table. The map annotates
the full caution answer per entry — tier, provenance/layer (org | builtin |
curated | repo name), license, route, egress — plus purpose, doc pointer,
and association state.

If `ops-orient` is absent (not built, not on PATH), fall back to the
manual protocol — do not stop.

## The floor: manual protocol

1. `config-read ops memory_repo` / `config-read ops tool_repos`
2. For each repo in `tool_repos`: read `repos/<repo>/.devenv/manifest.yaml`
   (name, purpose, doc, executables with tiers)
3. The caution vocabulary is available without any repo: the builtin and
   curated descriptor files + `command-tier` are workspace-native

The floor produces the same knowledge the accelerator emits — slower,
never stale.

## What the intake feeds

- **Session orientation**: what tools exist, what they do, what caution
  each carries — the map is the toolbox state.
- **Memory reconciliation**: memory's accumulated tool knowledge
  (behaviors, quirks, gaps) is cross-checked against the scan; a
  disagreement is the contradiction trigger — refresh memory from
  the scan, flag the drift, never silently trust either side.
- **Gap handling**: a tool on PATH resolving unknown through the tier
  oracle is a census-gap signal (see
  [caution-vocabulary.md](./caution-vocabulary.md)).

## Registry authority (env classes)

Environment classes resolve from the memory repo's `envs/` registry —
the authoritative class source, never eyeballed, never assumed from
cluster-name heuristics. An environment with no registry entry triggers
the guided scan → classify → save flow (see
[env-classes.md](./env-classes.md)).
