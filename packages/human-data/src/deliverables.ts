/**
 * The human-data DELIVERABLE contract (Work Order C012; issue #118) — typed
 * records derived ONLY from C009-ACCEPTED intervention outputs.
 *
 * A deliverable is the per-item unit of a commissioned dataset:
 *   - a CORRECTION PAIR (before/after + evidence refs) from a C001
 *     correction result;
 *   - a DEMONSTRATION TRAJECTORY from a C001 solution result + the EES1.0
 *     bounded-session replay trace (state → human action → observable
 *     consequence → evidence — visibly a bounded session, NEVER a
 *     live-world mutation: the replay law is enforced here);
 *   - an EVALUATION CASE from a C001 evaluation-verdict result;
 *   - a SCOPED KNOWLEDGE ARTIFACT from a C001 knowledge-patch result.
 *
 * Every record is rights-carrying (an explicit GRANTED consent/rights
 * statement + A002 rights metadata), provenance-addressed (the source
 * escalation request, the C009 adjudication verdict, the mode, the attempt —
 * architecture-lock rules 18/31) and tenant-scoped.
 *
 * THE VALIDATION GATE: deriveDeliverable rejects anything whose C009
 * adjudication verdict is not ACCEPTED — there are NO self-certified
 * deliverables (the acceptance of an item is decided by the C009 seam, not
 * by the studio, the expert or the customer).
 */

import { digestCanonical } from '@arena/protocol-core';
import type { AdjudicationOutcome } from '@arena/escalation-validation';
import type { EscalationResult } from '@arena/escalation';
import type { CorrectionResult, EvaluationVerdictResult, KnowledgePatchResult, SolutionResult } from '@arena/escalation';
import { isEscalationResult } from '@arena/escalation';
import type { ReplayTrace } from '@arena/expert-session';
import { isReplayTrace } from '@arena/expert-session';
import type { RightsMetadata } from '@arena/artifact-protocol';
import { HUMAN_DATA_ERROR_CODES, HumanDataError } from './errors.js';
import type { CommissionDeliverableKind, HumanDataCommission } from './commission.js';
import { KIND_RESULT_KINDS } from './commission.js';
import type { ConsentRightsStatement } from './rights.js';
import { requireGrantedConsent, toConsentRightsStatement, toRightsPosture } from './rights.js';
import type { PlainJsonValue } from './shared.js';
import { deepFreeze, requireStringArray, toDeliverableId, toIsoTimestamp } from './shared.js';

/** Wire version of the deliverable shape. */
export const DELIVERABLE_VERSION = 1 as const;

/** The singular record kinds (one per commissioned item). */
export const DELIVERABLE_RECORD_KINDS = Object.freeze([
  'correction-pair',
  'demonstration',
  'evaluation-case',
  'knowledge-artifact',
] as const);
export type DeliverableRecordKind = (typeof DELIVERABLE_RECORD_KINDS)[number];

/** Commission kind (plural) → record kind (singular). */
export const COMMISSION_KIND_RECORD_KINDS: Readonly<
  Record<CommissionDeliverableKind, DeliverableRecordKind>
> = Object.freeze({
  'correction-pairs': 'correction-pair',
  demonstrations: 'demonstration',
  'evaluation-cases': 'evaluation-case',
  'knowledge-artifacts': 'knowledge-artifact',
});

// ---------------------------------------------------------------------------
// Per-kind payloads (closed shapes)
// ---------------------------------------------------------------------------

/** A correction pair: the referenced original, the replacement, evidence. */
export interface CorrectionPairPayload {
  readonly recordKind: 'correction-pair';
  readonly correctedRef: string;
  /** The original material the correction applies to (host-supplied snapshot). */
  readonly before: PlainJsonValue | null;
  readonly after: PlainJsonValue;
  readonly evidenceRefs: readonly string[];
}

/** A demonstration trajectory: the EES1.0 replay trace (never a live mutation). */
export interface DemonstrationPayload {
  readonly recordKind: 'demonstration';
  readonly summary: string;
  readonly steps: readonly string[];
  readonly trace: ReplayTrace;
  readonly evidenceRefs: readonly string[];
}

