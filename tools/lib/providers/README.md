# Provider abstraction library

The seam between the devenv tooling and a git host. Tools and domain code call a
TypeScript **facade** (`facade/<family>.ts`); the facade resolves the active provider and
dispatches to that provider's module. Two providers ship: `github/` and `azure/`.
[CONTRACT.md](CONTRACT.md) is the contract every provider implements: the verbs, their
arguments, options and result fields, and which provider covers which verb. A fork can add a
provider without touching an existing one.

## Layout

```text
tools/lib/providers/
├── CONTRACT.md           # the verb inventory and shapes; its coverage table is enforced by a test
├── README.md             # this file
├── provider-core.ts      # detection, repo targeting, capability gates, errors, auth pre-flight, gh transport re-exports
├── provider-core.bash    # bootstrap chain only (see "The surviving bash files")
├── explain.ts            # the calling-requirements shape every provider's explain module returns
├── facade/               # the only import surface for tools and domain code
│   ├── README.md         # the boundary rule and the facade checklist
│   ├── provider-loader.ts   # per-process loader, family manifest, capability gate
│   ├── issues.ts  prs.ts  repos.ts  org.ts  pipelines.ts  projects.ts  urls.ts
├── github/               # the GitHub provider (drives gh)
│   ├── issues.ts  prs.ts  repos.ts  org.ts  pipelines.ts  projects.ts  urls.ts
│   ├── transport.ts      # ghApi / ghApiSync / ghApiPaginate: the one place gh is spawned
│   ├── explain.ts        # calling requirements for provider-explain
│   ├── key-update.ts     # credential rotation entry point
│   └── auth.bash  setup.bash  bootstrap.bash   # bootstrap chain only
└── azure/                # the Azure DevOps provider (REST)
    ├── MAPPING.md        # how GitHub concepts map onto Azure DevOps
    ├── http.ts           # the one REST transport: auth, api-versions, retries, redaction
    ├── issues.ts  prs.ts  repos.ts  org.ts  pipelines.ts  projects.ts  urls.ts
    ├── policies.ts       # rulesets as branch policies
    ├── auth.ts           # credential lookup and status
    ├── entity-roundtrip.ts  wit-urls.ts   # work-item text, tag and URL helpers
    ├── explain.ts        # calling requirements for provider-explain
    ├── key-update.ts     # credential rotation entry point
    ├── smoke.ts          # on-demand live smoke suite (never part of the regular run)
    ├── credential-helper.sh  # git credential helper for HTTPS remotes
    └── auth.bash  setup.bash  bootstrap.bash   # bootstrap chain only
```

The file layout of the two providers is not required to match: Azure hosts the issue web
URL in `urls.ts` and the ruleset verbs in `policies.ts`. The facade's manifest
(`FAMILY_MANIFEST` in `facade/provider-loader.ts`) records which modules implement each
family per provider.

## How a call flows

1. A tool imports `facade/<family>.ts` and calls a verb (`prsMerge`, `issuesEdit`, ...).
2. The facade calls `loadProviderModules(family)`. The loader reads the active provider from
   `providerDetect()` (the `[provider] name` key in `devenv.config`; default `github`; a name
   that is not shipped is an error, never a silent fallback), imports that provider's modules
   for the family from `FAMILY_MANIFEST` with a dynamic `import()` resolved from the loader's
   own location, and caches them for the process.
3. Importing a provider module declares its capabilities as a side effect
   (`providerDeclareCapability`). Tools that need one call `requireFamilyCapability(family,
   capability)`: it loads the family first, then runs `providerRequireCapability`, which
   throws the standard "provider does not support" error. The capabilities are
   `project-boards`, `rulesets`, `native-issue-types` and `pipelines`.
4. The facade calls the provider's verb, normalizing what differs between providers (return
   shapes, option sets, thrown-versus-returned failures). A thing a provider cannot do is a
   named `ProviderError`, never a silent drop.
5. Verbs never exit the process; they throw or return a failure-shaped result, and the tool
   decides the exit code.

Repository targeting is one function: `providerRepoTarget(spec)` in `provider-core.ts`
resolves the explicit argument, then `DEVENV_REPO`, then the provider's environment hook,
then the working directory's repository. Credentials resolve through the provider
(`providerAuthToken`, `ensureProviderAuth`), never by reading a token variable directly.

## The boundary

Tools (`tools/ts/`) and domain code (`tools/lib/domain/`) reach a provider only through the
facade. `provider-core.ts` stays importable because it is the shared seam, not a provider.
`tools/ts/provider-explain.ts` is the one sanctioned direct importer: its job is provider
introspection. `tools/tests/ts/provider-boundary.test.ts` scans both trees, with an empty
allowlist. [facade/README.md](facade/README.md) has the rule in full.

