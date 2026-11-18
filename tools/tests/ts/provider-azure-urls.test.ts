// Every clone-URL form an Azure DevOps repository is handed out in must parse
// to org/project/repo; foreign hosts and look-alike hosts must not. The
// `https://ORG@dev.azure.com/...` form is the default `git clone` URL Azure
// shows, so it is the one most likely to be an origin remote.
import { describe, expect, it } from "vitest";
import { azureParseRemote, remoteToSpec, remoteToWeb } from "../../lib/providers/azure/urls.ts";

const WIDGETS = { org: "acme", project: "proj", repo: "widgets" };
const SPACED = { org: "acme", project: "My Project", repo: "my repo" };

describe("azureParseRemote", () => {
  it.each([
    ["https://dev.azure.com/acme/proj/_git/widgets", WIDGETS],
    ["https://dev.azure.com/acme/proj/_git/widgets.git", WIDGETS],
    ["https://acme@dev.azure.com/acme/proj/_git/widgets", WIDGETS],
    ["https://acme:token@dev.azure.com/acme/proj/_git/widgets", WIDGETS],
    ["https://acme.visualstudio.com/proj/_git/widgets", WIDGETS],
    ["https://acme@acme.visualstudio.com/proj/_git/widgets", WIDGETS],
    ["git@ssh.dev.azure.com:v3/acme/proj/widgets", WIDGETS],
    ["git@ssh.dev.azure.com:v3/acme/proj/widgets.git", WIDGETS],
    ["ssh://git@ssh.dev.azure.com/v3/acme/proj/widgets", WIDGETS],
    ["ssh://git@ssh.dev.azure.com:22/v3/acme/proj/widgets", WIDGETS],
    ["https://acme@dev.azure.com/acme/My%20Project/_git/my%20repo", SPACED],
    ["ssh://git@ssh.dev.azure.com:22/v3/acme/My%20Project/my%20repo", SPACED],
  ])("parses %s", (url, expected) => {
    expect(azureParseRemote(url)).toEqual(expected);
  });

  it.each([
    "https://example.com/acme/widgets.git",
    "https://github.com/acme/widgets.git",
    "https://evil.example/dev.azure.com/acme/proj/_git/widgets",
    "https://notdev.azure.com/acme/proj/_git/widgets",
    "https://dev.azure.com.evil.example/acme/proj/_git/widgets",
    "git@github.com:acme/widgets.git",
    "",
  ])("returns null for %s", (url) => {
    expect(azureParseRemote(url)).toBeNull();
  });
});

describe("remote conversions share the parser", () => {
  it("turns the default clone URL into a project/repo spec and a clean web URL", () => {
    const url = "https://acme@dev.azure.com/acme/My%20Project/_git/widgets";
    expect(remoteToSpec(url)).toBe("My Project/widgets");
    expect(remoteToWeb(url)).toBe("https://dev.azure.com/acme/My%20Project/_git/widgets");
  });

  it("returns null for a non-Azure remote", () => {
    expect(remoteToSpec("https://github.com/acme/widgets.git")).toBeNull();
    expect(remoteToWeb("https://github.com/acme/widgets.git")).toBeNull();
  });
});
