#!/usr/bin/env node
// credentials.ts — provision step: load .setup identity seeds into shell
// globals for the session (the bridge equivalent seeds HUMAN_NAME/USER_EMAIL;
// the provider accessors read the seeds and config themselves when identity
// is needed, so nothing is exported here).
//
// Port of provision.bash load_setup_credentials. The DigitalOcean token is
// read when present and re-exported into env-vars by the env-vars step (the
// historical DO_API_TOKEN flow: this step reads the seed; env-vars embeds it).
//
// Idempotent by nature (reads only). In TS the values travel via env vars
// that later steps in the same orchestrator process read — the orchestrator
// spawns steps as separate processes, so credentials EXPORTS its finds.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { toolbox, setupDir } from "./lib.ts";

const emailFile = join(setupDir(), "email.txt");
const nameFile = join(setupDir(), "name.txt");

// require_setup_files (bootstrap) guarantees these exist; when run
// stand-alone without them, fail loudly with the recovery path.
for (const f of [emailFile, nameFile]) {
  if (!existsSync(f)) {
    console.error(`ERROR: missing seed file ${f} — run 'setup' on the host, then re-run.`);
    process.exit(1);
  }
}

const email = readFileSync(emailFile, "utf8").trim();
const name = readFileSync(nameFile, "utf8").trim();

// Session globals for downstream steps (env-vars consumes USER_EMAIL; the
// git-config step consumes both). Exported, not printed.
process.env.HUMAN_NAME = name;
process.env.USER_EMAIL = email;

const doTokenFile = join(setupDir(), "digitalocean_token.txt");
if (existsSync(doTokenFile)) {
  process.env.DO_API_TOKEN = readFileSync(doTokenFile, "utf8").trim();
} else {
  console.error(`WARNING: No Digital Ocean API token found in ${doTokenFile} (optional)`);
}

console.log(`credentials: loaded identity for ${name} <${email}> (${toolbox()})`);
