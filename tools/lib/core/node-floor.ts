// Node runtime floor for native TypeScript execution. Type stripping needs
// Node >= 23.6; an older runtime dies with a raw syntax error instead of a
// message, so every tool entry path checks this before anything else runs.
export const NODE_FLOOR = "23.6.0";

function parseSemver(v: string): number[] {
  return v
    .replace(/^v/, "")
    .split(".")
    .map((p) => Number.parseInt(p, 10) || 0);
}

export function nodeMeetsFloor(current: string, floor: string = NODE_FLOOR): boolean {
  const c = parseSemver(current);
  const f = parseSemver(floor);
  for (let i = 0; i < 3; i++) {
    if ((c[i] ?? 0) > (f[i] ?? 0)) return true;
    if ((c[i] ?? 0) < (f[i] ?? 0)) return false;
  }
  return true;
}

export function assertNodeFloor(): void {
  const current = process.version;
  if (!nodeMeetsFloor(current)) {
    process.stderr.write(
      `devenv: Node >= ${NODE_FLOOR} is required for TypeScript tooling ` +
        `(running ${current}). Update Node (dev container pins it in ` +
        `.devcontainer/tool-versions.bash).\n`,
    );
    process.exit(1);
  }
}

// Direct execution: report and exit cleanly (usable from bash too).
if (process.argv[1] && process.argv[1].endsWith("node-floor.ts")) {
  const ok = nodeMeetsFloor(process.version);
  console.log(ok ? `node-floor: ok (${process.version})` : `node-floor: FAIL (${process.version})`);
  process.exit(ok ? 0 : 1);
}
