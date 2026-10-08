/**
 * The LE1.0 LEARNING BOUNDARY wall of the compiler (Work Order C022;
 * spec/learning.md "Learning boundary"; architecture-lock rule 6 —
 * historical evidence is append-only).
 *
 * LE1.0: "Learning may produce a new Body Version. Learning may never
 * rewrite historical trajectories, task/environment versions,
 * certification evidence or original customer records."
 *
 * The compiler enforces the wall at THREE layers (mirroring A020's
 * precedent, specialized to the compile path):
 *
 *   1. READ-ONLY candidates — candidates handed to the compiler are
 *      deep-frozen views; the compiler never mutates them;
 *   2. NEW CONTENT-ADDRESSED OUTPUTS — the proposed artifact digest is
 *      computed over the program content (a new versioned artifact by
 *      construction; supersession is append-only and names the PRIOR
 *      artifact);
 *   3. REWRITE DETECTION — enforceCompilerBoundary rejects a program
 *      whose proposedArtifactRef collides with ANY historical digest the
 *      compilation consumed (source records, evidence refs, superseded
 *      priors, artifact digests and candidate digests). Proposing a
 *      historical artifact as the output of learning is a rewrite
 *      attempt by construction — CAPABILITY_LEARNING_BOUNDARY_VIOLATION.
 */

import {
  deepFreeze,
  isContentDigest,
} from '@arena/learning';
import type { ContentDigest } from '@arena/learning';
import { CAPABILITY_LEARNING_ERROR_CODES, CapabilityLearningError } from './errors.js';
import type { ImprovementCandidate } from './candidate.js';
import { historicalDigestsOfCandidate } from './candidate.js';
import type { ImprovementProgram } from './program.js';
import { isImprovementProgram } from './program.js';

/** Wire version of the compile-boundary decision record. */
export const COMPILE_BOUNDARY_VERSION = 1 as const;

/**
 * The set of historical digests one compilation consumed: every
 * candidate digest, every source record digest, every evidence digest,
 * every superseded prior and every intervention artifact digest. The
 * compiler may NEVER propose any of these as its own output.
 */
export function historicalDigestsOfCompilation(
  candidates: readonly ImprovementCandidate[],
): readonly string[] {
  const digests = new Set<string>();
  for (const candidate of candidates) {
    digests.add(candidate.digest as string);
    for (const historical of historicalDigestsOfCandidate(candidate)) {
      digests.add(historical);
    }
    digests.add(candidate.artifact.digest as string);
  }
  return Object.freeze([...digests]);
}

/**
 * THE compile-boundary guard: reject a program whose proposed artifact
 * digest (or supersession) collides with ANY historical digest the
 * compilation consumed. Accepts the program otherwise — learning
 * proposes NEW content-addressed objects; history stays append-only.
 */
export function enforceCompilerBoundary(
  historical: readonly string[],
  program: ImprovementProgram,
): void {
  if (!isImprovementProgram(program)) {
    throw new CapabilityLearningError(CAPABILITY_LEARNING_ERROR_CODES.INVALID_PROGRAM, {
      message: 'compile boundary requires a validated ImprovementProgram',
    });
  }
  const historicalSet = new Set(historical);
  if (historicalSet.has(program.proposedArtifactRef as string)) {
    throw new CapabilityLearningError(CAPABILITY_LEARNING_ERROR_CODES.BOUNDARY_VIOLATION, {
      message: `learning boundary violation: program ${program.programId} proposes artifact digest ${(program.proposedArtifactRef as string).slice(0, 16)}… which IS a historical digest the compilation consumed — the compiler never rewrites historical trajectories, task/environment versions, certification evidence or original customer records (LE1.0 learning boundary)`,
      details: {
        programId: program.programId as string,
        proposedArtifactRef: program.proposedArtifactRef as string,
      },
    });
  }
  if (
    program.supersedes !== null &&
    (program.supersedes as string) === (program.proposedArtifactRef as string)
  ) {
    throw new CapabilityLearningError(CAPABILITY_LEARNING_ERROR_CODES.BOUNDARY_VIOLATION, {
      message: 'learning boundary violation: a program cannot supersede its own proposed artifact (append-only supersession names a DIFFERENT prior artifact)',
      details: { programId: program.programId as string },
    });
  }
}

/** Compile AND boundary-check a program in one step (rewrite attempts never yield a program). */
export function checkProgramBoundary(
  program: ImprovementProgram,
  candidates: readonly ImprovementCandidate[],
): ImprovementProgram {
  enforceCompilerBoundary(historicalDigestsOfCompilation(candidates), program);
  return program;
}

/** A frozen compile-boundary decision (inspectable evidence of the wall). */
export interface CompileBoundaryDecision {
  readonly recordVersion: typeof COMPILE_BOUNDARY_VERSION;
  readonly programId: string;
  readonly historicalDigestCount: number;
  readonly proposedArtifactRef: ContentDigest;
  readonly ok: true;
}

/** Record the boundary decision for an accepted program (append-only audit material). */
export function boundaryDecisionOf(
  program: ImprovementProgram,
  candidates: readonly ImprovementCandidate[],
): CompileBoundaryDecision {
  checkProgramBoundary(program, candidates);
  const historical = historicalDigestsOfCompilation(candidates);
  return deepFreeze({
    recordVersion: COMPILE_BOUNDARY_VERSION,
    programId: program.programId as string,
    historicalDigestCount: historical.length,
    proposedArtifactRef: program.proposedArtifactRef,
    ok: true as const,
  });
}

/** Structural check (non-throwing) for a boundary decision. */
export function isCompileBoundaryDecision(value: unknown): value is CompileBoundaryDecision {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return (
    candidate['recordVersion'] === COMPILE_BOUNDARY_VERSION &&
    typeof candidate['programId'] === 'string' &&
    typeof candidate['historicalDigestCount'] === 'number' &&
    isContentDigest(candidate['proposedArtifactRef']) &&
    candidate['ok'] === true
  );
}
