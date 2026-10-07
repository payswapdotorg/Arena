/**
 * The KnowledgePatch (Work Order C008) — the scoped, rights-carrying,
 * evidence-backed statement that A019/A020 consume as a LEARNING
 * CANDIDATE ONLY.
 *
 * A patch is cut from a lattice record in a REUSABLE tier with GRANTED
 * rights and non-empty evidence. Task-specific guidance can NEVER become
 * a patch (fail-closed KNOWLEDGE_CAPTURE_PATCH_DENIED) — that is the
 * EES1.0 no-silent-promotion law applied at the learning boundary. The
 * patch carries `candidateOnly: true` STRUCTURALLY: it presents itself as
 * a learning candidate, never as established global truth, and it is a
 * NEW append-only object (the source record is untouched).
 */

import { KNOWLEDGE_CAPTURE_ERROR_CODES, KnowledgeCaptureError } from './errors.js';
import { isReusableTier } from './lattice.js';
import type { LatticeKnowledgeRecord } from './lattice.js';
import { isKnowledgeScopeDeclaration } from './scope.js';
import type { KnowledgeScopeDeclaration } from './scope.js';
import type { ConsentRightsStatement, KnowledgeTier } from '@arena/expert-session';
import type { KnowledgePatchId } from './shared.js';
import { isKnowledgePatchId, newKnowledgePatchId, toKnowledgeCaptureTimestamp } from './shared.js';

/** Wire version of the knowledge patch shape. */
export const KNOWLEDGE_PATCH_VERSION = 1 as const;

/** The learning-candidate patch A019/A020 consume (never global truth). */
export interface KnowledgePatch {
  readonly patchVersion: typeof KNOWLEDGE_PATCH_VERSION;
  readonly patchId: KnowledgePatchId;
  /** The lattice record the patch was cut from (append-only lineage). */
  readonly sourceRecordId: string;
  readonly tier: KnowledgeTier;
  /** The knowledge statement itself. */
  readonly statement: string;
  /** The structured scope the statement is claimed within. */
  readonly scope: KnowledgeScopeDeclaration;
  /** Evidence backing the statement (non-empty). */
  readonly evidenceRefs: readonly string[];
  readonly validation: {
    readonly state: 'unvalidated' | 'validated';
    readonly validationRef: string | null;
  };
  /** The GRANTED rights/consent statement backing reuse. */
  readonly rights: ConsentRightsStatement;
  readonly provenance: {
    readonly tenantId: string;
    readonly interventionId: string;
    readonly requestId: string;
    readonly sessionId: string;
    readonly expertRef: string | null;
  };
  readonly correlation: {
    readonly correlationId: string;
    readonly captureKey: string;
  };
  /**
   * STRUCTURAL learning-candidate marker: a patch is a proposal into the
   * A019/A020 learning surfaces — never an established universal fact.
   */
  readonly candidateOnly: true;
  readonly issuedAt: string;
}

export interface CreateKnowledgePatchInput {
  readonly record: LatticeKnowledgeRecord;
  readonly now: number | string | Date;
  readonly patchId?: string;
}

/**
 * Cut a KnowledgePatch from a lattice record (fail-closed):
 *   - the record's tier must be reusable (task-specific guidance can
 *     NEVER become a patch — the no-silent-promotion wall);
 *   - rights must be GRANTED;
 *   - evidence must be non-empty (guaranteed by the record constructor,
 *     re-checked here for wire-loaded records).
 */
export function createKnowledgePatch(input: CreateKnowledgePatchInput): KnowledgePatch {
  if (typeof input !== 'object' || input === null) {
    throw new KnowledgeCaptureError(KNOWLEDGE_CAPTURE_ERROR_CODES.PATCH_DENIED, {
      message: 'patch input must be an object',
    });
  }
  const record = input.record;
  if (!isKnowledgeScopeDeclaration(record.scope)) {
    throw new KnowledgeCaptureError(KNOWLEDGE_CAPTURE_ERROR_CODES.INVALID_SCOPE, {
      message: 'source record carries an invalid scope declaration',
    });
  }
  if (!isReusableTier(record.artifact.tier)) {
    throw new KnowledgeCaptureError(KNOWLEDGE_CAPTURE_ERROR_CODES.PATCH_DENIED, {
      message: `task-specific guidance can never become a learning patch (tier: ${record.artifact.tier}) — promote explicitly through the lattice first`,
      details: { tier: record.artifact.tier },
      correlationId: record.correlation.correlationId,
    });
  }
  if (record.rights === null || !record.rights.granted) {
    throw new KnowledgeCaptureError(KNOWLEDGE_CAPTURE_ERROR_CODES.PATCH_DENIED, {
      message: 'a knowledge patch requires GRANTED rights/consent (lock rule 31)',
      details: { tier: record.artifact.tier },
      correlationId: record.correlation.correlationId,
    });
  }
  if (record.evidenceRefs.length === 0) {
    throw new KnowledgeCaptureError(KNOWLEDGE_CAPTURE_ERROR_CODES.MISSING_EVIDENCE, {
      message: 'a knowledge patch requires non-empty evidence',
      correlationId: record.correlation.correlationId,
    });
  }
  const patchId =
    input.patchId === undefined
      ? newKnowledgePatchId()
      : isKnowledgePatchId(input.patchId)
        ? input.patchId
        : (() => {
            throw new KnowledgeCaptureError(KNOWLEDGE_CAPTURE_ERROR_CODES.PATCH_DENIED, {
              message: `patchId is invalid: ${JSON.stringify(input.patchId)}`,
            });
          })();

  const patch: KnowledgePatch = Object.freeze({
    patchVersion: KNOWLEDGE_PATCH_VERSION,
    patchId,
    sourceRecordId: record.recordId,
    tier: record.artifact.tier,
    statement: record.artifact.statement,
    scope: Object.freeze({ kind: record.scope.kind, ref: record.scope.ref }),
    evidenceRefs: Object.freeze([...record.evidenceRefs]),
    validation: Object.freeze({
      state: record.validation.state,
      validationRef: record.validation.validationRef,
    }),
    rights: record.rights,
    provenance: Object.freeze({
      tenantId: record.provenance.tenantId,
      interventionId: record.provenance.interventionId,
      requestId: record.provenance.requestId,
      sessionId: record.provenance.sessionId,
      expertRef: record.provenance.expertRef,
    }),
    correlation: Object.freeze({
      correlationId: record.correlation.correlationId,
      captureKey: record.correlation.captureKey,
    }),
    candidateOnly: true,
    issuedAt: toKnowledgeCaptureTimestamp(input.now),
  });
  return patch;
}

/** Structural guard for wire values claiming to be knowledge patches. */
export function isKnowledgePatch(value: unknown): value is KnowledgePatch {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    candidate['patchVersion'] === KNOWLEDGE_PATCH_VERSION &&
    isKnowledgePatchId(candidate['patchId']) &&
    typeof candidate['sourceRecordId'] === 'string' &&
    candidate['sourceRecordId'].length > 0 &&
    typeof candidate['statement'] === 'string' &&
    candidate['statement'].length > 0 &&
    isKnowledgeScopeDeclaration(candidate['scope']) &&
    Array.isArray(candidate['evidenceRefs']) &&
    candidate['evidenceRefs'].length > 0 &&
    candidate['candidateOnly'] === true
  );
}
