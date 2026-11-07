// harness/index.ts — barrel: the one import surface for suites.
// `import { runTool, stubGh, stubGit, stubCli, stubCalls, pathWithStubs, tmpDir, tmpToolboxRoot, rmrf } from "./harness/index.ts"`
export { runTool, REPO_ROOT, TOOLS } from "./run-tool.ts";
export type { RunToolOptions, RunToolResult } from "./run-tool.ts";
export { stubCli, stubGh, stubGit, stubCalls, pathWithStubs, CALLS_LOG_NAME } from "./stubs.ts";
export { tmpDir, tmpStubBin, tmpToolboxRoot, rmrf } from "./tmp-repo.ts";
