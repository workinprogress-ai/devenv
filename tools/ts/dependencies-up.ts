// dependencies-up — start development dependency containers.
// Port of dependencies-up.sh: a single docker compose pass-through.

import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { assertNodeFloor } from "../lib/core/node-floor.ts";
import { resolveToolsRoot } from "../lib/core/self-root.ts";

assertNodeFloor();

const composeFile = join(resolveToolsRoot(import.meta.url), "other", "docker-compose-dependencies.yml");
const r = spawnSync("docker", ["compose", "-f", composeFile, "up"], { stdio: "inherit" });
process.exit(r.status ?? 1);
