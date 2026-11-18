import { describe, expect, it } from "vitest";
import { raiseSdkPin, sdkPinMajor } from "../../lib/domain/cs/global-json.ts";

describe("sdkPinMajor", () => {
  it("reads the major of the sdk.version pin", () => {
    expect(sdkPinMajor('{ "sdk": { "version": "8.0.100" } }')).toBe(8);
  });
  it("returns null when no pin is declared", () => {
    expect(sdkPinMajor('{ "sdk": { "rollForward": "latestMajor" } }')).toBeNull();
    expect(sdkPinMajor("{}")).toBeNull();
  });
});

describe("raiseSdkPin", () => {
  it("raises a lower pin to <major>.0.100 and preserves the rest", () => {
    const text = '{\n  "sdk": {\n    "version": "8.0.404",\n    "rollForward": "disable"\n  }\n}\n';
    expect(raiseSdkPin(text, 10)).toBe(text.replace("8.0.404", "10.0.100"));
  });
  it("leaves an equal or higher pin unchanged", () => {
    const text = '{ "sdk": { "version": "10.0.100" } }';
    expect(raiseSdkPin(text, 10)).toBe(text);
    expect(raiseSdkPin(text, 8)).toBe(text);
  });
  it("leaves a file without a pin unchanged", () => {
    const text = '{ "sdk": { "rollForward": "latestMajor" } }';
    expect(raiseSdkPin(text, 10)).toBe(text);
  });
});