/** An evaluation case: the subject, the verdict, evidence. */
export interface EvaluationCasePayload {
  readonly recordKind: 'evaluation-case';
  readonly subjectRef: string;
  readonly verdict: 'pass' | 'fail' | 'inconclusive';
  readonly evidenceRefs: readonly string[];
}

/** A scoped knowledge artifact: the statement, its scope, evidence. */
export interface KnowledgeArtifactPayload {
  readonly recordKind: 'knowledge-artifact';
  readonly statement: string;
  readonly scope: string;
  readonly evidenceRefs: readonly string[];
}

export type DeliverablePayload =
  | CorrectionPairPayload
  | DemonstrationPayload
  | EvaluationCasePayload
  | KnowledgeArtifactPayload;

// ---------------------------------------------------------------------------
// The deliverable record
// ---------------------------------------------------------------------------

/** Provenance address of the deliverable's source (lock rules 18/31). */
export interface DeliverableSourceProvenance {
  readonly escalationRequestId: string;
  readonly adjudicationVerdictId: string;
  readonly adjudicatedAt: string;
  readonly attemptNumber: number;
  readonly escalationMode: string;
  readonly resultKind: string;
}

export interface DeliverableRecord {
  readonly deliverableVersion: typeof DELIVERABLE_VERSION;
  readonly deliverableId: string;
  readonly commissionId: string;
  readonly tenantId: string;
  readonly recordKind: DeliverableRecordKind;
  readonly sourceProvenance: DeliverableSourceProvenance;
  readonly rights: RightsMetadata;
  readonly consent: ConsentRightsStatement;
  readonly payload: DeliverablePayload;
  readonly createdAt: string;
  /** sha256 over the canonical digest-free view. */
  readonly digest: string;
}

function digestFreeView(record: Omit<DeliverableRecord, 'digest'>): Record<string, unknown> {
  return {
    deliverableVersion: record.deliverableVersion,
    deliverableId: record.deliverableId,
    commissionId: record.commissionId,
    tenantId: record.tenantId,
    recordKind: record.recordKind,
    sourceProvenance: record.sourceProvenance,
    rights: record.rights,
    consent: record.consent,
    payload: record.payload,
    createdAt: record.createdAt,
  };
}

// ---------------------------------------------------------------------------
// Derivation (ONLY from C009-ACCEPTED outputs)
// ---------------------------------------------------------------------------

/** The accepted deliverable source a host collects from the C009/C006 seams. */
export interface AcceptedDeliverableSourceInput {
  readonly commission: HumanDataCommission;
  /** The C001 escalation result of the commissioned item. */
  readonly result: EscalationResult;
  /** The C009 adjudication outcome that judged the result. */
  readonly adjudication: AdjudicationOutcome;
  /** The EES1.0 consent/rights statement collected at session completion. */
  readonly consent: { granted: boolean; statement: string };
  /** The bounded-session replay trace (REQUIRED for demonstrations). */
  readonly demonstrationTrace?: ReplayTrace;
  /** The original material snapshot (correction pairs). */
  readonly originalSnapshot?: PlainJsonValue;
  /** Injected record time (epoch ms / ISO string / Date) — never a wall-clock read. */
  readonly now: number | string | Date;
}

/**
 * Derive a deliverable record from a C009-ACCEPTED intervention output.
 * Fail-closed walls, in order:
 *   1. THE VALIDATION GATE — adjudication.verdict MUST be 'ACCEPTED'
 *      (no self-certified deliverables);
 *   2. tenant match — the adjudication's tenant must be the commission's
 *      tenant (cross-tenant derivation is rejected);
 *   3. result-kind match — the result kind must be the one the commission's
 *      deliverable kind maps onto (KIND_RESULT_KINDS);
 *   4. THE CONSENT WALL — an explicit GRANTED consent/rights statement is
 *      required (EES1.0 mirror);
 *   5. THE REPLAY LAW — demonstrations require a structurally valid
 *      bounded-session replay trace with liveMutation === false (a record
 *      masquerading as a live-world mutation is rejected).
 */
