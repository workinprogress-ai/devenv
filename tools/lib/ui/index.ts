// ui/index.ts — text-UI library entry: re-exports the role-based surface.
//
// Thin, role-based API over @clack/prompts + picocolors. Own code stays
// minimal — the third-party libs carry the rendering weight. Every
// interactive call declares a non-TTY fallback so callers are never forced
// to branch: in a non-interactive context the declared default wins instead
// of clack throwing on a missing TTY.

export * from "./prompts.ts";
export * from "./progress.ts";
export * from "./panels.ts";
