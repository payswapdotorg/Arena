/**
 * Deterministic test fixtures for @arena/expert-calibration (Work Order
 * C004) — fixed capability refs, fixed timestamps, fixed digests and
 * scripted builders. No randomness, no clocks: every fixture is
 * byte-reproducible.
 */

import {
  createCalibrationProgram,
} from './program.js';
import type { CalibrationProgram } from './program.js';
import { createCalibrationRecord } from './record.js';
import type { CalibrationRecord } from './record.js';
import { createDriftVerdictRecord } from './verdict.js';
import type { DriftVerdictRecord } from './verdict.js';
import { derivePreTrainingTrack } from './pretraining.js';
import type { PreTrainingTrack } from './pretraining.js';
import type { CreateCalibrationProgramInput } from './program.js';
import type { CreateCalibrationRecordInput } from './record.js';

/** Fixed capability ref (A004 view; content-addressed). */
export const CAPABILITY_REF = Object.freeze({
  kind: 'capability',
  id: 'tax-audit-review',
  version: '1.0.0',
  digest: 'a'.repeat(64),
});

/** A second capability ref (disjoint from CAPABILITY_REF). */
export const OTHER_CAPABILITY_REF = Object.freeze({
  kind: 'capability',
  id: 'forensic-accounting',
  version: '1.0.0',
  digest: 'b'.repeat(64),
});

/** Fixed tenant / expert identities. */
export const TENANT_A = 'tenant-a';
export const TENANT_B = 'tenant-b';
export const EXPERT_1 = 'expert-1';

/** Fixed ms-precision UTC timestamps (deterministic anchors). */
export const T0 = '2026-10-01T00:00:00.000Z';
export const T1 = '2026-10-02T00:00:00.000Z';
export const T2 = '2026-10-03T00:00:00.000Z';
export const T3 = '2026-10-04T00:00:00.000Z';
export const T_LATE = '2027-04-01T00:00:00.000Z';

/** Fixed pinned environment versions. */
export const ENVIRONMENT_VERSIONS = Object.freeze([
  {
    namespace: 'arena',
    name: 'expert-workbench-env',
    version: '1.2.0',
    digest: 'c'.repeat(64),
  },
]);

/** A minimal valid program input (one probe, deterministic). */
export const PROGRAM_INPUT: CreateCalibrationProgramInput = {
  programId: 'calprog-tax-audit-1',
  tenant: TENANT_A,
  capability: { ...CAPABILITY_REF },
  probes: [
    {
      probeId: 'probe-prediction-1',
      capability: { ...CAPABILITY_REF },
      evaluator: {
        evaluatorType: 'rubric-evaluator',
        evaluatorVersion: '1.0.0',
        criteriaDigest: 'd'.repeat(64),
      },
      verifier: {
        verifierId: 'verifier-tax-audit',
        verifierVersion: '1.0.0',
        criteriaDigest: 'e'.repeat(64),
        minimumEvidence: { evidenceKind: 'work-product-ref', minimumCount: 2 },
      },
    },
  ],
  driftPolicy: { minimumSample: 3, tolerance: 0.1, freshnessWindowDays: 90 },
  requalificationPolicy: {
    freshnessWindowDays: 90,
    validityWindowDays: 180,
    triggers: ['time-window-elapsed', 'drift-verdict', 'domain-pack-change', 'dispute-raised'],
  },
  seed: 'seed-tax-audit-1',
  createdBy: 'tl-arena',
  createdAt: T0,
};

/** Build the canonical fixture program. */
export async function buildProgram(): Promise<CalibrationProgram> {
  return createCalibrationProgram(PROGRAM_INPUT);
}

/** Build one calibration record fixture. */
export async function buildCalibrationRecord(
  overrides: Partial<CreateCalibrationRecordInput> = {},
): Promise<CalibrationRecord> {
  const program = await buildProgram();
  return createCalibrationRecord({
    calibrationId: 'cal-record-1',
    tenant: TENANT_A,
    expertId: EXPERT_1,
    programDigest: program.digest,
    probeId: 'probe-prediction-1',
    predicted: { confidence: 0.8, score: null },
    observed: { outcome: 'correct', score: null },
    applicability: {
      capability: { ...CAPABILITY_REF },
      environment: ENVIRONMENT_VERSIONS.map((entry) => ({ ...entry })),
    },
    predictedAt: T1,
    observedAt: T2,
    provenance: { recordedBy: 'verifier-tax-audit', recordedAt: T2, notes: null },
    ...overrides,
  });
}

/** Build a drift-verdict record fixture. */
export async function buildVerdictRecord(
  overrides: Record<string, unknown> = {},
): Promise<DriftVerdictRecord> {
  const program = await buildProgram();
  return createDriftVerdictRecord({
    verdictId: 'cal-verdict-1',
    tenant: TENANT_A,
    expertId: EXPERT_1,
    programDigest: program.digest,
    verdict: 'calibrated',
    recordCount: 3,
    freshDecidedCount: 3,
    staleDecidedCount: 0,
    inconclusiveCount: 0,
    bias: 0.02,
    tolerance: 0.1,
    foldedRecordDigests: ['f'.repeat(64), '1'.repeat(64)],
    evaluatedAt: T3,
    rationale: null,
    ...overrides,
  });
}

/** Build a pre-training track fixture from a scripted gap list. */
export async function buildPreTrainingTrack(
  gaps: readonly { reason: string; itemId: string; routingInput: string }[] = [
    { reason: 'capability-unanswered', itemId: 'item-cap-1', routingInput: 'capability' },
    { reason: 'evidence-missing', itemId: 'item-ev-1', routingInput: 'evidence' },
  ],
): Promise<PreTrainingTrack> {
  return derivePreTrainingTrack(gaps, {
    trackId: 'pretrain-track-1',
    tenant: TENANT_A,
    expertId: EXPERT_1,
    intakeSessionId: 'intake-session-1',
    derivedAt: T1,
  });
}