export async function deriveDeliverable(
  input: AcceptedDeliverableSourceInput,
): Promise<DeliverableRecord> {
  const { commission } = input;
  if (!isEscalationResult(input.result)) {
    throw new HumanDataError(HUMAN_DATA_ERROR_CODES.INVALID_DELIVERABLE, {
      message: 'the deliverable source result is not a structurally valid EscalationResult',
    });
  }
  if (input.adjudication.verdict !== 'ACCEPTED') {
    throw new HumanDataError(HUMAN_DATA_ERROR_CODES.VALIDATION_GATE, {
      message: `deliverables derive ONLY from C009-ACCEPTED intervention outputs — the adjudication verdict for escalation ${JSON.stringify(input.adjudication.requestId)} is ${JSON.stringify(input.adjudication.verdict)} (no self-certified deliverables)`,
      details: {
        requestId: input.adjudication.requestId,
        verdict: input.adjudication.verdict,
        attemptNumber: input.adjudication.attemptNumber,
      },
    });
  }
  if (input.adjudication.tenantId !== commission.tenantId) {
    throw new HumanDataError(HUMAN_DATA_ERROR_CODES.CROSS_TENANT, {
      message: `cross-tenant deliverable derivation rejected: adjudication tenant ${JSON.stringify(input.adjudication.tenantId)} is not the commission tenant ${JSON.stringify(commission.tenantId)} (customer data is never used across tenants)`,
      details: {
        commissionTenant: commission.tenantId,
        adjudicationTenant: input.adjudication.tenantId,
      },
    });
  }
  const expectedResultKind = KIND_RESULT_KINDS[commission.deliverableKind];
  if (input.result.kind !== expectedResultKind) {
    throw new HumanDataError(HUMAN_DATA_ERROR_CODES.INVALID_DELIVERABLE, {
      message: `the escalation result kind ${JSON.stringify(input.result.kind)} does not match the commissioned deliverable kind ${JSON.stringify(commission.deliverableKind)} (expected result kind ${JSON.stringify(expectedResultKind)})`,
      details: { deliverableKind: commission.deliverableKind, expectedResultKind },
    });
  }
  const consent = requireGrantedConsent(
    toConsentRightsStatement(input.consent),
    `the deliverable derived from escalation ${JSON.stringify(input.adjudication.requestId)}`,
  );
  const rights = toRightsPosture(commission.rights);

  const evidenceRefs = Object.freeze([
    ...input.adjudication.verificationStage.evidenceRefs,
    `adjudication:${input.adjudication.verdictId}`,
  ]);

  let payload: DeliverablePayload;
  const recordKind = COMMISSION_KIND_RECORD_KINDS[commission.deliverableKind];
  switch (recordKind) {
    case 'correction-pair': {
      const result = input.result as CorrectionResult;
      payload = Object.freeze({
        recordKind: 'correction-pair',
        correctedRef: result.correctedRef,
        before: input.originalSnapshot ?? null,
        after: result.replacement,
        evidenceRefs,
      });
      break;
    }
    case 'demonstration': {
      const result = input.result as SolutionResult;
      const trace = input.demonstrationTrace;
      if (trace === undefined || !isReplayTrace(trace)) {
        throw new HumanDataError(HUMAN_DATA_ERROR_CODES.REPLAY_LAW, {
          message: 'a demonstration deliverable REQUIRES a structurally valid EES1.0 bounded-session replay trace (state → human action → observable consequence → evidence)',
        });
      }
      if (trace.liveMutation !== false) {
        throw new HumanDataError(HUMAN_DATA_ERROR_CODES.REPLAY_LAW, {
          message: 'the replay law is violated: a demonstration record may never masquerade as a live-world mutation (liveMutation must be false)',
          details: { liveMutation: trace.liveMutation },
        });
      }
      payload = Object.freeze({
        recordKind: 'demonstration',
        summary: result.summary,
        steps: Object.freeze([...result.steps]),
        trace,
        evidenceRefs,
      });
      break;
    }
    case 'evaluation-case': {
      const result = input.result as EvaluationVerdictResult;
      payload = Object.freeze({
        recordKind: 'evaluation-case',
        subjectRef: result.subjectRef,
        verdict: result.verdict,
        evidenceRefs,
      });
      break;
    }
    case 'knowledge-artifact': {
      const result = input.result as KnowledgePatchResult;
      payload = Object.freeze({
        recordKind: 'knowledge-artifact',
        statement: result.statement,
        scope: result.scope,
        evidenceRefs,
      });
      break;
    }
  }

  const deliverableId = toDeliverableId(
    `del_${(await digestCanonical({ requestId: input.adjudication.requestId, recordKind })).slice(0, 32)}`,
  );
  const createdAt = toIsoTimestamp(input.now);

  const view: Omit<DeliverableRecord, 'digest'> = deepFreeze({
    deliverableVersion: DELIVERABLE_VERSION,
    deliverableId,
    commissionId: commission.commissionId,
    tenantId: commission.tenantId,
    recordKind,
    sourceProvenance: Object.freeze({
      escalationRequestId: input.adjudication.requestId,
      adjudicationVerdictId: input.adjudication.verdictId,
      adjudicatedAt: input.adjudication.adjudicatedAt,
      attemptNumber: input.adjudication.attemptNumber,
      escalationMode: commission.escalationModes[0],
      resultKind: input.result.kind,
    }),
    rights,
    consent,
    payload,
    createdAt,
  });

  const digest = await digestCanonical(digestFreeView(view));
  const record: DeliverableRecord = Object.freeze({ ...view, digest });
  deepFreeze(record as unknown as PlainJsonValue);
  return record;
}

