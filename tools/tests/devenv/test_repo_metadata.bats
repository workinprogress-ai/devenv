#!/usr/bin/env bats
# Repo-level metadata tells the truth: every doc is indexed, the package scripts
# cover the linters, and the release config only references things that exist.

bats_require_minimum_version 1.5.0

load ../test_helper

@test "docs/README.md links every other document in docs/" {
    missing=""
    for f in "$PROJECT_ROOT"/docs/*.md; do
        b="$(basename "$f")"
        [ "$b" = README.md ] && continue
        grep -qE "\]\(\./$b[)#]" "$PROJECT_ROOT/docs/README.md" || missing+="$b "
    done
    [ -z "$missing" ] || { echo "not indexed in docs/README.md: $missing"; false; }
}

@test "package.json has a lint:skills script that runs lint-skills" {
    run jq -r '.scripts["lint:skills"]' "$PROJECT_ROOT/package.json"
    [ "$status" -eq 0 ]
    [ "$output" = "lint-skills" ]
}

@test "release.config.js references no repo script that does not exist" {
    # e.g. a publishCmd pointing at ./.azuredevops/... when no such directory exists
    refs="$(grep -oE "\./\.?[A-Za-z0-9_-]+/[A-Za-z0-9_./-]+\.(sh|js|bash)" "$PROJECT_ROOT/release.config.js" || true)"
    for r in $refs; do
        [ -e "$PROJECT_ROOT/$r" ] || { echo "release.config.js references missing $r"; false; }
    done
}

@test "docs and skills use 'research' where the retired 'spike' skill name used to be" {
    # Allowed leftovers: the trigger phrase users still say ("spike on X"), the
    # `spike` artifact-type value, and an example issue type named Spike in Forking.md.
    hits="$(grep -rn -i 'spike' --include=*.md "$PROJECT_ROOT/copilot" "$PROJECT_ROOT/docs" \
        | grep -v -e '"spike on X"' -e '`spike`' -e 'name: Spike' || true)"
    [ -z "$hits" ] || { echo "$hits"; false; }
}

@test "issue docs show research (not spike) artifact examples" {
    run grep -n -E 'spike-[0-9]+-|--artifact-type spike' "$PROJECT_ROOT"/docs/*.md
    [ "$status" -ne 0 ]
}

@test "research SKILL: the findings file is the one upserted, never a tmpN.md copy" {
    skill="$PROJECT_ROOT/copilot/skills/devenv-research/SKILL.md"
    run grep -n 'Write the findings doc to `.local-artifacts/tmpN.md`' "$skill"
    [ "$status" -ne 0 ]
    grep -q 'issue-artifact-upsert --issue <N> --body-file <path to research-NNN-<topic>.md>' "$skill"
}

@test "research SKILL: numbering takes the number only and composes the filename explicitly" {
    skill="$PROJECT_ROOT/copilot/skills/devenv-research/SKILL.md"
    run grep -n -- "--dir <artifacts-folder> --filename" "$skill"
    [ "$status" -ne 0 ]
    # next-id replaces only {N}; a trailing * would be printed literally
    run grep -n "research-{N}-\*' --width 3 --dir <artifacts-folder>" "$skill"
    [ "$status" -eq 0 ]
}

@test "research SKILL: the prototype path uses the playground/devenv-research-<topic>-<date>/ form" {
    skill="$PROJECT_ROOT/copilot/skills/devenv-research/SKILL.md"
    run grep -n 'playground/research-' "$skill"
    [ "$status" -ne 0 ]
}

@test "delegate and pair per-task gates stop at owner: User and Research: tasks" {
    for skill in devenv-delegate devenv-pair; do
        f="$PROJECT_ROOT/copilot/skills/$skill/SKILL.md"
        # the stop-and-hand-back rule sits beside the decision: gate, mentioning both triggers
        run grep -nE 'owner: User.*Research:|Research:.*owner: User' "$f"
        [ "$status" -eq 0 ] || { echo "$skill: no owner/research gate"; false; }
    done
}

@test "link-prefix rule: a workspace-level .local-artifacts link to a repo file takes one ../" {
    conv="$PROJECT_ROOT/copilot/skills/_conventions.md"
    run grep -n '(\.\./\.\./repos/' "$conv"
    [ "$status" -ne 0 ]
    grep -q '(\.\./repos/<your-service>/src/Foo\.cs#L42)' "$conv"
}

@test "board roadmap recipe passes --issue (select requires an issue number)" {
    run grep -n 'issue-artifact-select --artifact-type roadmap' "$PROJECT_ROOT/copilot/skills/devenv-board/SKILL.md"
    [ "$status" -ne 0 ]
    grep -q 'issue-artifact-select --issue <epic> --artifact-type roadmap' "$PROJECT_ROOT/copilot/skills/devenv-board/SKILL.md"
}

@test "registry: audit triggers use assessment language, hunt-language stays with hunt" {
    reg="$PROJECT_ROOT/copilot/skills/devenv-help/references/skills-registry.md"
    audit="$(grep '^| `/devenv-audit`' "$reg")"
    hunt="$(grep '^| `/devenv-hunt`' "$reg")"
    triggers="$(echo "$audit" | awk -F'|' '{print $4}')"
    [[ "$triggers" != *"hunt"* ]]
    [[ "$triggers" == *"correctness-risk audit"* ]]
    [[ "$hunt" == *"go hunting"* ]]
    [[ "$hunt" == *"bug hunt"* ]]
}

@test "pair SKILL: step headings are unique and no reference dangles past the last step" {
    f="$PROJECT_ROOT/copilot/skills/devenv-pair/SKILL.md"
    dup="$(grep -oE '^### [0-9]+[a-z]?\.' "$f" | sort | uniq -d)"
    [ -z "$dup" ] || { echo "duplicate step headings: $dup"; false; }
    # the session procedure tops out at step 6; "step 8" belongs to the separate
    # Session Wrap-Up list, so only the old dangling "step 7" is checked for
    run grep -niE '\bstep 7\b' "$f"
    [ "$status" -ne 0 ]
}

@test "FIXME:DEVENV markers use the single-colon form everywhere in the skill tree" {
    run grep -rn --include=*.md 'DEVENV\[[^]]*\]::' "$PROJECT_ROOT/copilot" "$PROJECT_ROOT/docs"
    [ "$status" -ne 0 ]
}

@test "protocol-common: no reference to a nonexistent issue-edit wrapper" {
    run grep -n 'issue-edit' "$PROJECT_ROOT/copilot/skills/_shared/references/protocol-common.md"
    [ "$status" -ne 0 ]
}

@test "protocol-common: body-input contract names the picker only where it exists" {
    f="$PROJECT_ROOT/copilot/skills/_shared/references/protocol-common.md"
    # the interactive fzf picker is issue-artifact-upsert's alone
    block="$(sed -n '/^### Markdown body input (shared contract)/,/^## Issue tools/p' "$f")"
    [[ "$block" == *"issue-artifact-upsert"* ]]
    [[ "$block" == *"error"* ]]
}

@test "protocol-common: the --marker recipe uses single backslashes (a real regex escape)" {
    run grep -n -- "--marker 'DEVENV\\\\\\\\\[" "$PROJECT_ROOT/copilot/skills/_shared/references/protocol-common.md"
    [ "$status" -ne 0 ]
    grep -q -- "--marker 'DEVENV\\\\\[bug-hunt\\\\\]'" "$PROJECT_ROOT/copilot/skills/_shared/references/protocol-common.md"
}

@test "protocol-common: issue-create blocks only without --no-interactive (no-template is a no-op)" {
    f="$PROJECT_ROOT/copilot/skills/_shared/references/protocol-common.md"
    run grep -n 'Without `--no-template`/`--no-interactive`' "$f"
    [ "$status" -ne 0 ]
    grep -q 'Without `--no-interactive`' "$f"
}

@test "issue docs never force a workflow state with project-update-issue --status" {
    # Workflow states (TBD..Review) advance only by their own signals; only delivery
    # states (Merged, Staging, Production) may be written directly.
    hits="$(grep -nE 'project-update-issue .*--status "?(TBD|To-Groom|Ready|Implementing|Review)"?' \
        "$PROJECT_ROOT/docs/Issues-Quick-Reference.md" "$PROJECT_ROOT/docs/Issues-Management.md" \
        "$PROJECT_ROOT/docs/Additional-Tooling.md" || true)"
    [ -z "$hits" ] || { echo "$hits"; false; }
}

@test "issue docs do not claim that assigning an issue signals Implementing" {
    run grep -niE 'assign(ing|ment) (yourself )?signals Implementing' \
        "$PROJECT_ROOT/docs/Issues-Quick-Reference.md" "$PROJECT_ROOT/docs/Issues-Management.md"
    [ "$status" -ne 0 ]
}

@test "every code fence in the issue docs is closed" {
    for f in Issues-Quick-Reference Issues-Management; do
        n="$(grep -c '^```' "$PROJECT_ROOT/docs/$f.md")"
        [ $((n % 2)) -eq 0 ] || { echo "$f.md has an unterminated fence ($n fence lines)"; false; }
    done
}

@test "edit protocol: plans and roadmaps are exempt from per-edit revision history" {
    f="$PROJECT_ROOT/copilot/skills/common/references/issue-backed-artifact-edit-protocol.md"
    block="$(sed -n '/^## Revision history/,/^## Decision-package parity/p' "$f")"
    [[ "$block" == *"current-state"* ]]
    [[ "$block" == *"plans"* && "$block" == *"roadmaps"* ]]
}

@test "edit protocol: states the file-canonical vs issue-canonical rule with type lists" {
    f="$PROJECT_ROOT/copilot/skills/common/references/issue-backed-artifact-edit-protocol.md"
    block="$(sed -n '/^## Source-of-truth rule/,/^## Typical applications/p' "$f")"
    [[ "$block" == *"File-canonical"* ]]
    [[ "$block" == *"Issue-canonical"* ]]
    [[ "$block" == *"research"* && "$block" == *"design"* ]]
    [[ "$block" == *"plans"* && "$block" == *"roadmaps"* ]]
}

@test "research SKILL cites the edit protocol, which actually holds the file-canonical rule" {
    f="$PROJECT_ROOT/copilot/skills/devenv-research/SKILL.md"
    grep -q 'issue-backed-artifact-edit-protocol.md#source-of-truth-rule' "$f"
}

@test "ruleset commit-message pattern allows exactly the commitlint type enum" {
    command -v node >/dev/null || skip "node not installed"
    enum="$(node -e "console.log(require('$PROJECT_ROOT/commitlint.config.js').rules['type-enum'][2].slice().sort().join('|'))")"
    pattern="$(jq -r '.. | objects | select(.type? == "commit_message_pattern") | .parameters.pattern' "$PROJECT_ROOT/tools/config/ruleset-default.json")"
    ruleset="$(printf '%s' "$pattern" | sed -E 's/^\^\(([^)]*)\).*/\1/' | tr '|' '\n' | sort | paste -sd'|')"
    [ -n "$enum" ]
    [ "$ruleset" = "$enum" ]
}

