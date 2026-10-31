# Provider facade (tools layer boundary)

The TypeScript tools layer never imports a provider module
(`providers/github/`, `providers/azure/`) directly. Every provider access
flows through **this directory** — `facade/<family>.ts` — which resolves the
active provider at call time (dynamic `import()` through
[provider-loader.ts](provider-loader.ts), cached per process) and normalizes
the verbs whose provider shapes diverge. Adding a third provider touches the
manifest + the provider's module + (where shapes differ) the facade — never
a tool.

`tools/ts/provider-explain.ts` is the single sanctioned direct importer: its
job is provider introspection.

## Families

| Facade | Normalizations owned |
|---|---|
| `issues.ts` | blocked-by list-vs-per-blocker; edit-option superset with named azure refusals; view projection + jq subset; setType spec-vs-owner/name; create body-file reading |
| `projects.ts` | the hoisted ops-object (async-neutral verbs); azure tab-line forIssue parsing; fieldSet boolean contract; github-native `projectsNumberByName` |
| `prs.ts` | GhResult-neutral returns; comment body-file content-vs-path; create option mapping; thread verb shapes |
| `urls.ts` | pure pass-through (auth status, extract/remote parsing, web/transport addresses); azure authStatusOk lives in `auth.ts` |
| `repos.ts` | commits-count boolean-vs-number; create RunResult shape; github-native `reposTreeCount` |
| `org.ts` | async-neutral ruleset verbs; azure policies payload bridging (file -> parsed payload); releases flags gap named |
| `pipelines.ts` | JSON-text list/view; `{stdout, status}` for watch/run/rerun/download; azure --ref/-f flag mapping; surplus azure verbs stay internal |

## The boundary rule

- Tools import `facade/<family>.ts` only. `provider-core.ts` (detection,
  repo targeting, capabilities, errors) stays importable — it is the shared
  seam, not a provider implementation.
- A facade file imports only its own family's manifest modules
  (`FAMILY_MANIFEST` in provider-loader.ts is the source of truth; the
  boundary test reads it).
- The ratchet lives in `tools/tests/ts/provider-boundary.test.ts`:
  `RATCHET_CAP` is the allowlist size and may only shrink. New
  provider-importing tools are boundary breaches, not allowlist entries.

## Adding a provider (the checklist)

A new provider `X` must, per family it supports:

1. Implement the family's modules listed in `FAMILY_MANIFEST` (create the
   row: `X: ["<files>"]`). The verb set per family is the facade's export
   list; shapes follow `../CONTRACT.md`.
2. Where its shapes diverge from the facade's neutral contract, the FACADE
   normalizes — never the tool. Look at the azure arms of each facade verb
   for the established patterns: option objects mapped explicitly
   (`exactOptionalPropertyTypes` forbids explicit `undefined`), record
   returns stringified into the github-path return type, gaps thrown as
   named `ProviderError`s ("not implemented for provider 'X'"), never
   silently dropped.
3. Add the arm to the facade's `load()` switch (exhaustive — the default
   arm throws; a provider is never silently dispatched into github).
4. Provider detection: `TS_PROVIDERS` in provider-core gains the name; the
   capability declarations its modules make must cover the canonical list.
5. Run the boundary + loader tests (`pnpm test:ts`) — the manifest-driven
   checks verify the family rows and the same-family import rule.
