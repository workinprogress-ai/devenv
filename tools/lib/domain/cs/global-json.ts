// Pure text helpers for global.json SDK pins.

/** Major version of the `sdk.version` pin, or null when the text declares none. */
export function sdkPinMajor(globalJsonText: string): number | null {
  const m = /"sdk"\s*:\s*\{[^}]*?"version"\s*:\s*"(\d+)\./.exec(globalJsonText);
  return m ? Number(m[1]) : null;
}

/** Raise the `sdk.version` pin to `<major>.0.100` when its major is below
 * `major`. Every other byte of the file is preserved. Unchanged when there is
 * no pin or the pin is already at or above `major`. */
export function raiseSdkPin(globalJsonText: string, major: number): string {
  const current = sdkPinMajor(globalJsonText);
  if (current === null || current >= major) return globalJsonText;
  return globalJsonText.replace(
    /("sdk"\s*:\s*\{[^}]*?"version"\s*:\s*")[^"]*(")/,
    `$1${major}.0.100$2`,
  );
}
