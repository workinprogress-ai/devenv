// explain.ts — the provider calling-requirements contract, shared by the
// per-provider explain modules and the provider-explain tool. One shape,
// so a provider's self-description cannot drift from the tool that prints
// it (15.7).

/** Whether a family's verbs need a repo spec, per operation class. */
export interface RepoTargetNeed {
  reads: "required" | "optional" | "never";
  writes: "required" | "optional" | "never";
}

/** One wrapper family's calling requirements for one provider. */
export interface FamilyExplain {
  /** Machine name the provider-explain tool takes as its argument. */
  family: string;
  /** Wrapper prefixes in this family (e.g. ["issue-"]). */
  wrappers: string[];
  /** How identifiers scope: GitHub issue numbers are per-repo; azure
   * work-item ids are org/project-global. */
  identifierScoping: string;
  /** Whether a repo spec is needed, per operation class. */
  repoTarget: RepoTargetNeed;
  /** Where org/project (or org/repo) resolution comes from on this provider. */
  resolution: string;
  /** Credential prerequisite (the wrapper never handles tokens itself). */
  credentials: string;
  /** The wrapper's own gates that fire before the provider call. */
  wrapperGates: string[];
  /** Free-form notes an agent needs for the odd cases. */
  notes: string[];
}

/** The full self-description one provider ships. */
export interface ProviderExplain {
  provider: string;
  families: FamilyExplain[];
}
