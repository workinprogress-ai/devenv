#!/usr/bin/env bats
# Tests for lint-skills.sh — each defect class must FAIL the checker (negative
# controls); a golden tree must PASS.

bats_require_minimum_version 1.5.0

load ../test_helper

setup() {
  test_helper_setup
  WORK_DIR=$(mktemp -d)
  TREE="$WORK_DIR/copilot/skills"
  SCRIPT="$DEVENV_ROOT/tools/scripts/lint-skills.sh"
  # Golden minimal tree: two skills, registry, catalog.
  mkdir -p "$TREE/devenv-alpha" "$TREE/devenv-beta" "$TREE/devenv-help/references" "$TREE/common/references"
  write_skill() { # $1=name
    printf -- '---\nname: %s\ndescription: x\nuser-invocable: true\n---\n# %s\n' "$1" "$1" > "$TREE/$1/SKILL.md"
  }
  write_skill devenv-alpha; write_skill devenv-beta; write_skill devenv-help
  # the registry and catalog are referenced from the help skill (SK009 requires every reference file be linked)
  printf 'See references/skills-registry.md and ../common/references/skills-catalog.md\n' >> "$TREE/devenv-help/SKILL.md"
  printf '| `/devenv-alpha` | x | x | x |\n| `/devenv-beta` | x | x | x |\n| `/devenv-help` | x | x | x |\n' > "$TREE/devenv-help/references/skills-registry.md"
  # The catalog is a pointer (no skill names); docs/Skills.md (reached through
  # the shared symlink) is the canonical full listing the lint checks.
  mkdir -p "$TREE/_shared/docs"
  printf 'See ../../_shared/docs/Skills.md\n' > "$TREE/common/references/skills-catalog.md"
  printf 'devenv-alpha devenv-beta devenv-help\n' > "$TREE/_shared/docs/Skills.md"
}

teardown() { rm -rf "$WORK_DIR"; }

@test "golden tree passes" {
  run bash "$SCRIPT" "$TREE"
  [ "$status" -eq 0 ]
}

@test "SK004: a skill missing from docs/Skills.md fails" {
  printf 'devenv-alpha devenv-help\n' > "$TREE/_shared/docs/Skills.md"
  run bash "$SCRIPT" "$TREE"
  [ "$status" -eq 1 ]
  [[ "$output" == *"SK004"*"devenv-beta"*"Skills.md"* ]]
}

@test "SK004: a pointer-only catalog is fine when Skills.md lists every skill" {
  run bash "$SCRIPT" "$TREE"
  [ "$status" -eq 0 ]
}

@test "SK008: a cross-file link to a missing heading anchor fails" {
  printf '# Target\n\n## Real Heading\n' > "$TREE/common/references/target.md"
  printf -- '---\nname: devenv-alpha\ndescription: x\nuser-invocable: true\n---\nSee [x](../common/references/target.md#no-such-heading).\n' > "$TREE/devenv-alpha/SKILL.md"
  run bash "$SCRIPT" "$TREE"
  [ "$status" -eq 1 ]
  [[ "$output" == *"SK008"*"no-such-heading"* ]]
}

@test "SK008: a cross-file anchor matching a heading slug passes (punctuation, repeats)" {
  printf '# T\n\n## Skill `_on_<event>` (signals)\n\n## Same\n\n## Same\n' > "$TREE/common/references/target.md"
  printf -- '---\nname: devenv-alpha\ndescription: x\nuser-invocable: true\n---\n[a](../common/references/target.md#skill-_on_event-signals) [b](../common/references/target.md#same-1)\n' > "$TREE/devenv-alpha/SKILL.md"
  run bash "$SCRIPT" "$TREE"
  [ "$status" -eq 0 ]
}

@test "SK008: same-file example anchors and fenced examples are not checked" {
  printf -- '---\nname: devenv-alpha\ndescription: x\nuser-invocable: true\n---\nExample [AC-N](#ac-N).\n\n```\n[x](../common/references/target.md#nope)\n```\n' > "$TREE/devenv-alpha/SKILL.md"
  printf '# Target\n' > "$TREE/common/references/target.md"
  run bash "$SCRIPT" "$TREE"
  [ "$status" -eq 0 ]
}

@test "SK009: a references/ file that nothing links to fails" {
  printf '# Lonely\n' > "$TREE/devenv-alpha/references/lonely.md" 2>/dev/null || { mkdir -p "$TREE/devenv-alpha/references"; printf '# Lonely\n' > "$TREE/devenv-alpha/references/lonely.md"; }
  run bash "$SCRIPT" "$TREE"
  [ "$status" -eq 1 ]
  [[ "$output" == *"SK009"*"lonely.md"* ]]
}

@test "SK009: a references/ file linked from its skill passes" {
  mkdir -p "$TREE/devenv-alpha/references"
  printf '# Used\n' > "$TREE/devenv-alpha/references/used.md"
  printf -- '---\nname: devenv-alpha\ndescription: x\nuser-invocable: true\n---\nSee [used](./references/used.md).\n' > "$TREE/devenv-alpha/SKILL.md"
  run bash "$SCRIPT" "$TREE"
  [ "$status" -eq 0 ]
}

