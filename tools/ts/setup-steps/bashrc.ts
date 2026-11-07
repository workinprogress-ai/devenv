#!/usr/bin/env node
// bashrc.ts — provision step: append the devenvrc sourcing block to ~/.bashrc.
// Port of provision.bash append_bashrc.
//
// Idempotent via the marker: the block is appended only when the
// "### devenv rc start" marker is absent. Interactive-shell guard preserved
// (non-interactive shells must not inherit the customizations).

import { existsSync, readFileSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import { home } from "./lib.ts";

const MARKER_START = "### devenv rc start";
const bashrc = join(home(), ".bashrc");

if (existsSync(bashrc) && readFileSync(bashrc, "utf8").includes(MARKER_START)) {
  console.log("bashrc: devenv block already present; skipped");
} else {
  appendFileSync(
    bashrc,
    `${MARKER_START}
# Only apply interactive customizations for interactive shells
if [[ $- == *i* ]]; then
    if [ -f "${home()}/.devenvrc" ]; then
        source "${home()}/.devenvrc"
    fi
fi
### devenv rc end
`,
  );
  console.log(`bashrc: appended devenv block to ${bashrc}`);
}