## Adding a verb

1. Implement it in the provider modules that can honor it (`github/<module>.ts`,
   `azure/<module>.ts`), named by the convention: the camel-cased remainder of the contract
   name after `provider_` (`provider_prs_thread_reply` is `prsThreadReply`).
2. Add the facade export in `facade/<family>.ts`, normalizing the shapes that differ.
3. Add one row to the coverage table in [CONTRACT.md](CONTRACT.md) and the matching row in its
   human-readable tables. A provider that cannot implement the verb gets a `-` with a reason,
   or a `gap:` cell for a verb it should eventually have.
4. Run `npx vitest run tools/tests/ts/provider-azure-parity.test.ts`. The test imports the
   real modules and fails, naming the verb and the provider, when the table and the exports
   disagree.
5. Add the behavior tests next to the sibling suites in `tools/tests/ts/` (mock `fetch` or the
   `gh` stub; see below), and, when the Azure mapping changes, update
   [azure/MAPPING.md](azure/MAPPING.md) in the same change.

## Adding a provider

1. Create `providers/<name>/` with a module per family it supports and add its row for each
   family to `FAMILY_MANIFEST` in `facade/provider-loader.ts`.
2. Add the name to `TS_PROVIDERS` in `provider-core.ts` and make its modules declare the
   capabilities they implement (the canonical list is `PROVIDER_CAPABILITY_CANONICAL`).
3. Add the provider's arm to each facade's `load()`. `facade/issues.ts` switches exhaustively
   and throws on an unknown provider; the other families branch on `azure` and fall through
   to GitHub, so extend each branch by hand rather than relying on the fall-through.
4. Add a column for it to the coverage table in [CONTRACT.md](CONTRACT.md) and extend the
   parity test's provider list.
5. Add the provider's `explain.ts`, and an `auth`/`bootstrap`/`setup` hook set if it joins
   the bootstrap chain.

## Testing

- **Hermetic by default.** The regular suite never reaches a provider backend. GitHub tests
  mock the `gh` binary or the transport; Azure tests mock `fetch`. A canary shims `gh`, `az`,
  `curl`, `wget` and `ssh` and guards `fetch`, and fails any test that reaches a backend. The
  harness lives in `tools/tests/ts/harness/`; see [tools/tests/README.md](../../tests/README.md).
- **The parity test** (`tools/tests/ts/provider-azure-parity.test.ts`) is the gate for the
  contract: it compares the coverage table with the real exports of the facade, GitHub and
  Azure modules, and pins unknown-option and invalid-value rejection on the tool surface.
- **Capability, loader and boundary suites** (`provider-capabilities`, `facade-loader`,
  `provider-facade`, `provider-boundary`) pin the loader, the capability declarations and the
  import rule.
- **Live smoke suites** are the only code allowed to touch a backend, run by hand against a
  disposable target: `azure/smoke.ts` today, and a `github/smoke.ts` planned beside the GitHub
  adapter. Each refuses to run without an explicit opt-in variable; no vitest pattern
  collects them and `provider-smoke-guard.test.ts` pins that. See the provider smoke section
  of [tools/tests/README.md](../../tests/README.md).

## The surviving bash files

A few bash files remain for the container bootstrap chain only:

- `provider-core.bash`: provider detection, the credential seam and the hook dispatcher
  (`provider_bootstrap_call`) the bootstrap sources.
- `github/` and `azure/` `auth.bash`, `setup.bash`, `bootstrap.bash`: credential import, host-side
  setup prompts (bash 3.2 compatible, because they run on the user's machine), and the
  container hooks for apt packages, git authentication header, NuGet and npm registries.

They are bootstrap-chain members, not verb implementations: no new verb belongs there.

## Fork documentation

A fork that swaps providers edits this directory plus one skill-side file it authors: the
transport reference under
[`copilot/skills/_shared/references/provider-protocols/`](../../../copilot/skills/_shared/references/provider-protocols/azure.md),
named by `[provider] name` and written to the fixed three-part structure (credential
lifecycle, repo targeting, provider-visible behavior). The neutral wrapper contract both
cite is [`protocol-common.md`](../../../copilot/skills/_shared/references/protocol-common.md),
identical for every fork.

Organization policy decisions (issue types, triage labels, workflow status semantics,
provider default, organization identity) are the other fork surface: they live in
[`tools/lib/policy/`](../policy/README.md), with config-driven values and `POLICY_*`
overrides.