export function isDeliverableRecord(value: unknown): value is DeliverableRecord {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    candidate['deliverableVersion'] === DELIVERABLE_VERSION &&
    typeof candidate['deliverableId'] === 'string' &&
    /^del_[0-9a-f]{32}$/.test(candidate['deliverableId']) &&
    typeof candidate['commissionId'] === 'string' &&
    typeof candidate['tenantId'] === 'string' &&
    typeof candidate['recordKind'] === 'string' &&
    (DELIVERABLE_RECORD_KINDS as readonly string[]).includes(candidate['recordKind']) &&
    typeof candidate['digest'] === 'string' &&
    /^[0-9a-f]{64}$/.test(candidate['digest'])
  );
}

/**
 * THE RIGHTS WALL (structural, re-enforced at every assembly path):
 * a deliverable without GRANTED consent, outside the expected tenant, or
 * with a tampered digest can NEVER enter a dataset bundle. Recomputes the
 * content digest (tamper detection) and fails closed on any violation.
 */
export async function assertDeliverableRightsGated(
  record: unknown,
  expectedTenantId: string,
): Promise<DeliverableRecord> {
  if (!isDeliverableRecord(record)) {
    throw new HumanDataError(HUMAN_DATA_ERROR_CODES.INVALID_DELIVERABLE, {
      message: 'the value is not a structurally valid deliverable record',
    });
  }
  requireGrantedConsent(
    record.consent,
    `deliverable ${record.deliverableId} (commission ${record.commissionId})`,
  );
  if (record.tenantId !== expectedTenantId) {
    throw new HumanDataError(HUMAN_DATA_ERROR_CODES.CROSS_TENANT, {
      message: `cross-tenant dataset assembly rejected: deliverable ${record.deliverableId} belongs to tenant ${JSON.stringify(record.tenantId)}, not ${JSON.stringify(expectedTenantId)}`,
      details: { deliverableTenant: record.tenantId, expectedTenantId },
    });
  }
  const actual = await digestCanonical(digestFreeView(record));
  if (actual !== record.digest) {
    throw new HumanDataError(HUMAN_DATA_ERROR_CODES.TAMPERED, {
      message: `deliverable digest mismatch for ${record.deliverableId}: expected ${record.digest}, recomputed ${actual} (rights-metadata or payload tampering is detected)`,
      details: { expected: record.digest, actual },
    });
  }
  return record;
}

/** The evidence refs of a deliverable (lineage view helper). */
export function deliverableEvidenceRefs(record: DeliverableRecord): readonly string[] {
  return requireStringArray(record.payload.evidenceRefs, 'payload.evidenceRefs');
}