@test "SK001: missing description fails" {
  printf -- '---\nname: devenv-alpha\nuser-invocable: true\n---\n' > "$TREE/devenv-alpha/SKILL.md"
  run bash "$SCRIPT" "$TREE"
  [ "$status" -eq 1 ]
  [[ "$output" == *"SK001"* ]]
}

@test "SK002: name mismatch fails" {
  printf -- '---\nname: devenv-something-else\ndescription: x\nuser-invocable: true\n---\n' > "$TREE/devenv-alpha/SKILL.md"
  run bash "$SCRIPT" "$TREE"
  [ "$status" -eq 1 ]
  [[ "$output" == *"SK002"* ]]
}

@test "SK003: over-length description fails" {
  local long; long=$(printf 'y%.0s' $(seq 1 2100))
  printf -- '---\nname: devenv-alpha\ndescription: %s\nuser-invocable: true\n---\n' "$long" > "$TREE/devenv-alpha/SKILL.md"
  run bash "$SCRIPT" "$TREE"
  [ "$status" -eq 1 ]
  [[ "$output" == *"SK003"* ]]
}

@test "SK004: registry ghost (reference with no directory) fails" {
  printf '| `/devenv-ghost` | x | x | x |\n' >> "$TREE/devenv-help/references/skills-registry.md"
  run bash "$SCRIPT" "$TREE"
  [ "$status" -eq 1 ]
  [[ "$output" == *"SK004"*"ghost"* ]]
}

@test "SK004: orphan skill directory (not in registry) fails" {
  mkdir -p "$TREE/devenv-orphan"
  printf -- '---\nname: devenv-orphan\ndescription: x\nuser-invocable: true\n---\n' > "$TREE/devenv-orphan/SKILL.md"
  run bash "$SCRIPT" "$TREE"
  [ "$status" -eq 1 ]
  [[ "$output" == *"SK004"*"orphan"* ]]
}

@test "SK005: broken relative link fails" {
  printf -- '---\nname: devenv-alpha\ndescription: x\nuser-invocable: true\n---\n# A\n[bad](../devenv-nonexistent/SKILL.md)\n' > "$TREE/devenv-alpha/SKILL.md"
  run bash "$SCRIPT" "$TREE"
  [ "$status" -eq 1 ]
  [[ "$output" == *"SK005"* ]]
}

# --- SK007: stale backticked path references ------------------------------------

# Makes TREE a git repo (SK007 is gated on $repo_root/.git) whose history
# contains a committed TREE/docs/GitHub-Issues-Management.md that is then
# renamed (committed) to docs/Issues-History.md. A backticked reference to
# the old name is stale; references to paths never present in this repo's
# history are unverifiable and must be skipped.
setup_git_with_renamed_doc() {
  git init -q "$TREE"
  git -C "$TREE" config user.email t@t
  git -C "$TREE" config user.name t
  mkdir -p "$TREE/docs"
  printf 'old doc\n' > "$TREE/docs/GitHub-Issues-Management.md"
  git -C "$TREE" add -A
  git -C "$TREE" commit -qm init
  git -C "$TREE" mv docs/GitHub-Issues-Management.md docs/Issues-History.md
  git -C "$TREE" add -A
  git -C "$TREE" commit -qm rename
}

@test "SK007: stale path (in git history, missing from tree) fails" {
  printf 'see `docs/GitHub-Issues-Management.md`\n' >> "$TREE/devenv-alpha/SKILL.md"
  setup_git_with_renamed_doc
  run bash "$SCRIPT" "$TREE"
  [ "$status" -eq 1 ]
  [[ "$output" == *"SK007"* ]]
  [[ "$output" == *"docs/GitHub-Issues-Management.md"* ]]
}

@test "SK007: globs, bare dirs, placeholders, and never-existed paths pass" {
  printf 'refs `docs/Decisions/` `tools/lib/providers/*` `docs/SomeFile.md` `docs/Usage_guide.md`\n' >> "$TREE/devenv-alpha/SKILL.md"
  setup_git_with_renamed_doc
  run bash "$SCRIPT" "$TREE"
  [ "$status" -eq 0 ]
  [[ "$output" != *"SK007"* ]]
}

@test "SK007: current path referenced alongside renamed sibling stays clean" {
  printf 'now `docs/Issues-History.md`\n' >> "$TREE/devenv-alpha/SKILL.md"
  setup_git_with_renamed_doc
  run bash "$SCRIPT" "$TREE"
  [ "$status" -eq 0 ]
  [[ "$output" != *"SK007"* ]]
}

@test "SK007: no .git dir — check skipped silently" {
  printf 'see `docs/anything-old.md`\n' >> "$TREE/devenv-alpha/SKILL.md"
  run bash "$SCRIPT" "$TREE"
  [ "$status" -eq 0 ]
  [[ "$output" != *"SK007"* ]]
}
