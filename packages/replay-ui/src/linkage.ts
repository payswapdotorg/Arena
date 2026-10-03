/**
 * Replay result-linkage view model (Work Order B011; issue #86;
 * packages/replay-ui — the pure view-model layer).
 *
 * The EVALUATION / VERIFICATION RESULT LINKAGE of a replayed run: the
 * append-only EVIDENCE ADDRESSES the run produced (content digests —
 * never dereferenced here, only addressed), plus the evaluation records
 * and verification records linked to the run's trajectory digest. Every
 * linked artifact renders under its OWN truth class:
 *
 *   - an evidence address is EVIDENCE (an append-only content address);
 *   - an evaluation record is an EVALUATION RESULT (a score against
 *     explicit criteria — never a verification claim, never verified);
 *   - a verification record with a DECIDED outcome (pass | fail) is a
 *     VERIFIED FACT about what the verifier decided; an `unknown`
 *     outcome renders as UNKNOWN, never guessed;
 *   - an unreadable payload renders as UNKNOWN (degraded linkage row),
 *     never crash, never silently dropped.
 *
 * Structural validation reuses @arena/evaluation's and
 * @arena/verification's PUBLIC guards (`isEvaluationRecord`,
 * `isVerificationRecord`) — canonical objects projected, never a
 * parallel domain model.
 */

import { isEvaluationRecord } from '@arena/evaluation';
import type { EvaluationRecord } from '@arena/evaluation';
import { isVerificationRecord } from '@arena/verification';
import type { VerificationRecord } from '@arena/verification';
import {
  DECIDED_VERIFICATION_TRUTH_CLASS,
  EVIDENCE_ADDRESS_TRUTH_CLASS,
  EVALUATION_LINK_TRUTH_CLASS,
  UNKNOWN_TRUTH_CLASS,
} from './truth.js';
import type { ReplayTruthClass } from './truth.js';

// ---------------------------------------------------------------------------
// Evidence addresses (append-only content digests)
// ---------------------------------------------------------------------------

/** Where one evidence address came from (carried, rendered verbatim). */
export type EvidenceLinkSource =
  | 'trajectory-completion'
  | 'run-result'
  | 'verification-evidence';

/** One append-only evidence address. */
export interface EvidenceLinkModel {
  /** The content digest itself — the append-only evidence address. */
  readonly digest: string;
  readonly truthClass: ReplayTruthClass;
  readonly source: EvidenceLinkSource;
  readonly note: string;
}

const CONTENT_DIGEST_PATTERN = /^[0-9a-f]{64}$/;

/**
 * Project a list of evidence digests into evidence links. Malformed
 * entries (not 64-hex content digests) are NOT rendered as addresses —
 * they are counted and reported in the returned degradation note (an
 * address that is not an address is no datum at all, never a guess).
 */
export function toEvidenceLinks(
  digests: readonly unknown[],
  source: EvidenceLinkSource,
): { links: readonly EvidenceLinkModel[]; malformedCount: number } {
  const links: EvidenceLinkModel[] = [];
  let malformedCount = 0;
  for (const digest of digests) {
    if (typeof digest === 'string' && CONTENT_DIGEST_PATTERN.test(digest)) {
      links.push(
        Object.freeze({
          digest,
          truthClass: EVIDENCE_ADDRESS_TRUTH_CLASS,
          source,
          note: `append-only evidence address (${source}) — the digest identifies evidence content; it is not dereferenced by this viewer`,
        } satisfies EvidenceLinkModel),
      );
    } else {
      malformedCount += 1;
    }
  }
  return { links: Object.freeze(links), malformedCount };
}

// ---------------------------------------------------------------------------
// Evaluation linkage
// ---------------------------------------------------------------------------

/** One linked evaluation record (an evaluation result — never a verification claim). */
export interface EvaluationLinkModel {
  readonly recordId: string;
  readonly digest: string | null;
  /** The trajectory digest this record judged (the linkage binding). */
  readonly trajectoryRef: string | null;
  readonly criteriaRef: string | null;
  readonly evaluatorRef: string | null;
  readonly seed: string | null;
  readonly aggregateScore: number | null;
  readonly aggregateOutcome: string | null;
  readonly verdictCount: number | null;
  readonly startedAt: string | null;
  readonly finishedAt: string | null;
  readonly confidence: number | null;
  readonly truthClass: ReplayTruthClass;
  /** False when the payload failed the structural guard (degraded row). */
  readonly readable: boolean;
  readonly note: string;
}

