#!/usr/bin/env node
// custom-bootstrap.ts — provision step: run the fork's org-level and the
// user's personal custom bootstrap hooks when present.
// Port of provision.bash run_custom_bootstrap_if_present.
//
// Contract (docs/Bootstrap-Customization.md): org-custom-bootstrap.sh is
// committed in the fork; user-custom-bootstrap.sh is machine-local. A hook's
// failure fails the step (the historical behavior — bootstrap stops).

import { existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { toolbox } from "./lib.ts";

const root = toolbox();

const orgHook = join(root, ".devcontainer", "org-custom-bootstrap.sh");
if (existsSync(orgHook)) {
  console.log("Running organization-level custom bootstrap...");
  execFileSync("/bin/bash", [orgHook], { stdio: "inherit" });
}

const userHook = join(root, ".devcontainer", "user-custom-bootstrap.sh");
if (existsSync(userHook)) {
  console.log("Running user-level custom bootstrap...");
  execFileSync("/bin/bash", [userHook], { stdio: "inherit" });
}

console.log("custom-bootstrap: ok");
