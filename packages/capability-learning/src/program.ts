/**
 * The compiler CORE (Work Order C022): approved intervention-derived
 * candidates → typed ImprovementPrograms, ONE PER LE1.0 INTERVENTION
 * CLASS (spec/learning.md LE1.0 "Interventions" — "the changed surface
 * must be explicit").
 *
 * Compilation is DETERMINISTIC given identical candidates (same input
 * set ⇒ byte-identical programs — no clock reads, no map-order
 * dependence; candidates are ordered by (changedSurface, candidateId)
 * before grouping). The outcome is a TYPED CLOSED SET:
 *
 *   - { kind: 'compilable', program }           — the program carries
 *     its EXPLICIT intervention class (one of the LE1.0 nine), the
 *     candidate refs it compiles, the full experiment plan and a NEW
 *     content-addressed proposed artifact with append-only lineage;
 *   - { kind: 'blocked', reasons }               — machine-readable
 *     block reasons from a closed vocabulary:
 *       · rights-insufficient   — a candidate requesting global reuse
 *         without 'granted-for-global-reuse' rights (lock rules 31/32:
 *         globally reusable outputs require explicit rights);
 *       · evidence-insufficient — a candidate whose validated evidence
 *         set is empty (fail-closed; the constructor also enforces ≥1);
 *       · scope-conflict        — same tenant + same intervention class
 *         but different target capabilities (one program per class must
 *         have ONE target), or conflicting global-reuse requests.
 *
 * The proposed artifact digest is COMPUTED over the program content —
 * a NEW versioned artifact by construction; the boundary module
 * enforces that it never collides with any historical digest.
 */

import { digestCanonical } from '@arena/protocol-core';
import {
  INTERVENTION_SURFACES,
  deepFreeze,
  isContentDigest,
  isInterventionSurface,
  isLearningVersion,
  isNeutralId,
  toContentDigest,
  toNeutralId,
  toLearningVersion,
} from '@arena/learning';
import type { ContentDigest, LearningVersion, NeutralId } from '@arena/learning';
import type { InterventionSurface } from '@arena/learning';
import { CAPABILITY_LEARNING_ERROR_CODES, CapabilityLearningError } from './errors.js';
import type {
  CandidateArtifactRef,
  CandidateExperimentPlan,
  CandidateRightsStatus,
  ImprovementCandidate,
} from './candidate.js';

/** Wire version of the improvement-program shape. */
export const IMPROVEMENT_PROGRAM_VERSION = 1 as const;

/** The closed compile-block reason vocabulary (typed blocked outcomes). */
export const COMPILE_BLOCK_REASONS = Object.freeze([
  'rights-insufficient',
  'evidence-insufficient',
  'scope-conflict',
] as const);
export type CompileBlockReason = (typeof COMPILE_BLOCK_REASONS)[number];

export function isCompileBlockReason(value: unknown): value is CompileBlockReason {
  return (
    typeof value === 'string' &&
    (COMPILE_BLOCK_REASONS as readonly string[]).includes(value)
  );
}

/** One machine-readable block reason with the offending candidates. */
export interface CompileBlockDetail {
  readonly reason: CompileBlockReason;
  readonly candidateIds: readonly string[];
  readonly basis: string;
}

/** The typed closed compile outcome (never a bare boolean). */
export type CompilationOutcome =
  | { readonly kind: 'compilable'; readonly program: ImprovementProgram }
  | { readonly kind: 'blocked'; readonly reasons: readonly CompileBlockDetail[] };

