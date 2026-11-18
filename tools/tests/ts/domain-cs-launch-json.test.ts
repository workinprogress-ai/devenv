import { describe, expect, it } from "vitest";
import { retargetLaunchPaths } from "../../lib/domain/cs/launch-json.ts";

describe("retargetLaunchPaths", () => {
  it("retargets the TFM folder after bin/<config>/", () => {
    const text = '"program": "${workspaceFolder}/src/Host/bin/Debug/net8.0/Host.dll"';
    expect(retargetLaunchPaths(text, "net10.0")).toBe(
      '"program": "${workspaceFolder}/src/Host/bin/Debug/net10.0/Host.dll"',
    );
  });
  it("keeps a platform suffix", () => {
    expect(retargetLaunchPaths("bin/Release/net8.0-windows/App.dll", "net10.0")).toBe(
      "bin/Release/net10.0-windows/App.dll",
    );
  });
  it("handles backslash paths", () => {
    expect(retargetLaunchPaths("bin\\Debug\\net8.0\\App.dll", "net10.0")).toBe("bin\\Debug\\net10.0\\App.dll");
  });
  it("leaves unrelated net8.0 text and non-modern TFMs alone", () => {
    const text = '"name": "net8.0 host", "program": "bin/Debug/netstandard2.0/X.dll"';
    expect(retargetLaunchPaths(text, "net10.0")).toBe(text);
  });
});
