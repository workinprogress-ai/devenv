// domain/cs/repo-filter.ts — which repositories a global dependency-update
// wave processes. Waves (all libraries first, services later) run the same
// generation order with different repository sets; filtered-out repositories
// keep their place in the graph so the order stays correct.

/** A shell-style glob (`*` any run of characters, `?` one character) as an
 * anchored regular expression. */
function globToRegExp(glob: string): RegExp {
  const body = glob
    .split("")
    .map((c) => (c === "*" ? ".*" : c === "?" ? "." : c.replace(/[.+^${}()|[\]\\]/g, "\\$&")))
    .join("");
  return new RegExp(`^${body}$`);
}

/** A predicate selecting repository names: included when the include list is
 * empty or any include glob matches, and no exclude glob matches. */
export function repoFilter(includes: string[], excludes: string[]): (repo: string) => boolean {
  const inc = includes.map(globToRegExp);
  const exc = excludes.map(globToRegExp);
  return (repo: string): boolean =>
    (inc.length === 0 || inc.some((r) => r.test(repo))) && !exc.some((r) => r.test(repo));
}