/**
 * True iff an evaluation-record payload is structurally readable AND
 * judges the given trajectory digest (the linkage predicate the runtime
 * uses to bind records to a run).
 */
export function evaluationLinksTrajectory(payload: unknown, trajectoryDigest: string): boolean {
  return isEvaluationRecord(payload) && payload.trajectoryRef === trajectoryDigest;
}

/** Project ANY payload into one evaluation link row (total, never-throwing). */
export function toEvaluationLink(payload: unknown): EvaluationLinkModel {
  if (!isEvaluationRecord(payload)) {
    return Object.freeze({
      recordId: 'unreadable-evaluation',
      digest: null,
      trajectoryRef: null,
      criteriaRef: null,
      evaluatorRef: null,
      seed: null,
      aggregateScore: null,
      aggregateOutcome: null,
      verdictCount: null,
      startedAt: null,
      finishedAt: null,
      confidence: null,
      truthClass: UNKNOWN_TRUTH_CLASS,
      readable: false,
      note: 'evaluation payload failed the structural guard (isEvaluationRecord) — rendered as unknown, never guessed',
    } satisfies EvaluationLinkModel);
  }
  const record = payload as EvaluationRecord;
  return Object.freeze({
    recordId: record.digest,
    digest: record.digest,
    trajectoryRef: record.trajectoryRef,
    criteriaRef: record.criteriaRef,
    evaluatorRef: record.evaluatorRef,
    seed: record.seed,
    aggregateScore: record.aggregate.score,
    aggregateOutcome: record.aggregate.outcome,
    verdictCount: record.verdicts.length,
    startedAt: record.startedAt,
    finishedAt: record.finishedAt,
    confidence: record.confidence,
    truthClass: EVALUATION_LINK_TRUTH_CLASS,
    readable: true,
    note: 'an evaluation result — a score against an explicit, versioned criteria set under recorded run conditions; it is NOT a verification outcome and carries no evidence-support claim',
  } satisfies EvaluationLinkModel);
}

// ---------------------------------------------------------------------------
// Verification linkage
// ---------------------------------------------------------------------------

/** One linked verification record (evidence support — never a score). */
export interface VerificationLinkModel {
  readonly recordId: string;
  readonly digest: string | null;
  readonly verifierRef: string | null;
  /** pass | fail | unknown — the closed outcome vocabulary. */
  readonly outcome: string | null;
  /** The structured WHY of an unknown outcome (closed reason taxonomy), else null. */
  readonly unknownCause: { readonly reason: string; readonly detail: string } | null;
  readonly requirementsCount: number | null;
  readonly supportedCount: number | null;
  readonly evidenceDigests: readonly string[];
  readonly startedAt: string | null;
  readonly finishedAt: string | null;
  readonly truthClass: ReplayTruthClass;
  readonly readable: boolean;
  readonly note: string;
}

/** True iff a verification-record payload is structurally readable. */
export function isReadableVerificationLink(payload: unknown): boolean {
  return isVerificationRecord(payload);
}

/** Project ANY payload into one verification link row (total, never-throwing). */
export function toVerificationLink(payload: unknown): VerificationLinkModel {
  if (!isVerificationRecord(payload)) {
    return Object.freeze({
      recordId: 'unreadable-verification',
      digest: null,
      verifierRef: null,
      outcome: null,
      unknownCause: null,
      requirementsCount: null,
      supportedCount: null,
      evidenceDigests: Object.freeze([]),
      startedAt: null,
      finishedAt: null,
      truthClass: UNKNOWN_TRUTH_CLASS,
      readable: false,
      note: 'verification payload failed the structural guard (isVerificationRecord) — rendered as unknown, never guessed',
    } satisfies VerificationLinkModel);
  }
  const record = payload as VerificationRecord;
  const unknownCause =
    record.unknownCause === null
      ? null
      : Object.freeze({
          reason: String(record.unknownCause.reason),
          detail: String(record.unknownCause.detail),
        });
  const evidenceDigests = record.evidence.map((entry) => entry.artifact.digest);
  const supported = record.evidenceSupport.filter(
    (entry) => entry.status === 'present-supported',
  ).length;
  const decided = record.outcome === 'pass' || record.outcome === 'fail';
  return Object.freeze({
    recordId: record.digest,
    digest: record.digest,
    verifierRef: record.verifierRef,
    outcome: record.outcome,
    unknownCause,
    requirementsCount: record.evidenceSupport.length,
    supportedCount: supported,
    evidenceDigests: Object.freeze(evidenceDigests),
    startedAt: record.startedAt,
    finishedAt: record.finishedAt,
    truthClass: decided ? DECIDED_VERIFICATION_TRUTH_CLASS : UNKNOWN_TRUTH_CLASS,
    readable: true,
    note: decided
      ? 'a decided verification outcome (pass or fail) — a fact about what the named verifier decided, with its evidence and provenance; verification never emits a score'
      : 'the verification outcome is unknown — evidence was missing, unverified or indeterminate, so no verdict is guessed',
  } satisfies VerificationLinkModel);
}

