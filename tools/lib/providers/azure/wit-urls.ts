// azure/wit-urls.ts — the Work Item Tracking URL builders shared by the
// azure modules (issues, projects, and any future WIT consumer). Split out
// of issues.ts and projects.ts, which each carried an identical private
// copy (the projects.ts copy existed to avoid an import cycle; a shared
// leaf module has none).

import { azureOrgProject, azureUri } from "./urls.ts";

/** Project-scoped WIQL API base for the configured org/project. */
export function witBase(): { base: string; org: string; project: string } {
  const { org, project } = azureOrgProject();
  return {
    base: `https://dev.azure.com/${azureUri(org)}/${azureUri(project)}/_apis/wit`,
    org,
    project,
  };
}

/** Web UI base for a work item's page (comments anchor included by callers). */
export function webItemsBase(): string {
  const { org, project } = azureOrgProject();
  return `https://dev.azure.com/${azureUri(org)}/${azureUri(project)}/_workitems/edit/`;
}
