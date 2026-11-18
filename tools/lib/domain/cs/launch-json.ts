// Pure text helper for VS Code launch.json files (JSONC — never parsed).

/** Retarget the TFM folder in build-output paths (`bin/<config>/net8.0/…`) to
 * `framework`. A platform suffix (`net8.0-windows`) is kept. Only the segment
 * directly after `bin/<config>/` is touched, so unrelated `net8.0` text stays. */
export function retargetLaunchPaths(launchJsonText: string, framework: string): string {
  return launchJsonText.replace(
    /(bin[\\/][^\\/"]+[\\/])net\d+\.\d+(?=(?:-[^\\/"]+)?[\\/])/g,
    `$1${framework}`,
  );
}