/** The digest-free program view — exactly what the program digest commits to. */
export interface ImprovementProgramView {
  readonly recordVersion: typeof IMPROVEMENT_PROGRAM_VERSION;
  readonly programId: NeutralId;
  readonly version: LearningVersion;
  readonly tenantId: NeutralId;
  /** The EXPLICIT intervention class (one of the LE1.0 nine). */
  readonly interventionClass: InterventionSurface;
  /** The digests of the candidates compiled into this program (sorted). */
  readonly candidateRefs: readonly ContentDigest[];
  readonly targetCapability: {
    readonly kind: string;
    readonly id: string;
    readonly version: string;
    readonly digest: string;
  };
  readonly baseline: {
    readonly bodyRef: string | null;
    readonly substrateRef: string | null;
    readonly runtimeRef: string | null;
  };
  /** The intervention artifacts (one per candidate), each on the program's class. */
  readonly interventions: readonly {
    readonly artifact: CandidateArtifactRef;
    readonly changedSurface: InterventionSurface;
  }[];
  readonly experimentPlan: CandidateExperimentPlan;
  /**
   * The digest of the NEW versioned artifact this program proposes —
   * computed over the program content; NEVER a historical digest (the
   * boundary module enforces the LE1.0 learning boundary).
   */
  readonly proposedArtifactRef: ContentDigest;
  /** Append-only lineage: the digest of the PRIOR artifact version, or null. */
  readonly supersedes: ContentDigest | null;
  /** Globally reusable ONLY with explicit rights on every candidate (lock rules 31/32). */
  readonly globalReuse: boolean;
  readonly rights: {
    readonly status: CandidateRightsStatus;
    readonly statement: string;
  };
  readonly provenance: {
    readonly compiledBy: NeutralId;
    readonly notes: string | null;
  };
}

/** A frozen, content-addressed improvement program: the view plus its sha256 digest. */
export interface ImprovementProgram extends ImprovementProgramView {
  readonly digest: ContentDigest;
}

/** Stable field list for the program view (tests + parity mirror it). */
export const IMPROVEMENT_PROGRAM_FIELDS = Object.freeze([
  'recordVersion',
  'programId',
  'version',
  'tenantId',
  'interventionClass',
  'candidateRefs',
  'targetCapability',
  'baseline',
  'interventions',
  'experimentPlan',
  'proposedArtifactRef',
  'supersedes',
  'globalReuse',
  'rights',
  'provenance',
] as const);

export interface CompileProgramsOptions {
  /** Who compiled (provenance; deterministic — no timestamps inside the program digest). */
  readonly compiledBy: string;
  readonly notes?: string | null;
}

/** Structural (non-throwing) check for the digest-free program view. */
export function isImprovementProgramView(value: unknown): value is ImprovementProgramView {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return (
    candidate['recordVersion'] === IMPROVEMENT_PROGRAM_VERSION &&
    isNeutralId(candidate['programId']) &&
    isLearningVersion(candidate['version']) &&
    isNeutralId(candidate['tenantId']) &&
    isInterventionSurface(candidate['interventionClass']) &&
    Array.isArray(candidate['candidateRefs']) &&
    (candidate['candidateRefs'] as unknown[]).every((entry) => isContentDigest(entry)) &&
    typeof candidate['targetCapability'] === 'object' &&
    candidate['targetCapability'] !== null &&
    isContentDigest((candidate['targetCapability'] as Record<string, unknown>)['digest']) &&
    typeof candidate['baseline'] === 'object' &&
    candidate['baseline'] !== null &&
    Array.isArray(candidate['interventions']) &&
    isContentDigest(candidate['proposedArtifactRef']) &&
    (candidate['supersedes'] === null || isContentDigest(candidate['supersedes'])) &&
    typeof candidate['globalReuse'] === 'boolean' &&
    typeof candidate['rights'] === 'object' &&
    candidate['rights'] !== null &&
    typeof (candidate['rights'] as Record<string, unknown>)['status'] === 'string' &&
    typeof (candidate['rights'] as Record<string, unknown>)['statement'] === 'string' &&
    typeof candidate['provenance'] === 'object' &&
    candidate['provenance'] !== null &&
    isNeutralId((candidate['provenance'] as Record<string, unknown>)['compiledBy'])
  );
}

/** Structural (non-throwing) check for the full program (view + digest). */
export function isImprovementProgram(value: unknown): value is ImprovementProgram {
  if (!isImprovementProgramView(value)) return false;
  return isContentDigest((value as unknown as Record<string, unknown>)['digest']);
}

/** Deterministic program id: `cl-<tenant>-<surface>` (both sanitized to the LearningId charset). */
export function programIdFor(tenantId: string, interventionClass: InterventionSurface): string {
  const sanitize = (value: string): string =>
    value.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/^-+|-+$/g, '') || 'x';
  const id = `cl-${sanitize(tenantId)}-${sanitize(interventionClass)}`;
  return id.length > 64 ? id.slice(0, 64) : id;
}