@test "update-roadmap SKILL: issue-get is not claimed to return linked PRs, and PRs are found by their bodies" {
    f="$PROJECT_ROOT/copilot/skills/devenv-update-roadmap/SKILL.md"
    run grep -n 'fetch issue state, labels, linked PRs' "$f"
    [ "$status" -ne 0 ]
    run grep -n 'scan issue comments for `Closes' "$f"
    [ "$status" -ne 0 ]
    grep -q 'scan PR bodies for `Closes #N`' "$f"
}

@test "update-roadmap SKILL: states that roadmap-parse passes status through and the skill computes it" {
    f="$PROJECT_ROOT/copilot/skills/devenv-update-roadmap/SKILL.md"
    grep -q 'passes each step.s existing \*\*Status\*\* line through' "$f"
}

@test "Issues-Management: no stale note says issues close when moved to Production" {
    run grep -n 'closed when moved to Production' "$PROJECT_ROOT/docs/Issues-Management.md"
    [ "$status" -ne 0 ]
    grep -q 'reaching Production does not auto-close' "$PROJECT_ROOT/docs/Issues-Management.md"
}

@test "Additional-Tooling lists exactly the repo types repo-types.yaml defines for repo-create --type" {
    yaml_types="$(awk '/^types:/{t=1; next} t && /^  [a-z][a-z-]*:[[:space:]]*$/ {gsub(/[: ]/,""); print}' "$PROJECT_ROOT/tools/config/repo-types.yaml" | sort | paste -sd'|')"
    doc_types="$(grep -m1 -- '- `--type <type>`: Required (' "$PROJECT_ROOT/docs/Additional-Tooling.md" | sed -E 's/.*Required \(([^)]*)\).*/\1/' | tr '|' '\n' | sort | paste -sd'|')"
    [ -n "$yaml_types" ]
    [ "$doc_types" = "$yaml_types" ]
}

