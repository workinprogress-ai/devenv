// install-extras — pick an "extra" from .devcontainer/install-extras and run
// it. Port of install-extras.sh: fzf picker (clack select on a TTY; numbered
// fallback otherwise), filter with auto-run on a single match, multi via -m.

import { existsSync, readdirSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import { spawnSync } from "node:child_process";
import { assertNodeFloor } from "../lib/core/node-floor.ts";
import { select, multiSelect } from "../lib/ui/prompts.ts";

assertNodeFloor();

const argv = process.argv.slice(2);
let multi = false;
let extrasDir = "";
let filter = "";

for (let i = 0; i < argv.length; i++) {
  const a = argv[i] as string;
  if (a === "-m" || a === "--multi") multi = true;
  else if (a === "--dir") {
    const v = argv[i + 1];
    if (v === undefined) { console.error("❌ Missing value for --dir"); process.exit(2); }
    extrasDir = v as string;
    i++;
  } else if (filter === "") filter = a;
}

// The bash tool read ${devenv:-.} — the checkout root via env, else cwd.
const devenvRoot = process.env.DEVENV_ROOT ?? process.cwd();
if (extrasDir === "") extrasDir = join(devenvRoot, ".devcontainer", "install-extras");

if (!existsSync(extrasDir) || !statSync(extrasDir).isDirectory()) {
  console.error(`❌ Extras directory not found: ${extrasDir}`);
  process.exit(1);
}

// Candidates: *.sh or executable files.
const files = readdirSync(extrasDir)
  .map((e) => join(extrasDir, e))
  .filter((f) => {
    const st = statSync(f, { throwIfNoEntry: false });
    if (!st?.isFile()) return false;
    return f.endsWith(".sh") || (st.mode & 0o111) !== 0;
  })
  .sort();
if (files.length === 0) {
  console.error(`❌ No extras found in ${extrasDir}`);
  process.exit(1);
}

// Menu: NAME (label) with the full path as value; optional filter.
let candidates = files;
if (filter !== "") {
  candidates = files.filter((f) => basename(f).toLowerCase().includes(filter.toLowerCase()));
  if (candidates.length === 0) {
    console.error("No selection.");
    process.exit(1);
  }
}

const chosen: string[] = [];
if (filter !== "" && candidates.length === 1) {
  chosen.push(candidates[0] as string);
} else {
  const options = candidates.map((f) => ({ value: f, label: basename(f) }));
  if (multi) {
    const picked = await multiSelect({ message: "Install extra > ", options, fallback: [] });
    if (picked.length === 0) { console.log("No selection."); process.exit(1); }
    chosen.push(...picked);
  } else {
    const picked = await select({ message: "Install extra > ", options, fallback: "" });
    if (picked === "") { console.log("No selection."); process.exit(1); }
    chosen.push(picked);
  }
}

// Execute selections in order.
let exitCode = 0;
for (const script of chosen) {
  console.log(`• Running: ${basename(script)}`);
  const r = spawnSync("bash", [script], { stdio: "inherit" });
  if (r.status !== 0) {
    console.error(`❌ Script exited with code ${r.status}: ${script}`);
    exitCode = r.status ?? 1;
  }
}
process.exit(exitCode);
