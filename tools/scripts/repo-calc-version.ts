#!/usr/bin/env node
// repo-calc-version.ts - Calculate the next version for the repository
// Version: 1.1.0
// Description: Outputs the calculated next version string: the base version
//              bumped per the conventional commits since the latest vX.Y.Z tag.
// Requirements: Node >= 23.6 (native type-stripping execution)

import { assertNodeFloor } from "../lib/core/node-floor.ts";
import { calculateNextVersion, getLatestVersionTag } from "../lib/domain/release/version.ts";

assertNodeFloor();

const latestTag = getLatestVersionTag();
console.log(calculateNextVersion(latestTag));
