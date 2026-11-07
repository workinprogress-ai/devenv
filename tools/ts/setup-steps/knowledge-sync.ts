#!/usr/bin/env node
// knowledge-sync.ts — provision step: clone/update the configured Copilot
// knowledge side-repo and link ~/.copilot/knowledge. Port of provision.bash
// sync_copilot_knowledge (implementation in side-repo-sync.ts).
//
// Unconfigured repo: skip (not an error). Missing credentials: warn + skip
// (never a bootstrap blocker). Missing subpath: ERROR (broken link target).

import { join } from "node:path";
import { home, toolbox } from "./lib.ts";
import { syncCopilotSideRepo, copilotConfig } from "./side-repo-sync.ts";

const root = toolbox();
const repoUrl = copilotConfig("knowledge_repo");
const subpath = copilotConfig("knowledge_subpath");

if (repoUrl === "") {
  console.log("No [copilot] knowledge_repo configured; skipping knowledge sync");
  process.exit(0);
}

const rc = syncCopilotSideRepo(
  repoUrl,
  subpath,
  join(root, "copilot", "knowledge"),
  join(home(), ".copilot", "knowledge"),
  "Copilot knowledge",
  join(root, ".runtime", "copilot-knowledge-backups"),
);
process.exit(rc);
