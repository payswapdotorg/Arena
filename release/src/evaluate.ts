/**
 * The launch-readiness evaluator (REL1.0): the fail-closed decision
 * function that turns gate/checklist/security/performance outcomes
 * into a Go/No-Go verdict.
 *
 * A release is GO only when ALL of the following hold; anything else
 * is NO-GO:
 *   - every health-gate evaluation passed (A035 wiring, DEP1.0);
 *   - the OPS1.0 checklist verdict is 'go';
 *   - the A034 security verdict is 'pass';
 *   - the PERF1.0 suite verdict is 'pass';
 *   - the evidence set cites every REQUIRED evidence kind, each with
 *     a valid content digest (unsigned/unverified artifacts are
 *     rejected — never a pass).
 *
 * MISSING input fails closed: absent gates, absent checklist, absent
 * security verdict or absent performance verdict are all NO-GO.
 */

import type { HealthGateEvaluation } from '@arena/deploy';
import { isDigestHex, isEvidenceKind } from './shared.js';
import { RELEASE_ERROR_CODES, ReleaseError } from './shared.js';
import type { EvidenceKind, LaunchVerdict } from './shared.js';
import type { ReleaseEvidenceCitation } from './record.js';

/** The outcome inputs of one launch-readiness decision. */
export interface LaunchReadinessInput {
  readonly gateEvaluations: readonly HealthGateEvaluation[] | null;
  readonly checklistVerdict: 'go' | 'no-go' | null;
  readonly securityVerdict: 'pass' | 'fail' | null;
  readonly performanceVerdict: 'pass' | 'fail' | null;
  readonly evidence: readonly ReleaseEvidenceCitation[];
}

/** Evidence kinds a GO record MUST cite (closed completeness rule). */
export const REQUIRED_EVIDENCE_KINDS: readonly EvidenceKind[] = Object.freeze([
  'health-gate-report',
  'performance-evidence',
  'security-audit',
  'checklist-evaluation',
  'manifest',
]);

/** The frozen result of a launch-readiness evaluation. */
export interface LaunchReadinessResult {
  readonly verdict: LaunchVerdict;
  readonly reasons: readonly string[];
}

/** Evaluate launch readiness (pure, fail-closed). */
export function evaluateLaunchReadiness(input: LaunchReadinessInput): LaunchReadinessResult {
  const reasons: string[] = [];

  if (input.gateEvaluations === null) {
    reasons.push('health-gate evaluations missing (fail-closed: no-data is not a pass)');
  } else if (input.gateEvaluations.length === 0) {
    reasons.push('no health-gate evaluations supplied (fail-closed)');
  } else {
    const failed = input.gateEvaluations.filter((evaluation) => !evaluation.passed);
    if (failed.length > 0) {
      reasons.push(
        `SLO-violating release rejected: ${failed
          .map((evaluation) => `${evaluation.gateId}=${evaluation.observedVerdict}`)
          .join(', ')}`,
      );
    }
  }

  if (input.checklistVerdict === null) {
    reasons.push('checklist verdict missing (fail-closed)');
  } else if (input.checklistVerdict !== 'go') {
    reasons.push(`checklist verdict is ${input.checklistVerdict}`);
  }

  if (input.securityVerdict === null) {
    reasons.push('security verdict missing (fail-closed)');
  } else if (input.securityVerdict !== 'pass') {
    reasons.push(`security verdict is ${input.securityVerdict}`);
  }

  if (input.performanceVerdict === null) {
    reasons.push('performance verdict missing (fail-closed)');
  } else if (input.performanceVerdict !== 'pass') {
    reasons.push(`performance verdict is ${input.performanceVerdict}`);
  }

  // Evidence completeness: every required kind cited with a valid digest.
  for (const kind of REQUIRED_EVIDENCE_KINDS) {
    const citations = input.evidence.filter((citation) => citation.kind === kind);
    if (citations.length === 0) {
      reasons.push(`missing evidence of kind "${kind}"`);
      continue;
    }
    for (const citation of citations) {
      if (!isDigestHex(citation.digest)) {
        throw new ReleaseError(
          RELEASE_ERROR_CODES.UNSIGNED_EVIDENCE,
          `evidence "${citation.path}" (${kind}) is unsigned: digest missing or malformed`,
        );
      }
      if (!isEvidenceKind(citation.kind)) {
        throw new ReleaseError(
          RELEASE_ERROR_CODES.UNSIGNED_EVIDENCE,
          `evidence "${citation.path}" has an unknown kind`,
        );
      }
    }
  }

  return { verdict: reasons.length === 0 ? 'go' : 'no-go', reasons };
}