@test "Function-Naming-Conventions: every example function exists, and every cited lib file exists" {
    doc="$PROJECT_ROOT/docs/Function-Naming-Conventions.md"
    for fn in $(grep -oE '`[a-z_]+\(\)`' "$doc" | tr -d '`()' | sort -u); do
        grep -rqE "^(function )?$fn\(\)" "$PROJECT_ROOT/tools" "$PROJECT_ROOT/.devcontainer" \
            || { echo "example function not defined anywhere: $fn"; false; }
    done
    for lib in $(grep -oE '\(lib/[a-z-]+\.bash\)' "$doc" | tr -d '()' | sort -u); do
        [ -f "$PROJECT_ROOT/tools/$lib" ] || { echo "cited lib file missing: $lib"; false; }
    done
}

@test "no doc or skill names the nonexistent create-for-merge PR tool" {
    run grep -rn --include=*.md 'create-for-merge' "$PROJECT_ROOT/docs" "$PROJECT_ROOT/copilot"
    [ "$status" -ne 0 ]
}

@test "devenv-commit SKILL describes repo-commit's real editor-resolution chain, in order" {
    f="$PROJECT_ROOT/copilot/skills/devenv-commit/SKILL.md"
    # the order in repo-commit.sh: GIT_EDITOR, core.editor, code --wait, nano, VISUAL, EDITOR
    grep -qE 'GIT_EDITOR.*core\.editor.*code --wait.*nano.*VISUAL.*EDITOR' "$f"
    grep -qi 'treated as unset' "$f"
    run grep -n 'prefers VS Code (`code --wait`) with nano as fallback' "$f"
    [ "$status" -ne 0 ]
}

