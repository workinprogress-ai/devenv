#!/usr/bin/env node
// engineering-sync.ts — provision step: clone/update the configured
// engineering-standards side-repo and link ~/.copilot/engineering. Port of
// provision.bash sync_copilot_engineering (implementation in
// side-repo-sync.ts).

import { join } from "node:path";
import { home, toolbox } from "./lib.ts";
import { syncCopilotSideRepo, copilotConfig } from "./side-repo-sync.ts";

const root = toolbox();
const repoUrl = copilotConfig("engineering_repo");
const subpath = copilotConfig("engineering_subpath");

if (repoUrl === "") {
  console.log("No [copilot] engineering_repo configured; skipping engineering standards sync");
  process.exit(0);
}

const rc = syncCopilotSideRepo(
  repoUrl,
  subpath,
  join(root, "copilot", "engineering"),
  join(home(), ".copilot", "engineering"),
  "Engineering standards",
  join(root, ".runtime", "copilot-engineering-backups"),
);
process.exit(rc);
