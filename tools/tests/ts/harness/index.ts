// harness/index.ts — barrel: the one import surface for suites.
// `import { runTool, stubGh, stubGit, stubCli, stubCalls, pathWithStubs, tmpDir, tmpToolboxRoot, rmrf } from "./harness/index.ts"`
export { runTool, toolScript, REPO_ROOT, TOOLS } from "./run-tool.ts";
export type { RunToolOptions, RunToolResult } from "./run-tool.ts";
export { stubCli, stubGh, stubGit, stubCalls, pathWithStubs, useProviderDown, CALLS_LOG_NAME } from "./stubs.ts";
export { tmpDir, tmpStubBin, tmpToolboxRoot, rmrf } from "./tmp-repo.ts";
