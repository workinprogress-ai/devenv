# Customization Guide for the Devenv

If you've forked this repository for your organization, this guide explains what to configure so the environment matches your org. The essentials live in `devenv.config`; repository-creation standards live in `tools/config/repo-types.yaml`.

## Quick Checklist

- ✅ Update `devenv.config` for org identity, container name, workflows, and bootstrap defaults
- ✅ (If you use repo creation tooling) Update `tools/config/repo-types.yaml` for naming, templates, branch protection, and post-creation scripts
- ✅ Create/adjust template repos per type (recommended) so new repos start with CI, CODEOWNERS, and hooks

## Required: devenv.config

Edit `devenv.config` in the root directory:

### [organization]

```ini
[organization]
name=YourOrg
github_org=your-org
email_domain=yourorg.com
```

- **name**: Organization name (for docs/branding)
- **github_org**: GitHub org/user used for cloning and feeds
- **email_domain**: Enforced commit email domain (empty = any valid email)

### [container]

```ini
[container]
name=YourOrg Dev Environment
```

- **name**: Display name for the dev container

### [workflows]

```ini
[workflows]
status_workflow=Backlog,Ready,In Progress,In review,Done
issue_types=story,bug
```

- **status_workflow**: Your issue flow, ordered
- **issue_types**: Issue types used by your teams

### [bootstrap]

```ini
[bootstrap]
validate_config=true
```

- **validate_config**: Validate config on startup (recommended: true)

## Repo Creation Standards (repo-create.sh)

If you use `tools/scripts/repo-create.sh`, configure `tools/config/repo-types.yaml`:

- **Naming**: `naming_pattern` and `naming_example` per type (e.g., service.*, gateway.*, app.web.*)
- **Templates**: `template` per type (or null) to pre-bake CI, CODEOWNERS, and .repo scripts
- **Post-creation**: `post_creation_script`, `delete_post_creation_script`, and `post_creation_commit_handling` (`none|amend|new`)
- **Branch protection**: counts/owners/conversation rules, `allow_force_pushes`, `allow_admin_bypass`, `delete_branch_on_merge`
- **Status checks**: `required_status_checks` should list the exact check run names from your CI (e.g., `Devenv Tests / test`)

Tip: Keep a lightweight template repo for each type so new repos start with pipelines and policies already in place.

## devenv.config Examples

### Small Startup

```ini
[organization]
name=Acme Corp
github_org=acme-corp
email_domain=acme.com

[container]
name=Acme Dev Environment

[workflows]
status_workflow=Backlog,In Progress,Done
issue_types=story,bug
```

### Enterprise Organization

```ini
[organization]
name=Mega Corp
github_org=mega-corp-dev
email_domain=megacorp.com

[container]
name=Mega Corp Development Environment

[workflows]
status_workflow=Backlog,Ready,In Progress,In review,Testing,Done
issue_types=story,bug
```

## What You Should NOT Change (unless you want to maintain your fork)

- Test infrastructure (unless enhancing it)
- Error handling libraries
- Git configuration helpers
- Version comparison logic
- Core script templates
- Bootstrap framework

These are intended to be generic and reused across orgs.

## Advanced Customization

For deeper bootstrap tweaks, see [Bootstrap-Customization.md](./Bootstrap-Customization.md) (modular tasks, overrides, env-based flows).

## Contributing Improvements Back

1. Fork the main devenv repository
2. Create a feature branch
3. Make your improvements
4. Ensure all tests pass
5. Submit a pull request

See [Contributing](./Contributing.md) for more details.

## Getting Help

- Check the `docs/` folder for feature-specific topics
- Review test files in `tools/tests/` for usage examples
