# Policy Library

Org-policy decisions for the devenv tooling, separated from mechanics so a
fork changes values — not code. This is the policy half of the fork-stable
surfaces contract (Q-003); the provider half lives in
[`tools/lib/providers/`](../../providers/README.md).

## Resolution chain

Every accessor resolves in the same order:

1. **`POLICY_<NAME>` environment override** — explicit, session-scoped.
2. **Config value** — from `devenv.config` (via `policy-core`), unless the
   accessor documents a different source.
3. **Built-in fallback** — the current org's value, listed per knob below.

A missing or empty config value falls through to the fallback; a fallback is
never empty.

## Knobs

| Accessor | Env override | Config key | Fallback |
|---|---|---|---|
| `policy_issue_types` | `POLICY_ISSUE_TYPES` | `[issues] types` *(optional — absent today)* | `Bug Feature Task Epic` |
| `policy_issue_aliases` | `POLICY_ISSUE_ALIASES` | `[issues] aliases` *(optional — absent today)* | *(empty — set `alias=Target` pairs)* |
| `policy_triage_labels` | `POLICY_TRIAGE_LABELS` | `[issues] triage_labels` *(optional — absent today)* | `needs-triage needs-grooming status:ready future-idea` |

**Note on issue types:** the `[issues]` section does not exist in the stock
`devenv.config` — the fallback is the operative source until a fork sets the
key. The *native type IDs* (the GitHub-side type identifiers used by
`issue-create`) live separately in `tools/config/issues-config.yml`, which the
normalizer does not consume; keep the two lists consistent when overriding.
| `policy_triage_label <key>` | — | (looks up the vocabulary above) | rc 1 for unknown keys |
| `policy_delivery_segment_anchor` | `POLICY_DELIVERY_SEGMENT_ANCHOR` | `[workflows] delivery_segment_anchor` | `Implementing` |
| `policy_status_fallback` | `POLICY_STATUS_FALLBACK` | `[workflows] status_fallback` | `Ready` |
| `policy_default_provider` | `POLICY_DEFAULT_PROVIDER` | `[provider] name` | `github` |
| `policy_org` | `POLICY_ORG` | `[organization] github_org` (env `GH_ORG` honored first) | fails (rc 1) when unresolvable |

## Usage

```bash
source "$DEVENV_TOOLS/lib/policy/policy-core.bash"
policy_core_init "${DEVENV_ROOT:-}/devenv.config"

source "$DEVENV_TOOLS/lib/policy/issue-policy.bash"
types="$(policy_issue_types)"
```

`policy_core_init` must run before domain accessors. `policy_org` is
self-contained (it carries its own env-first chain: `POLICY_ORG` → `GH_ORG` →
config).

## Adding a knob

1. Add a `policy_define "<name>" "<ENV_SUFFIX>" <section> <key> <fallback>`
   in the relevant domain module (or create a new domain module and source it
   after `policy-core`).
2. Reroute the literal consumers to the accessor.
3. Add the knob to the table above — the docs are part of the contract.

## Related

- Provider facade: `tools/lib/providers/` (domain verbs; the `actions` domain
  is what `pipelines-*` tools route through)
- Naming/fork contract: `tools/lib/providers/README.md`
- Env-var residue (elimination of `GH_*` reads beyond the org chain): #57