@test "the lint-skills docs name every rule the script implements" {
    doc="$PROJECT_ROOT/copilot/skills/_tools-reference.md"
    last="$(grep -oE 'SK0[0-9]+' "$PROJECT_ROOT/tools/scripts/lint-skills.sh" | sort -u | tail -1)"
    section="$(sed -n '/^### lint-skills/,/^```$/p' "$doc")"
    [[ "$section" == *"$last"* ]] || { echo "doc does not mention $last"; false; }
    [[ "$section" == *"anchor"* ]]
    [[ "$section" == *"orphan"* && "$section" == *"references"* ]]
}

@test "the wrapper's DEVENV_COMMIT_TYPES equals the commitlint type enum" {
    command -v node >/dev/null || skip "node not installed"
    enum="$(node -e "console.log(require('$PROJECT_ROOT/commitlint.config.js').rules['type-enum'][2].slice().sort().join(' '))")"
    wrapper="$(bash -c "source '$PROJECT_ROOT/tools/lib/git-operations.bash' >/dev/null 2>&1; echo \$DEVENV_COMMIT_TYPES" | tr ' ' '\n' | sort | paste -sd' ')"
    [ -n "$enum" ]
    [ "$wrapper" = "$enum" ]
}

@test "Commit-Conventions documents the CI enforcement of commit messages and the trailer" {
    doc="$PROJECT_ROOT/docs/Commit-Conventions.md"
    grep -q 'check-commit-trailers' "$doc"
    grep -qi 'commit-messages' "$doc"
}

@test "copilot-instructions does not claim pr-create pushes the branch in general" {
    run grep -n 'pr-create` pushes the branch' "$PROJECT_ROOT/copilot/copilot-instructions.md"
    [ "$status" -ne 0 ]
    grep -q 'pr-create --at` pushes the merge branch' "$PROJECT_ROOT/copilot/copilot-instructions.md"
}
