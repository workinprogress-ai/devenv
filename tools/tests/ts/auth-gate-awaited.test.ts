// A tool that checks provider authentication before acting must stop when the
// provider is unauthenticated. `authStatusOk` is async: a caller that forgets to
// await it tests a Promise (always truthy), so the gate can never fire and the
// tool carries on against an unauthenticated provider.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { rmrf, runTool, stubCalls, stubCli, tmpStubBin, pathWithStubs } from "./harness/index.ts";
import { EXIT_API_FAILURE, EXIT_GENERAL_ERROR } from "../../lib/core/exit-codes.ts";

let stubDir = "";

beforeEach(() => {
  stubDir = tmpStubBin("auth-gate");
  // gh refuses `auth status` (the unauthenticated shape) and records every other call.
  stubCli(
    stubDir,
    "gh",
    [
      "#!/usr/bin/env bash",
      'if [ "$1" = "auth" ] && [ "$2" = "status" ]; then echo "not logged in" >&2; exit 1; fi',
      `printf '%s\\n' "gh $*" >> "${stubDir}/calls.log"`,
      "exit 0",
    ].join("\n"),
  );
});

afterEach(() => {
  rmrf(stubDir);
});

const env = (): Record<string, string> => ({ PATH: pathWithStubs(stubDir), DEVENV_REPO: "org/repo" });

describe("the provider auth gate is awaited", () => {
  it("pr-thread-reply stops with the API-failure exit and never calls the provider", () => {
    const r = runTool("pr-thread-reply", ["12", "--comment-id", "5", "--body", "hello"], { env: env() });
    expect(r.output).toContain("Not authenticated with the active provider");
    expect(r.status).toBe(EXIT_API_FAILURE);
    expect(stubCalls(stubDir, "gh")).toEqual([]);
  });

  it("repo-create stops with the general-error exit and never calls the provider", () => {
    const r = runTool("repo-create", ["svc.alpha.beta", "--type", "service"], { env: env() });
    expect(r.output).toContain("Provider CLI is not authenticated");
    expect(r.status).toBe(EXIT_GENERAL_ERROR);
    expect(stubCalls(stubDir, "gh")).toEqual([]);
  });
});