// ---------------------------------------------------------------------------
// The whole linkage section
// ---------------------------------------------------------------------------

/** The complete result-linkage view model of one replayed run. */
export interface ReplayLinkageModel {
  readonly evidence: readonly EvidenceLinkModel[];
  readonly evaluations: readonly EvaluationLinkModel[];
  readonly verifications: readonly VerificationLinkModel[];
  /** Degradation notes (malformed digests / unreadable records) — empty when fully readable. */
  readonly degradation: readonly string[];
}

/**
 * Assemble the linkage view model from raw payloads. Total and
 * never-throwing: unreadable records become degraded rows; malformed
 * evidence digests are counted (never rendered as addresses).
 */
export function toReplayLinkage(input: {
  readonly trajectoryEvidenceDigests?: readonly unknown[];
  readonly runResultEvidenceDigests?: readonly unknown[];
  readonly evaluationRecords?: readonly unknown[];
  readonly verificationRecords?: readonly unknown[];
}): ReplayLinkageModel {
  const degradation: string[] = [];
  const evidence: EvidenceLinkModel[] = [];
  const seen = new Set<string>();

  const fromTrajectory = toEvidenceLinks(
    input.trajectoryEvidenceDigests ?? [],
    'trajectory-completion',
  );
  for (const link of fromTrajectory.links) {
    if (!seen.has(link.digest)) {
      seen.add(link.digest);
      evidence.push(link);
    }
  }
  if (fromTrajectory.malformedCount > 0) {
    degradation.push(
      `${String(fromTrajectory.malformedCount)} malformed trajectory evidence address(es) were not rendered (not 64-hex content digests)`,
    );
  }

  const fromResult = toEvidenceLinks(
    input.runResultEvidenceDigests ?? [],
    'run-result',
  );
  for (const link of fromResult.links) {
    if (!seen.has(link.digest)) {
      seen.add(link.digest);
      evidence.push(link);
    }
  }
  if (fromResult.malformedCount > 0) {
    degradation.push(
      `${String(fromResult.malformedCount)} malformed run-result evidence address(es) were not rendered (not 64-hex content digests)`,
    );
  }

  const evaluations: EvaluationLinkModel[] = [];
  for (const payload of input.evaluationRecords ?? []) {
    const link = toEvaluationLink(payload);
    if (!link.readable) {
      degradation.push('one evaluation payload was unreadable and renders as unknown');
    }
    evaluations.push(link);
  }

  const verifications: VerificationLinkModel[] = [];
  for (const payload of input.verificationRecords ?? []) {
    const link = toVerificationLink(payload);
    if (!link.readable) {
      degradation.push('one verification payload was unreadable and renders as unknown');
    }
    // Verification evidence addresses render as evidence links too (they
    // are append-only addresses referenced by the linked record).
    for (const digest of link.evidenceDigests) {
      if (!seen.has(digest)) {
        seen.add(digest);
        evidence.push(
          Object.freeze({
            digest,
            truthClass: EVIDENCE_ADDRESS_TRUTH_CLASS,
            source: 'verification-evidence',
            note: 'append-only evidence address (referenced by a linked verification record) — the digest identifies evidence content; it is not dereferenced by this viewer',
          } satisfies EvidenceLinkModel),
        );
      }
    }
    verifications.push(link);
  }

  return Object.freeze({
    evidence: Object.freeze(evidence),
    evaluations: Object.freeze(evaluations),
    verifications: Object.freeze(verifications),
    degradation: Object.freeze(degradation),
  } satisfies ReplayLinkageModel);
}