/** Deterministic rights roll-up: the weakest grant wins; global reuse requires ALL candidates granted. */
function rollUpRights(
  candidates: readonly ImprovementCandidate[],
): { status: CandidateRightsStatus; statement: string } {
  const statuses = candidates.map((entry) => entry.rights.status);
  if (statuses.every((status) => status === 'granted-for-global-reuse')) {
    return {
      status: 'granted-for-global-reuse',
      statement: 'every compiled candidate carries an explicit global-reuse rights grant',
    };
  }
  if (statuses.every((status) => status !== 'insufficient')) {
    return {
      status: 'granted-tenant-scoped',
      statement: 'compiled candidates carry tenant-scoped rights only — the program stays tenant-scoped',
    };
  }
  return {
    status: 'insufficient',
    statement: 'at least one compiled candidate carries insufficient rights',
  };
}

/** Merge experiment plans of one class deterministically (union + sort; plan fields must agree). */
function mergeExperimentPlans(
  candidates: readonly ImprovementCandidate[],
): CandidateExperimentPlan {
  const first = candidates[0];
  if (first === undefined) {
    throw new CapabilityLearningError(CAPABILITY_LEARNING_ERROR_CODES.INVALID_INPUT, {
      message: 'experiment-plan merge requires at least one candidate',
    });
  }
  if (candidates.length === 1) {
    return first.experimentPlan;
  }
  const taskKey = (entry: { taskId: string; version: string }): string => `${entry.taskId}@${entry.version}`;
  const taskPopulation = Object.freeze(
    [...new Map(candidates.flatMap((c) => c.experimentPlan.taskPopulation).map((t) => [taskKey(t), t])).values()]
      .sort((a, b) => taskKey(a).localeCompare(taskKey(b))),
  );
  const evaluationSuiteRefs = Object.freeze(
    [...new Set(candidates.flatMap((c) => c.experimentPlan.evaluationSuiteRefs as readonly string[]))].sort(),
  );
  const verificationSuiteRefs = Object.freeze(
    [...new Set(candidates.flatMap((c) => c.experimentPlan.verificationSuiteRefs as readonly string[]))].sort(),
  );
  const envKey = (entry: CandidateArtifactRef): string => `${entry.namespace}/${entry.name}@${entry.version}`;
  const environmentVersions = Object.freeze(
    [...new Map(candidates.flatMap((c) => c.experimentPlan.environmentVersions).map((e) => [envKey(e), e])).values()]
      .sort((a, b) => envKey(a).localeCompare(envKey(b))),
  );
  const metricKey = (entry: { metricId: string }): string => entry.metricId;
  const outcomeMetrics = Object.freeze(
    [...new Map(candidates.flatMap((c) => c.experimentPlan.outcomeMetrics).map((m) => [metricKey(m), m])).values()]
      .sort((a, b) => metricKey(a).localeCompare(metricKey(b))),
  );
  const protectedKey = (entry: { ref: { digest: string } }): string => entry.ref.digest;
  const protectedCapabilities = Object.freeze(
    [...new Map(candidates.flatMap((c) => c.experimentPlan.protectedCapabilities).map((p) => [protectedKey(p), p])).values()]
      .sort((a, b) => protectedKey(a).localeCompare(protectedKey(b))),
  );
  return deepFreeze({
    taskPopulation,
    evaluationSuiteRefs,
    verificationSuiteRefs,
    environmentVersions,
    outcomeMetrics,
    uncertainty: deepFreeze({ ...first.experimentPlan.uncertainty }),
    protectedCapabilities,
  }) as CandidateExperimentPlan;
}

/**
 * THE COMPILER: deterministic compilation of candidates into typed
 * ImprovementPrograms — one per (tenant, LE1.0 intervention class).
 *
 * Ordering is canonical: candidates sorted by (changedSurface,
 * candidateId); programs emitted sorted by (tenantId,
 * interventionClass). Identical candidate sets ⇒ byte-identical
 * programs (verified by the determinism tests).
 */
