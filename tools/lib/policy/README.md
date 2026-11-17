# Policy Library

Org-policy decisions for the devenv tooling, separated from mechanics so a
fork changes values, not code. This is the policy half of the fork-stable
surfaces contract; the provider half lives in
[`tools/lib/providers/`](../providers/README.md).

This folder holds no code. The bash policy layer (`policy_define` accessors
and the `POLICY_<NAME>` environment overrides) was retired with the rest of
the bash verb layer, and the policy decisions it carried now live as
`devenv.config` values and YAML files that the TypeScript tools read directly.
A fork changes the value, not a module.

## Where each decision lives

| Decision | Source | Read by | Built-in fallback |
|---|---|---|---|
| Organization identity | `devenv.config` `[organization] org`, then the setup seed file `.setup/provider_org.txt` | `providerOrgGet` in [`provider-core.ts`](../providers/provider-core.ts); the older `GH_ORG` variable is not read | none: empty when unresolved |
| User identity | `devenv.config` `[organization] user`, then the setup seed file | `providerUserGet` in [`provider-core.ts`](../providers/provider-core.ts) | none: empty when unresolved |
| Active provider | `devenv.config` `[provider] name` | `providerDetect` in [`provider-core.ts`](../providers/provider-core.ts) | `github`; a name that is not shipped is an error |
| Status vocabulary | `devenv.config` `[workflows] status_workflow` | `workflowOrder` in [`graph.ts`](../domain/issues/graph.ts) | none |
| Delivery boundary token | `devenv.config` `[workflows] delivery_segment_anchor` | `workflowPolicy` in [`graph.ts`](../domain/issues/graph.ts) | `Implementing` |
| Status for an unreadable child | `devenv.config` `[workflows] status_fallback` | `workflowPolicy` in [`graph.ts`](../domain/issues/graph.ts) | `Ready` |
| Issue types, aliases and parent rules | [`tools/config/issues-config.yml`](../../config/issues-config.yml) | the issue tools | see the file |
| Triage and seed labels | [`tools/config/labels-config.yml`](../../config/labels-config.yml) | `issue-label-create --seed` | see the file |
| Status each lifecycle event writes | [`tools/config/skill-events.yml`](../../config/skill-events.yml) | `onEvent` in [`graph.ts`](../domain/issues/graph.ts) | see the file |

A missing or empty `[workflows]` value falls through to its built-in fallback;
a fallback is never empty. The workflow vocabulary carries engine contracts
(the delivery boundary token, the birth tokens); the customization rules are
in [Forking](../../../docs/Forking.md) and
[Issue Workflow](../../../docs/Issue-Workflow.md).

## Adding a decision

1. Add a key to `devenv.config` (or an entry to the relevant YAML file under
   `tools/config/`) and read it through `configGet`/`configGetRaw`
   (`tools/lib/core/config.ts`), with a non-empty built-in fallback where one
   makes sense.
2. Route every consumer through that one read; do not hard-code the value
   beside it.
3. Add the decision to the table above and to the relevant config reference in
   `docs/`; the docs are part of the contract.

## Related

- Provider layer: [`tools/lib/providers/`](../providers/README.md) (domain verbs; the `actions` domain
  is what `pipelines-*` tools route through)
- Fork contract: [`docs/Forking.md`](../../../docs/Forking.md)
