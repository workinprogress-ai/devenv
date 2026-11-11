// commit-format.ts — the conventional-commit title check shared by the PR
// tools. The type list mirrors the `type-enum` of the repo-root
// commitlint.config.js, the authoritative source every surface derives from.
//
// Strip-only compatible: runs natively under `node <file>.ts`.

/** Allowed conventional-commit types (equal to commitlint.config.js type-enum). */
export const COMMIT_TYPES: readonly string[] = [
  "build", "chore", "ci", "docs", "feat", "fix", "perf", "refactor", "revert", "style", "test",
  "major", "minor", "patch",
];

const CONVENTIONAL_TITLE = new RegExp(`^(${COMMIT_TYPES.join("|")})(\\([^)]+\\))?!?: .+`);

/** True when `title` is `type(scope)!: subject` with an allowed type. */
export function conventionalCommitsOk(title: string): boolean {
  return CONVENTIONAL_TITLE.test(title);
}