export async function compilePrograms(
  candidates: readonly ImprovementCandidate[],
  options: CompileProgramsOptions,
): Promise<readonly CompilationOutcome[]> {
  if (!Array.isArray(candidates)) {
    throw new CapabilityLearningError(CAPABILITY_LEARNING_ERROR_CODES.INVALID_INPUT, {
      message: 'compilePrograms: candidates must be an array of improvement candidates',
    });
  }
  if (typeof options !== 'object' || options === null || typeof options.compiledBy !== 'string' || options.compiledBy.length === 0) {
    throw new CapabilityLearningError(CAPABILITY_LEARNING_ERROR_CODES.INVALID_INPUT, {
      message: 'compilePrograms: options.compiledBy must be a non-empty string (provenance)',
    });
  }
  const seen = new Set<string>();
  for (const candidate of candidates) {
    if (!isImprovementProgramInput(candidate)) {
      throw new CapabilityLearningError(CAPABILITY_LEARNING_ERROR_CODES.INVALID_CANDIDATE, {
        message: `compilePrograms: entry ${JSON.stringify(candidate?.candidateId)} is not a validated ImprovementCandidate (use createImprovementCandidate)`,
      });
    }
    const key = candidate.digest as string;
    if (seen.has(key)) continue;
    seen.add(key);
  }

  const ordered = [...seen]
    .map((digest) => candidates.find((entry) => (entry.digest as string) === digest) as ImprovementCandidate)
    .sort((a, b) =>
      (a.changedSurface as string).localeCompare(b.changedSurface as string) ||
      (a.candidateId as string).localeCompare(b.candidateId as string) ||
      (a.tenantId as string).localeCompare(b.tenantId as string),
    );

  const groups = new Map<string, ImprovementCandidate[]>();
  for (const candidate of ordered) {
    const groupKey = `${candidate.tenantId}::${candidate.changedSurface}`;
    const group = groups.get(groupKey);
    if (group === undefined) {
      groups.set(groupKey, [candidate]);
    } else {
      group.push(candidate);
    }
  }

  const outcomes: CompilationOutcome[] = [];
  const sortedGroupKeys = [...groups.keys()].sort((a, b) => {
    const [tenantA, surfaceA] = a.split('::') as [string, string];
    const [tenantB, surfaceB] = b.split('::') as [string, string];
    return tenantA.localeCompare(tenantB) || surfaceA.localeCompare(surfaceB);
  });

  for (const groupKey of sortedGroupKeys) {
    const group = groups.get(groupKey) as ImprovementCandidate[];
    const lead = group[0] as ImprovementCandidate;
    const interventionClass = lead.changedSurface as InterventionSurface;
    const tenantId = lead.tenantId as string;

    // ---- the closed block checks (typed reasons, never silent) ----
    const reasons: CompileBlockDetail[] = [];

    const rightsBlocking = group.filter(
      (entry) =>
        entry.globalReuseRequested === true &&
        entry.rights.status !== 'granted-for-global-reuse',
    );
    if (rightsBlocking.length > 0) {
      reasons.push({
        reason: 'rights-insufficient',
        candidateIds: Object.freeze(rightsBlocking.map((entry) => entry.candidateId as string)),
        basis: `candidate(s) request global reusability without an explicit 'granted-for-global-reuse' rights grant (lock rules 31/32: globally reusable outputs require explicit rights, provenance, validation and scope)`,
      });
    }

    const evidenceBlocking = group.filter((entry) => entry.evidenceRefs.length === 0);
    if (evidenceBlocking.length > 0) {
      reasons.push({
        reason: 'evidence-insufficient',
        candidateIds: Object.freeze(evidenceBlocking.map((entry) => entry.candidateId as string)),
        basis: 'candidate(s) carry no validated evidence digests (C009/C013/A012/A013 evidence is required before compilation)',
      });
    }

    const targets = new Set(
      group.map((entry) => entry.targetCapability.digest as string),
    );
    if (targets.size > 1) {
      reasons.push({
        reason: 'scope-conflict',
        candidateIds: Object.freeze(group.map((entry) => entry.candidateId as string)),
        basis: `candidates of tenant ${JSON.stringify(tenantId)} on intervention class ${JSON.stringify(interventionClass)} declare ${String(targets.size)} different target capabilities — one program per class has exactly ONE target capability`,
      });
    }

    if (reasons.length > 0) {
      outcomes.push({ kind: 'blocked', reasons: Object.freeze([...reasons]) });
      continue;
    }

    // ---- the compilable program (deterministic content) ----
    const candidateRefs = Object.freeze(
      group.map((entry) => entry.digest as string).sort(),
    ) as readonly ContentDigest[];
    const interventions = Object.freeze(
      group
        .slice()
        .sort((a, b) => (a.candidateId as string).localeCompare(b.candidateId as string))
        // A020 declares one intervention per artifact digest (the same
        // artifact declared twice is ambiguous) — deduplicate by digest,
        // keeping the first in candidate order (deterministic).
        .filter((entry, index, ordered) =>
          ordered.findIndex(
            (other) => (other.artifact.digest as string) === (entry.artifact.digest as string),
          ) === index,
        )
        .map((entry) =>
          Object.freeze({
            artifact: entry.artifact,
            changedSurface: entry.changedSurface,
          }),
        ),
    );
    const supersedesCandidates = group
      .map((entry) => entry.supersedes as string | null)
      .filter((value): value is string => value !== null)
      .sort();
    const supersedes: string | null =
      supersedesCandidates.length === 0 ? null : (supersedesCandidates[0] ?? null);
    const rights = rollUpRights(group);
    const globalReuse =
      group.every((entry) => entry.globalReuseRequested === true) &&
      rights.status === 'granted-for-global-reuse';

    const experimentPlan = mergeExperimentPlans(group);

    const view: Omit<ImprovementProgramView, 'proposedArtifactRef'> = {
      recordVersion: IMPROVEMENT_PROGRAM_VERSION,
      programId: toNeutralId(programIdFor(tenantId, interventionClass), 'improvement program programId'),
      version: toLearningVersion('1.0.0', 'improvement program version'),
      tenantId: toNeutralId(tenantId, 'improvement program tenantId'),
      interventionClass,
      candidateRefs,
      targetCapability: lead.targetCapability,
      baseline: lead.baseline,
      interventions,
      experimentPlan,
      supersedes: supersedes === null ? null : toContentDigest(supersedes, 'program supersedes'),
      globalReuse,
      rights: deepFreeze({
        status: rights.status,
        statement: rights.statement,
      }),
      provenance: deepFreeze({
        compiledBy: toNeutralId(options.compiledBy, 'improvement program provenance compiledBy'),
        notes: options.notes ?? null,
      }),
    };
    // The NEW versioned artifact: content-addressed over the program
    // content — never equal to an input digest by construction, and the
    // boundary module rejects any collision with historical digests.
    const proposedArtifactRef = toContentDigest(
      await digestCanonical({ program: view, artifactKind: 'capability-learning-program-output' }),
      'improvement program proposedArtifactRef',
    );

    const programView: ImprovementProgramView = {
      ...view,
      proposedArtifactRef,
    };
    const digest = toContentDigest(await digestCanonical(programView), 'improvement program digest');
    outcomes.push({
      kind: 'compilable',
      program: deepFreeze({ ...programView, digest }) as ImprovementProgram,
    });
  }

  return Object.freeze(outcomes);
}

function isImprovementProgramInput(value: unknown): value is ImprovementCandidate {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    isNeutralId(candidate['candidateId']) &&
    isInterventionSurface(candidate['changedSurface']) &&
    isContentDigest(candidate['digest']) &&
    isContentDigest(candidate['sourceRecordRef']) &&
    Array.isArray(candidate['evidenceRefs'])
  );
}

/** Strict re-parse of a program view (unknown fields rejected, structure enforced). */
export function toImprovementProgramView(value: unknown): ImprovementProgramView {
  if (!isImprovementProgramView(value)) {
    throw new CapabilityLearningError(CAPABILITY_LEARNING_ERROR_CODES.INVALID_PROGRAM, {
      message: 'improvement program parsing requires a structurally valid program view',
    });
  }
  return deepFreeze({ ...value }) as ImprovementProgramView;
}

/** The closed LE1.0 intervention classes this compiler emits programs for (parity surface). */
export const COMPILER_INTERVENTION_CLASSES: readonly InterventionSurface[] = Object.freeze([
  ...INTERVENTION_SURFACES,
]);
