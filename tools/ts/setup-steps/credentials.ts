#!/usr/bin/env node
// credentials.ts — provision step: verify the .setup identity seeds exist.
//
// Port of provision.bash load_setup_credentials. Steps run as separate
// processes, so nothing is passed on through the environment: the env-vars
// and git-config steps (and the provider accessors) read the seeds
// themselves. The optional DigitalOcean token seed is only checked here.
//
// Idempotent by nature (reads only).

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

const doTokenFile = join(setupDir(), "digitalocean_token.txt");
if (!existsSync(doTokenFile)) {
  console.error(`WARNING: No Digital Ocean API token found in ${doTokenFile} (optional)`);
}

console.log(`credentials: loaded identity for ${name} <${email}> (${toolbox()})`);
